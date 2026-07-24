import { motion } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import gifts from '../data/gifts.json'

// How many gift options unlock at each score out of 3.
const GIFT_COUNT_BY_SCORE = { 3: gifts.length, 2: 3, 1: 2 }

export default function GiftPage() {
  const { score, gift, setGift, setStep } = useFlow()

  if (score === 0) {
    return (
      <div className="card center-narrow" style={{ textAlign: 'center' }}>
        <h2 className="card__title">No rewards unlocked this time 😔</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          You'll need at least one correct answer to unlock a reward. Give it another go!
        </p>
        <button
          className="btn btn--primary btn--lg"
          style={{ marginTop: 22 }}
          onClick={() => setStep(STEPS.REGISTER)}
        >
          Try Again <span className="btn__arrow">→</span>
        </button>
      </div>
    )
  }

  const visibleGifts = gifts.slice(0, GIFT_COUNT_BY_SCORE[score] ?? gifts.length)

  return (
    <div className="card card--center center-narrow">
      <div style={{ textAlign: 'center' }}>
        <h2 className="card__title">Choose Your Gift 🎁</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          Select a gift you would like to receive — you'll confirm it at your meeting.
        </p>
      </div>

      <div className="gift__grid" style={{ width: '100%' }}>
        {visibleGifts.map((g, i) => {
          const active = gift?.id === g.id
          return (
            <motion.button
              key={g.id}
              className={`gift__card ${active ? 'is-active' : ''}`}
              onClick={() => setGift(g)}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="gift__emoji">{g.emoji}</span>
              <span className="gift__name">{g.title}</span>
              <span className="gift__desc">{g.desc}</span>
              {active && (
                <motion.span className="gift__check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
                  ✓
                </motion.span>
              )}
            </motion.button>
          )
        })}
      </div>

      <div className="form__actions">
        <button className="btn btn--ghost" onClick={() => setStep(STEPS.COMPLETE)}>Back</button>
        <button className="btn btn--primary" disabled={!gift} onClick={() => setStep(STEPS.SCHEDULE)}>
          Continue <span className="btn__arrow">→</span>
        </button>
      </div>
    </div>
  )
}
