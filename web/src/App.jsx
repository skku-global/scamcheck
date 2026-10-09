import { useState, useEffect } from 'react'
import './app.css'
const API = import.meta.env.VITE_API || 'http://localhost:4000'
const KEY = 'scamcheck_history'
const EXAMPLES = [
  'Invest 20000 and get 100000 within 24 hours, guaranteed',
  'Your BVN is blocked. Send your OTP to unblock now',
  'Hello, how are you doing today?'
]
const QUIZ = [
  { t: 'CBN is giving ₦50,000 to all Nigerians. Click this link and enter your BVN to claim.', scam: true, why: 'Free money plus a request for your BVN. The CBN does not give out cash through links.' },
  { t: 'Your account was debited ₦5,000 at a store. If this was not you, call the number on the back of your card.', scam: false, why: 'It points you to the number on your own card, not a number or link in the message. Still confirm in your banking app.' },
  { t: 'Congratulations! You won a car in the MTN promo. Pay ₦15,000 delivery fee to receive it.', scam: true, why: 'You cannot win a promo you never entered, and real prizes never need an upfront fee.' },
  { t: 'Hi, I mistakenly sent ₦20,000 to your account. Please return it to this number.', scam: true, why: 'A common reversal scam. Check your own bank app, and refer the sender to their bank.' },
  { t: 'Your NEPA bill is overdue. Pay now at http://nepa-pay.xyz or be disconnected today.', scam: true, why: 'Fake urgency, a strange link without HTTPS, and a threat. Pay only through official channels.' },
  { t: 'Your package is out for delivery. Track it in the app you ordered from.', scam: false, why: 'It asks for no money, codes, or links. Open the official app yourself to confirm.' },
  { t: 'Invest ₦100,000 today and receive ₦300,000 in 7 days. Limited slots!', scam: true, why: 'Guaranteed high returns in days is the classic sign of a Ponzi scheme.' },
  { t: 'Reminder: your dentist appointment is tomorrow at 10am. Reply YES to confirm.', scam: false, why: 'No money, links, or personal details are requested.' }
]
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }
const save = h => { try { localStorage.setItem(KEY, JSON.stringify(h)) } catch {} }
async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
function Quiz({ goCheck }) {
  const [i, setI] = useState(0)
  const [pick, setPick] = useState(null)
  const [score, setScore] = useState(0)
  const [copied, setCopied] = useState(false)
  const done = i >= QUIZ.length
  const q = QUIZ[i]
  function answer(isScam) {
    if (pick !== null) return
    setPick(isScam)
    if (isScam === q.scam) setScore(s => s + 1)
  }
  function next() { setPick(null); setI(n => n + 1) }
  function restart() { setI(0); setPick(null); setScore(0); setCopied(false) }
  async function share() {
    const text = `I scored ${score}/${QUIZ.length} on the Spot the Scam quiz. Can you beat me?`
    const url = window.location.origin
    try {
      if (navigator.share) await navigator.share({ text, url })
      else { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true) }
    } catch {}
  }
  if (done) return (
    <section className="result low">
      <p className="label">Your score</p>
      <h2>{score} / {QUIZ.length}</h2>
      <p className="summary">{score >= 7 ? 'Sharp eye. Share it and challenge a friend.' : score >= 4 ? 'Good start. Scammers rely on the few you missed.' : 'Scammers count on this. Run the quiz again and read each explanation.'}</p>
      <button className="cta" onClick={share}>{copied ? 'Copied' : 'Share score'}</button>
      <button className="ghost" onClick={restart}>Play again</button>
      <button className="ghost" onClick={goCheck}>Check a real message</button>
    </section>
  )
  return (
    <section className="quiz">
      <p className="label">Question {i + 1} of {QUIZ.length}</p>
      <p className="qtext">{q.t}</p>
      <div className="qbtns">
        <button className="ghost" onClick={() => answer(true)} disabled={pick !== null}>Scam</button>
        <button className="ghost" onClick={() => answer(false)} disabled={pick !== null}>Safe</button>
      </div>
      {pick !== null && (
        <div className={`reveal ${pick === q.scam ? 'right' : 'wrong'}`}>
          <strong>{pick === q.scam ? 'Correct.' : 'Not quite.'}</strong> It is {q.scam ? 'a scam' : 'likely safe'}. {q.why}
          <button className="cta" onClick={next}>{i + 1 === QUIZ.length ? 'See score' : 'Next'}</button>
        </div>
      )}
    </section>
  )
}
export default function App() {
  const [tab, setTab] = useState('check')
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
    } catch (e) { setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message) }
    setLoading(false)
  }
  async function report() {
    setErr('')
    try {
      const v = checked
      const link = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v)
      const phone = /^\+?[\d\s-]{7,16}$/.test(v)
      await post('/api/report', { type: link ? 'link' : phone ? 'phone' : 'message', value: v.slice(0, 500) })
      setReported(true)
    } catch (e) { setErr(e.message === 'Failed to fetch' ? 'No connection. Try again.' : e.message) }
  }
  const clear = () => { setHistory([]); save([]) }
  const reuse = h => { setInput(h.full); setRes(null); setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return (
    <div className="shell">
      <header><span className="mark" />SCAMCHECK</header>
      <nav className="tabs">
        <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>Check</button>
        <button className={tab === 'quiz' ? 'on' : ''} onClick={() => setTab('quiz')}>Spot the scam</button>
      </nav>
      <main>
        {tab === 'quiz' ? <Quiz goCheck={() => setTab('check')} /> : (
          <>
            <p className="eyebrow">Verify before you trust</p>
            <h1>Is this a <em>scam</em>?</h1>
            <p className="sub">Paste a link, message, or phone number. Know the risk in seconds.</p>
            <textarea value={input} onChange={e => setInput(e.target.value)} maxLength={2000} rows={5} placeholder="Paste here" />
            <div className="chips">
              {EXAMPLES.map(x => <button key={x} className="chip" onClick={() => setInput(x)}>{x.slice(0, 26)}…</button>)}
            </div>
            <button className="cta" onClick={check} disabled={loading || input.trim().length < 3}>{loading ? 'Checking' : 'Check now'}</button>
            {err && <p className="err">{err}</p>}
            {res && (
              <section className={`result ${res.risk.toLowerCase()}`}>
                <p className="label">Verdict</p>
                <h2>{res.risk} risk</h2>
                <div className="meter"><i style={{ width: res.score + '%' }} /></div>
                <p className="score">{res.score} / 100</p>
                {res.summary && <p className="summary">{res.summary}</p>}
                {res.matches && res.matches.length > 0 && (<><p className="label">What we flagged</p><p className="flagged">{highlight(checked, res.matches)}</p></>)}
                {res.reasons.length > 0 && (<><p className="label">Why</p><ul>{res.reasons.map(x => <li key={x}>{x}</li>)}</ul></>)}
                <p className="note">{res.note}</p>
                {reported ? <p className="thanks">Thank you. Your report protects others.</p> : <button className="ghost" onClick={report}>Report as scam</button>}
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
          </>
        )}
        <footer>Saved on this device only</footer>
      </main>
    </div>
  )
}
