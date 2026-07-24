import { useEffect, useState } from 'react'
import Cal, { getCalApi } from '@calcom/embed-react'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import { CONFIG } from '../config.js'

// Pull a start time out of Cal.com's bookingSuccessful payload, whatever
// shape it arrives in, and format it into a readable date + time.
function extractSlot(data) {
  const iso =
    data?.date ||
    data?.startTime ||
    data?.booking?.startTime ||
    data?.booking?.start ||
    null
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (isNaN(d)) return { date: '', time: '' }
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  }
}

export default function SchedulePage() {
  const { gift, setMeeting, setStep } = useFlow()
  const [booked, setBooked] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const cal = await getCalApi()
      cal('on', {
        action: 'bookingSuccessful',
        callback: (e) => {
          if (!active) return
          const slot = extractSlot(e?.detail?.data)
          setMeeting(slot)
          setBooked(true)
          // Give Cal's own confirmation a moment, then advance.
          setTimeout(() => active && setStep(STEPS.SCHEDULED), 1200)
        },
      })
    })()
    return () => { active = false }
  }, [setMeeting, setStep])

  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <h2 className="card__title">Schedule a Meeting 📅</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          Pick a date &amp; time that works for you. Your gift <strong>{gift?.title}</strong> will be confirmed at the meeting.
        </p>
      </div>

      <div className="cal-embed">
        <Cal
          calLink={CONFIG.calLink}
          style={{ width: '100%', height: '100%', overflow: 'scroll' }}
          config={{ layout: 'month_view', theme: 'light' }}
        />
      </div>

      <p className="cal-embed__powered">Powered by Cal.com</p>

      <div className="form__actions" style={{ marginTop: 6 }}>
        <button className="btn btn--ghost" onClick={() => setStep(STEPS.GIFT)}>Back</button>
        <button className="btn btn--primary" onClick={() => setStep(STEPS.SCHEDULED)}>
          {booked ? 'Continue →' : "I've booked — Finish ✓"}
        </button>
      </div>
    </div>
  )
}
