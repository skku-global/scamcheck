import { useState, useEffect } from 'react'
import './app.css'
const API = import.meta.env.VITE_API || 'http://localhost:4000'
const KEY = 'scamcheck_history'
const EXAMPLES = [
  'Invest 20000 and get 100000 within 24 hours, guaranteed',
  'Your BVN is blocked. Send your OTP to unblock now',
  'Hello, how are you doing today?'
]
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] }
}
function saveHistory(h) {
  try { localStorage.setItem(KEY, JSON.stringify(h)) } catch {}
}
async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'Something went wrong')
  return d
}
export default function App() {
  const [input, setInput] = useState('')
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [reported, setReported] = useState(false)
  const [history, setHistory] = useState([])
  useEffect(() => { setHistory(loadHistory()) }, [])
  async function check(text = input) {
    const t = text.trim()
    if (t.length < 3) return
    setErr(''); setRes(null); setReported(false); setLoading(true)
    try {
      const d = await post('/api/check', { input: t })
      setRes(d)
      const item = { risk: d.risk, score: d.score, preview: t.slice(0, 40), full: t.slice(0, 200), at: Date.now() }
      const next = [item, ...history.filter(h => h.full !== item.full)].slice(0, 20)
      setHistory(next); saveHistory(next)
    } catch (e) {
      setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message)
    }
    setLoading(false)
  }
  async function report() {
    setErr('')
    try {
      const v = input.trim()
      const looksLink = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v)
      const looksPhone = /^\+?[\d\s-]{7,15}$/.test(v)
      await post('/api/report', { type: looksLink ? 'link' : looksPhone ? 'phone' : 'message', value: v.slice(0, 500) })
      setReported(true)
    } catch (e) {
      setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message)
    }
  }
  function clearHistory() { setHistory([]); saveHistory([]) }
  function reuse(h) { setInput(h.full); setRes(null); setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <>
      <header><span className="logo">Ìª°Ô∏è ScamCheck</span></header>
      <main>
        <h1>Is this a scam?</h1>
        <p className="sub">Paste a link, message, or number. Get a risk check in seconds.</p>
        <textarea value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={5} placeholder="Paste here..." />
        <div className="chips">
          {EXAMPLES.map(x => <button key={x} className="chip" onClick={() => setInput(x)}>{x.slice(0, 28)}...</button>)}
        </div>
        <button className="primary" onClick={() => check()} disabled={loading || input.trim().length < 3}>
          {loading ? 'Checking...' : 'Check'}
        </button>
        {err && <p className="err">{err}</p>}
        {res && (
          <section className={`card ${res.risk.toLowerCase()}`}>
            <div className="badge">{res.risk} risk</div>
            <div className="bar"><div style={{ width: res.score + '%' }} /></div>
            <small>Score {res.score}/100</small>
            {res.reasons.length > 0 && <ul>{res.reasons.map(x => <li key={x}>{x}</li>)}</ul>}
            <small>{res.note}</small>
            {reported
              ? <p>Thanks. Your report helps others.</p>
              : <button className="ghost" onClick={report}>Report as scam</button>}
          </section>
        )}
        {history.length > 0 && (
          <section className="history">
            <div className="row"><h3>Recent checks</h3><button className="link" onClick={clearHistory}>Clear</button></div>
            {history.map(h => (
              <button key={h.at} className="item" onClick={() => reuse(h)}>
                <span className={`dot ${h.risk.toLowerCase()}`} />
                <span className="txt">{h.preview}</span>
                <span className="sc">{h.score}</span>
              </button>
            ))}
          </section>
        )}
        <footer>Saved on this device only.</footer>
      </main>
    </>
  )
}
