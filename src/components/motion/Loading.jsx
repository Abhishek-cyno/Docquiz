import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE_SOFT } from '../../animations/motion.js'

/* =========================================================
   Loading — spoke spinner
   ---------------------------------------------------------
   The classic ring of fading ticks (macOS/iOS-style activity
   indicator), in the app's brand blue. Twelve bars are laid
   out radially with a baked-in opacity fade, then the whole
   group spins — cheaper and steadier than animating each
   tick's opacity individually.

   Reduced motion drops the spin for a slow whole-group pulse.
   ========================================================= */

const TICK_COUNT = 12

export default function Loading({ size = 56, className = '' }) {
  const reduced = useReducedMotion()

  const radius = size / 2
  const tickLength = size * 0.28
  const tickWidth = Math.max(2, size * 0.09)

  return (
    <motion.span
      className={`loader${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, willChange: reduced ? 'auto' : 'transform' }}
      role="status"
      aria-label="Loading"
      animate={reduced ? { opacity: [0.4, 1, 0.4] } : { rotate: 360 }}
      transition={
        reduced
          ? { duration: 1.6, repeat: Infinity, ease: EASE_SOFT }
          : { duration: DURATION.slow, repeat: Infinity, ease: 'linear' }
      }
    >
      {Array.from({ length: TICK_COUNT }).map((_, i) => (
        <span
          key={i}
          className="loader__tick"
          style={{
            width: tickWidth,
            height: tickLength,
            marginLeft: -tickWidth / 2,
            marginTop: -tickLength / 2,
            opacity: Math.max(0.12, 1 - i * 0.18),
            transform: `rotate(${(i * 360) / TICK_COUNT}deg) translateY(${-(radius - tickLength / 2)}px)`,
          }}
        />
      ))}
    </motion.span>
  )
}
