import { motion, useReducedMotion } from 'framer-motion'
import { floatLoop } from '../animations/motion.js'

// Lightweight, self-contained SVG illustrations (no external assets),
// styled in the brand blue palette to match the reference design.

// Gentle idle float, silenced for anyone who prefers reduced motion.
function useFloat(options) {
  const reduced = useReducedMotion()
  return floatLoop(reduced, { amplitude: 8, duration: 5.5, ...options })
}

export function StethoscopeArt() {
  const float = useFloat()
  return (
    <motion.svg className="art" viewBox="0 0 320 300" fill="none" {...float}>
      <defs>
        <linearGradient id="stethG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {/* soft blob */}
      <circle cx="160" cy="150" r="118" fill="#fff" opacity="0.55" />
      <circle cx="160" cy="150" r="118" stroke="#dbeafe" strokeWidth="2" />
      {/* stethoscope tubing */}
      <path d="M118 78c-4 40 4 78 42 78s46-38 42-78" stroke="url(#stethG)" strokeWidth="9" strokeLinecap="round" />
      <path d="M160 156c0 34 0 50 34 58 30 7 46-14 46-40" stroke="url(#stethG)" strokeWidth="9" strokeLinecap="round" />
      {/* earpieces */}
      <circle cx="118" cy="74" r="9" fill="#1d4ed8" />
      <circle cx="202" cy="74" r="9" fill="#1d4ed8" />
      {/* chest piece */}
      <circle cx="242" cy="188" r="26" fill="url(#stethG)" />
      <circle cx="242" cy="188" r="12" fill="#dbeafe" />
      {/* crosses */}
      <g fill="#60a5fa" opacity="0.9">
        <path d="M74 128h10v10h10v10h-10v10h-10v-10h-10v-10h10z" />
      </g>
      <g fill="#93c5fd" opacity="0.8">
        <path d="M96 210h7v7h7v7h-7v7h-7v-7h-7v-7h7z" />
      </g>
    </motion.svg>
  )
}

export function CelebrateArt() {
  const float = useFloat({ duration: 6.2 })
  return (
    <motion.svg className="art" viewBox="0 0 300 220" fill="none" {...float}>
      <g fill="#2563eb">
        <circle cx="100" cy="120" r="30" fill="#fcd9b8" />
        <path d="M64 210c0-24 16-42 36-42s36 18 36 42z" />
      </g>
      <g fill="#1d4ed8">
        <circle cx="200" cy="120" r="30" fill="#fcd9b8" />
        <path d="M164 210c0-24 16-42 36-42s36 18 36 42z" />
      </g>
      {/* raised hands / high five */}
      <path d="M128 96l22-22 22 22" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" fill="none" />
      <circle cx="150" cy="66" r="8" fill="#fbbf24" />
      {/* confetti */}
      <g>
        <rect x="60" y="40" width="8" height="8" rx="2" fill="#60a5fa" />
        <rect x="240" y="54" width="8" height="8" rx="2" fill="#fbbf24" />
        <rect x="120" y="30" width="7" height="7" rx="2" fill="#22c55e" />
        <rect x="190" y="34" width="7" height="7" rx="2" fill="#ef4444" />
      </g>
    </motion.svg>
  )
}
