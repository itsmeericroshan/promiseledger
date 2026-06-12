'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

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
  const [page, setPage] = useState('ask')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [selectedVerdict, setSelectedVerdict] = useState('pending')
  const [verdictProof, setVerdictProof] = useState('')
  const [verdictNote, setVerdictNote] = useState('')
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ask page
  const [askInput, setAskInput] = useState('')
  const [askResult, setAskResult] = useState(null)
  const [asking, setAsking] = useState(false)

  // add form
  const [addText, setAddText] = useState('')
  const [addPolitician, setAddPolitician] = useState('')
  const [addDate, setAddDate] = useState('')
  const [addContext, setAddContext] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [fingerprint, setFingerprint] = useState('')

  const toastTimer = useRef(null)

  useEffect(() => {
    const stored = localStorage.getItem('we_ledger')
    if (stored) setLedger(JSON.parse(stored))
  }, [])

  const persist = useCallback((nl) => {
    setLedger(nl)
    localStorage.setItem('we_ledger', JSON.stringify(nl))
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

  // ── ASK AI ──────────────────────────────────────────────────────
  async function askAboutPromise() {
    if (!askInput.trim()) { showToast('Please type a promise or question.', 'error'); return }
    setAsking(true)
    setAskResult(null)
    try {
      const data = await callAI({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are WE — a powerful political accountability AI. When a user asks about a political promise, you search the web thoroughly and give them a complete, honest analysis.

You MUST use the web_search tool multiple times to find:
1. When and where the promise was made
2. Whether it was fulfilled, broken, or still pending — search for the LATEST news (2024, 2025, 2026)
3. Any official announcements, government reports, or news articles about it

Always search with recent year terms like "2024", "2025", "2026" to get the latest status.

Respond ONLY with this exact JSON (no markdown, no extra text):
{
  "verdict": "fulfilled" | "broken" | "pending" | "unknown",
  "confidence": "high" | "medium" | "low",
  "promise_text": "<exact or close wording of the promise>",
  "made_by": "<politician/party name>",
  "made_when": "<date or year if found>",
  "made_where": "<place/event if found>",
  "current_status": "<2-3 plain English sentences explaining the latest status with specific facts>",
  "fulfillment_probability": <number 0-100>,
  "key_findings": ["<finding 1>", "<finding 2>", "<finding 3>"],
  "advantages": ["<advantage if fulfilled 1>", "<advantage 2>", "<advantage 3>"],
  "disadvantages": ["<risk or downside 1>", "<risk 2>", "<risk 3>"],
  "sources": [
    {"title": "<title>", "snippet": "<one sentence>", "url": "<url>", "date": "<date if available>"}
  ],
  "last_searched": "June 2026"
}

Be specific with facts, numbers, and dates. If something was fulfilled 3 years ago, say so clearly. Never say "pending" if there is clear evidence it was completed.`,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: `Tell me about this political promise: "${askInput.trim()}"` }]
      })

      const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text')
      const raw = textBlock?.text || '{}'
      let result
      try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
      catch {
        const match = raw.match(/\{[\s\S]*\}/)
        result = match ? JSON.parse(match[0]) : { verdict: 'unknown', confidence: 'low', current_status: 'Could not analyse. Please try again.', sources: [] }
      }

      // Save to ledger if not already there
      const fp = await hashText(askInput.trim())
      if (!ledger.find(p => p.fp === fp)) {
        const record = {
          id: uuid(), text: askInput.trim(), fp,
          politician: result.made_by || '',
          date: result.made_when || '',
          context: result.made_where || '',
          sourceUrl: result.sources?.[0]?.url || '',
          savedAt: Date.now(),
          blockNum: Math.floor(Math.random() * 500000) + 7000000,
          status: result.verdict === 'fulfilled' ? 'kept' : result.verdict === 'broken' ? 'broken' : 'pending',
          verdictHistory: [{
            status: result.verdict === 'fulfilled' ? 'kept' : result.verdict === 'broken' ? 'broken' : 'pending',
            note: `[AI Analysis] ${result.current_status}`,
            proof: result.sources?.[0]?.url || '',
            at: Date.now(),
            byAI: true
          }]
        }
        persist([record, ...ledger])
      }

      setAskResult(result)
    } catch (err) {
      showToast('Analysis failed. Please try again.', 'error')
      console.error(err)
    }
    setAsking(false)
  }

  // ── Save promise ─────────────────────────────────────────────────
  async function savePromise() {
    if (!addText.trim()) { showToast('Please write what was promised first.', 'error'); return }
    setSaving(true)
    const fp = await hashText(addText.trim())
    if (ledger.find(p => p.fp === fp)) {
      showToast('This exact promise is already on record!', 'error')
      setSaving(false); return
    }
    const record = {
      id: uuid(), text: addText.trim(), fp,
      politician: addPolitician.trim(),
      date: addDate,
      context: addContext.trim(),
      sourceUrl: addUrl.trim(),
      savedAt: Date.now(),
      blockNum: Math.floor(Math.random() * 500000) + 7000000,
      status: 'pending',
      verdictHistory: []
    }
    persist([record, ...ledger])
    setAddText(''); setAddPolitician(''); setAddDate(''); setAddContext(''); setAddUrl('')
    setSaving(false)
    showToast('Promise saved!', 'success')
    setPage('browse')
  }

  // ── Modal ────────────────────────────────────────────────────────
  function openModal(p) {
    setModal(p); setSelectedVerdict(p.status)
    setVerdictProof(''); setVerdictNote(''); setAiAnalysis(null)
    document.body.style.overflow = 'hidden'
  }
  function closeModal() { setModal(null); document.body.style.overflow = '' }

  // ── Verdict ──────────────────────────────────────────────────────
  function submitVerdict() {
    if (!modal) return
    setSubmitting(true)
    setTimeout(() => {
      const updated = ledger.map(p => {
        if (p.id !== modal.id) return p
        const h = [...(p.verdictHistory || []), { status: selectedVerdict, note: verdictNote, proof: verdictProof, at: Date.now() }]
        return { ...p, status: selectedVerdict, verdictHistory: h }
      })
      persist(updated)
      setModal(updated.find(p => p.id === modal.id))
      setVerdictProof(''); setVerdictNote(''); setSubmitting(false)
      showToast(selectedVerdict === 'kept' ? 'Marked as Kept!' : selectedVerdict === 'broken' ? 'Marked as Broken' : 'Reset to Pending', 'success')
    }, 500)
  }

  // ── AI Analysis in modal ─────────────────────────────────────────
  async function runAIAnalysis() {
    if (!modal) return
    setAiAnalysis('loading')
    try {
      const data = await callAI({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are WE — a political accountability AI. Search the web thoroughly for the LATEST news (search for 2024, 2025, 2026 updates) about this promise. Never assume "pending" if there is evidence of completion or failure.

Respond ONLY with this exact JSON (no markdown):
{
  "verdict": "fulfilled" | "broken" | "pending" | "unknown",
  "confidence": "high" | "medium" | "low",
  "made_when": "<date/year if found>",
  "made_where": "<place/event if found>",
  "current_status": "<2-3 plain English sentences with specific facts and dates>",
  "fulfillment_probability": <0-100>,
  "key_findings": ["<finding 1>", "<finding 2>", "<finding 3>"],
  "advantages": ["<advantage 1>", "<advantage 2>", "<advantage 3>"],
  "disadvantages": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "sources": [{"title": "<title>", "snippet": "<one sentence>", "url": "<url>", "date": "<date>"}],
  "last_searched": "June 2026"
}`,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Investigate this political promise with the LATEST news:\nPromise: "${modal.text}"\nMade by: ${modal.politician || 'unknown'}\nDate: ${modal.date || 'unknown'}\n\nSearch for 2024, 2025, 2026 updates. Was it fulfilled, broken, or still pending?`
        }]
      })
      const textBlock = [...(data.content || [])].reverse().find(b => b.type === 'text')
      const raw = textBlock?.text || '{}'
      let result
      try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
      catch {
        const match = raw.match(/\{[\s\S]*\}/)
        result = match ? JSON.parse(match[0]) : { verdict: 'unknown', confidence: 'low', current_status: 'Could not parse response.', sources: [] }
      }
      setAiAnalysis(result)

      // Auto-update status if high confidence
      if (['fulfilled','broken','pending'].includes(result.verdict) && result.confidence === 'high') {
        const newStatus = result.verdict === 'fulfilled' ? 'kept' : result.verdict === 'broken' ? 'broken' : 'pending'
        const updated = ledger.map(p => {
          if (p.id !== modal.id) return p
          const h = [...(p.verdictHistory || []), { status: newStatus, note: `[AI] ${result.current_status}`, proof: result.sources?.[0]?.url || '', at: Date.now(), byAI: true }]
          return { ...p, status: newStatus, verdictHistory: h }
        })
        persist(updated)
        setModal(updated.find(p => p.id === modal.id))
        setSelectedVerdict(newStatus)
      }
    } catch (err) {
      setAiAnalysis({ error: err.message })
    }
  }

  const statusIcon = s => s === 'kept' ? '✅' : s === 'broken' ? '❌' : '⏳'
  const statusLabel = s => s === 'kept' ? 'Kept' : s === 'broken' ? 'Broken' : 'Pending'
  const verdictIcon = v => v === 'fulfilled' ? '✅' : v === 'broken' ? '❌' : v === 'unknown' ? '❓' : '⏳'
  const verdictLabel = v => v === 'fulfilled' ? 'Promise Fulfilled' : v === 'broken' ? 'Promise Broken' : v === 'unknown' ? 'Not Enough Information' : 'Still Pending'
  const verdictCls = v => v === 'fulfilled' ? 'fulfilled' : v === 'broken' ? 'broken' : v === 'unknown' ? 'unknown' : 'pending'

  const filtered = filter === 'all' ? ledger : ledger.filter(p => p.status === filter)

  const ProbBar = ({ val }) => {
    const color = val >= 70 ? '#1a7a4a' : val >= 40 ? '#b8860b' : '#c0392b'
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
          <span>Likelihood of fulfillment</span>
          <span style={{ fontWeight: 700, color }}>{val}%</span>
        </div>
        <div style={{ height: 8, background: 'var(--warm)', borderRadius: 100, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${val}%`, background: color, borderRadius: 100, transition: 'width 1s ease' }} />
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        :root{--cream:#faf7f2;--warm:#f2ebe0;--card:#fff;--border:#e8e0d4;--brown:#2d1f14;--brown2:#5c3d2e;--primary:#1a6b3c;--primary-soft:#e8f5ee;--red:#c0392b;--red-soft:#fdecea;--yellow:#b8860b;--yellow-soft:#fff8e1;--muted:#8a7060;--shadow:0 2px 16px rgba(45,31,20,.08);--shadow-hover:0 8px 32px rgba(45,31,20,.14)}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--cream);color:var(--brown);font-family:'Nunito',sans-serif;min-height:100vh}
        nav{background:var(--card);border-bottom:1px solid var(--border);padding:0 24px;position:sticky;top:0;z-index:200;box-shadow:0 1px 8px rgba(45,31,20,.06)}
        .nav-inner{max-width:900px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px}
        .logo{display:flex;align-items:center;gap:10px;cursor:pointer}
        .logo-icon{width:36px;height:36px;background:var(--primary);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
        .logo-text{font-family:'Fraunces',serif;font-size:22px;font-weight:700;color:var(--primary);letter-spacing:1px}
        .logo-sub{font-size:11px;color:var(--muted);margin-top:-2px}
        .nav-pill{font-size:12px;color:var(--primary);background:var(--primary-soft);padding:4px 12px;border-radius:100px;border:1px solid rgba(26,107,60,.2)}
        .hero{max-width:900px;margin:0 auto;padding:48px 24px 32px;text-align:center}
        .hero-tag{display:inline-flex;align-items:center;gap:6px;background:var(--primary-soft);color:var(--primary);font-size:12px;font-weight:600;padding:5px 14px;border-radius:100px;margin-bottom:16px;border:1px solid rgba(26,107,60,.2)}
        .hero h1{font-family:'Fraunces',serif;font-size:clamp(28px,6vw,52px);font-weight:700;line-height:1.15;margin-bottom:12px}
        .hero h1 em{font-style:italic;color:var(--primary)}
        .hero p{font-size:15px;line-height:1.7;color:var(--muted);max-width:500px;margin:0 auto 28px}
        .stat-row{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:36px}
        .stat-pill{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 20px;text-align:center;box-shadow:var(--shadow);min-width:110px}
        .stat-pill-num{font-family:'Fraunces',serif;font-size:26px;font-weight:700;color:var(--primary);line-height:1}
        .stat-pill-label{font-size:11px;color:var(--muted);margin-top:3px;font-weight:600}
        .main{max-width:900px;margin:0 auto;padding:0 24px 80px}
        .page-tabs{display:flex;gap:6px;margin-bottom:26px;flex-wrap:wrap}
        .page-tab{display:flex;align-items:center;gap:7px;padding:9px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;background:var(--card);border:1.5px solid var(--border);color:var(--muted)}
        .page-tab:hover{color:var(--brown);border-color:var(--brown2)}
        .page-tab.active{background:var(--primary);color:#fff;border-color:var(--primary)}
        .sec-header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
        .sec-icon{width:40px;height:40px;background:var(--primary-soft);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
        .sec-title{font-family:'Fraunces',serif;font-size:22px;font-weight:700}
        .sec-desc{font-size:13px;color:var(--muted);margin-top:2px}
        .card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:26px;box-shadow:var(--shadow);margin-bottom:22px}

        /* ASK BOX */
        .ask-box{background:var(--card);border:2px solid var(--primary);border-radius:20px;padding:28px;box-shadow:0 4px 24px rgba(26,107,60,.12);margin-bottom:24px}
        .ask-box textarea{width:100%;background:var(--warm);border:1.5px solid var(--border);color:var(--brown);padding:14px 16px;font-family:'Nunito',sans-serif;font-size:15px;border-radius:14px;outline:none;resize:vertical;transition:border-color .2s}
        .ask-box textarea:focus{border-color:var(--primary);background:#fff;box-shadow:0 0 0 3px rgba(26,107,60,.1)}
        .ask-box textarea::placeholder{color:var(--muted);opacity:.7}
        .ask-examples{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .ask-example{padding:6px 14px;background:var(--primary-soft);border:1px solid rgba(26,107,60,.2);border-radius:100px;font-size:12px;color:var(--primary);cursor:pointer;font-weight:600;transition:all .2s}
        .ask-example:hover{background:var(--primary);color:#fff}

        /* RESULT BOX */
        .result-box{border-radius:16px;overflow:hidden;border:1px solid var(--border);margin-top:20px;animation:fadeUp .4s ease}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .result-header{padding:16px 20px;display:flex;align-items:flex-start;gap:14px}
        .result-header.fulfilled{background:#e8f5ee;border-bottom:1px solid rgba(26,122,74,.2)}
        .result-header.broken{background:#fdecea;border-bottom:1px solid rgba(192,57,43,.2)}
        .result-header.pending{background:#fff8e1;border-bottom:1px solid rgba(184,134,11,.2)}
        .result-header.unknown{background:var(--warm);border-bottom:1px solid var(--border)}
        .rh-icon{font-size:28px;flex-shrink:0;margin-top:2px}
        .rh-verdict{font-family:'Fraunces',serif;font-size:20px;font-weight:700}
        .rh-verdict.fulfilled{color:#1a7a4a}
        .rh-verdict.broken{color:var(--red)}
        .rh-verdict.pending{color:var(--yellow)}
        .rh-verdict.unknown{color:var(--muted)}
        .rh-conf{font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px;margin-left:8px;display:inline-block}
        .conf-high{background:#e8f5ee;color:#1a7a4a}
        .conf-medium{background:#fff8e1;color:var(--yellow)}
        .conf-low{background:var(--warm);color:var(--muted)}
        .result-body{padding:18px 20px;background:var(--card)}
        .result-section{margin-bottom:18px}
        .result-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:6px}
        .result-status-text{font-size:14px;line-height:1.8;color:var(--brown)}
        .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
        @media(max-width:500px){.meta-grid{grid-template-columns:1fr}}
        .meta-item{background:var(--warm);border-radius:10px;padding:10px 14px}
        .meta-item-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:3px}
        .meta-item-val{font-size:13px;font-weight:600;color:var(--brown)}
        .findings-list{display:flex;flex-direction:column;gap:7px}
        .finding-item{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--brown);line-height:1.5}
        .finding-dot{width:6px;height:6px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:5px}
        .adv-dis-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media(max-width:500px){.adv-dis-grid{grid-template-columns:1fr}}
        .adv-box{background:#e8f5ee;border-radius:12px;padding:14px}
        .dis-box{background:#fdecea;border-radius:12px;padding:14px}
        .adv-dis-title{font-size:12px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:5px}
        .adv-dis-title.adv{color:#1a7a4a}
        .adv-dis-title.dis{color:var(--red)}
        .adv-dis-item{font-size:12px;color:var(--brown2);line-height:1.5;margin-bottom:5px;padding-left:12px;position:relative}
        .adv-dis-item::before{content:"•";position:absolute;left:0;color:inherit}
        .src-item{display:flex;gap:10px;padding:10px 12px;background:var(--warm);border-radius:10px;border:1px solid var(--border);margin-bottom:7px}
        .src-body{flex:1;min-width:0}
        .src-title{font-size:13px;font-weight:600;color:var(--brown);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .src-snippet{font-size:12px;color:var(--muted);line-height:1.5}
        .src-meta{display:flex;gap:10px;margin-top:3px;align-items:center}
        .src-link{font-size:11px;color:var(--primary);font-weight:600}
        .src-date{font-size:10px;color:var(--muted)}
        .ai-note{font-size:11px;color:var(--muted);margin-top:12px;font-style:italic;line-height:1.5;padding:10px 12px;background:var(--warm);border-radius:8px}

        /* FORM */
        .steps{display:flex;flex-direction:column;gap:18px}
        .step{display:flex;gap:14px;align-items:flex-start}
        .step-num{width:28px;height:28px;border-radius:50%;background:var(--warm);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--brown2);flex-shrink:0;margin-top:2px}
        .step-label{font-size:14px;font-weight:700;color:var(--brown);margin-bottom:4px}
        .step-hint{font-size:12px;color:var(--muted);margin-bottom:6px;line-height:1.5}
        input[type=text],input[type=date],input[type=url],textarea{width:100%;background:var(--warm);border:1.5px solid var(--border);color:var(--brown);padding:11px 14px;font-family:'Nunito',sans-serif;font-size:14px;border-radius:12px;outline:none;transition:border-color .2s;resize:vertical}
        input:focus,textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(26,107,60,.1);background:#fff}
        input::placeholder,textarea::placeholder{color:var(--muted);opacity:.7}
        .input-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media(max-width:560px){.input-row{grid-template-columns:1fr}}
        .optional-tag{font-size:10px;color:var(--muted);font-weight:400;margin-left:6px;background:var(--warm);padding:2px 7px;border-radius:100px;border:1px solid var(--border)}
        .fp-box{background:var(--warm);border:1.5px dashed var(--border);border-radius:12px;padding:12px 15px;margin-top:8px}
        .fp-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px}
        .fp-val{font-family:monospace;font-size:11px;color:var(--brown2);word-break:break-all;line-height:1.6}

        /* BUTTONS */
        .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;border:none;border-radius:12px;cursor:pointer;transition:all .2s}
        .btn-primary{background:var(--primary);color:#fff;box-shadow:0 4px 12px rgba(26,107,60,.3)}
        .btn-primary:hover{background:#145730;transform:translateY(-1px)}
        .btn-ghost{background:var(--warm);color:var(--brown2);border:1.5px solid var(--border)}
        .btn-ghost:hover{background:var(--border)}
        .btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}
        .btn-sm{padding:7px 14px;font-size:12px;border-radius:8px}
        .form-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}

        /* BROWSE */
        .filter-bar{display:flex;gap:7px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
        .filter-btn{padding:6px 13px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--card);color:var(--muted);transition:all .2s}
        .filter-btn.active{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}
        .filter-btn.f-broken.active{background:var(--red-soft);border-color:var(--red);color:var(--red)}
        .filter-btn.f-pending.active{background:var(--yellow-soft);border-color:var(--yellow);color:var(--yellow)}
        .promise-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px 20px;box-shadow:var(--shadow);transition:box-shadow .2s,transform .2s;cursor:pointer;margin-bottom:11px}
        .promise-card:hover{box-shadow:var(--shadow-hover);transform:translateY(-2px)}
        .pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
        .pc-text{font-size:14px;line-height:1.6;color:var(--brown);flex:1;font-weight:500}
        .status-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:100px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid transparent;flex-shrink:0}
        .s-pending{background:var(--yellow-soft);color:var(--yellow);border-color:rgba(184,134,11,.25)}
        .s-kept{background:#e8f5ee;color:#1a7a4a;border-color:rgba(26,122,74,.25)}
        .s-broken{background:var(--red-soft);color:var(--red);border-color:rgba(192,57,43,.25)}
        .pc-meta{display:flex;flex-wrap:wrap;gap:6px 14px;border-top:1px solid var(--border);padding-top:9px;margin-top:7px}
        .pc-meta-item{font-size:12px;color:var(--muted)}
        .pc-meta-item strong{color:var(--brown2)}
        .tap-hint{margin-top:8px;font-size:12px;color:var(--primary);font-weight:600}
        .empty-state{text-align:center;padding:48px 24px;color:var(--muted)}
        .empty-icon{font-size:44px;margin-bottom:14px}
        .empty-state h3{font-family:'Fraunces',serif;font-size:18px;color:var(--brown);margin-bottom:6px}
        .empty-state p{font-size:13px;line-height:1.6;max-width:300px;margin:0 auto}

        /* MODAL */
        .modal-overlay{position:fixed;inset:0;background:rgba(45,31,20,.45);backdrop-filter:blur(4px);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto}
        .modal{background:var(--card);border-radius:20px;width:100%;max-width:640px;box-shadow:0 24px 64px rgba(45,31,20,.2);margin:auto;animation:fadeUp .3s ease}
        .modal-header{padding:22px 26px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        .modal-title{font-family:'Fraunces',serif;font-size:19px;font-weight:700;line-height:1.3}
        .modal-close{width:34px;height:34px;border-radius:50%;background:var(--warm);border:none;cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted)}
        .modal-close:hover{background:var(--border)}
        .modal-body{padding:18px 26px 26px}
        .modal-promise-text{font-size:15px;line-height:1.7;color:var(--brown);background:var(--warm);border-radius:12px;padding:14px;margin-bottom:16px;font-style:italic;border-left:3px solid var(--primary)}
        .detail-row{display:flex;gap:10px;font-size:13px;padding:6px 0;border-bottom:1px solid var(--warm)}
        .detail-row:last-child{border-bottom:none}
        .detail-key{color:var(--muted);font-weight:700;min-width:110px;flex-shrink:0}
        .detail-val{color:var(--brown);word-break:break-word}
        .verdict-section h3{font-family:'Fraunces',serif;font-size:15px;font-weight:700;margin-bottom:12px;margin-top:18px}
        .verdict-current{border-radius:12px;padding:14px;margin-bottom:14px}
        .vc-kept{background:#e8f5ee;border:1px solid rgba(26,122,74,.25)}
        .vc-broken{background:var(--red-soft);border:1px solid rgba(192,57,43,.25)}
        .vc-pending{background:var(--yellow-soft);border:1px solid rgba(184,134,11,.25)}
        .vc-top{display:flex;align-items:center;gap:10px;margin-bottom:6px}
        .vc-icon{font-size:20px}
        .vc-label{font-size:14px;font-weight:700}
        .vc-kept .vc-label{color:#1a7a4a}.vc-broken .vc-label{color:var(--red)}.vc-pending .vc-label{color:var(--yellow)}
        .vc-note{font-size:13px;color:var(--muted);line-height:1.6}
        .update-form{background:var(--warm);border:1.5px dashed var(--border);border-radius:14px;padding:16px;margin-bottom:14px}
        .update-form h4{font-size:13px;font-weight:700;color:var(--brown);margin-bottom:10px}
        .verdict-opts{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
        .vo{padding:7px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:2px solid transparent;transition:all .2s;background:var(--card)}
        .vo-kept{color:#1a7a4a;border-color:rgba(26,122,74,.3)}.vo-kept.sel{background:#e8f5ee;border-color:#1a7a4a}
        .vo-broken{color:var(--red);border-color:rgba(192,57,43,.3)}.vo-broken.sel{background:var(--red-soft);border-color:var(--red)}
        .vo-pending{color:var(--yellow);border-color:rgba(184,134,11,.3)}.vo-pending.sel{background:var(--yellow-soft);border-color:var(--yellow)}
        .history-log h4{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;margin-top:14px}
        .history-item{display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--warm)}
        .history-item:last-child{border-bottom:none}
        .hi-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:5px}
        .hi-dot-kept{background:#1a7a4a}.hi-dot-broken{background:var(--red)}.hi-dot-pending{background:var(--yellow)}
        .hi-text{font-size:12px;color:var(--muted);line-height:1.5}
        .hi-text strong{color:var(--brown)}
        .ai-box{border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:14px}
        .ai-header{padding:12px 16px;display:flex;align-items:center;gap:10px}
        .ai-header.fulfilled{background:#e8f5ee;border-bottom:1px solid rgba(26,122,74,.2)}
        .ai-header.broken{background:var(--red-soft);border-bottom:1px solid rgba(192,57,43,.2)}
        .ai-header.pending,.ai-header.unknown{background:var(--yellow-soft);border-bottom:1px solid rgba(184,134,11,.2)}
        .ai-header.loading{background:var(--warm);border-bottom:1px solid var(--border)}
        .ai-verdict{font-family:'Fraunces',serif;font-size:15px;font-weight:700}
        .ai-verdict.fulfilled{color:#1a7a4a}.ai-verdict.broken{color:var(--red)}.ai-verdict.pending,.ai-verdict.unknown{color:var(--yellow)}.ai-verdict.loading{color:var(--muted)}
        .ai-body{padding:14px 16px;background:var(--card)}
        .how-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}
        @media(max-width:600px){.how-grid{grid-template-columns:1fr}}
        .how-card{background:var(--warm);border:1px solid var(--border);border-radius:14px;padding:16px}
        .how-card .hc-icon{font-size:24px;margin-bottom:7px}
        .how-card h4{font-size:13px;font-weight:700;margin-bottom:4px}
        .how-card p{font-size:12px;color:var(--muted);line-height:1.6}
        .toast-wrap{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999;pointer-events:none}
        .toast{padding:11px 22px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(45,31,20,.2);animation:fadeUp .35s ease;max-width:380px;text-align:center}
        .toast.success{background:#1a7a4a;color:#fff}
        .toast.error{background:var(--red);color:#fff}
        .toast.default{background:var(--brown);color:#fff}
        .spin{display:inline-block;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .skel{height:11px;background:var(--warm);border-radius:6px;animation:pulse 1.4s ease-in-out infinite;margin-bottom:8px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .loading-box{background:var(--warm);border:1.5px dashed var(--border);border-radius:14px;padding:24px;text-align:center}
        .loading-box .spin{font-size:28px;display:block;margin-bottom:12px}
        .loading-box p{font-size:13px;color:var(--muted);line-height:1.6}
      `}</style>

      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,400&family=Nunito:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* NAV */}
      <nav>
        <div className="nav-inner">
          <div className="logo" onClick={() => setPage('ask')}>
            <div className="logo-icon">⚖️</div>
            <div>
              <div className="logo-text">WE</div>
              <div className="logo-sub">Political Accountability</div>
            </div>
          </div>
          <div className="nav-pill">🔍 AI-Powered</div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-tag">🗳️ Ask. Verify. Hold Accountable.</div>
        <h1>Did They <em>Really</em><br />Say That?</h1>
        <p>Ask WE about any political promise. We search the latest news and tell you exactly what happened — when it was made, where, and whether it was kept.</p>
        <div className="stat-row">
          {[[stats.total,'Promises Tracked'],[stats.kept,'✅ Kept'],[stats.broken,'❌ Broken'],[stats.pending,'⏳ Pending']].map(([num,label]) => (
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
          {[['ask','💬 Ask WE'],['browse','📋 All Promises'],['add','✍️ Add a Promise'],['about','ℹ️ About']].map(([p,label]) => (
            <div key={p} className={`page-tab${page===p?' active':''}`} onClick={() => setPage(p)}>{label}</div>
          ))}
        </div>

        {/* ═══ ASK WE ═══ */}
        {page === 'ask' && (
          <div>
            <div className="sec-header">
              <div className="sec-icon">💬</div>
              <div><div className="sec-title">Ask WE Anything</div><div className="sec-desc">Type any political promise and WE will tell you everything about it.</div></div>
            </div>

            <div className="ask-box">
              <textarea
                rows={3}
                placeholder="e.g. Did the government promise free electricity to farmers? Or: Women safety force promise by Modi"
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAboutPromise() } }}
              />
              <div className="ask-examples">
                <span style={{fontSize:11,color:'var(--muted)',fontWeight:600,alignSelf:'center'}}>Try:</span>
                {['Free electricity to farmers','2 crore jobs per year','Smart cities mission','Bullet train by 2023'].map(ex => (
                  <span key={ex} className="ask-example" onClick={() => setAskInput(ex)}>{ex}</span>
                ))}
              </div>
              <div className="form-actions" style={{marginTop:16}}>
                <button className="btn btn-primary" disabled={asking} onClick={askAboutPromise} style={{fontSize:15,padding:'13px 28px'}}>
                  {asking ? <><span className="spin">⟳</span> WE is searching the web...</> : '🔍 Ask WE'}
                </button>
              </div>
            </div>

            {asking && (
              <div className="loading-box">
                <span className="spin">🔍</span>
                <p>WE is searching the latest news, government reports, and fact-checks...<br />This takes about 15-20 seconds.</p>
              </div>
            )}

            {askResult && !asking && (() => {
              const r = askResult
              const vc = verdictCls(r.verdict)
              const confClass = r.confidence==='high'?'conf-high':r.confidence==='medium'?'conf-medium':'conf-low'
              const confLabel = r.confidence==='high'?'High Confidence':r.confidence==='medium'?'Medium Confidence':'Low Confidence'
              return (
                <div className="result-box">
                  <div className={`result-header ${vc}`}>
                    <div className="rh-icon">{verdictIcon(r.verdict)}</div>
                    <div style={{flex:1}}>
                      <div className="rh-verdict" style={{display:'inline'}}>{verdictLabel(r.verdict)}</div>
                      <span className={`rh-conf ${confClass}`}>{confLabel}</span>
                      <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>Searched the web · Last updated {r.last_searched || 'June 2026'}</div>
                    </div>
                  </div>
                  <div className="result-body">

                    {/* Meta */}
                    <div className="meta-grid">
                      {r.made_by && <div className="meta-item"><div className="meta-item-label">👤 Made by</div><div className="meta-item-val">{r.made_by}</div></div>}
                      {r.made_when && <div className="meta-item"><div className="meta-item-label">📅 When</div><div className="meta-item-val">{r.made_when}</div></div>}
                      {r.made_where && <div className="meta-item"><div className="meta-item-label">📍 Where</div><div className="meta-item-val">{r.made_where}</div></div>}
                      {r.fulfillment_probability !== undefined && (
                        <div className="meta-item" style={{gridColumn:'1/-1'}}>
                          <ProbBar val={r.fulfillment_probability} />
                        </div>
                      )}
                    </div>

                    {/* Current status */}
                    <div className="result-section">
                      <div className="result-section-title">📰 What Actually Happened</div>
                      <div className="result-status-text">{r.current_status}</div>
                    </div>

                    {/* Key findings */}
                    {r.key_findings?.length > 0 && (
                      <div className="result-section">
                        <div className="result-section-title">🔑 Key Findings</div>
                        <div className="findings-list">
                          {r.key_findings.map((f, i) => (
                            <div key={i} className="finding-item"><div className="finding-dot" />{f}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Advantages & Disadvantages */}
                    {(r.advantages?.length > 0 || r.disadvantages?.length > 0) && (
                      <div className="result-section">
                        <div className="result-section-title">⚖️ If This Promise Gets Fulfilled</div>
                        <div className="adv-dis-grid">
                          {r.advantages?.length > 0 && (
                            <div className="adv-box">
                              <div className="adv-dis-title adv">👍 Advantages</div>
                              {r.advantages.map((a, i) => <div key={i} className="adv-dis-item">{a}</div>)}
                            </div>
                          )}
                          {r.disadvantages?.length > 0 && (
                            <div className="dis-box">
                              <div className="adv-dis-title dis">⚠️ Risks / Downsides</div>
                              {r.disadvantages.map((d, i) => <div key={i} className="adv-dis-item">{d}</div>)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Sources */}
                    {r.sources?.length > 0 && (
                      <div className="result-section">
                        <div className="result-section-title">📰 Sources Found on the Web</div>
                        {r.sources.map((s, i) => (
                          <div key={i} className="src-item">
                            <div style={{fontSize:16,flexShrink:0,marginTop:1}}>🔗</div>
                            <div className="src-body">
                              <div className="src-title">{s.title || 'Article'}</div>
                              <div className="src-snippet">{s.snippet}</div>
                              <div className="src-meta">
                                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="src-link">Read full article ↗</a>}
                                {s.date && <span className="src-date">{s.date}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ai-note">⚠️ WE uses AI and live web search. While we strive for accuracy, always verify important claims with the linked sources. Political situations change rapidly.</div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ═══ BROWSE ═══ */}
        {page === 'browse' && (
          <div>
            <div className="sec-header">
              <div className="sec-icon">📋</div>
              <div><div className="sec-title">All Tracked Promises</div><div className="sec-desc">Click any promise to see full AI analysis and verdict.</div></div>
            </div>
            <div className="filter-bar">
              <span style={{fontSize:12,fontWeight:600,color:'var(--muted)'}}>Filter:</span>
              {[['all','All'],['pending','⏳ Pending'],['kept','✅ Kept'],['broken','❌ Broken']].map(([f,label]) => (
                <button key={f} className={`filter-btn${f==='broken'?' f-broken':f==='pending'?' f-pending':''}${filter===f?' active':''}`} onClick={() => setFilter(f)}>{label}</button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <h3>{ledger.length===0?'No promises tracked yet':'No promises match this filter'}</h3>
                <p>{ledger.length===0?'Go to "Ask WE" and ask about any political promise to start tracking.':'Try a different filter.'}</p>
              </div>
            ) : filtered.map(p => (
              <div key={p.id} className="promise-card" onClick={() => openModal(p)}>
                <div className="pc-top">
                  <div className="pc-text">"{p.text}"</div>
                  <span className={`status-badge s-${p.status}`}>{statusIcon(p.status)} {statusLabel(p.status)}</span>
                </div>
                <div className="pc-meta">
                  {p.politician && <div className="pc-meta-item">👤 <strong>{p.politician}</strong></div>}
                  {p.date && <div className="pc-meta-item">📅 <strong>{p.date}</strong></div>}
                  {p.context && <div className="pc-meta-item">📍 {p.context}</div>}
                  <div className="pc-meta-item" style={{fontSize:11}}>Asked {timeAgo(p.savedAt)}</div>
                </div>
                <div className="tap-hint">Tap for full analysis & details →</div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ ADD ═══ */}
        {page === 'add' && (
          <div>
            <div className="sec-header">
              <div className="sec-icon">✍️</div>
              <div><div className="sec-title">Add a Promise Manually</div><div className="sec-desc">Record a specific promise you want to track. Only the promise text is required.</div></div>
            </div>
            <div className="card">
              <div className="steps">
                <div className="step">
                  <div className="step-num">1</div>
                  <div className="step-body" style={{flex:1}}>
                    <div className="step-label">What was promised? *</div>
                    <div className="step-hint">Write the exact commitment.</div>
                    <textarea rows={3} placeholder="e.g. We will provide free education up to Class 12 for all students" value={addText} onChange={e => setAddText(e.target.value)} />
                    {fingerprint && (
                      <div className="fp-box">
                        <div className="fp-label">🔏 Unique Fingerprint</div>
                        <div className="fp-val">{fingerprint}</div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">2</div>
                  <div className="step-body" style={{flex:1}}>
                    <div className="step-label">Who made this promise? <span className="optional-tag">optional</span></div>
                    <input type="text" placeholder="e.g. Narendra Modi, Congress Party" value={addPolitician} onChange={e => setAddPolitician(e.target.value)} />
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">3</div>
                  <div className="step-body" style={{flex:1}}>
                    <div className="step-label">When &amp; where? <span className="optional-tag">optional</span></div>
                    <div className="input-row">
                      <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} />
                      <input type="text" placeholder="e.g. Election rally, Delhi" value={addContext} onChange={e => setAddContext(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="step">
                  <div className="step-num">4</div>
                  <div className="step-body" style={{flex:1}}>
                    <div className="step-label">Source link <span className="optional-tag">optional</span></div>
                    <input type="url" placeholder="https://..." value={addUrl} onChange={e => setAddUrl(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={saving} onClick={savePromise}>{saving?'Saving...':'📌 Save Promise'}</button>
                <button className="btn btn-ghost" onClick={() => { setAddText(''); setAddPolitician(''); setAddDate(''); setAddContext(''); setAddUrl('') }}>Clear</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ABOUT ═══ */}
        {page === 'about' && (
          <div>
            <div className="sec-header">
              <div className="sec-icon">⚖️</div>
              <div><div className="sec-title">What is WE?</div><div className="sec-desc">A collective intelligence for political accountability.</div></div>
            </div>
            <div className="card" style={{marginBottom:14}}>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:18,fontWeight:700,marginBottom:12}}>WE — because accountability belongs to all of us.</div>
              <p style={{fontSize:14,lineHeight:1.8,color:'var(--muted)'}}>Politicians make hundreds of promises. Most go untracked. WE uses AI to search the latest news, government reports, and fact-checks — giving you a clear, honest answer about whether a promise was kept, broken, or is still pending.</p>
            </div>
            <div className="card" style={{marginBottom:14}}>
              <div className="how-grid">
                {[
                  ['💬','Ask a Question','Type any political promise in plain language. No need for exact wording — WE understands what you mean.'],
                  ['🔍','AI Web Search','WE searches the latest news (2024, 2025, 2026) and government reports to find the real story.'],
                  ['⚖️','Full Analysis','Get the verdict, probability, advantages, risks, and real sources — not just a yes or no.'],
                ].map(([icon,title,desc]) => (
                  <div key={title} className="how-card"><div className="hc-icon">{icon}</div><h4>{title}</h4><p>{desc}</p></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div style={{fontSize:14,fontWeight:700,color:'var(--brown)',marginBottom:10}}>Powered by</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {[['🤖 Anthropic Claude','AI reasoning + live web search for accurate, up-to-date analysis'],['⚡ Next.js + Vercel','Fast, reliable, deployed globally'],['🔒 Secure','Your API key never touches the browser']].map(([k,v]) => (
                  <div key={k} style={{display:'flex',gap:12,padding:'10px 14px',background:'var(--warm)',borderRadius:10}}>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--brown)',minWidth:180}}>{k}</div>
                    <div style={{fontSize:13,color:'var(--muted)'}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODAL ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) closeModal() }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{modal.politician ? `Promise by ${modal.politician}` : 'Promise Details'}</div>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-promise-text">"{modal.text}"</div>
              <div style={{marginBottom:14}}>
                {[['👤 Who',modal.politician||'Not specified'],['📅 Date',modal.date||'Not specified'],['📍 Where',modal.context||'Not specified']].map(([k,v]) => (
                  <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
                ))}
                {modal.sourceUrl && <div className="detail-row"><div className="detail-key">🔗 Source</div><div className="detail-val"><a href={modal.sourceUrl} target="_blank" rel="noreferrer" style={{color:'var(--primary)',fontWeight:600}}>{modal.sourceUrl}</a></div></div>}
              </div>

              <div className="verdict-section">
                <h3>⚖️ AI Analysis</h3>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:10}}>
                  <span style={{fontSize:13,color:'var(--muted)'}}>🤖 Searches latest news automatically</span>
                  <button className="btn btn-primary btn-sm" disabled={aiAnalysis==='loading'} onClick={runAIAnalysis}>
                    {aiAnalysis==='loading'?<><span className="spin">⟳</span> Searching...</>:aiAnalysis?'🔎 Re-Analyse':'🔎 Analyse Now'}
                  </button>
                </div>

                {!aiAnalysis && <div style={{background:'var(--warm)',border:'1.5px dashed var(--border)',borderRadius:12,padding:'14px 16px',fontSize:13,color:'var(--muted)'}}>Click <strong>Analyse Now</strong> — WE will search the latest news and tell you if this promise was kept, broken, or pending.</div>}

                {aiAnalysis==='loading' && (
                  <div className="ai-box">
                    <div className="ai-header loading"><div style={{fontSize:20}}><span className="spin">🔍</span></div><div><div className="ai-verdict loading">Searching latest news...</div></div></div>
                    <div className="ai-body">{[88,72,80].map((w,i)=><div key={i} className="skel" style={{width:`${w}%`}}/>)}</div>
                  </div>
                )}

                {aiAnalysis && aiAnalysis!=='loading' && !aiAnalysis.error && (() => {
                  const vc = verdictCls(aiAnalysis.verdict)
                  const confClass = aiAnalysis.confidence==='high'?'conf-high':aiAnalysis.confidence==='medium'?'conf-medium':'conf-low'
                  return (
                    <div className="ai-box">
                      <div className={`ai-header ${vc}`}>
                        <div style={{fontSize:20}}>{verdictIcon(aiAnalysis.verdict)}</div>
                        <div>
                          <div className={`ai-verdict ${vc}`}>{verdictLabel(aiAnalysis.verdict)} <span className={`rh-conf ${confClass}`}>{aiAnalysis.confidence==='high'?'High Confidence':aiAnalysis.confidence==='medium'?'Medium':'Low Confidence'}</span></div>
                          <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Searched · {aiAnalysis.last_searched||'June 2026'}</div>
                        </div>
                      </div>
                      <div className="ai-body">
                        <p style={{fontSize:13,lineHeight:1.75,color:'var(--brown)',marginBottom:12}}>{aiAnalysis.current_status}</p>
                        {aiAnalysis.fulfillment_probability!==undefined && <ProbBar val={aiAnalysis.fulfillment_probability}/>}
                        {aiAnalysis.key_findings?.length>0 && <div style={{marginTop:12}}><div style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Key Findings</div>{aiAnalysis.key_findings.map((f,i)=><div key={i} className="finding-item" style={{marginBottom:5}}><div className="finding-dot"/>{f}</div>)}</div>}
                        {(aiAnalysis.advantages?.length>0||aiAnalysis.disadvantages?.length>0)&&(
                          <div style={{marginTop:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>If Fulfilled</div>
                            <div className="adv-dis-grid">
                              {aiAnalysis.advantages?.length>0&&<div className="adv-box"><div className="adv-dis-title adv">👍 Advantages</div>{aiAnalysis.advantages.map((a,i)=><div key={i} className="adv-dis-item">{a}</div>)}</div>}
                              {aiAnalysis.disadvantages?.length>0&&<div className="dis-box"><div className="adv-dis-title dis">⚠️ Risks</div>{aiAnalysis.disadvantages.map((d,i)=><div key={i} className="adv-dis-item">{d}</div>)}</div>}
                            </div>
                          </div>
                        )}
                        {aiAnalysis.sources?.length>0&&(
                          <div style={{marginTop:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Sources</div>
                            {aiAnalysis.sources.map((s,i)=>(
                              <div key={i} className="src-item">
                                <div className="src-body">
                                  <div className="src-title">{s.title}</div>
                                  <div className="src-snippet">{s.snippet}</div>
                                  <div className="src-meta">{s.url&&<a href={s.url} target="_blank" rel="noreferrer" className="src-link">Read ↗</a>}{s.date&&<span className="src-date">{s.date}</span>}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="ai-note">⚠️ AI analysis. Always verify with linked sources.</div>
                      </div>
                    </div>
                  )
                })()}

                {aiAnalysis?.error && <div style={{background:'var(--red-soft)',borderRadius:12,padding:14,fontSize:13,color:'var(--red)'}}>⚠️ Analysis failed. Try again.</div>}

                {/* Current verdict */}
                <div className={`verdict-current vc-${modal.status}`}>
                  <div className="vc-top"><div className="vc-icon">{statusIcon(modal.status)}</div><div className="vc-label">{modal.status==='kept'?'KEPT':modal.status==='broken'?'BROKEN':'PENDING'}</div></div>
                  {modal.verdictHistory?.length ? <div className="vc-note">{modal.verdictHistory[modal.verdictHistory.length-1].note}</div> : <div className="vc-note" style={{color:'var(--muted)'}}>Click Analyse Now for the latest status.</div>}
                </div>

                {/* Update form */}
                <div className="update-form">
                  <h4>📝 Update Manually</h4>
                  <div className="verdict-opts">
                    {[['kept','✅ Kept','vo-kept'],['broken','❌ Broken','vo-broken'],['pending','⏳ Pending','vo-pending']].map(([v,label,cls])=>(
                      <div key={v} className={`vo ${cls}${selectedVerdict===v?' sel':''}`} onClick={()=>setSelectedVerdict(v)}>{label}</div>
                    ))}
                  </div>
                  <input type="url" placeholder="Evidence link (optional)" value={verdictProof} onChange={e=>setVerdictProof(e.target.value)} style={{marginBottom:8}} />
                  <textarea rows={2} placeholder="Add a note..." value={verdictNote} onChange={e=>setVerdictNote(e.target.value)} />
                  <div className="form-actions" style={{marginTop:10}}>
                    <button className="btn btn-primary btn-sm" disabled={submitting} onClick={submitVerdict}>{submitting?'Saving...':'Submit'}</button>
                  </div>
                </div>

                {/* History */}
                {modal.verdictHistory?.length>0 && (
                  <div className="history-log">
                    <h4>History</h4>
                    {[...modal.verdictHistory].reverse().map((h,i)=>(
                      <div key={i} className="history-item">
                        <div className={`hi-dot hi-dot-${h.status}`}/>
                        <div className="hi-text">
                          <strong>{h.status==='kept'?'Kept':h.status==='broken'?'Broken':'Pending'}</strong>
                          {h.byAI&&<span style={{fontSize:10,background:'var(--primary-soft)',color:'var(--primary)',padding:'1px 6px',borderRadius:100,marginLeft:5,fontWeight:700}}>AI</span>}
                          {h.note&&` — ${h.note}`}
                          {h.proof&&<> · <a href={h.proof} target="_blank" rel="noreferrer" style={{color:'var(--primary)'}}>Evidence ↗</a></>}
                          <br/><span style={{fontSize:11}}>{new Date(h.at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
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

      {toast && <div className="toast-wrap"><div className={`toast ${toast.type||'default'}`}>{toast.msg}</div></div>}
    </>
  )
}
