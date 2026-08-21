import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Loading from './Loading.jsx'
import { EASE_OUT } from '../../animations/motion.js'

/* =========================================================
   LoadingOverlay — full-screen loading state
   ---------------------------------------------------------
   Fixed over the whole viewport with a blurred backdrop and a
   single revolving ring centered on screen — no card, no text.
   ========================================================= */

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
        >
          <Loading size={56} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
