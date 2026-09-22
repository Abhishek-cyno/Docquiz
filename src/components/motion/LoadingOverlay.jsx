import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../../animations/motion.js'

/* =========================================================
   LoadingOverlay — full-screen loading state
   ---------------------------------------------------------
   Fixed over the whole viewport with a blurred backdrop and a
   circular progress ring centered on screen: a grey track, a
   blue arc that sweeps clockwise from 12 o'clock, and the
   percentage in the middle.

   None of the calls behind this overlay report real progress,
   so the number is an estimate: it climbs quickly at first,
   then slows toward 99% so it never stalls at a false 100%.
   It only reaches 100% when the overlay is dismissed.
   ========================================================= */

// Time constant of the ease-out curve: ~63% at 1 tau, ~95% at 3 taus.
const TAU_MS = 1600
const CEILING = 99

const SIZE = 112
const STROKE = 9
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function ProgressRing() {
  const [progress, setProgress] = useState(0)
  // Flips to false as soon as the parent stops rendering the overlay,
  // i.e. the work finished and the fade-out has begun.
  const present = useIsPresent()

  useEffect(() => {
    if (!present) {
      setProgress(100)
      return undefined
    }

    const start = performance.now()
    let raf
    const tick = (now) => {
      const eased = CEILING * (1 - Math.exp(-(now - start) / TAU_MS))
      setProgress((prev) => Math.max(prev, eased))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [present])

  const percent = Math.floor(progress)

  return (
    <div className="progress-ring" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          className="progress-ring__track"
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
          strokeWidth={STROKE}
        />
        <circle
          className="progress-ring__arc"
          cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
        />
      </svg>
      <span className="progress-ring__value" aria-hidden="true">
        {percent}<small>%</small>
      </span>
    </div>
  )
}

export default function LoadingOverlay({ show }) {
  const reduced = useReducedMotion()

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="loading-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.25, ease: EASE_OUT }}
          role="status"
          aria-live="polite"
          aria-label="Loading"
        >
          <ProgressRing />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
