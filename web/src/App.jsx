import { useState } from 'react'
import './app.css'
const API = import.meta.env.VITE_API || 'http://localhost:4000'
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
  async function check() {
    setErr(''); setRes(null); setReported(false); setLoading(true)
    try { setRes(await post('/api/check', { input })) }
    catch (e) { setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message) }
    setLoading(false)
  }
  async function report() {
    setErr('')
    try {
      const looksLink = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(input.trim())
      const looksPhone = /^\+?[\d\s-]{7,15}$/.test(input.trim())
      await post('/api/report', {
        type: looksLink ? 'link' : looksPhone ? 'phone' : 'message',
        value: input.trim().slice(0, 500)
      })
      setReported(true)
    } catch (e) { setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message) }
  }
  return (
    <main>
      <h1>ScamCheck</h1>
      <p>Paste a link, message, or number</p>
      <textarea value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={6} />
      <button onClick={check} disabled={loading || input.trim().length < 3}>
        {loading ? 'Checking...' : 'Check'}
      </button>
      {err && <p className="err">{err}</p>}
      {res && (
        <section className={`card ${res.risk.toLowerCase()}`}>
          <h2>{res.risk} risk ({res.score})</h2>
          {res.reasons.length > 0 && <ul>{res.reasons.map(x => <li key={x}>{x}</li>)}</ul>}
          <small>{res.note}</small>
          <div>
            {reported
              ? <p>Thanks. Your report helps others.</p>
              : <button className="ghost" onClick={report}>Report as scam</button>}
          </div>
        </section>
      )}
    </main>
  )
}
