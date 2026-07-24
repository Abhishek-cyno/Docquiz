import { motion } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'

const CONFETTI = ['#2563eb', '#60a5fa', '#fbbf24', '#22c55e', '#ef4444', '#a855f7']

export default function CompletePage() {
  const { score, questions, doctor, setStep } = useFlow()
  const total = questions.length
  const pct = total ? Math.round((score / total) * 100) : 0

  const message =
    pct === 100 ? 'Excellent! 🎉' :
    pct >= 67 ? 'Well done! 👏' :
    'Nice effort! 🙌'

  return (
    <div className="card center-narrow">
      <div className="complete-layout">
        <div className="trophy">
          🏆
          <span className="confetti">
            {Array.from({ length: 14 }).map((_, i) => (
              <motion.i
                key={i}
                style={{ left: `${(i / 14) * 100}%`, background: CONFETTI[i % CONFETTI.length] }}
                initial={{ y: 40, opacity: 0, rotate: 0 }}
                animate={{ y: [-10, 120], opacity: [1, 1, 0], rotate: 360 }}
                transition={{ duration: 1.6, delay: 0.2 + i * 0.05, ease: 'easeOut' }}
              />
            ))}
          </span>
        </div>

        <motion.h2
          className="card__title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          Quiz Completed!
        </motion.h2>
        <p className="card__sub">
          Great job{doctor.name ? `, ${doctor.name}` : ''}! You've successfully completed the {doctor.specialty} quiz.
        </p>

        <motion.div
          className="score-card"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 140, delay: 0.2 }}
        >
          <div className="score-card__num">{score}<small>/{total}</small></div>
          <div className="score-card__label">{message}</div>
        </motion.div>

        <button className="btn btn--primary btn--lg" onClick={() => setStep(STEPS.GIFT)}>
          Continue to Rewards <span className="btn__arrow">→</span>
        </button>
      </div>
    </div>
  )
}
