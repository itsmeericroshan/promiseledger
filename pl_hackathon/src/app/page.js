'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ── helpers ──────────────────────────────────────────────────────
async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}
function today() { return new Date().toISOString().split('T')[0] }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

// ── API call (goes through our safe backend proxy) ────────────────
async function callAI(body) {
  const res = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ═════════════════════════════════════════════════════════════════
export default function Home() {
  const [ledger, setLedger] = useState([])
  const [page, setPage] = useState('browse')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)           // promise object or null
  const [selectedVerdict, setSelectedVerdict] = useState('pending')
  const [verdictProof, setVerdictProof] = useState('')
  const [verdictNote, setVerdictNote] = useState('')
  const [aiAnalysis, setAiAnalysis] = useState(null) // null | 'loading' | result obj
  const [toast, setToast] = useState(null)
  const [savingPromise, setSavingPromise] = useState(false)
  const [checkingPromise, setCheckingPromise] = useState(false)
  const [submittingVerdict, setSubmittingVerdict] = useState(false)

  // add form state
  const [addText, setAddText] = useState('')
  const [addPolitician, setAddPolitician] = useState('')
  const [addDate, setAddDate] = useState(today())
  const [addContext, setAddContext] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [fingerprint, setFingerprint] = useState('')

  // check form state
  const [checkInput, setCheckInput] = useState('')
  const [checkResult, setCheckResult] = useState(null)

  const toastTimer = useRef(null)

  // Load from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('pl3_ledger')
    if (stored) setLedger(JSON.parse(stored))
  }, [])

  // Persist to localStorage whenever ledger changes
  const persist = useCallback((newLedger) => {
    setLedger(newLedger)
    localStorage.setItem('pl3_ledger', JSON.stringify(newLedger))
  }, [])

  // Live fingerprint
  useEffect(() => {
    if (!addText.trim()) { setFingerprint(''); return }
    hashText(addText.trim()).then(setFingerprint)
  }, [addText])

  // Toast helper
  const showToast = useCallback((msg, type = '') => {
    setToast({ msg, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // Stats
  const stats = {
    total: ledger.length,
    kept: ledger.filter(p => p.status === 'kept').length,
    broken: ledger.filter(p => p.status === 'broken').length,
    pending: ledger.filter(p => p.status === 'pending').length,
  }

  // ── Save promise ────────────────────────────────────────────────
  async function savePromise() {
    if (!addText.trim()) { showToast('Please write what was promised first.', 'error'); return }
    setSavingPromise(true)
    const fp = await hashText(addText.trim())
    if (ledger.find(p => p.fp === fp)) {
      showToast('This exact promise is already on record!', 'error')
      setSavingPromise(false); return
    }
    const record = {
      id: uuid(), text: addText.trim(), fp,
      politician: addPolitician.trim(),
      date: addDate || today(),
      context: addContext.trim(),
      sourceUrl: addUrl.trim(),
      savedAt: Date.now(),
      blockNum: Math.floor(Math.random() * 500000) + 7000000,
      status: 'pending',
      verdictHistory: []
    }
    persist([record, ...ledger])
    setAddText(''); setAddPolitician(''); setAddDate(today()); setAddContext(''); setAddUrl('')
    setSavingPromise(false)
    showToast('✅ Promise saved permanently!', 'success')
    setPage('browse')
  }

  // ── Open modal ──────────────────────────────────────────────────
  function openModal(p) {
    setModal(p)
    setSelectedVerdict(p.status)
    setVerdictProof('')
    setVerdictNote('')
    setAiAnalysis(null)
    document.body.style.overflow = 'hidden'
  }
  function closeModal() {
    setModal(null)
    document.body.style.overflow = ''
  }

  // ── Submit verdict ──────────────────────────────────────────────
  function submitVerdict() {
    if (!modal) return
    setSubmittingVerdict(true)
    setTimeout(() => {
      const updated = ledger.map(p => {
        if (p.id !== modal.id) return p
        const newHistory = [...(p.verdictHistory || []), {
          status: selectedVerdict, note: verdictNote, proof: verdictProof, at: Date.now()
        }]
        return { ...p, status: selectedVerdict, verdictHistory: newHistory }
      })
      persist(updated)
      const updatedP = updated.find(p => p.id === modal.id)
      setModal(updatedP)
      setVerdictProof(''); setVerdictNote('')
      setSubmittingVerdict(false)
      const map = { kept: '✅ Marked as Kept!', broken: '❌ Marked as Broken', pending: '⏳ Reset to Waiting' }
      showToast(map[selectedVerdict] || 'Verdict updated', 'success')
    }, 600)
  }

  // ── AI Auto-Analyse ─────────────────────────────────────────────
  async function runAIAnalysis() {
    if (!modal) return
    setAiAnalysis('loading')
    try {
      const data = await callAI({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `You are a political fact-checker AI. Use the web_search tool to investigate whether a political promise was kept, broken, or is still pending. Search for news about fulfillment and failure. Respond ONLY with this exact JSON (no markdown, no extra text):
{"verdict":"kept"|"broken"|"pending"|"insufficient","confidence":"high"|"medium"|"low","summary":"<2-3 plain English sentences>","sources":[{"title":"<title>","snippet":"<one sentence>","url":"<url>","supports":"kept"|"broken"|"pending"}]}
Rules: kept=clear evidence implemented; broken=cancelled/failed/deadline passed; pending=some progress but incomplete; insufficient=not enough info. Include up to 4 relevant sources.`,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Investigate this political promise:\nPromise: "${modal.text}"\nMade by: ${modal.politician || 'unknown politician'}\nDate made: ${modal.date}\n\nSearch the web and determine if this promise was kept, broken, or is still pending.`
        }]
      })

      const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text')
      const raw = textBlock?.text || '{}'
      const clean = raw.replace(/```json|```/g, '').trim()
      let result
      try { result = JSON.parse(clean) }
      catch {
        const match = clean.match(/\{[\s\S]*\}/)
        result = match ? JSON.parse(match[0]) : { verdict: 'insufficient', confidence: 'low', summary: 'Could not parse AI response. Please try again.', sources: [] }
      }
      setAiAnalysis(result)
    } catch (err) {
      setAiAnalysis({ error: err.message })
    }
  }

  // ── Apply AI verdict ────────────────────────────────────────────
  function applyAIVerdict(verdict, summary, proofUrl) {
    if (!modal) return
    const updated = ledger.map(p => {
      if (p.id !== modal.id) return p
      const newHistory = [...(p.verdictHistory || []), {
        status: verdict, note: `[AI Analysis] ${summary}`, proof: proofUrl || '', at: Date.now(), byAI: true
      }]
      return { ...p, status: verdict, verdictHistory: newHistory }
    })
    persist(updated)
    const updatedP = updated.find(p => p.id === modal.id)
    setModal(updatedP)
    setSelectedVerdict(verdict)
    const map = { kept: '✅ Verdict applied: Kept!', broken: '❌ Verdict applied: Broken', pending: '⏳ Verdict applied: Still Waiting' }
    showToast(map[verdict] || 'Verdict updated', 'success')
  }

  // ── Fact-check ──────────────────────────────────────────────────
  async function checkPromise() {
    if (!checkInput.trim()) { showToast('Please describe the promise you are looking for.', 'error'); return }
    if (!ledger.length) { showToast('No promises saved yet!', 'error'); return }
    setCheckingPromise(true)
    setCheckResult(null)
    try {
      const promiseList = ledger.map((p, i) =>
        `[${i}] "${p.text}"${p.politician ? ' — by ' + p.politician : ''} (Status: ${p.status})`
      ).join('\n')
      const data = await callAI({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: `You are a promise-matching assistant. Compare the user's description to saved promises and find the best semantic match even if wording differs (e.g. "women security force" matches "women safety squad"). Respond ONLY with valid JSON, no extra text:\n{"bestMatchIndex":<number or null>,"confidence":"high"|"medium"|"low","reason":"<one sentence>","otherMatches":[<indices>]}`,
        messages: [{ role: 'user', content: `User searching for: "${checkInput.trim()}"\n\nSaved promises:\n${promiseList}` }]
      })
      const textBlock = data.content?.find(b => b.type === 'text')
      const raw = textBlock?.text || '{}'
      const result = JSON.parse(raw.replace(/```json|```/g, '').trim())
      setCheckResult({ result, query: checkInput.trim() })
    } catch (err) {
      showToast('Search failed. Please try again.', 'error')
    }
    setCheckingPromise(false)
  }

  // ── Filtered list ───────────────────────────────────────────────
  const filtered = filter === 'all' ? ledger : ledger.filter(p => p.status === filter)

  // ── Status helpers ──────────────────────────────────────────────
  const statusLabel = s => s === 'kept' ? '✅ Kept' : s === 'broken' ? '❌ Broken' : '⏳ Waiting'
  const statusCls = s => s === 'kept' ? 's-kept' : s === 'broken' ? 's-broken' : 's-pending'
  const verdictBarCls = s => s === 'kept' ? 'pvb-kept' : s === 'broken' ? 'pvb-broken' : 'pvb-pending'
  const verdictBarLabel = s => s === 'kept' ? "Kept — they followed through!" : s === 'broken' ? "Broken — they didn't deliver." : 'Still waiting to be fulfilled...'
  const verdictBarIcon = s => s === 'kept' ? '✅' : s === 'broken' ? '❌' : '⏳'

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        :root{--cream:#faf7f2;--warm:#f2ebe0;--card:#fff;--border:#e8e0d4;--brown:#2d1f14;--brown2:#5c3d2e;--orange:#e8621a;--orange-soft:#fff0e8;--green:#1a7a4a;--green-soft:#e8f5ee;--red:#c0392b;--red-soft:#fdecea;--yellow:#b8860b;--yellow-soft:#fff8e1;--muted:#8a7060;--shadow:0 2px 16px rgba(45,31,20,.08);--shadow-hover:0 8px 32px rgba(45,31,20,.14)}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--cream);color:var(--brown);font-family:'Nunito',sans-serif;min-height:100vh}
        nav{background:var(--card);border-bottom:1px solid var(--border);padding:0 24px;position:sticky;top:0;z-index:200;box-shadow:0 1px 8px rgba(45,31,20,.06)}
        .nav-inner{max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px}
        .nav-logo{display:flex;align-items:center;gap:10px;cursor:pointer}
        .nav-logo-icon{width:36px;height:36px;background:var(--orange);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
        .nav-logo-text{font-family:'Fraunces',serif;font-size:20px;font-weight:700;color:var(--brown)}
        .nav-logo-text span{color:var(--orange)}
        .nav-pill{font-size:12px;color:var(--muted);background:var(--warm);padding:4px 12px;border-radius:100px;border:1px solid var(--border)}
        .hero{max-width:960px;margin:0 auto;padding:52px 24px 36px;text-align:center}
        .hero-tag{display:inline-flex;align-items:center;gap:6px;background:var(--orange-soft);color:var(--orange);font-size:13px;font-weight:600;padding:6px 16px;border-radius:100px;margin-bottom:18px;border:1px solid rgba(232,98,26,.2)}
        .hero h1{font-family:'Fraunces',serif;font-size:clamp(30px,6vw,50px);font-weight:700;line-height:1.15;margin-bottom:14px}
        .hero h1 em{font-style:italic;color:var(--orange)}
        .hero p{font-size:16px;line-height:1.7;color:var(--muted);max-width:520px;margin:0 auto 32px}
        .stat-row{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-bottom:40px}
        .stat-pill{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px 24px;text-align:center;box-shadow:var(--shadow);min-width:130px}
        .stat-pill-num{font-family:'Fraunces',serif;font-size:30px;font-weight:700;color:var(--orange);line-height:1}
        .stat-pill-label{font-size:11px;color:var(--muted);margin-top:4px;font-weight:600}
        .main{max-width:960px;margin:0 auto;padding:0 24px 80px}
        .page-tabs{display:flex;gap:6px;margin-bottom:28px;flex-wrap:wrap}
        .page-tab{display:flex;align-items:center;gap:7px;padding:9px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;background:var(--card);border:1.5px solid var(--border);color:var(--muted)}
        .page-tab:hover{color:var(--brown);border-color:var(--brown2)}
        .page-tab.active{background:var(--orange);color:#fff;border-color:var(--orange)}
        .section-header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
        .section-icon{width:40px;height:40px;background:var(--orange-soft);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
        .section-title{font-family:'Fraunces',serif;font-size:22px;font-weight:700}
        .section-desc{font-size:13px;color:var(--muted);margin-top:2px}
        .card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:28px;box-shadow:var(--shadow);margin-bottom:24px}
        .steps{display:flex;flex-direction:column;gap:20px}
        .step{display:flex;gap:16px;align-items:flex-start}
        .step-num{width:32px;height:32px;border-radius:50%;background:var(--warm);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--brown2);flex-shrink:0;margin-top:2px}
        .step-body{flex:1}
        .step-label{font-size:14px;font-weight:700;color:var(--brown);margin-bottom:6px}
        .step-hint{font-size:12px;color:var(--muted);margin-bottom:8px;line-height:1.5}
        input[type=text],input[type=date],input[type=url],textarea{width:100%;background:var(--warm);border:1.5px solid var(--border);color:var(--brown);padding:12px 14px;font-family:'Nunito',sans-serif;font-size:14px;border-radius:12px;outline:none;transition:border-color .2s,box-shadow .2s;resize:vertical}
        input:focus,textarea:focus{border-color:var(--orange);box-shadow:0 0 0 3px rgba(232,98,26,.12);background:#fff}
        input::placeholder,textarea::placeholder{color:var(--muted);opacity:.7}
        .input-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media(max-width:560px){.input-row{grid-template-columns:1fr}}
        .fp-box{background:var(--warm);border:1.5px dashed var(--border);border-radius:12px;padding:14px 16px;margin-top:8px}
        .fp-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
        .fp-val{font-family:monospace;font-size:11px;color:var(--brown2);word-break:break-all;line-height:1.6}
        .fp-tip{font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5}
        .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;border:none;border-radius:12px;cursor:pointer;transition:all .2s}
        .btn-primary{background:var(--orange);color:#fff;box-shadow:0 4px 12px rgba(232,98,26,.3)}
        .btn-primary:hover{background:#d4561a;transform:translateY(-1px)}
        .btn-ghost{background:var(--warm);color:var(--brown2);border:1.5px solid var(--border)}
        .btn-ghost:hover{background:var(--border)}
        .btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
        .btn-sm{padding:7px 14px;font-size:12px;border-radius:8px}
        .form-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;align-items:center}
        .status-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:100px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid transparent}
        .s-pending{background:var(--yellow-soft);color:var(--yellow);border-color:rgba(184,134,11,.25)}
        .s-kept{background:var(--green-soft);color:var(--green);border-color:rgba(26,122,74,.25)}
        .s-broken{background:var(--red-soft);color:var(--red);border-color:rgba(192,57,43,.25)}
        .promises-grid{display:flex;flex-direction:column;gap:14px}
        .promise-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 22px;box-shadow:var(--shadow);transition:box-shadow .2s,transform .2s;cursor:pointer}
        .promise-card:hover{box-shadow:var(--shadow-hover);transform:translateY(-2px)}
        .pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
        .pc-text{font-size:15px;line-height:1.6;color:var(--brown);flex:1;font-weight:500}
        .pc-meta{display:flex;flex-wrap:wrap;gap:8px 18px;border-top:1px solid var(--border);padding-top:10px;margin-top:6px}
        .pc-meta-item{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px}
        .pc-meta-item strong{color:var(--brown2)}
        .pc-verdict-bar{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:8px}
        .pvb-pending{background:var(--yellow-soft);color:var(--yellow)}
        .pvb-kept{background:var(--green-soft);color:var(--green)}
        .pvb-broken{background:var(--red-soft);color:var(--red)}
        .filter-bar{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
        .filter-btn{padding:7px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--card);color:var(--muted);transition:all .2s}
        .filter-btn:hover{color:var(--brown);border-color:var(--brown2);background:var(--warm)}
        .filter-btn.active{color:var(--brown);border-color:var(--brown2);background:var(--warm)}
        .filter-btn.f-kept.active{background:var(--green-soft);border-color:var(--green);color:var(--green)}
        .filter-btn.f-broken.active{background:var(--red-soft);border-color:var(--red);color:var(--red)}
        .filter-btn.f-pending.active{background:var(--yellow-soft);border-color:var(--yellow);color:var(--yellow)}
        .empty-state{text-align:center;padding:48px 24px;color:var(--muted)}
        .empty-icon{font-size:44px;margin-bottom:14px}
        .empty-state h3{font-family:'Fraunces',serif;font-size:18px;color:var(--brown);margin-bottom:6px}
        .empty-state p{font-size:13px;line-height:1.6;max-width:300px;margin:0 auto}
        .modal-overlay{position:fixed;inset:0;background:rgba(45,31,20,.5);backdrop-filter:blur(4px);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto}
        .modal{background:var(--card);border-radius:20px;width:100%;max-width:640px;box-shadow:0 24px 64px rgba(45,31,20,.2);margin:auto;animation:fadeUp .3s ease}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .modal-header{padding:24px 28px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        .modal-title{font-family:'Fraunces',serif;font-size:20px;font-weight:700;line-height:1.3}
        .modal-close{width:36px;height:36px;border-radius:50%;background:var(--warm);border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted)}
        .modal-close:hover{background:var(--border)}
        .modal-body{padding:20px 28px 28px}
        .modal-promise-text{font-size:16px;line-height:1.7;color:var(--brown);background:var(--warm);border-radius:12px;padding:16px;margin-bottom:20px;font-style:italic;border-left:3px solid var(--orange)}
        .detail-row{display:flex;gap:10px;font-size:13px;padding:7px 0;border-bottom:1px solid var(--warm)}
        .detail-row:last-child{border-bottom:none}
        .detail-key{color:var(--muted);font-weight:700;min-width:100px;flex-shrink:0}
        .detail-val{color:var(--brown);word-break:break-word}
        .verdict-section{margin-top:20px}
        .verdict-section h3{font-family:'Fraunces',serif;font-size:16px;font-weight:700;margin-bottom:14px}
        .verdict-current{border-radius:14px;padding:16px;margin-bottom:16px}
        .vc-pending{background:var(--yellow-soft);border:1px solid rgba(184,134,11,.25)}
        .vc-kept{background:var(--green-soft);border:1px solid rgba(26,122,74,.25)}
        .vc-broken{background:var(--red-soft);border:1px solid rgba(192,57,43,.25)}
        .vc-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
        .vc-icon{font-size:24px}
        .vc-label{font-size:16px;font-weight:700}
        .vc-pending .vc-label{color:var(--yellow)}
        .vc-kept .vc-label{color:var(--green)}
        .vc-broken .vc-label{color:var(--red)}
        .vc-note{font-size:13px;color:var(--muted);line-height:1.6}
        .vc-proof{margin-top:8px;font-size:12px}
        .update-verdict-form{background:var(--warm);border:1.5px dashed var(--border);border-radius:14px;padding:18px;margin-bottom:16px}
        .update-verdict-form h4{font-size:13px;font-weight:700;color:var(--brown);margin-bottom:12px}
        .verdict-options{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
        .verdict-opt{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:2px solid transparent;transition:all .2s;background:var(--card)}
        .vo-kept{color:var(--green);border-color:rgba(26,122,74,.3)}
        .vo-kept.selected{background:var(--green-soft);border-color:var(--green)}
        .vo-broken{color:var(--red);border-color:rgba(192,57,43,.3)}
        .vo-broken.selected{background:var(--red-soft);border-color:var(--red)}
        .vo-pending{color:var(--yellow);border-color:rgba(184,134,11,.3)}
        .vo-pending.selected{background:var(--yellow-soft);border-color:var(--yellow)}
        .history-log{margin-top:16px}
        .history-log h4{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
        .history-item{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--warm)}
        .history-item:last-child{border-bottom:none}
        .hi-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:5px}
        .hi-dot-kept{background:var(--green)}
        .hi-dot-broken{background:var(--red)}
        .hi-dot-pending{background:var(--yellow)}
        .hi-text{font-size:12px;color:var(--muted);line-height:1.5}
        .hi-text strong{color:var(--brown)}
        .ai-analysis-box{border-radius:16px;overflow:hidden;border:1.5px solid var(--border);margin-bottom:16px}
        .ai-analysis-header{padding:14px 18px;display:flex;align-items:center;gap:10px}
        .ai-analysis-header.kept{background:var(--green-soft);border-bottom:1.5px solid rgba(26,122,74,.2)}
        .ai-analysis-header.broken{background:var(--red-soft);border-bottom:1.5px solid rgba(192,57,43,.2)}
        .ai-analysis-header.pending{background:var(--yellow-soft);border-bottom:1.5px solid rgba(184,134,11,.2)}
        .ai-analysis-header.insufficient,.ai-analysis-header.loading{background:var(--warm);border-bottom:1.5px solid var(--border)}
        .aah-icon{font-size:24px}
        .aah-verdict{font-family:'Fraunces',serif;font-size:17px;font-weight:700}
        .aah-verdict.kept{color:var(--green)}
        .aah-verdict.broken{color:var(--red)}
        .aah-verdict.pending{color:var(--yellow)}
        .aah-verdict.insufficient,.aah-verdict.loading{color:var(--muted)}
        .aah-conf{font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-left:6px}
        .conf-high{background:var(--green-soft);color:var(--green)}
        .conf-medium{background:var(--yellow-soft);color:var(--yellow)}
        .conf-low{background:var(--warm);color:var(--muted)}
        .ai-analysis-body{padding:16px 18px;background:var(--card)}
        .ai-summary{font-size:14px;line-height:1.75;color:var(--brown);margin-bottom:14px}
        .ai-sources-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px}
        .ai-source-item{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:var(--warm);border-radius:10px;border:1px solid var(--border);margin-bottom:8px}
        .asi-icon{font-size:16px;flex-shrink:0;margin-top:1px}
        .asi-body{flex:1;min-width:0}
        .asi-title{font-size:13px;font-weight:600;color:var(--brown);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .asi-snippet{font-size:12px;color:var(--muted);line-height:1.5}
        .asi-link{font-size:11px;color:var(--orange);font-weight:600;word-break:break-all}
        .ai-auto-note{font-size:11px;color:var(--muted);margin-top:12px;font-style:italic;line-height:1.5}
        .ai-banner{display:flex;gap:10px;align-items:flex-start;background:var(--orange-soft);border:1px solid rgba(232,98,26,.2);border-radius:14px;padding:14px 16px;margin-bottom:18px}
        .ai-banner-icon{font-size:20px;flex-shrink:0}
        .ai-banner-title{font-size:13px;font-weight:700;color:var(--brown);margin-bottom:2px}
        .ai-banner-desc{font-size:12px;color:var(--muted);line-height:1.5}
        .vr-box{border-radius:14px;padding:20px 22px;margin-top:20px}
        .vr-box.ok{background:var(--green-soft);border:1.5px solid rgba(26,122,74,.3)}
        .vr-box.fail{background:var(--red-soft);border:1.5px solid rgba(192,57,43,.3)}
        .vr-top{display:flex;align-items:center;gap:12px;margin-bottom:12px}
        .vr-icon{font-size:28px}
        .vr-title{font-family:'Fraunces',serif;font-size:20px;font-weight:700}
        .vr-title.ok{color:var(--green)}
        .vr-title.fail{color:var(--red)}
        .vr-desc{font-size:13px;color:var(--muted);line-height:1.7}
        .vr-details{margin-top:14px;padding:14px;background:rgba(255,255,255,.6);border-radius:10px}
        .vr-detail-row{display:flex;gap:10px;font-size:12px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05)}
        .vr-detail-row:last-child{border-bottom:none}
        .vr-detail-key{color:var(--muted);font-weight:600;min-width:100px;flex-shrink:0}
        .vr-detail-val{color:var(--brown);word-break:break-all}
        .similar-card{background:var(--warm);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:box-shadow .2s}
        .similar-card:hover{box-shadow:var(--shadow)}
        .how-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
        @media(max-width:600px){.how-grid{grid-template-columns:1fr}}
        .how-card{background:var(--warm);border:1px solid var(--border);border-radius:16px;padding:18px}
        .how-card .hc-icon{font-size:26px;margin-bottom:8px}
        .how-card h4{font-size:14px;font-weight:700;margin-bottom:5px}
        .how-card p{font-size:13px;color:var(--muted);line-height:1.6}
        .toast-wrap{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999;pointer-events:none}
        .toast{background:var(--brown);color:#fff;padding:12px 22px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(45,31,20,.25);animation:fadeUp .3s ease}
        .toast.success{background:var(--green)}
        .toast.error{background:var(--red)}
        .spin{display:inline-block;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .skeleton{height:12px;background:var(--warm);border-radius:6px;animation:pulse 1.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      `}</style>

      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <div className="nav-logo" onClick={() => setPage('browse')}>
            <div className="nav-logo-icon">📜</div>
            <div className="nav-logo-text">Promise<span>Ledger</span></div>
          </div>
          <div className="nav-pill">🔒 Permanently Recorded</div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-tag">🗳️ Political Accountability Tool</div>
        <h1>Did They Say It?<br />Did They <em>Do</em> It?</h1>
        <p>Record political promises, verify they were actually said, and track whether they were ever kept.</p>
        <div className="stat-row">
          {[['stat-total', stats.total, 'Promises Recorded'], ['stat-kept', stats.kept, '✅ Kept'], ['stat-broken', stats.broken, '❌ Broken'], ['stat-pending', stats.pending, '⏳ Waiting']].map(([, num, label]) => (
            <div key={label} className="stat-pill">
              <div className="stat-pill-num">{num}</div>
              <div className="stat-pill-label">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MAIN */}
      <div className="main">
        <div className="page-tabs">
          {[['add','✍️ Record a Promise'],['browse','📋 Browse All'],['check','🔍 Fact-Check'],['about','ℹ️ How It Works']].map(([p, label]) => (
            <div key={p} className={`page-tab${page===p?' active':''}`} onClick={() => setPage(p)}>{label}</div>
          ))}
        </div>

        {/* ═══ ADD ═══ */}
        {page === 'add' && (
          <div>
            <div className="section-header">
              <div className="section-icon">✍️</div>
              <div><div className="section-title">Record a Political Promise</div><div className="section-desc">Fill in what was promised, by whom, and where you heard it.</div></div>
            </div>
            <div className="card">
              <div className="steps">
                <div className="step">
                  <div className="step-num">1</div>
                  <div className="step-body">
                    <div className="step-label">What did they promise? *</div>
                    <div className="step-hint">Write it in your own words or copy it exactly.</div>
                    <textarea rows={3} placeholder="e.g. We will form a dedicated women's security force in every district by 2026." value={addText} onChange={e => setAddText(e.target.value)} />
                    {fingerprint && (
                      <div className="fp-box">
                        <div className="fp-label">🔏 Unique Fingerprint (auto-generated)</div>
                        <div className="fp-val">{fingerprint}</div>
                        <div className="fp-tip">This digital signature changes if even one letter changes — proof of the exact original wording.</div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">2</div>
                  <div className="step-body">
                    <div className="step-label">Who made this promise?</div>
                    <input type="text" placeholder="e.g. Ravi Kumar, Leader of XYZ Party" value={addPolitician} onChange={e => setAddPolitician(e.target.value)} />
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">3</div>
                  <div className="step-body">
                    <div className="step-label">When &amp; where was it said?</div>
                    <div className="input-row">
                      <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} />
                      <input type="text" placeholder="e.g. Election rally, Mumbai" value={addContext} onChange={e => setAddContext(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">4</div>
                  <div className="step-body">
                    <div className="step-label">Source link (recommended)</div>
                    <div className="step-hint">Link to a news article, speech video, or tweet as proof.</div>
                    <input type="url" placeholder="https://..." value={addUrl} onChange={e => setAddUrl(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={savingPromise} onClick={savePromise}>
                  {savingPromise ? '⟳ Saving...' : '📌 Save This Promise'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setAddText(''); setAddPolitician(''); setAddDate(today()); setAddContext(''); setAddUrl('') }}>Clear</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ BROWSE ═══ */}
        {page === 'browse' && (
          <div>
            <div className="section-header">
              <div className="section-icon">📋</div>
              <div><div className="section-title">All Recorded Promises</div><div className="section-desc">Click any promise to see details, evidence, and verdict.</div></div>
            </div>
            <div className="filter-bar">
              <span style={{fontSize:13,fontWeight:600,color:'var(--muted)'}}>Filter:</span>
              {[['all','All'],['pending','⏳ Waiting'],['kept','✅ Kept'],['broken','❌ Broken']].map(([f,label]) => (
                <button key={f} className={`filter-btn${f!=='all'?' f-'+f:''}${filter===f?' active':''}`} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{filter==='all'?'📭':'🔎'}</div>
                <h3>{filter==='all'?'No promises saved yet':'No promises with this status'}</h3>
                <p>{filter==='all'?'Go to "Record a Promise" to add the first one.':'Try a different filter above.'}</p>
              </div>
            ) : (
              <div className="promises-grid">
                {filtered.map(p => {
                  const lastNote = p.verdictHistory?.length ? p.verdictHistory[p.verdictHistory.length-1].note : null
                  return (
                    <div key={p.id} className="promise-card" onClick={() => openModal(p)}>
                      <div className="pc-top">
                        <div className="pc-text">"{p.text}"</div>
                        <span className={`status-badge ${statusCls(p.status)}`}>{statusLabel(p.status)}</span>
                      </div>
                      <div className="pc-meta">
                        {p.politician && <div className="pc-meta-item">👤 <strong>{p.politician}</strong></div>}
                        <div className="pc-meta-item">📅 <strong>{p.date}</strong></div>
                        {p.context && <div className="pc-meta-item">📍 {p.context}</div>}
                        {p.sourceUrl && <div className="pc-meta-item">🔗 <a href={p.sourceUrl} target="_blank" rel="noreferrer" style={{color:'var(--orange)',fontWeight:600}} onClick={e=>e.stopPropagation()}>Source</a></div>}
                        <div className="pc-meta-item" style={{fontSize:11,color:'var(--muted)'}}>Saved {timeAgo(p.savedAt)}</div>
                      </div>
                      <div className={`pc-verdict-bar ${verdictBarCls(p.status)}`}>
                        {verdictBarIcon(p.status)} <strong>{verdictBarLabel(p.status)}</strong>
                        {lastNote && ` · "${lastNote.slice(0,80)}${lastNote.length>80?'…':''}"`}
                      </div>
                      <div style={{marginTop:10,fontSize:12,color:'var(--orange)',fontWeight:600}}>Tap to see details & update verdict →</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ FACT-CHECK ═══ */}
        {page === 'check' && (
          <div>
            <div className="section-header">
              <div className="section-icon">🔍</div>
              <div><div className="section-title">Fact-Check a Promise</div><div className="section-desc">Not sure if they really said it? Ask in your own words.</div></div>
            </div>
            <div className="ai-banner">
              <div className="ai-banner-icon">🤖</div>
              <div>
                <div className="ai-banner-title">AI-powered — no need for exact wording</div>
                <div className="ai-banner-desc">"women security force" and "women safety squad" will both find the same promise. Just describe what you remember.</div>
              </div>
            </div>
            <div className="card">
              <div className="step-label" style={{marginBottom:6}}>What promise are you trying to verify?</div>
              <div className="step-hint" style={{marginBottom:10}}>Describe it however you remember it.</div>
              <textarea rows={3} placeholder="e.g. something about a women's safety squad, or free education for all..." value={checkInput} onChange={e => setCheckInput(e.target.value)} />
              <div className="form-actions">
                <button className="btn btn-primary" disabled={checkingPromise} onClick={checkPromise}>
                  {checkingPromise ? <><span className="spin">⟳</span> Searching...</> : '🔍 Search & Verify'}
                </button>
              </div>

              {checkResult && (() => {
                const { result } = checkResult
                const isMatch = result.bestMatchIndex !== null && result.bestMatchIndex !== undefined && result.confidence !== 'low'
                const record = isMatch ? ledger[result.bestMatchIndex] : null
                return (
                  <>
                    <div className={`vr-box ${isMatch?'ok':'fail'}`}>
                      <div className="vr-top">
                        <div className="vr-icon">{isMatch?'✅':'🔎'}</div>
                        <div>
                          <div className={`vr-title ${isMatch?'ok':'fail'}`}>
                            {isMatch ? 'Yes — this promise is on record' : 'No matching promise found'}
                            {isMatch && result.confidence === 'high' && <span style={{background:'var(--green-soft)',color:'var(--green)',padding:'2px 10px',borderRadius:100,fontSize:11,fontWeight:700,marginLeft:8}}>Strong Match</span>}
                            {isMatch && result.confidence === 'medium' && <span style={{background:'var(--yellow-soft)',color:'var(--yellow)',padding:'2px 10px',borderRadius:100,fontSize:11,fontWeight:700,marginLeft:8}}>Likely Match</span>}
                          </div>
                          <div className="vr-desc">{result.reason}</div>
                        </div>
                      </div>
                      {record && (
                        <div className="vr-details">
                          {[['📝 Recorded as', `"${record.text}"`],['👤 Who', record.politician||'Not specified'],['📅 Date', record.date],['⚖️ Status', statusLabel(record.status)]].map(([k,v]) => (
                            <div key={k} className="vr-detail-row"><div className="vr-detail-key">{k}</div><div className="vr-detail-val">{v}</div></div>
                          ))}
                        </div>
                      )}
                      {record && (
                        <button className="btn btn-primary btn-sm" style={{marginTop:14}} onClick={() => openModal(record)}>
                          See full details & verdict →
                        </button>
                      )}
                      {!isMatch && <div className="vr-details"><div className="vr-detail-row"><div className="vr-detail-key">💡 Tip</div><div className="vr-detail-val">Try different words, or browse all promises manually.</div></div></div>}
                    </div>

                    {(result.otherMatches||[]).filter(i => i !== result.bestMatchIndex && ledger[i]).length > 0 && (
                      <div style={{marginTop:20}}>
                        <div style={{fontSize:13,fontWeight:700,color:'var(--brown)',marginBottom:10}}>🧩 Other possibly related promises:</div>
                        {(result.otherMatches||[]).filter(i => i !== result.bestMatchIndex && ledger[i]).map(i => {
                          const p = ledger[i]
                          return (
                            <div key={i} className="similar-card" onClick={() => openModal(p)}>
                              <div style={{fontSize:14,color:'var(--brown)',marginBottom:6,fontWeight:500}}>"{p.text}"</div>
                              <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                                {p.politician && <span style={{fontSize:12,color:'var(--muted)'}}>👤 {p.politician}</span>}
                                <span style={{fontSize:12,color:'var(--muted)'}}>📅 {p.date}</span>
                                <span className={`status-badge ${statusCls(p.status)}`}>{statusLabel(p.status)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* ═══ ABOUT ═══ */}
        {page === 'about' && (
          <div>
            <div className="section-header">
              <div className="section-icon">ℹ️</div>
              <div><div className="section-title">How PromiseLedger Works</div><div className="section-desc">Simple, transparent, and tamper-proof.</div></div>
            </div>
            <div className="card" style={{marginBottom:16}}>
              <div className="how-grid">
                {[['✍️','1. Record It','Anyone saves a political promise with the name, date, and a source link.'],['🔍','2. Fact-Check It','Use AI search to verify if a promise was really made — even if you don\'t remember the exact words.'],['⚖️','3. Track the Verdict','The AI searches the web automatically, or mark it yourself as Kept, Broken, or Still Waiting.']].map(([icon,title,desc]) => (
                  <div key={title} className="how-card"><div className="hc-icon">{icon}</div><h4>{title}</h4><p>{desc}</p></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="step-label" style={{marginBottom:10}}>What do the status labels mean?</div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {[['s-pending','⏳ Waiting','The promise was made but we\'re still waiting. Default status for all new promises.'],['s-kept','✅ Kept','The politician followed through. A proof link should be attached.'],['s-broken','❌ Broken','The deadline passed or they went back on their word.']].map(([cls,label,desc]) => (
                  <div key={cls} style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                    <span className={`status-badge ${cls}`} style={{flexShrink:0}}>{label}</span>
                    <span style={{fontSize:13,color:'var(--muted)',lineHeight:1.6}}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODAL ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal.politician ? `Promise by ${modal.politician}` : 'Promise Details'}</div>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-promise-text">"{modal.text}"</div>

              <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:16}}>
                {[['👤 Who',modal.politician||'Not specified'],['📅 Date',modal.date],['📍 Where',modal.context||'Not specified'],['📦 Block','#'+modal.blockNum]].map(([k,v]) => (
                  <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                ))}
                {modal.sourceUrl && <div className="detail-row"><div className="detail-key">🔗 Source</div><div className="detail-val"><a href={modal.sourceUrl} target="_blank" rel="noreferrer" style={{color:'var(--orange)',fontWeight:600}}>{modal.sourceUrl}</a></div></div>}
              </div>

              <div className="verdict-section">
                <h3>⚖️ Was This Promise Kept?</h3>

                {/* AI ANALYSIS */}
                <div style={{marginBottom:16}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:10}}>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--brown)',display:'flex',alignItems:'center',gap:6}}>
                      🤖 AI Web Analysis
                      <span style={{fontSize:11,fontWeight:400,color:'var(--muted)'}}>— searches the internet for real news</span>
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={aiAnalysis==='loading'} onClick={runAIAnalysis}>
                      {aiAnalysis === 'loading' ? <><span className="spin">⟳</span> Searching web...</> : aiAnalysis ? '🔎 Re-Analyse' : '🔎 Auto-Analyse Now'}
                    </button>
                  </div>

                  {!aiAnalysis && (
                    <div style={{background:'var(--warm)',border:'1.5px dashed var(--border)',borderRadius:14,padding:'16px 18px',fontSize:13,color:'var(--muted)',lineHeight:1.6}}>
                      Click <strong>Auto-Analyse Now</strong> — the AI will search the web for news about this promise and tell you if it was fulfilled, broken, or still pending, with real sources.
                    </div>
                  )}

                  {aiAnalysis === 'loading' && (
                    <div className="ai-analysis-box">
                      <div className="ai-analysis-header loading">
                        <div className="aah-icon"><span className="spin">🔍</span></div>
                        <div><div className="aah-verdict loading">Searching the web for evidence...</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Running multiple searches, please wait</div></div>
                      </div>
                      <div className="ai-analysis-body">
                        {[90,75,85].map((w,i) => <div key={i} className="skeleton" style={{width:`${w}%`,marginBottom:8}} />)}
                      </div>
                    </div>
                  )}

                  {aiAnalysis && aiAnalysis !== 'loading' && !aiAnalysis.error && (() => {
                    const vMap = { kept:{icon:'✅',label:'Promise Kept',cls:'kept'}, broken:{icon:'❌',label:'Promise Broken',cls:'broken'}, pending:{icon:'⏳',label:'Still In Progress',cls:'pending'}, insufficient:{icon:'🔎',label:'Not Enough Evidence Yet',cls:'insufficient'} }
                    const v = vMap[aiAnalysis.verdict] || vMap.insufficient
                    const confClass = aiAnalysis.confidence==='high'?'conf-high':aiAnalysis.confidence==='medium'?'conf-medium':'conf-low'
                    const confLabel = aiAnalysis.confidence==='high'?'High Confidence':aiAnalysis.confidence==='medium'?'Medium Confidence':'Low Confidence'
                    return (
                      <div>
                        <div className="ai-analysis-box">
                          <div className={`ai-analysis-header ${v.cls}`}>
                            <div className="aah-icon">{v.icon}</div>
                            <div>
                              <div className={`aah-verdict ${v.cls}`}>{v.label} <span className={`aah-conf ${confClass}`}>{confLabel}</span></div>
                              <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Based on live web search · {new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                            </div>
                          </div>
                          <div className="ai-analysis-body">
                            <div className="ai-summary">{aiAnalysis.summary}</div>
                            {(aiAnalysis.sources||[]).length > 0 && (
                              <div>
                                <div className="ai-sources-label">📰 Sources found on the web</div>
                                {aiAnalysis.sources.map((s,i) => (
                                  <div key={i} className="ai-source-item">
                                    <div className="asi-icon">{s.supports==='kept'?'✅':s.supports==='broken'?'❌':'⏳'}</div>
                                    <div className="asi-body">
                                      <div className="asi-title">{s.title||'News Article'}</div>
                                      <div className="asi-snippet">{s.snippet}</div>
                                      {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="asi-link">Read full article ↗</a>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="ai-auto-note">⚠️ This is an AI analysis based on publicly available news. Always verify with the linked sources before drawing conclusions.</div>
                          </div>
                        </div>
                        {['kept','broken','pending'].includes(aiAnalysis.verdict) && aiAnalysis.confidence !== 'low' && (
                          <div style={{marginTop:12,padding:'12px 14px',background:'var(--orange-soft)',border:'1px solid rgba(232,98,26,.2)',borderRadius:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                            <div style={{fontSize:13,color:'var(--brown)'}}>Apply this AI verdict to the promise?</div>
                            <button className="btn btn-primary btn-sm" onClick={() => applyAIVerdict(aiAnalysis.verdict, aiAnalysis.summary, aiAnalysis.sources?.[0]?.url||'')}>
                              Apply {v.icon} {v.label}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {aiAnalysis?.error && (
                    <div style={{background:'var(--red-soft)',border:'1.5px solid rgba(192,57,43,.2)',borderRadius:14,padding:16,fontSize:13,color:'var(--red)'}}>
                      ⚠️ Analysis failed. Please try again.<br /><span style={{color:'var(--muted)',fontSize:11}}>{aiAnalysis.error}</span>
                    </div>
                  )}
                </div>

                {/* CURRENT VERDICT */}
                <div className={`verdict-current vc-${modal.status}`}>
                  <div className="vc-top">
                    <div className="vc-icon">{verdictBarIcon(modal.status)}</div>
                    <div className="vc-label">{modal.status==='kept'?'This promise was KEPT':modal.status==='broken'?'This promise was BROKEN':'Still waiting — not yet fulfilled'}</div>
                  </div>
                  {modal.verdictHistory?.length ? (
                    <>
                      <div className="vc-note">{modal.verdictHistory[modal.verdictHistory.length-1].note}</div>
                      {modal.verdictHistory[modal.verdictHistory.length-1].proof && (
                        <div className="vc-proof">🔗 Evidence: <a href={modal.verdictHistory[modal.verdictHistory.length-1].proof} target="_blank" rel="noreferrer" style={{color:'var(--orange)',fontWeight:600}}>{modal.verdictHistory[modal.verdictHistory.length-1].proof}</a></div>
                      )}
                    </>
                  ) : (
                    <div className="vc-note" style={{color:'var(--muted)'}}>No notes added yet. Update the verdict below to add evidence.</div>
                  )}
                </div>

                {/* UPDATE FORM */}
                <div className="update-verdict-form">
                  <h4>📝 Update the Verdict</h4>
                  <div className="verdict-options">
                    {[['kept','✅ Kept','vo-kept'],['broken','❌ Broken','vo-broken'],['pending','⏳ Still Waiting','vo-pending']].map(([v,label,cls]) => (
                      <div key={v} className={`verdict-opt ${cls}${selectedVerdict===v?' selected':''}`} onClick={() => setSelectedVerdict(v)}>{label}</div>
                    ))}
                  </div>
                  <div className="step-hint" style={{marginBottom:6}}>What's your evidence? (link to news, video, official statement)</div>
                  <input type="url" placeholder="https://... (optional but recommended)" value={verdictProof} onChange={e => setVerdictProof(e.target.value)} />
                  <div style={{marginTop:8}}>
                    <div className="step-hint" style={{marginBottom:4}}>Add a note (optional)</div>
                    <textarea rows={2} placeholder="e.g. The government launched this scheme on Jan 15, 2025..." value={verdictNote} onChange={e => setVerdictNote(e.target.value)} />
                  </div>
                  <div className="form-actions" style={{marginTop:12}}>
                    <button className="btn btn-primary btn-sm" disabled={submittingVerdict} onClick={submitVerdict}>
                      {submittingVerdict ? '⟳ Saving...' : 'Submit Verdict'}
                    </button>
                  </div>
                </div>

                {/* HISTORY */}
                {modal.verdictHistory?.length > 0 && (
                  <div className="history-log">
                    <h4>Update History</h4>
                    {[...modal.verdictHistory].reverse().map((h, i) => (
                      <div key={i} className="history-item">
                        <div className={`hi-dot hi-dot-${h.status}`} />
                        <div className="hi-text">
                          <strong>{h.status==='kept'?'Marked as Kept':h.status==='broken'?'Marked as Broken':'Reset to Waiting'}</strong>
                          {h.note && ` — ${h.note}`}
                          {h.proof && <> · <a href={h.proof} target="_blank" rel="noreferrer" style={{color:'var(--orange)'}}>Evidence ↗</a></>}
                          <br /><span style={{fontSize:11}}>{new Date(h.at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className="toast-wrap">
          <div className={`toast ${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </>
  )
}
