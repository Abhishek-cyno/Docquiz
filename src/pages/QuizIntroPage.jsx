import { motion } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import { CONFIG } from '../config.js'

const POINTS = [
  { icon: '📋', text: `You'll be asked ${CONFIG.questionsPerQuiz} questions` },
  { icon: '⚡', text: "You'll see the result instantly" },
  { icon: '⏱️', text: 'It will only take a minute!' },
]

export default function QuizIntroPage() {
  const { setStep, doctor, buildQuiz } = useFlow()

  function start() {
    buildQuiz(doctor.specialty)
    setStep(STEPS.QUIZ)
  }
  

  return (
    <div className="card card--center center-narrow">
      <motion.div
        className="intro__icon"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 140, delay: 0.05 }}
      >
        📋
      </motion.div>

      <h2 className="card__title">Ready for a quick quiz?</h2>
      <p className="card__sub">
        {doctor.name ? `${doctor.name}, ` : ''}you'll be asked {CONFIG.questionsPerQuiz} questions
        related to {doctor.category || 'category'}.
      </p>

      <ul className="intro__list">
        {POINTS.map((p, i) => (
          <motion.li
            key={p.text}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
          >
            <span className="intro__bullet">{p.icon}</span>
            {p.text}
          </motion.li>
        ))}
      </ul>

      <div className="form__actions" style={{ width: '100%', maxWidth: 360 }}>
        <button className="btn btn--ghost" onClick={() => setStep(STEPS.REGISTER)}>Back</button>
        <button className="btn btn--primary" onClick={start}>
          Start Quiz <span className="btn__arrow">→</span>
        </button>
      </div>
    </div>
  )
}
