import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useFlow } from '../context/FlowContext.jsx'
import { saveResponse } from '../utils/storage.js'
import Float from '../components/motion/Float.jsx'
import calImg from '../assets/cal.png'
import meetImg from '../assets/meet.png'

export default function ScheduledPage() {
  const { doctor, score, questions, answers, gift, meeting, reset } = useFlow()
  const [saving, setSaving] = useState(true)
  const saved = useRef(false)

  // Persist the response once, as soon as the meeting is confirmed.
  useEffect(() => {
    if (saved.current) return
    saved.current = true
    ;(async () => {
      await saveResponse({
        name: doctor.name,
        specialty: doctor.specialty,
        category: doctor.category,
        score,
        total: questions.length,
        percent: questions.length ? Math.round((score / questions.length) * 100) : 0,
        gift: gift?.title || '',
        meetingDate: meeting.date,
        meetingTime: meeting.time,
        answers,
      })
      setSaving(false)
    })()
  }, [])

  return (
    <div className="scheduled">
      <div className="scheduled__art">
        <Float amplitude={6} duration={6.5}>
          <img className="art" src={calImg} alt="" />
        </Float>
      </div>

      <div className="scheduled__main">
        <motion.div
          className="success-check"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 160, delay: 0.1 }}
        >
          ✓
        </motion.div>

        <h2 className="card__title">Meeting Scheduled!</h2>
        <p className="card__sub">Your meeting has been successfully booked.</p>

        <motion.div
          className="booking-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="details__row"><span className="ico">📅</span> <span>Date</span> <b style={{ marginLeft: 'auto' }}>{meeting.date}</b></div>
          <div className="details__row"><span className="ico">⏰</span> <span>Time</span> <b style={{ marginLeft: 'auto' }}>{meeting.time}</b></div>
          <div className="details__row"><span className="ico">🤝</span> <span>Meeting</span> <b style={{ marginLeft: 'auto' }}>With our medical team</b></div>
        </motion.div>

        <button className="btn btn--primary btn--lg" onClick={reset} disabled={saving}>
          {saving ? 'Saving…' : 'Go to Home'}
        </button>
      </div>

      <div className="scheduled__art">
        <Float amplitude={6} duration={7.2} delay={0.5}>
          <img className="art" src={meetImg} alt="" />
        </Float>
      </div>
    </div>
  )
}
