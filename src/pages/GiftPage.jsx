import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import SpinWheel from '../components/SpinWheel.jsx'

export default function GiftPage() {
  const { score, gift, setGift, setStep, hasClinic, giftWheel, winnableGifts } = useFlow()
  const [spinning, setSpinning] = useState(false)

  if (score === 0) {
    return (
      <div className="card center-narrow" style={{ textAlign: 'center' }}>
        <h2 className="card__title">No rewards unlocked this time 😔</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          You'll need at least one correct answer to unlock a spin. Give it another go!
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

  function onResult(won) {
    setGift(won)
    setSpinning(false)
  }

  const nextStep = hasClinic ? STEPS.SCHEDULE : STEPS.THANKYOU

  return (
    <div className="card card--center spin-card">
      <div style={{ textAlign: 'center' }}>
        <h2 className="card__title">Spin &amp; Win 🎡</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          {gift
            ? 'Here’s what the wheel picked for you!'
            : 'Spin the wheel to find out which reward is yours.'}
        </p>
      </div>

      {/* Same wheel for everyone; `winnable` is what limits where it stops.
          One spin per doctor — `disabled` keeps them from re-rolling by
          stepping back here from the schedule screen. */}
      <SpinWheel
        items={giftWheel}
        winnable={winnableGifts}
        spinning={spinning}
        disabled={!!gift}
        result={gift}
        onSpinStart={() => setSpinning(true)}
        onResult={onResult}
      />

      <AnimatePresence mode="wait">
        {gift ? (
          <motion.div
            key="result"
            className="spin-result"
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          >
            <span className="spin-result__emoji">{gift.emoji}</span>
            <div className="spin-result__text">
              <span className="spin-result__label">You won</span>
              <span className="spin-result__title">{gift.title}</span>
              <span className="spin-result__desc">{gift.desc}</span>
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="hint"
            className="spin-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {spinning ? 'Spinning…' : 'Tap SPIN in the centre of the wheel'}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="form__actions">
        <button className="btn btn--ghost" onClick={() => setStep(STEPS.COMPLETE)} disabled={spinning}>
          Back
        </button>
        <button
          className="btn btn--primary"
          disabled={!gift || spinning}
          onClick={() => setStep(nextStep)}
        >
          Continue <span className="btn__arrow">→</span>
        </button>
      </div>
    </div>
  )
}
