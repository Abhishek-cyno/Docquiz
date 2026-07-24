import { motion, useReducedMotion } from 'framer-motion'
import Float from '../motion/Float.jsx'
import FloatingIcons from './FloatingIcons.jsx'
import doctorImg from '../../assets/doctor.png'
import { EASE_OUT } from '../../animations/motion.js'

/* =========================================================
   DoctorScene — halo + slow orbit ring + floating doctor + icons
   ---------------------------------------------------------
   Layering, back to front:
     halo   · static blurred glow
     ring   · dashed circle, one revolution every 90s
     figure · entrance (once) wrapping an endless 7px float
     icons  · five medical tiles, each on its own rhythm
   ========================================================= */

export default function DoctorScene() {
  const reduced = useReducedMotion()

  return (
    <div className="hero-scene">
      <span className="hero-scene__halo" aria-hidden="true" />

      <motion.span
        className="hero-scene__ring"
        aria-hidden="true"
        style={{ willChange: reduced ? 'auto' : 'transform' }}
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
      />

      <motion.div
        className="hero-scene__figure"
        initial={{ opacity: 0, y: reduced ? 0 : 28, scale: reduced ? 1 : 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduced ? 0.25 : 1, delay: 0.15, ease: EASE_OUT }}
      >
        <Float amplitude={7} duration={6.5}>
          <img
            className="hero-scene__art"
            src={doctorImg}
            alt="Illustration of a smiling doctor wearing a stethoscope"
          />
        </Float>
      </motion.div>

      <FloatingIcons />
    </div>
  )
}
