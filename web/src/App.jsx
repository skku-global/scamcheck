import { useState, useEffect } from 'react'
import './app.css'
const API = import.meta.env.VITE_API || 'http://localhost:4000'
const KEY = 'scamcheck_history'
const EXAMPLES = [
  'Invest 20000 and get 100000 within 24 hours, guaranteed',
  'Your BVN is blocked. Send your OTP to unblock now',
  'Hello, how are you doing today?'
]
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }
const save = h => { try { localStorage.setItem(KEY, JSON.stringify(h)) } catch {} }
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
function highlight(text, matches) {
  const lower = text.toLowerCase()
  const ranges = []
  for (const m of matches || []) {
    const s = (m.text || '').toLowerCase()
    if (!s) continue
    const i = lower.indexOf(s)
    if (i >= 0) ranges.push([i, i + s.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  const out = []
  let pos = 0
  merged.forEach(([a, b], k) => {
    if (a > pos) out.push(text.slice(pos, a))
    out.push(<mark key={k}>{text.slice(a, b)}</mark>)
    pos = b
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}
export default function App() {
  const [input, setInput] = useState('')
  const [checked, setChecked] = useState('')
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [reported, setReported] = useState(false)
  const [history, setHistory] = useState([])
  useEffect(() => { setHistory(load()) }, [])
  async function check() {
    const t = input.trim()
    if (t.length < 3) return
    setErr(''); setRes(null); setReported(false); setLoading(true)
    try {
      const d = await post('/api/check', { input: t })
      setRes(d); setChecked(t)
      const item = { risk: d.risk, score: d.score, full: t.slice(0, 200), at: Date.now() }
      const next = [item, ...history.filter(h => h.full !== item.full)].slice(0, 20)
      setHistory(next); save(next)
    } catch (e) {
      setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message)
    }
    setLoading(false)
  }
  async function report() {
    setErr('')
    try {
      const v = checked
      const link = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v)
      const phone = /^\+?[\d\s-]{7,15}$/.test(v)
      await post('/api/report', { type: link ? 'link' : phone ? 'phone' : 'message', value: v.slice(0, 500) })
      setReported(true)
    } catch (e) {
      setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message)
    }
  }
  const clear = () => { setHistory([]); save([]) }
  const reuse = h => { setInput(h.full); setRes(null); setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <div className="shell">
      <header><span className="mark" />SCAMCHECK</header>
      <main>
        <p className="eyebrow">Verify before you trust</p>
        <h1>Is this a <em>scam</em>?</h1>
        <p className="sub">Paste a link, message, or number. Know the risk in seconds.</p>
        <textarea value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={5} placeholder="Paste here" />
        <div className="chips">
          {EXAMPLES.map(x => <button key={x} className="chip" onClick={() => setInput(x)}>{x.slice(0, 26)}…</button>)}
        </div>
        <button className="cta" onClick={check} disabled={loading || input.trim().length < 3}>
          {loading ? 'Checking' : 'Check now'}
        </button>
        {err && <p className="err">{err}</p>}
        {res && (
          <section className={`result ${res.risk.toLowerCase()}`}>
            <p className="label">Verdict</p>
            <h2>{res.risk} risk</h2>
            <div className="meter"><i style={{ width: res.score + '%' }} /></div>
            <p className="score">{res.score} / 100</p>
            {res.summary && <p className="summary">{res.summary}</p>}
            {res.matches && res.matches.length > 0 && (
              <>
                <p className="label">What we flagged</p>
                <p className="flagged">{highlight(checked, res.matches)}</p>
              </>
            )}
            {res.reasons.length > 0 && (
              <>
                <p className="label">Why</p>
                <ul>{res.reasons.map(x => <li key={x}>{x}</li>)}</ul>
              </>
            )}
            <p className="note">{res.note}</p>
            {reported
              ? <p className="thanks">Thank you. Your report protects others.</p>
              : <button className="ghost" onClick={report}>Report as scam</button>}
          </section>
        )}
        {history.length > 0 && (
          <section className="history">
            <div className="row"><p className="label">Recent</p><button className="link" onClick={clear}>Clear</button></div>
            {history.map(h => (
              <button key={h.at} className="item" onClick={() => reuse(h)}>
                <span className={`dot ${h.risk.toLowerCase()}`} />
                <span className="txt">{h.full}</span>
                <span className="sc">{h.score}</span>
              </button>
            ))}
          </section>
        )}
        <footer>Saved on this device only</footer>
      </main>
    </div>
  )
}
