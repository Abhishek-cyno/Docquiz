import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useFlow } from '../context/FlowContext.jsx'
import { saveResponse } from '../utils/storage.js'
import Float from '../components/motion/Float.jsx'
import meetImg from '../assets/meet.png'

/**
 * End of the road for doctors without their own clinic: they keep the gift the
 * wheel gave them, but there is no rep visit to book. ContactPage already
 * recorded name/email/phone/gift into the Bookings sheet (the authoritative
 * write, same as a real booking); this is the legacy backup write into the
 * separate responses sheet, mirroring what ScheduledPage does for the
 * clinic-owner branch. `meeting.email`/`meeting.phone` come from ContactPage.
 */
export default function ThankYouPage() {
  const { doctor, score, questions, answers, gift, meeting, reset } = useFlow()
  const saved = useRef(false)

  // Backup write only — ContactPage already saved the real record, so this
  // runs in the background instead of blocking the screen.
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
      meetingDate: '',
      meetingTime: '',
      answers,
    })
  }, [])

  return (
    <div className="scheduled">

      <div className="scheduled__art">
        <Float amplitude={6} duration={6.5}>
          <img className="art" src={meetImg} alt="" />
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

        <h2 className="card__title">Thank You for Participating! 🎉</h2>
        <p className="card__sub">
          Thanks{doctor.name ? `, ${doctor.name}` : ''} — your responses have been recorded.
          Our team will reach out on WhatsApp or email soon.
        </p>

        {gift && (
          <motion.div
            className="booking-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {gift.tier === 'consolation' ? (
              <div className="details__row">
                <span className="ico">{gift.emoji}</span> <span>Result</span>
                <b style={{ marginLeft: 'auto' }}>{gift.title}</b>
              </div>
            ) : (
              <div className="details__row">
                <span className="ico">{gift.emoji}</span> <span>Your gift</span>
                <b style={{ marginLeft: 'auto' }}>{gift.title}</b>
              </div>
            )}
            {gift.tier !== 'consolation' && (
              <div className="details__row">
                <span className="ico">🚚</span> <span>Delivery</span>
                <b style={{ marginLeft: 'auto' }}>Our team will reach out</b>
              </div>
            )}
          </motion.div>
        )}

        <button className="btn btn--primary btn--lg" onClick={reset}>
          Go to Home
        </button>
      </div>
    </div>
  )
}
