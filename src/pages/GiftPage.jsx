import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import SpinWheel from '../components/SpinWheel.jsx'
import LoadingOverlay from '../components/motion/LoadingOverlay.jsx'
import { checkGiftEligibility, claimGift } from '../utils/booking.js'
import { SKIP_QUIZ } from '../utils/flowMode.js'

/**
 * Owns the eligibility check so the loading overlay can stay mounted across
 * the checking -> result switch — that's what lets it finish at 100% and fade
 * out, instead of vanishing the instant the screen underneath changes.
 */
export default function GiftPage() {
  const { score, doctor } = useFlow()
  const [eligibility, setEligibility] = useState({ status: 'checking', error: '' })
  const [eligibilityRetry, setEligibilityRetry] = useState(0)

  useEffect(() => {
    let active = true
    checkGiftEligibility(doctor.mobile).then((result) => {
      if (!active) return
      if (result.ok) {        
        setEligibility({ status: result.eligible ? 'eligible' : 'already-won', error: '' })
      } else {
        setEligibility({ status: 'error', error: result.error || 'We could not validate prize eligibility.' })
      }
    })
    return () => { active = false }
  }, [doctor.mobile, eligibilityRetry])

  // A score of 0 never reaches the wheel — except in the ?skipquiz=1 variant,
  // where there's no quiz to score, so a 0 is expected and the wheel still
  // waits on the real eligibility check.
  const checking = (SKIP_QUIZ || score !== 0) && eligibility.status === 'checking'

  function retry() {
    setEligibility({ status: 'checking', error: '' })
    setEligibilityRetry((count) => count + 1)
  }

  return (
    <>
      <LoadingOverlay show={checking} />
      <GiftScreen eligibility={eligibility} onRetry={retry} />
    </>
  )
}

function GiftScreen({ eligibility, onRetry }) {
  const { score, gift, setGift, setStep, hasClinic, giftWheel, winnableGifts, reloadGifts, doctor } = useFlow()
  const [spinning, setSpinning] = useState(false)
  const [claimError, setClaimError] = useState('')

  if (!SKIP_QUIZ && score === 0) {
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

  // The loading overlay (see GiftPage) covers the screen while this runs.
  if (eligibility.status === 'checking') return null

  if (eligibility.status === 'already-won') {
    return (
      <div className="card card--center center-narrow" style={{ textAlign: 'center' }}>
        <h2 className="card__title">You’ve already won a prize</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          It looks like you’ve already claimed a prize. You’re welcome to take the quiz again, but only one prize can be claimed per person.
        </p>
        <button className="btn btn--primary" style={{ marginTop: 22 }} onClick={() => setStep(STEPS.LANDING)}>
          Back to Home
        </button>
      </div>
    )
  }

  if (eligibility.status === 'error') {
    return (
      <div className="card card--center center-narrow" style={{ textAlign: 'center' }}>
        <h2 className="card__title">Prize eligibility could not be checked</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>{eligibility.error}</p>
        <button className="btn btn--primary" style={{ marginTop: 22 }} onClick={onRetry}>
          Try Again
        </button>
      </div>
    )
  }

  async function onResult(won) {
    // The Sheet is the source of truth. Do not announce a win until its
    // locked claim endpoint has reserved stock for this exact prize.
    const claim = await claimGift(won.id, doctor)
    setSpinning(false)
    if (claim.ok) {
      setGift(won)
      return
    }

    // Another spin may have claimed the final unit while this wheel was
    // animating. Refresh so exhausted rows disappear before the retry.
    await reloadGifts()
    setClaimError(
      claim.reason === 'outofstock'
        ? 'That gift was just claimed by someone else. The wheel has been refreshed — please spin again.'
        : 'We could not reserve that gift. Please check your connection and spin again.'
    )
  }

  // Clinic owners go pick a meeting slot; everyone else still needs to leave
  // contact details somewhere before Thank You, since a doctor with no
  // clinic never otherwise types a phone number or email into this app.
  const nextStep = hasClinic ? STEPS.SCHEDULE : STEPS.CONTACT
  const isSuper = gift?.tier === 'superpremium'
  const isConsolation = gift?.tier === 'consolation'

  return (
    <div className="card card--center spin-card">
      <div style={{ textAlign: 'center' }}>
        <h2 className="card__title">Spin &amp; Win 🎡</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          {isSuper
            ? 'Jackpot! You landed our rarest prize! 🌟'
            : isConsolation
            ? 'Thanks for spinning — better luck next time!'
            : gift
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
        onSpinStart={() => { setClaimError(''); setSpinning(true) }}
        onResult={onResult}
      />

      {claimError && <p className="form__error" role="alert">{claimError}</p>}

      <AnimatePresence mode="wait">
        {gift ? (
          <motion.div
            key="result"
            className={
              isSuper ? 'spin-result spin-result--super'
                : isConsolation ? 'spin-result spin-result--consolation'
                : 'spin-result'
            }
            initial={{ opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          >
            <span className="spin-result__emoji">{gift.emoji}</span>
            <div className="spin-result__text">
              <span className="spin-result__label">
                {isSuper ? 'Jackpot' : isConsolation ? 'This time' : 'You won'}
              </span>
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
