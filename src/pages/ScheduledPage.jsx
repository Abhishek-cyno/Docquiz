import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useFlow } from '../context/FlowContext.jsx'
import { saveResponse } from '../utils/storage.js'
import Float from '../components/motion/Float.jsx'
import calImg from '../assets/cal.png'
import meetImg from '../assets/meet.png'

export default function ScheduledPage() {
  const { doctor, score, questions, answers, gift, meeting, reset } = useFlow()
  const saved = useRef(false)

  // The booking script has already recorded the full response in its own
  // Bookings sheet. This second write keeps the original responses sheet
  // (config.sheetEndpoint) and the localStorage backup filling as before —
  // clear sheetEndpoint in config.js if you'd rather have a single source.
  // Runs in the background — it's a backup, so it never blocks the screen.
  useEffect(() => {
    if (saved.current) return
    saved.current = true
    saveResponse({
      name: doctor.name,
      email: meeting.email,
      phone: meeting.phone,
      specialty: doctor.specialty,
      category: doctor.category,
      clinic: doctor.hasClinic,
      score,
      total: questions.length,
      percent: questions.length ? Math.round((score / questions.length) * 100) : 0,
      gift: gift?.title || '',
      meetingDate: meeting.dateLabel,
      meetingTime: meeting.timeLabel,
      answers,
    })
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
        <p className="card__sub">
          Your booking is confirmed. Our representative will contact you on WhatsApp at <strong>{meeting.phone}</strong>.
        </p>

        <motion.div
          className="booking-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="details__row"><span className="ico">📅</span> <span>Date</span> <b style={{ marginLeft: 'auto' }}>{meeting.dateLabel}</b></div>
          <div className="details__row"><span className="ico">⏰</span> <span>Time</span> <b style={{ marginLeft: 'auto' }}>{meeting.timeLabel} IST</b></div>
          <div className="details__row"><span className="ico">🤝</span> <span>Meeting</span> <b style={{ marginLeft: 'auto' }}>With our medical team</b></div>
          {meeting.ref && (
            <div className="details__row"><span className="ico">#️⃣</span> <span>Reference</span> <b style={{ marginLeft: 'auto' }}>{meeting.ref}</b></div>
          )}
        </motion.div>

        <p className="card__sub">Our representative will get in touch with you soon.</p>

        <button className="btn btn--primary btn--lg" onClick={reset}>
          Go to Home
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
