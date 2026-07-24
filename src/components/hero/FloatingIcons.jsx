import { motion, useReducedMotion } from 'framer-motion'
import Float from '../motion/Float.jsx'
import { fadeScale, staggerContainer } from '../../animations/motion.js'
import {
  HeartIcon,
  StethoscopeIcon,
  EcgIcon,
  PillIcon,
  ShieldIcon,
} from './MedicalIcons.jsx'

/* =========================================================
   FloatingIcons — the medical icon tiles orbiting the doctor
   ---------------------------------------------------------
   Each tile is two nested elements:
     · outer  → the staggered entrance (scale + fade)
     · inner  → the endless ambient float
   Splitting them keeps the loop from restarting the entrance,
   and lets every tile carry its own duration/delay/drift so the
   group never falls into visible lock-step.
   ========================================================= */

const ICONS = [
  { key: 'heart', Icon: HeartIcon, tone: 'rose', pos: { top: '4%', left: '2%' }, amplitude: 9, drift: 5, rotate: 3, duration: 6.4, delay: 0 },
  { key: 'stethoscope', Icon: StethoscopeIcon, tone: 'blue', pos: { top: '-2%', right: '14%' }, amplitude: 7, drift: 4, rotate: -2.5, duration: 7.8, delay: 0.6 },
  { key: 'ecg', Icon: EcgIcon, tone: 'teal', pos: { top: '44%', right: '-2%' }, amplitude: 10, drift: 6, rotate: 2, duration: 8.6, delay: 1.1 },
  { key: 'pill', Icon: PillIcon, tone: 'indigo', pos: { top: '52%', left: '-2%' }, amplitude: 8, drift: 5, rotate: -3, duration: 7.1, delay: 0.35 },
  { key: 'shield', Icon: ShieldIcon, tone: 'violet', pos: { bottom: '10%', right: '24%' }, amplitude: 6, drift: 4, rotate: 2, duration: 9.4, delay: 1.6 },
]

export default function FloatingIcons({ icons = ICONS, delayChildren = 0.7 }) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      className="hero-icons"
      aria-hidden="true"
      variants={staggerContainer(reduced, { stagger: 0.12, delayChildren })}
      initial="hidden"
      animate="show"
    >
      {icons.map(({ key, Icon, tone, pos, amplitude, drift, rotate, duration, delay }) => (
        <motion.div
          key={key}
          className="hero-icons__slot"
          style={pos}
          variants={fadeScale(reduced, { from: 0.7, duration: 0.55 })}
        >
          <Float amplitude={amplitude} drift={drift} rotate={rotate} duration={duration} delay={delay}>
            <span className={`hero-icons__tile hero-icons__tile--${tone}`}>
              <Icon width="22" height="22" />
            </span>
          </Float>
        </motion.div>
      ))}
    </motion.div>
  )
}
