import { motion } from 'framer-motion'
import { STEPS, useFlow } from '../context/FlowContext.jsx'
import { SKIP_QUIZ } from '../utils/flowMode.js'

// Named phases shown across the top of the flow. Doctors without a clinic
// never book a meeting, so their journey is one phase shorter. The
// ?skipquiz=1 variant (see flowMode.js) never visits the quiz phase at all,
// so it drops out of the stepper rather than showing as instantly "done".
const PHASES = ['Your Details', 'Quiz', 'Spin & Win', 'Schedule', 'Complete']
const PHASES_NO_MEETING = ['Your Details', 'Quiz', 'Spin & Win', 'Complete']
const PHASES_SKIP_QUIZ = ['Your Details', 'Spin & Win', 'Schedule', 'Complete']
const PHASES_SKIP_QUIZ_NO_MEETING = ['Your Details', 'Spin & Win', 'Complete']

// Which phase each step belongs to, indexed into PHASES (or the
// PHASES_SKIP_QUIZ* variants, once the Quiz phase collapses out below).
const STEP_PHASE = {
  [STEPS.REGISTER]: 0,
  [STEPS.QUIZINTRO]: 1,
  [STEPS.QUIZ]: 1,
  [STEPS.COMPLETE]: 1,
  [STEPS.GIFT]: 2,
  [STEPS.SCHEDULE]: 3,
  [STEPS.SCHEDULED]: 4,
  [STEPS.CONTACT]: 4,
  [STEPS.THANKYOU]: 4,
}

export default function Stepper({ step }) {
  const { doctor } = useFlow()
  const active = STEP_PHASE[step]
  if (active === undefined) return null // e.g. landing — no stepper

  // Only collapse once we actually know there's no meeting coming, so the
  // stepper never grows a phase underneath a doctor mid-flow. 'Complete' is
  // the last entry either way, so shift it down when the Schedule phase is
  // missing (done against the full, quiz-inclusive numbering above).
  const noMeeting = doctor.hasClinic === 'no'
  let activeIndex = noMeeting && active === 4 ? 3 : active

  // Quiz never happens in the ?skipquiz=1 variant, so every phase after it
  // shifts down by one to fill the gap it leaves in the stepper.
  if (SKIP_QUIZ && activeIndex >= 1) activeIndex -= 1

  const phases = SKIP_QUIZ
    ? (noMeeting ? PHASES_SKIP_QUIZ_NO_MEETING : PHASES_SKIP_QUIZ)
    : (noMeeting ? PHASES_NO_MEETING : PHASES)

  // On the final screens, mark everything complete.
  const allDone = step === STEPS.SCHEDULED || step === STEPS.THANKYOU

  return (
    <div className="stepper" role="list" aria-label="Progress">
      {phases.map((label, i) => {
        const done = allDone || i < activeIndex
        const current = !allDone && i === activeIndex
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
