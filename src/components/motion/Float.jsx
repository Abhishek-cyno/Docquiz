import { motion, useReducedMotion } from 'framer-motion'
import { floatLoop } from '../../animations/motion.js'

/* =========================================================
   Float — ambient "hovering" wrapper
   ---------------------------------------------------------
   Wraps any content in a slow, infinite vertical drift.

   Deliberately does *nothing* else: keep entrance animations on a
   separate parent element. Framer Motion cannot run an entrance and
   an infinite loop on the same transform at the same time — the loop
   would restart the entrance. Nesting them is what keeps both smooth.
   ========================================================= */

export default function Float({
  amplitude = 7,
  drift = 0,
  rotate = 0,
  duration = 6,
  delay = 0,
  className,
  style,
  children,
  ...rest
}) {
  const reduced = useReducedMotion()
  const loop = floatLoop(reduced, { amplitude, drift, rotate, duration, delay })

  return (
    <motion.div
      className={className}
      // Promote to its own compositor layer so the loop never repaints.
      style={{ willChange: reduced ? 'auto' : 'transform', ...style }}
      {...loop}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
