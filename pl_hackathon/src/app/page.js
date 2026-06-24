'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s/60) + 'm ago'
  if (s < 86400) return Math.floor(s/3600) + 'h ago'
  return Math.floor(s/86400) + 'd ago'
}
async function callAI(body) {
  const res = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export default function Home() {
  const [ledger, setLedger] = useState([])
  const [page, setPage] = useState('home')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [selectedVerdict, setSelectedVerdict] = useState('pending')
  const [verdictProof, setVerdictProof] = useState('')
  const [verdictNote, setVerdictNote] = useState('')
  const [modalAI, setModalAI] = useState(null)
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ask
  const [askInput, setAskInput] = useState('')
  const [askResult, setAskResult] = useState(null)
  const [asking, setAsking] = useState(false)
  const [askStage, setAskStage] = useState('')

  // add form
  const [addText, setAddText] = useState('')
  const [addWho, setAddWho] = useState('')
  const [addYoutube, setAddYoutube] = useState('')
  const [addWhen, setAddWhen] = useState('')
  const [addWhere, setAddWhere] = useState('')
  const [fingerprint, setFingerprint] = useState('')

  const toastTimer = useRef(null)

  useEffect(() => {
    // Load promises from DynamoDB on mount
    fetch('/api/promises')
      .then(r => r.json())
      .then(data => {
        if (data.items) setLedger(data.items)
      })
      .catch(() => {
        // Fallback to localStorage if DB fails
        const stored = localStorage.getItem('we_v2_ledger')
        if (stored) setLedger(JSON.parse(stored))
      })
  }, [])

  const persist = useCallback((nl) => {
    setLedger(nl)
    // Also keep localStorage as backup
    localStorage.setItem('we_v2_ledger', JSON.stringify(nl))
  }, [])

  useEffect(() => {
    if (!addText.trim()) { setFingerprint(''); return }
    hashText(addText.trim()).then(setFingerprint)
  }, [addText])

  const showToast = useCallback((msg, type = '') => {
    setToast({ msg, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  const stats = {
    total: ledger.length,
    kept: ledger.filter(p => p.status === 'kept').length,
    broken: ledger.filter(p => p.status === 'broken').length,
    pending: ledger.filter(p => p.status === 'pending').length,
  }

  // ── ASK WE (Tavily search + Claude analysis) ────────────────
  async function askWE() {
    if (!askInput.trim()) { showToast('Please type a promise or question.', 'error'); return }
    setAsking(true)
    setAskResult(null)
    setAskStage('🔍 Searching the web for latest news...')

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: askInput.trim() })
      })

      setAskStage('📊 Analysing results...')
      const result = await res.json()

      if (result.error) {
        showToast(result.error, 'error')
        setAskStage('')
        setAsking(false)
        return
      }

      setAskResult(result)
      setAskStage('')
    } catch (err) {
      showToast('Search failed. Please try again.', 'error')
      setAskStage('')
      console.error(err)
    }
    setAsking(false)
  }

  // ── SAVE PROMISE (manual add only) ───────────────────────────────
  async function savePromise() {
    if (!addText.trim()) { showToast('Please write what was promised.', 'error'); return }
    setSaving(true)
    const fp = await hashText(addText.trim())
    if (ledger.find(p => p.fp === fp)) {
      showToast('This promise is already saved!', 'error'); setSaving(false); return
    }
    const record = {
      id: uuid(), text: addText.trim(), fp,
      who: addWho.trim(), youtube: addYoutube.trim(),
      when: addWhen.trim(), where: addWhere.trim(),
      savedAt: Date.now(),
      status: 'pending', verdictHistory: [],
      source: 'manual'
    }
    // Save to DynamoDB
    fetch('/api/promises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).catch(console.error)
    persist([record, ...ledger])
    setAddText(''); setAddWho(''); setAddYoutube(''); setAddWhen(''); setAddWhere('')
    setSaving(false)
    showToast('Promise saved!', 'success')
    setPage('promises')
  }

  // ── MODAL ────────────────────────────────────────────────────────
  function openModal(p) {
    setModal(p); setSelectedVerdict(p.status)
    setVerdictProof(''); setVerdictNote(''); setModalAI(null)
    document.body.style.overflow = 'hidden'
  }
  function closeModal() { setModal(null); document.body.style.overflow = '' }

  function submitVerdict() {
    if (!modal) return
    setSubmitting(true)
    setTimeout(() => {
      const updated = ledger.map(p => {
        if (p.id !== modal.id) return p
        const h = [...(p.verdictHistory||[]), { status: selectedVerdict, note: verdictNote, proof: verdictProof, at: Date.now() }]
        return { ...p, status: selectedVerdict, verdictHistory: h }
      })
      persist(updated)
      // Update DynamoDB
      const updatedP = updated.find(p => p.id === modal.id)
      if (updatedP) {
        fetch('/api/promises', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: updatedP.id, status: updatedP.status, verdictHistory: updatedP.verdictHistory })
        }).catch(console.error)
      }
      setModal(updated.find(p => p.id === modal.id))
      setVerdictProof(''); setVerdictNote(''); setSubmitting(false)
      showToast('Verdict updated!', 'success')
    }, 500)
  }

  async function runModalAI() {
    if (!modal) return
    setModalAI('loading')
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: modal.text + (modal.who ? ' by ' + modal.who : '') })
      })
      const result = await res.json()
      if (result.error) { setModalAI({ error: result.error }); return }
      setModalAI(result)
      if (['fulfilled','broken','pending'].includes(result.verdict) && result.confidence === 'high') {
        const ns = result.verdict === 'fulfilled' ? 'kept' : result.verdict === 'broken' ? 'broken' : 'pending'
        const updated = ledger.map(p => {
          if (p.id !== modal.id) return p
          const h = [...(p.verdictHistory||[]), {status:ns, note:`[AI] ${result.current_status}`, proof:result.sources?.[0]?.url||'', at:Date.now(), byAI:true}]
          return {...p, status:ns, verdictHistory:h}
        })
        persist(updated)
        setModal(updated.find(p => p.id === modal.id))
        setSelectedVerdict(ns)
      }
    } catch(err) { setModalAI({ error: err.message }) }
  }


  // helpers
  const vIcon = v => v==='fulfilled'||v==='kept'?'✅':v==='broken'?'❌':v==='partial'?'🔄':v==='unknown'?'❓':'⏳'
  const vLabel = v => v==='fulfilled'||v==='kept'?'Fulfilled':v==='broken'?'Broken':v==='partial'?'Partially Fulfilled':v==='unknown'?'Unknown':'Pending'
  const vCls = v => v==='fulfilled'||v==='kept'?'fulfilled':v==='broken'?'broken':v==='partial'?'partial':'pending'
  const sIcon = s => s==='kept'?'✅':s==='broken'?'❌':'⏳'
  const sLabel = s => s==='kept'?'Fulfilled':s==='broken'?'Broken':'Pending'
  const filtered = filter==='all'?ledger.filter(p=>p.source==='manual'):ledger.filter(p=>p.source==='manual'&&p.status===filter)

  const ScoreRing = ({ val, label, color }) => {
    const r = 28, circ = 2*Math.PI*r
    const dash = (val/100)*circ
    return (
      <div style={{textAlign:'center',flex:1}}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={r} fill="none" stroke="#e8e0d4" strokeWidth="7"/>
          <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            transform="rotate(-90 36 36)" style={{transition:'stroke-dasharray 1s ease'}}/>
          <text x="36" y="41" textAnchor="middle" fill={color} fontSize="14" fontWeight="700" fontFamily="Nunito,sans-serif">{val}%</text>
        </svg>
        <div style={{fontSize:11,color:'#8a7060',marginTop:2,fontWeight:600}}>{label}</div>
      </div>
    )
  }

  const VerdictBar = ({ val }) => {
    const color = val>=70?'#4ade80':val>=40?'#fbbf24':'#f87171'
    return (
      <div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#8a7060',marginBottom:6}}>
          <span>Fulfillment Likelihood</span><span style={{fontWeight:700,color,fontSize:13}}>{val}%</span>
        </div>
        <div style={{height:10,background:'#f2ebe0',borderRadius:100,overflow:'hidden',position:'relative'}}>
          <div style={{height:'100%',width:`${val}%`,background:`linear-gradient(90deg, ${color}88, ${color})`,borderRadius:100,transition:'width 1.2s ease',boxShadow:`0 0 8px ${color}66`}}/>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        :root {
          --bg: #faf7f2;
          --surface: #ffffff;
          --surface2: #f2ebe0;
          --border: #e8e0d4;
          --border2: #d8cdb8;
          --red: #c0392b;
          --red2: #e63329;
          --red-soft: rgba(192,57,43,0.08);
          --green: #1a7a4a;
          --green-soft: rgba(26,122,74,0.1);
          --yellow: #b8860b;
          --yellow-soft: rgba(184,134,11,0.1);
          --blue: #2563eb;
          --blue-soft: rgba(37,99,235,0.08);
          --text: #2d1f14;
          --text2: #5c3d2e;
          --text3: #8a7060;
          --shadow: 0 2px 16px rgba(45,31,20,0.08);
          --shadow-lg: 0 8px 32px rgba(45,31,20,0.14);
          --radius: 14px;
          --radius-lg: 20px;
        }
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        html { scroll-behavior: smooth; }
        body { background:var(--bg); color:var(--text); font-family:'Nunito',sans-serif; min-height:100vh; overflow-x:hidden; }

        /* SCROLLBAR */
        ::-webkit-scrollbar { width:6px; }
        ::-webkit-scrollbar-track { background:var(--surface); }
        ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:3px; }

        /* NAV */
        nav { background:rgba(250,247,242,0.95); border-bottom:1px solid var(--border); padding:0 24px; position:sticky; top:0; z-index:200; backdrop-filter:blur(12px); }
        .nav-inner { max-width:960px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; height:62px; }
        .logo { display:flex; align-items:center; gap:12px; cursor:pointer; }
        .logo-mark { width:38px; height:38px; background:var(--red); border-radius:10px; display:flex; align-items:center; justify-content:center; font-family:'Fraunces',serif; font-size:20px; font-weight:700; color:#fff; box-shadow:0 0 16px rgba(230,51,41,0.4); }
        .logo-text { font-family:'Fraunces',serif; font-size:22px; font-weight:700; color:var(--text); letter-spacing:1px; }
        .logo-text span { color:var(--red); }
        .logo-sub { font-size:10px; color:var(--text3); margin-top:-3px; letter-spacing:2px; text-transform:uppercase; }
        .nav-right { display:flex; align-items:center; gap:8px; }
        .nav-stat { font-size:11px; color:var(--text3); background:var(--surface); border:1px solid var(--border); padding:5px 12px; border-radius:100px; }
        .nav-stat span { color:var(--red); font-weight:700; }

        /* HERO */
        .hero { max-width:960px; margin:0 auto; padding:64px 24px 48px; }
        .hero-top { display:grid; grid-template-columns:1fr 1fr; gap:48px; align-items:center; margin-bottom:56px; }
        @media(max-width:640px) { .hero-top { grid-template-columns:1fr; gap:32px; } }
        .hero-badge { display:inline-flex; align-items:center; gap:7px; background:var(--red-soft); border:1px solid rgba(230,51,41,0.3); color:var(--red); font-size:11px; font-weight:700; padding:6px 14px; border-radius:100px; margin-bottom:20px; letter-spacing:1px; text-transform:uppercase; }
        .hero h1 { font-family:'Fraunces',serif; font-size:clamp(36px,6vw,58px); font-weight:700; line-height:1.1; margin-bottom:16px; color:var(--text); }
        .hero h1 em { font-style:italic; color:var(--red); }
        .hero-desc { font-size:15px; line-height:1.8; color:var(--text2); margin-bottom:28px; }
        .hero-vm { display:flex; flex-direction:column; gap:14px; }
        .vm-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
        .vm-card-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:var(--red); margin-bottom:6px; }
        .vm-card-text { font-size:13px; line-height:1.7; color:var(--text2); }

        /* STAT STRIP */
        .stat-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:56px; }
        @media(max-width:560px) { .stat-strip { grid-template-columns:repeat(2,1fr); } }
        .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; text-align:center; }
        .stat-num { font-family:'Fraunces',serif; font-size:32px; font-weight:700; line-height:1; }
        .stat-num.red { color:var(--red); }
        .stat-num.green { color:var(--green); }
        .stat-num.yellow { color:var(--yellow); }
        .stat-num.white { color:var(--text); }
        .stat-lbl { font-size:11px; color:var(--text3); margin-top:5px; font-weight:600; letter-spacing:0.5px; }

        /* BIG 4 BUTTONS */
        .four-btns { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
        @media(max-width:560px) { .four-btns { grid-template-columns:1fr; } }
        .big-btn { border:1.5px solid var(--border); border-radius:var(--radius-lg); padding:28px 24px; cursor:pointer; transition:all 0.25s; background:var(--surface); text-align:left; position:relative; overflow:hidden; }
        .big-btn::before { content:''; position:absolute; inset:0; opacity:0; transition:opacity .25s; }
        .big-btn.ask::before { background:radial-gradient(circle at top left, rgba(230,51,41,0.15), transparent 60%); }
        .big-btn.add::before { background:radial-gradient(circle at top left, rgba(74,222,128,0.1), transparent 60%); }
        .big-btn.promises::before { background:radial-gradient(circle at top left, rgba(251,191,36,0.1), transparent 60%); }
        .big-btn.about-btn::before { background:radial-gradient(circle at top left, rgba(96,165,250,0.1), transparent 60%); }
        .big-btn:hover { transform:translateY(-3px); box-shadow:var(--shadow-lg); border-color:var(--border2); }
        .big-btn:hover::before { opacity:1; }
        .big-btn.ask:hover { border-color:rgba(230,51,41,0.5); }
        .big-btn.add:hover { border-color:rgba(74,222,128,0.4); }
        .big-btn.promises:hover { border-color:rgba(251,191,36,0.4); }
        .big-btn.about-btn:hover { border-color:rgba(96,165,250,0.4); }
        .big-btn.active-tab { border-color:var(--red); background:var(--surface2); }
        .bb-icon { font-size:32px; margin-bottom:14px; display:block; }
        .bb-title { font-family:'Fraunces',serif; font-size:22px; font-weight:700; color:var(--text); margin-bottom:6px; }
        .bb-desc { font-size:13px; color:var(--text3); line-height:1.6; }
        .bb-arrow { position:absolute; right:20px; top:50%; transform:translateY(-50%); font-size:20px; color:var(--border2); transition:all .2s; }
        .big-btn:hover .bb-arrow { color:var(--text2); transform:translateY(-50%) translateX(4px); }

        /* MAIN CONTAINER */
        .main { max-width:960px; margin:0 auto; padding:0 24px 80px; }

        /* PAGE HEADER */
        .page-header { display:flex; align-items:center; gap:14px; margin-bottom:28px; padding-bottom:20px; border-bottom:1px solid var(--border); }
        .page-back { width:36px; height:36px; border-radius:50%; background:var(--surface); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text2); font-size:16px; transition:all .2s; flex-shrink:0; }
        .page-back:hover { background:var(--surface2); color:var(--text); border-color:var(--border2); }
        .page-title { font-family:'Fraunces',serif; font-size:24px; font-weight:700; color:var(--text); }
        .page-subtitle { font-size:13px; color:var(--text3); margin-top:2px; }

        /* ASK PAGE */
        .ask-wrap { background:var(--surface); border:1.5px solid var(--border); border-radius:var(--radius-lg); padding:28px; margin-bottom:20px; }
        .ask-wrap:focus-within { border-color:var(--red); box-shadow:0 0 0 3px rgba(230,51,41,0.1); }
        .ask-textarea { width:100%; background:transparent; border:none; outline:none; color:var(--text); font-family:'Nunito',sans-serif; font-size:16px; line-height:1.7; resize:none; }
        .ask-textarea::placeholder { color:var(--text3); }
        .ask-divider { height:1px; background:var(--border); margin:16px 0; }
        .ask-examples { display:flex; flex-wrap:wrap; gap:8px; }
        .ask-ex { padding:6px 14px; background:var(--surface2); border:1px solid var(--border); border-radius:100px; font-size:12px; color:var(--text3); cursor:pointer; transition:all .2s; font-weight:600; }
        .ask-ex:hover { background:var(--red-soft); border-color:rgba(230,51,41,0.4); color:var(--red); }
        .ask-actions { display:flex; align-items:center; gap:12px; margin-top:18px; }
        .ask-hint { font-size:11px; color:var(--text3); }

        /* LOADING STAGES */
        .loading-stages { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:24px; text-align:center; margin-bottom:20px; }
        .ls-icon { font-size:32px; display:block; margin-bottom:12px; animation:spin .7s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .ls-text { font-size:14px; color:var(--text2); line-height:1.6; }
        .ls-dots { display:flex; justify-content:center; gap:6px; margin-top:14px; }
        .ls-dot { width:7px; height:7px; border-radius:50%; background:var(--border2); animation:dotpulse 1.4s ease-in-out infinite; }
        .ls-dot:nth-child(2) { animation-delay:.2s; }
        .ls-dot:nth-child(3) { animation-delay:.4s; }
        @keyframes dotpulse { 0%,80%,100%{background:var(--border2)} 40%{background:var(--red)} }

        /* RESULT */
        .result { border:1px solid var(--border); border-radius:var(--radius-lg); overflow:hidden; animation:fadeUp .4s ease; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .result-hero { padding:22px 24px; position:relative; overflow:hidden; }
        .result-hero.fulfilled { background:linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.04)); border-bottom:1px solid rgba(74,222,128,0.2); }
        .result-hero.broken { background:linear-gradient(135deg, rgba(230,51,41,0.14), rgba(230,51,41,0.04)); border-bottom:1px solid rgba(230,51,41,0.25); }
        .result-hero.partial { background:linear-gradient(135deg, rgba(96,165,250,0.12), rgba(96,165,250,0.04)); border-bottom:1px solid rgba(96,165,250,0.2); }
        .result-hero.pending { background:linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.03)); border-bottom:1px solid rgba(251,191,36,0.2); }
        .result-hero.unknown { background:var(--surface); border-bottom:1px solid var(--border); }
        .rh-top { display:flex; align-items:flex-start; gap:16px; margin-bottom:14px; }
        .rh-big-icon { font-size:36px; flex-shrink:0; }
        .rh-info { flex:1; }
        .rh-verdict { font-family:'Fraunces',serif; font-size:24px; font-weight:700; color:var(--text); display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .rh-conf { font-size:11px; font-weight:700; padding:3px 10px; border-radius:100px; }
        .conf-high { background:rgba(74,222,128,0.15); color:var(--green); }
        .conf-medium { background:rgba(251,191,36,0.15); color:var(--yellow); }
        .conf-low { background:var(--surface2); color:var(--text3); }
        .rh-meta { display:flex; flex-wrap:wrap; gap:8px 20px; font-size:12px; color:var(--text3); }
        .rh-meta-item { display:flex; align-items:center; gap:5px; }
        .rh-meta-item span { color:var(--text2); font-weight:600; }
        .result-body { padding:22px 24px; background:var(--surface); }

        /* SCORES ROW */
        .scores-row { display:flex; gap:8px; margin-bottom:22px; padding:18px; background:var(--surface2); border-radius:var(--radius); border:1px solid var(--border); }

        /* SECTIONS */
        .rs { margin-bottom:22px; }
        .rs-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:var(--text3); margin-bottom:12px; display:flex; align-items:center; gap:7px; }
        .rs-title::after { content:''; flex:1; height:1px; background:var(--border); }
        .status-text { font-size:14px; line-height:1.85; color:var(--text2); }

        /* TIMELINE */
        .timeline { display:flex; flex-direction:column; gap:0; }
        .tl-item { display:flex; gap:14px; align-items:flex-start; }
        .tl-left { display:flex; flex-direction:column; align-items:center; width:36px; flex-shrink:0; }
        .tl-dot { width:10px; height:10px; border-radius:50%; background:var(--red); flex-shrink:0; margin-top:4px; box-shadow:0 0 6px rgba(230,51,41,0.5); }
        .tl-line { width:2px; background:var(--border); flex:1; min-height:20px; }
        .tl-year { font-size:11px; font-weight:700; color:var(--red); min-width:36px; text-align:center; }
        .tl-event { font-size:13px; color:var(--text2); line-height:1.6; padding-bottom:16px; flex:1; }

        /* FINDINGS */
        .findings { display:flex; flex-direction:column; gap:8px; }
        .finding { display:flex; gap:10px; align-items:flex-start; }
        .finding-bullet { width:6px; height:6px; border-radius:50%; background:var(--red); flex-shrink:0; margin-top:6px; }
        .finding-text { font-size:13px; color:var(--text2); line-height:1.6; }

        /* ADV/DIS */
        .adv-dis { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media(max-width:500px) { .adv-dis { grid-template-columns:1fr; } }
        .adv-box { background:rgba(74,222,128,0.06); border:1px solid rgba(74,222,128,0.15); border-radius:var(--radius); padding:16px; }
        .dis-box { background:rgba(230,51,41,0.06); border:1px solid rgba(230,51,41,0.15); border-radius:var(--radius); padding:16px; }
        .ad-title { font-size:12px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:5px; }
        .ad-title.adv { color:var(--green); }
        .ad-title.dis { color:var(--red2); }
        .ad-item { font-size:12px; color:var(--text2); line-height:1.6; margin-bottom:6px; padding-left:14px; position:relative; }
        .ad-item::before { content:'•'; position:absolute; left:0; }

        /* IMPACT CARDS */
        .impact-cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media(max-width:500px) { .impact-cards { grid-template-columns:1fr; } }
        .impact-card { background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; }
        .impact-card-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:var(--text3); margin-bottom:6px; }
        .impact-card-text { font-size:13px; color:var(--text2); line-height:1.6; }

        /* SOURCES */
        .src { display:flex; gap:12px; padding:12px 14px; background:var(--surface2); border-radius:var(--radius); border:1px solid var(--border); margin-bottom:8px; }
        .src-body { flex:1; min-width:0; }
        .src-title { font-size:13px; font-weight:600; color:var(--text); margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .src-snippet { font-size:12px; color:var(--text3); line-height:1.5; }
        .src-footer { display:flex; gap:12px; margin-top:5px; align-items:center; }
        .src-link { font-size:11px; color:var(--red); font-weight:700; text-decoration:none; }
        .src-link:hover { color:var(--red2); }
        .src-date { font-size:10px; color:var(--text3); }
        .src-cred { font-size:10px; font-weight:700; padding:2px 7px; border-radius:100px; }
        .cred-high { background:rgba(74,222,128,0.1); color:var(--green); }
        .cred-medium { background:rgba(251,191,36,0.1); color:var(--yellow); }

        /* AI NOTE */
        .ai-note { font-size:11px; color:var(--text3); padding:10px 14px; background:var(--surface2); border-radius:8px; border-left:2px solid var(--border2); line-height:1.6; margin-top:14px; }

        /* BUTTONS */
        .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:12px 24px; font-family:'Nunito',sans-serif; font-size:14px; font-weight:700; border:none; border-radius:var(--radius); cursor:pointer; transition:all .2s; }
        .btn-red { background:var(--red); color:#fff; box-shadow:0 4px 14px rgba(230,51,41,0.35); }
        .btn-red:hover { background:#cc2d24; transform:translateY(-1px); box-shadow:0 6px 20px rgba(230,51,41,0.45); }
        .btn-ghost { background:var(--surface2); color:var(--text2); border:1px solid var(--border); }
        .btn-ghost:hover { background:var(--surface); color:var(--text); border-color:var(--border2); }
        .btn-sm { padding:8px 16px; font-size:12px; border-radius:10px; }
        .btn:disabled { opacity:.45; cursor:not-allowed; transform:none!important; }

        /* FORM */
        .form-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:28px; }
        .field { margin-bottom:18px; }
        .field-label { font-size:13px; font-weight:700; color:var(--text2); margin-bottom:7px; display:flex; align-items:center; gap:8px; }
        .opt-tag { font-size:10px; font-weight:600; color:var(--text3); background:var(--surface2); border:1px solid var(--border); padding:2px 8px; border-radius:100px; }
        input[type=text],input[type=date],input[type=url],textarea,input[type=datetime-local] { width:100%; background:var(--surface2); border:1.5px solid var(--border); color:var(--text); padding:12px 15px; font-family:'Nunito',sans-serif; font-size:14px; border-radius:var(--radius); outline:none; transition:border-color .2s,box-shadow .2s; resize:vertical; }
        input:focus,textarea:focus { border-color:var(--red); box-shadow:0 0 0 3px rgba(230,51,41,0.1); }
        input::placeholder,textarea::placeholder { color:var(--text3); }
        .input-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media(max-width:500px) { .input-row { grid-template-columns:1fr; } }

        /* PROMISE CARDS */
        .promise-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:18px 20px; margin-bottom:10px; cursor:pointer; transition:all .2s; }
        .promise-card:hover { border-color:var(--border2); background:var(--surface2); transform:translateX(4px); }
        .pc-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; }
        .pc-text { font-size:14px; line-height:1.6; color:var(--text); flex:1; font-weight:500; }
        .s-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; border-radius:100px; font-size:11px; font-weight:700; white-space:nowrap; flex-shrink:0; }
        .s-pending { background:var(--yellow-soft); color:var(--yellow); border:1px solid rgba(251,191,36,0.25); }
        .s-kept { background:var(--green-soft); color:var(--green); border:1px solid rgba(74,222,128,0.25); }
        .s-broken { background:var(--red-soft); color:var(--red2); border:1px solid rgba(230,51,41,0.25); }
        .pc-meta { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:var(--text3); border-top:1px solid var(--border); padding-top:9px; margin-top:6px; }
        .pc-tap { font-size:12px; color:var(--red); font-weight:600; margin-top:7px; }

        /* FILTER */
        .filter-bar { display:flex; gap:7px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
        .f-btn { padding:6px 14px; border-radius:10px; font-size:12px; font-weight:600; cursor:pointer; border:1.5px solid var(--border); background:var(--surface); color:var(--text3); transition:all .2s; }
        .f-btn:hover { color:var(--text); border-color:var(--border2); }
        .f-btn.active { background:var(--red-soft); border-color:rgba(230,51,41,0.4); color:var(--red); }
        .f-btn.fg.active { background:var(--green-soft); border-color:rgba(74,222,128,0.3); color:var(--green); }
        .f-btn.fy.active { background:var(--yellow-soft); border-color:rgba(251,191,36,0.3); color:var(--yellow); }

        /* EMPTY */
        .empty { text-align:center; padding:56px 24px; color:var(--text3); }
        .empty-icon { font-size:48px; display:block; margin-bottom:14px; }
        .empty h3 { font-family:'Fraunces',serif; font-size:18px; color:var(--text2); margin-bottom:8px; }
        .empty p { font-size:13px; line-height:1.6; max-width:280px; margin:0 auto; }

        /* MODAL */
        .overlay { position:fixed; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(6px); z-index:300; display:flex; align-items:flex-start; justify-content:center; padding:20px; overflow-y:auto; }
        .modal { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); width:100%; max-width:620px; box-shadow:0 32px 80px rgba(0,0,0,0.7); margin:auto; animation:fadeUp .3s ease; }
        .modal-head { padding:22px 24px 0; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .modal-ttl { font-family:'Fraunces',serif; font-size:18px; font-weight:700; color:var(--text); line-height:1.3; }
        .modal-close { width:32px; height:32px; border-radius:50%; background:var(--surface2); border:none; cursor:pointer; font-size:16px; color:var(--text3); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .modal-close:hover { background:var(--border); color:var(--text); }
        .modal-body { padding:18px 24px 24px; }
        .modal-promise { font-size:14px; line-height:1.7; color:var(--text2); background:var(--surface2); border-radius:var(--radius); padding:14px; margin-bottom:16px; font-style:italic; border-left:3px solid var(--red); }
        .drow { display:flex; gap:10px; font-size:13px; padding:6px 0; border-bottom:1px solid var(--border); }
        .drow:last-child { border-bottom:none; }
        .dk { color:var(--text3); font-weight:700; min-width:100px; flex-shrink:0; }
        .dv { color:var(--text2); word-break:break-word; }
        .vs-h3 { font-family:'Fraunces',serif; font-size:15px; font-weight:700; color:var(--text); margin:18px 0 12px; }
        .vc { border-radius:var(--radius); padding:14px; margin-bottom:14px; }
        .vc-kept { background:var(--green-soft); border:1px solid rgba(74,222,128,0.2); }
        .vc-broken { background:var(--red-soft); border:1px solid rgba(230,51,41,0.2); }
        .vc-pending { background:var(--yellow-soft); border:1px solid rgba(251,191,36,0.2); }
        .vc-top { display:flex; align-items:center; gap:9px; margin-bottom:6px; }
        .vc-icon { font-size:18px; }
        .vc-lbl { font-size:14px; font-weight:700; }
        .vc-kept .vc-lbl { color:var(--green); } .vc-broken .vc-lbl { color:var(--red2); } .vc-pending .vc-lbl { color:var(--yellow); }
        .vc-note { font-size:12px; color:var(--text3); line-height:1.5; }
        .upd-form { background:var(--surface2); border:1.5px dashed var(--border); border-radius:var(--radius); padding:16px; margin-bottom:14px; }
        .upd-form h4 { font-size:12px; font-weight:700; color:var(--text2); margin-bottom:10px; }
        .vo-row { display:flex; gap:7px; margin-bottom:12px; flex-wrap:wrap; }
        .vo { padding:7px 14px; border-radius:9px; font-size:12px; font-weight:700; cursor:pointer; border:1.5px solid var(--border); background:var(--surface); color:var(--text3); transition:all .2s; }
        .vo-k.sel { background:var(--green-soft); border-color:var(--green); color:var(--green); }
        .vo-b.sel { background:var(--red-soft); border-color:var(--red2); color:var(--red2); }
        .vo-p.sel { background:var(--yellow-soft); border-color:var(--yellow); color:var(--yellow); }
        .hist h4 { font-size:11px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:1px; margin:14px 0 9px; }
        .hi { display:flex; gap:9px; padding:7px 0; border-bottom:1px solid var(--border); }
        .hi:last-child { border-bottom:none; }
        .hi-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-top:4px; }
        .hi-dot-kept { background:var(--green); } .hi-dot-broken { background:var(--red2); } .hi-dot-pending { background:var(--yellow); }
        .hi-text { font-size:12px; color:var(--text3); line-height:1.5; }
        .hi-text strong { color:var(--text2); }

        /* TOAST */
        .toast-wrap { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:999; pointer-events:none; }
        .toast { padding:11px 22px; border-radius:14px; font-size:14px; font-weight:600; box-shadow:0 8px 32px rgba(0,0,0,0.5); animation:fadeUp .35s ease; max-width:380px; text-align:center; }
        .toast.success { background:var(--green); color:#000; }
        .toast.error { background:var(--red); color:#fff; }
        .toast.default { background:var(--text); color:#fff; border:1px solid var(--border); }

        /* SKEL */
        .skel { height:11px; background:var(--surface2); border-radius:6px; animation:pulse 1.4s ease-in-out infinite; margin-bottom:8px; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
      `}</style>

      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <div className="logo" onClick={() => setPage('home')}>
            <div className="logo-mark">W</div>
            <div>
              <div className="logo-text">W<span>E</span></div>
              <div className="logo-sub">Hold Power Accountable</div>
            </div>
          </div>
          <div className="nav-right">
            <div className="nav-stat">Tracked: <span>{stats.total}</span></div>
            <div className="nav-stat">✅ <span>{stats.kept}</span> · ❌ <span>{stats.broken}</span></div>
          </div>
        </div>
      </nav>

      {/* HOME */}
      {page === 'home' && (
        <div>
          <div className="hero">
            {/* Top: headline + vision/mission */}
            <div className="hero-top">
              <div>
                <div className="hero-badge">⚖️ Political Accountability AI</div>
                <h1>Did They <em>Really</em> Keep Their Promise?</h1>
                <p className="hero-desc">WE uses AI and live web search to tell you the truth about political promises — what was said, when, and whether it was actually delivered.</p>
              </div>
              <div className="hero-vm">
                <div className="vm-card">
                  <div className="vm-card-label">🎯 Our Mission</div>
                  <div className="vm-card-text">To make every political promise permanently trackable, searchable, and accountable — powered by real-time AI research so citizens always know the truth.</div>
                </div>
                <div className="vm-card">
                  <div className="vm-card-label">🌟 Our Vision</div>
                  <div className="vm-card-text">A democracy where no promise is forgotten, no commitment is hidden, and every citizen has instant access to the facts — regardless of political affiliation.</div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="stat-strip">
              <div className="stat-card"><div className="stat-num white">{stats.total}</div><div className="stat-lbl">Promises Tracked</div></div>
              <div className="stat-card"><div className="stat-num green">{stats.kept}</div><div className="stat-lbl">✅ Fulfilled</div></div>
              <div className="stat-card"><div className="stat-num red">{stats.broken}</div><div className="stat-lbl">❌ Broken</div></div>
              <div className="stat-card"><div className="stat-num yellow">{stats.pending}</div><div className="stat-lbl">⏳ Pending</div></div>
            </div>

            {/* 4 Big Buttons */}
            <div className="four-btns">
              <div className={`big-btn ask${page==='ask'?' active-tab':''}`} onClick={() => setPage('ask')}>
                <span className="bb-icon">💬</span>
                <div className="bb-title">Ask WE</div>
                <div className="bb-desc">Ask about any promise or scheme. Get deep AI insights — status, impact, sustainability, and live sources.</div>
                <span className="bb-arrow">→</span>
              </div>
              <div className={`big-btn add${page==='add'?' active-tab':''}`} onClick={() => setPage('add')}>
                <span className="bb-icon">✍️</span>
                <div className="bb-title">Add a Promise</div>
                <div className="bb-desc">Record a political promise with proof. Add a YouTube link, who said it, and when.</div>
                <span className="bb-arrow">→</span>
              </div>
              <div className={`big-btn promises${page==='promises'?' active-tab':''}`} onClick={() => setPage('promises')}>
                <span className="bb-icon">📋</span>
                <div className="bb-title">All Promises</div>
                <div className="bb-desc">Browse all manually recorded promises. Filter by status. Click to get the latest AI verdict.</div>
                <span className="bb-arrow">→</span>
              </div>
              <div className="big-btn about-btn" onClick={() => setPage('about')}>
                <span className="bb-icon">ℹ️</span>
                <div className="bb-title">How WE Works</div>
                <div className="bb-desc">Learn how WE uses agentic AI to search the live web and deliver honest, up-to-date accountability.</div>
                <span className="bb-arrow">→</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="main">

        {/* ═══ ASK WE ═══ */}
        {page === 'ask' && (
          <div>
            <div className="page-header">
              <div className="page-back" onClick={() => setPage('home')}>←</div>
              <div>
                <div className="page-title">💬 Ask WE</div>
                <div className="page-subtitle">Type any promise or scheme — WE searches the latest news and gives you deep insights</div>
              </div>
            </div>

            <div className="ask-wrap">
              <textarea className="ask-textarea" rows={4}
                placeholder="e.g. XYZ party's promise to build new highways  Or: ABC government's free electricity scheme  Or: A leader's pledge to create jobs"
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); askWE() } }}
              />
              <div className="ask-divider"/>
              <div style={{fontSize:11,color:'var(--text3)',marginBottom:10,fontWeight:600}}>Try these:</div>
              <div className="ask-examples">
                {['Free education promise by a party','Women safety force scheme','2 crore jobs per year promise','Smart cities mission update','Free electricity to farmers','Bullet train project status'].map(ex => (
                  <span key={ex} className="ask-ex" onClick={() => setAskInput(ex)}>{ex}</span>
                ))}
              </div>
            </div>
            <div className="ask-actions">
              <button className="btn btn-red" disabled={asking} onClick={askWE} style={{fontSize:15,padding:'13px 32px'}}>
                {asking ? <><span style={{display:'inline-block',animation:'spin .7s linear infinite'}}>⟳</span> Searching...</> : '🔍 Ask WE Now'}
              </button>
              {askResult && <button className="btn btn-ghost btn-sm" onClick={() => { setAskResult(null); setAskInput('') }}>Clear</button>}
            </div>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:10,marginBottom:20}}>Press Enter or click Ask WE · Searches live web for latest 2025-2026 updates</div>

            {asking && (
              <div className="loading-stages">
                <span className="ls-icon">🔍</span>
                <div className="ls-text">{askStage || 'WE is searching the live web for the latest information...'}<br /><span style={{fontSize:12,color:'var(--text3)'}}>This takes 15–25 seconds for deep research</span></div>
                <div className="ls-dots"><div className="ls-dot"/><div className="ls-dot"/><div className="ls-dot"/></div>
              </div>
            )}

            {askResult && !asking && (() => {
              const r = askResult
              const vc = vCls(r.verdict)
              const confCls = r.confidence==='high'?'conf-high':r.confidence==='medium'?'conf-medium':'conf-low'
              const confLbl = r.confidence==='high'?'High Confidence':r.confidence==='medium'?'Medium Confidence':'Low Confidence'
              return (
                <div className="result">
                  <div className={`result-hero ${vc}`}>
                    <div className="rh-top">
                      <div className="rh-big-icon">{vIcon(r.verdict)}</div>
                      <div className="rh-info">
                        <div className="rh-verdict">
                          {vLabel(r.verdict)}
                          <span className={`rh-conf ${confCls}`}>{confLbl}</span>
                        </div>
                        <div className="rh-meta" style={{marginTop:8}}>
                          {r.made_by&&<div className="rh-meta-item">👤 <span>{r.made_by}</span></div>}
                          {r.made_when&&<div className="rh-meta-item">📅 <span>{r.made_when}</span></div>}
                          {r.made_where&&<div className="rh-meta-item">📍 <span>{r.made_where}</span></div>}
                          <div className="rh-meta-item">🔎 Searched: <span>{r.searched_on||'June 2026'}</span></div>
                        </div>
                      </div>
                    </div>
                    {/* Score rings */}
                    {(r.fulfillment_likelihood_pct!==undefined||r.people_impact_score!==undefined) && (
                      <div className="scores-row">
                        {r.fulfillment_likelihood_pct!==undefined&&<ScoreRing val={r.fulfillment_likelihood_pct} label="Fulfillment Likelihood" color={r.fulfillment_likelihood_pct>=70?'#1a7a4a':r.fulfillment_likelihood_pct>=40?'#b8860b':'#c0392b'}/>}
                        {r.people_impact_score!==undefined&&<ScoreRing val={r.people_impact_score} label="People Impact" color="#2563eb"/>}
                        {r.fulfillment_likelihood_pct!==undefined&&(
                          <div style={{flex:2,alignSelf:'center',paddingLeft:8}}>
                            <VerdictBar val={r.fulfillment_likelihood_pct}/>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="result-body">
                    {/* Current Status */}
                    <div className="rs">
                      <div className="rs-title">📰 What Actually Happened</div>
                      <div className="status-text">{r.current_status || 'WE searched the web but could not find specific information about this promise. Try rephrasing your query with more details.'}</div>
                    </div>

                    {/* Timeline */}
                    {r.timeline?.length>0 && (
                      <div className="rs">
                        <div className="rs-title">📅 Timeline</div>
                        <div className="timeline">
                          {r.timeline.map((t,i)=>(
                            <div key={i} className="tl-item">
                              <div className="tl-left">
                                <div className="tl-year">{t.year}</div>
                                <div className="tl-dot" style={{marginTop:4}}/>
                                {i<r.timeline.length-1&&<div className="tl-line"/>}
                              </div>
                              <div className="tl-event">{t.event}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Findings */}
                    {r.key_findings?.length>0 && (
                      <div className="rs">
                        <div className="rs-title">🔑 Key Findings</div>
                        <div className="findings">
                          {r.key_findings.map((f,i)=>(
                            <div key={i} className="finding"><div className="finding-bullet"/><div className="finding-text">{f}</div></div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Advantages & Disadvantages */}
                    {(r.advantages?.length>0||r.disadvantages?.length>0) && (
                      <div className="rs">
                        <div className="rs-title">⚖️ Advantages vs Risks</div>
                        <div className="adv-dis">
                          {r.advantages?.length>0&&<div className="adv-box"><div className="ad-title adv">👍 If Fulfilled</div>{r.advantages.map((a,i)=><div key={i} className="ad-item">{a}</div>)}</div>}
                          {r.disadvantages?.length>0&&<div className="dis-box"><div className="ad-title dis">⚠️ Risks & Concerns</div>{r.disadvantages.map((d,i)=><div key={i} className="ad-item">{d}</div>)}</div>}
                        </div>
                      </div>
                    )}

                    {/* People Impact + Sustainability Goal */}
                    {(r.people_impact||r.sustainability_goal) && (
                      <div className="rs">
                        <div className="rs-title">🌍 Impact & Sustainability</div>
                        <div className="impact-cards">
                          {r.people_impact&&<div className="impact-card"><div className="impact-card-label">👥 Impact on People</div><div className="impact-card-text">{r.people_impact}</div></div>}
                          {r.sustainability_goal&&<div className="impact-card"><div className="impact-card-label">♻️ Sustainability Goal</div><div className="impact-card-text">{r.sustainability_goal}</div></div>}
                        </div>
                      </div>
                    )}

                    {/* Expert Verdict */}
                    {r.expert_verdict && (
                      <div className="rs">
                        <div className="rs-title">🧑‍⚖️ Expert Verdict</div>
                        <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16,fontSize:14,color:'var(--text2)',lineHeight:1.7,fontStyle:'italic'}}>"{r.expert_verdict}"</div>
                      </div>
                    )}

                    {/* Sources */}
                    {r.sources?.length>0 && (
                      <div className="rs">
                        <div className="rs-title">📰 Sources Found</div>
                        {r.sources.map((s,i)=>(
                          <div key={i} className="src">
                            <div className="src-body">
                              <div className="src-title">{s.title||'Article'}</div>
                              <div className="src-snippet">{s.snippet}</div>
                              <div className="src-footer">
                                {s.url&&<a href={s.url} target="_blank" rel="noreferrer" className="src-link">Read full article ↗</a>}
                                {s.date&&<span className="src-date">{s.date}</span>}
                                {s.credibility&&<span className={`src-cred cred-${s.credibility}`}>{s.credibility==='high'?'Credible':'Moderate'}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ai-note">⚠️ WE uses AI and live web search. While we search for the most recent information, always verify important claims with the linked sources. Political situations change rapidly.</div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ═══ ADD PROMISE ═══ */}
        {page === 'add' && (
          <div>
            <div className="page-header">
              <div className="page-back" onClick={() => setPage('home')}>←</div>
              <div>
                <div className="page-title">✍️ Add a Promise</div>
                <div className="page-subtitle">Record a political promise with proof. Only the promise text is required.</div>
              </div>
            </div>
            <div className="form-card">
              <div className="field">
                <div className="field-label">What was promised? *</div>
                <textarea rows={3} placeholder="e.g. We will provide 2 crore jobs every year to the youth of India" value={addText} onChange={e => setAddText(e.target.value)}/>
                {fingerprint && <div style={{marginTop:8,padding:'8px 12px',background:'var(--surface2)',borderRadius:8,fontFamily:'monospace',fontSize:10,color:'var(--text3)',wordBreak:'break-all'}}>🔏 {fingerprint}</div>}
              </div>
              <div className="field">
                <div className="field-label">Who made this promise? <span className="opt-tag">optional</span></div>
                <input type="text" placeholder="e.g. Narendra Modi, PM of India · Congress Party · Arvind Kejriwal" value={addWho} onChange={e => setAddWho(e.target.value)}/>
              </div>
              <div className="field">
                <div className="field-label">YouTube link <span className="opt-tag">optional — paste a speech/video link</span></div>
                <input type="url" placeholder="https://youtube.com/watch?v=..." value={addYoutube} onChange={e => setAddYoutube(e.target.value)}/>
              </div>
              <div className="field">
                <div className="field-label">When &amp; Where? <span className="opt-tag">optional</span></div>
                <div className="input-row">
                  <input type="text" placeholder="Date or year e.g. Jan 2024, 2019" value={addWhen} onChange={e => setAddWhen(e.target.value)}/>
                  <input type="text" placeholder="Place or event e.g. Election rally, Parliament" value={addWhere} onChange={e => setAddWhere(e.target.value)}/>
                </div>
              </div>
              <div style={{display:'flex',gap:10,marginTop:6}}>
                <button className="btn btn-red" disabled={saving} onClick={savePromise}>{saving?'Saving...':'📌 Save Promise'}</button>
                <button className="btn btn-ghost" onClick={() => { setAddText(''); setAddWho(''); setAddYoutube(''); setAddWhen(''); setAddWhere('') }}>Clear</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ALL PROMISES ═══ */}
        {page === 'promises' && (
          <div>
            <div className="page-header">
              <div className="page-back" onClick={() => setPage('home')}>←</div>
              <div>
                <div className="page-title">📋 All Promises</div>
                <div className="page-subtitle">Promises added manually by users. Click any to get the latest AI verdict.</div>
              </div>
            </div>
            <div className="filter-bar">
              <span style={{fontSize:12,fontWeight:600,color:'var(--text3)'}}>Filter:</span>
              {[['all','All'],['pending','⏳ Pending'],['kept','✅ Fulfilled'],['broken','❌ Broken']].map(([f,label]) => (
                <button key={f} className={`f-btn${f==='kept'?' fg':f==='pending'?' fy':''}${filter===f?' active':''}`} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            {filtered.length===0 ? (
              <div className="empty">
                <span className="empty-icon">📭</span>
                <h3>{ledger.filter(p=>p.source==='manual').length===0?'No promises added yet':'No promises match this filter'}</h3>
                <p>{ledger.filter(p=>p.source==='manual').length===0?'Go to "Add a Promise" to record the first one.':'Try a different filter.'}</p>
              </div>
            ) : filtered.map(p => (
              <div key={p.id} className="promise-card" onClick={() => openModal(p)}>
                <div className="pc-top">
                  <div className="pc-text">"{p.text}"</div>
                  <span className={`s-badge s-${p.status}`}>{sIcon(p.status)} {sLabel(p.status)}</span>
                </div>
                <div className="pc-meta">
                  {p.who&&<span>👤 {p.who}</span>}
                  {p.when&&<span>📅 {p.when}</span>}
                  {p.where&&<span>📍 {p.where}</span>}
                  <span style={{fontSize:11}}>Added {timeAgo(p.savedAt)}</span>
                </div>
                {p.youtube&&<div style={{marginTop:8,fontSize:12}}><a href={p.youtube} target="_blank" rel="noreferrer" style={{color:'var(--red)',fontWeight:600}} onClick={e=>e.stopPropagation()}>▶ Watch Video ↗</a></div>}
                <div className="pc-tap">Tap for AI analysis →</div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ ABOUT ═══ */}
        {page === 'about' && (
          <div>
            <div className="page-header">
              <div className="page-back" onClick={() => setPage('home')}>←</div>
              <div><div className="page-title">ℹ️ How WE Works</div></div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {[
                ['💬','Ask WE','Type any political promise in plain language. WE understands context, partial wording, and even vague descriptions.'],
                ['🔍','Agentic AI Search','WE uses Anthropic Claude with live web search — running multiple queries to find the latest 2025-2026 news, government reports, and fact-checks.'],
                ['📊','Deep Insights','You get: verdict, fulfillment likelihood, people impact, sustainability goal, timeline, advantages, risks, expert opinions, and real sources.'],
                ['✍️','Add & Track','Manually add promises with YouTube proof links. WE auto-analyses them and updates the verdict when you ask.'],
                ['🔒','Secure & Private','Your data stays in your browser. The API key is stored server-side — never visible to anyone.'],
              ].map(([icon,title,desc]) => (
                <div key={title} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'18px 20px',display:'flex',gap:16,alignItems:'flex-start'}}>
                  <div style={{fontSize:26,flexShrink:0}}>{icon}</div>
                  <div><div style={{fontSize:15,fontWeight:700,color:'var(--text)',marginBottom:5}}>{title}</div><div style={{fontSize:13,color:'var(--text2)',lineHeight:1.7}}>{desc}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODAL ═══ */}
      {modal && (
        <div className="overlay" onClick={e => { if(e.target===e.currentTarget) closeModal() }}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-ttl">{modal.who?`Promise by ${modal.who}`:'Promise Details'}</div>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-promise">"{modal.text}"</div>
              <div style={{marginBottom:16}}>
                {[['👤 Who',modal.who||'Not specified'],['📅 When',modal.when||'Not specified'],['📍 Where',modal.where||'Not specified']].map(([k,v]) => (
                  <div key={k} className="drow"><div className="dk">{k}</div><div className="dv">{v}</div></div>
                ))}
                {modal.youtube&&<div className="drow"><div className="dk">▶ Video</div><div className="dv"><a href={modal.youtube} target="_blank" rel="noreferrer" style={{color:'var(--red)',fontWeight:600}}>{modal.youtube}</a></div></div>}
              </div>

              <div className="vs-h3">⚖️ AI Analysis</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:12}}>
                <span style={{fontSize:12,color:'var(--text3)'}}>Searches latest 2025-2026 news automatically</span>
                <button className="btn btn-red btn-sm" disabled={modalAI==='loading'} onClick={runModalAI}>
                  {modalAI==='loading'?<><span style={{animation:'spin .7s linear infinite',display:'inline-block'}}>⟳</span> Searching...</>:modalAI?'🔎 Re-Analyse':'🔎 Analyse Now'}
                </button>
              </div>

              {!modalAI&&<div style={{background:'var(--surface2)',border:'1.5px dashed var(--border)',borderRadius:'var(--radius)',padding:14,fontSize:13,color:'var(--text3)'}}>Click <strong style={{color:'var(--text2)'}}>Analyse Now</strong> — WE searches the latest news to tell you if this promise was kept, broken, or pending.</div>}
              {modalAI==='loading'&&<div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:18}}>{[88,72,80].map((w,i)=><div key={i} className="skel" style={{width:`${w}%`}}/>)}</div>}
              {modalAI&&modalAI!=='loading'&&!modalAI.error&&(()=>{
                const vc=vCls(modalAI.verdict)
                return (
                  <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',marginBottom:14}}>
                    <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid var(--border)',background:vc==='fulfilled'?'var(--green-soft)':vc==='broken'?'var(--red-soft)':'var(--yellow-soft)'}}>
                      <span style={{fontSize:20}}>{vIcon(modalAI.verdict)}</span>
                      <div>
                        <div style={{fontSize:15,fontWeight:700,color:vc==='fulfilled'?'var(--green)':vc==='broken'?'var(--red2)':'var(--yellow)'}}>{vLabel(modalAI.verdict)}</div>
                        <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>Searched · {modalAI.searched_on||'June 2026'}</div>
                      </div>
                    </div>
                    <div style={{padding:'14px 16px'}}>
                      <p style={{fontSize:13,lineHeight:1.75,color:'var(--text2)',marginBottom:10}}>{modalAI.current_status}</p>
                      {modalAI.fulfillment_likelihood_pct!==undefined&&<VerdictBar val={modalAI.fulfillment_likelihood_pct}/>}
                      {modalAI.key_findings?.length>0&&<div style={{marginTop:12}}>{modalAI.key_findings.map((f,i)=><div key={i} className="finding" style={{marginBottom:6}}><div className="finding-bullet"/><div className="finding-text">{f}</div></div>)}</div>}
                      {modalAI.sources?.length>0&&<div style={{marginTop:12}}>{modalAI.sources.slice(0,3).map((s,i)=><div key={i} className="src" style={{marginBottom:6}}><div className="src-body"><div className="src-title">{s.title}</div><div className="src-snippet">{s.snippet}</div><div className="src-footer">{s.url&&<a href={s.url} target="_blank" rel="noreferrer" className="src-link">Read ↗</a>}{s.date&&<span className="src-date">{s.date}</span>}</div></div></div>)}</div>}
                      <div className="ai-note">⚠️ AI analysis. Verify with linked sources.</div>
                    </div>
                  </div>
                )
              })()}
              {modalAI?.error&&<div style={{background:'var(--red-soft)',borderRadius:'var(--radius)',padding:14,fontSize:13,color:'var(--red2)'}}>⚠️ Analysis failed. Try again.</div>}

              {/* Verdict */}
              <div className={`vc vc-${modal.status}`}>
                <div className="vc-top"><div className="vc-icon">{sIcon(modal.status)}</div><div className="vc-lbl">{modal.status==='kept'?'FULFILLED':modal.status==='broken'?'BROKEN':'PENDING'}</div></div>
                {modal.verdictHistory?.length?<div className="vc-note">{modal.verdictHistory[modal.verdictHistory.length-1].note}</div>:<div className="vc-note">Click Analyse Now to get AI verdict.</div>}
              </div>

              {/* Update */}
              <div className="upd-form">
                <h4>📝 Update Manually</h4>
                <div className="vo-row">
                  {[['kept','✅ Fulfilled','vo-k'],['broken','❌ Broken','vo-b'],['pending','⏳ Pending','vo-p']].map(([v,label,cls])=>(
                    <div key={v} className={`vo ${cls}${selectedVerdict===v?' sel':''}`} onClick={()=>setSelectedVerdict(v)}>{label}</div>
                  ))}
                </div>
                <input type="url" placeholder="Evidence link (optional)" value={verdictProof} onChange={e=>setVerdictProof(e.target.value)} style={{marginBottom:8}}/>
                <textarea rows={2} placeholder="Add a note..." value={verdictNote} onChange={e=>setVerdictNote(e.target.value)}/>
                <div style={{marginTop:10}}>
                  <button className="btn btn-red btn-sm" disabled={submitting} onClick={submitVerdict}>{submitting?'Saving...':'Submit'}</button>
                </div>
              </div>

              {/* History */}
              {modal.verdictHistory?.length>0&&(
                <div className="hist">
                  <h4>History</h4>
                  {[...modal.verdictHistory].reverse().map((h,i)=>(
                    <div key={i} className="hi">
                      <div className={`hi-dot hi-dot-${h.status}`}/>
                      <div className="hi-text">
                        <strong>{h.status==='kept'?'Fulfilled':h.status==='broken'?'Broken':'Pending'}</strong>
                        {h.byAI&&<span style={{fontSize:10,background:'var(--red-soft)',color:'var(--red)',padding:'1px 6px',borderRadius:100,marginLeft:5}}>AI</span>}
                        {h.note&&` — ${h.note}`}
                        {h.proof&&<> · <a href={h.proof} target="_blank" rel="noreferrer" style={{color:'var(--red)'}}>Evidence ↗</a></>}
                        <br/><span style={{fontSize:11}}>{new Date(h.at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast&&<div className="toast-wrap"><div className={`toast ${toast.type||'default'}`}>{toast.msg}</div></div>}
    </>
  )
}

function ScoreRing({ val, label, color }) {
  const r=28, circ=2*Math.PI*r, dash=(val/100)*circ
  return (
    <div style={{textAlign:'center',flex:1}}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#e8e0d4" strokeWidth="7"/>
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)"/>
        <text x="36" y="41" textAnchor="middle" fill={color} fontSize="13" fontWeight="700" fontFamily="Nunito,sans-serif">{val}%</text>
      </svg>
      <div style={{fontSize:10,color:'#8a7060',marginTop:2,fontWeight:600}}>{label}</div>
    </div>
  )
}

function VerdictBar({ val }) {
  const color=val>=70?'#4ade80':val>=40?'#fbbf24':'#f87171'
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#8a7060',marginBottom:5}}>
        <span>Fulfillment Likelihood</span><span style={{fontWeight:700,color,fontSize:13}}>{val}%</span>
      </div>
      <div style={{height:10,background:'#f2ebe0',borderRadius:100,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${val}%`,background:`linear-gradient(90deg,${color}88,${color})`,borderRadius:100,boxShadow:`0 0 8px ${color}66`}}/>
      </div>
    </div>
  )
}
