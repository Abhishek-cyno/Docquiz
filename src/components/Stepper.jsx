import { motion } from 'framer-motion'
import { STEPS } from '../context/FlowContext.jsx'

// Named phases shown across the top of the flow.
const PHASES = ['Your Details', 'Quiz', 'Rewards', 'Schedule', 'Complete']

// Which phase each step belongs to.
const STEP_PHASE = {
  [STEPS.REGISTER]: 0,
  [STEPS.QUIZINTRO]: 1,
  [STEPS.QUIZ]: 1,
  [STEPS.COMPLETE]: 1,
  [STEPS.GIFT]: 2,
  [STEPS.SCHEDULE]: 3,
  [STEPS.SCHEDULED]: 4,
  [STEPS.THANKYOU]: 4,
}

export default function Stepper({ step }) {
  const active = STEP_PHASE[step]
  if (active === undefined) return null // e.g. landing — no stepper

  // On the final screens, mark everything complete.
  const allDone = step === STEPS.SCHEDULED || step === STEPS.THANKYOU

  return (
    <div className="stepper" role="list" aria-label="Progress">
      {PHASES.map((label, i) => {
        const done = allDone || i < active
        const current = !allDone && i === active
        const cls = done ? 'is-done' : current ? 'is-current' : ''
        return (
          <div key={label} className={`stepper__step ${cls}`} role="listitem">
            <span className="stepper__line" />
            <motion.span
              className="stepper__dot"
              initial={false}
              animate={{ scale: current ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            >
              {done ? '✓' : i + 1}
            </motion.span>
            <span className="stepper__label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
