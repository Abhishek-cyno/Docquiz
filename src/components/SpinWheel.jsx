import { useCallback, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { pickWinnerIndex, rotationForIndex } from '../utils/wheel.js'

/**
 * Prize wheel.
 *
 * Drawn as a single 200x200 SVG that scales to whatever box the CSS gives it,
 * so the whole thing stays crisp from a 320px phone up to a desktop card
 * without any breakpoint-specific geometry. The pointer and the hub button
 * live outside the rotating group so they stay put while it spins.
 *
 * Every doctor sees the same slices. The winner is drawn up front — uniformly,
 * but only from the slices `winnable` allows — and the wheel is then rotated to
 * land on it. The animation reports the result, it never decides it.
 */

const VIEW = 200
const C = VIEW / 2
const R = 96
const TURNS = 6 // full revolutions before settling
const SPIN_SECONDS = 5

// premium and standard slices share this palette (brand blues plus one teal
// for variety) — only superpremium/consolation get a dedicated look below.
const SEGMENT_COLORS = [
  { bg: '#2563eb', fg: '#ffffff' },
  { bg: '#14b8a6', fg: '#022c22' },
  { bg: '#1d4ed8', fg: '#ffffff' },
  { bg: '#93c5fd', fg: '#1e293b' },
  { bg: '#3b82f6', fg: '#ffffff' },
]

// The two special tiers (see the PRIZE WHEEL note in
// google-apps-script-booking.gs) get a look of their own instead of cycling
// through SEGMENT_COLORS, so a doctor can tell at a glance which slices are
// the jackpot and which one is "no real prize" — same idea as a Wheel of
// Fortune board making its Bankrupt wedge visually distinct.
const SUPER_COLOR = { bg: 'url(#wheelSuperGradient)', fg: '#4a2400', glow: true }
const CONSOLATION_COLOR = { bg: '#64748b', fg: '#ffffff' }

function colorForItem(item, i) {
  if (item.tier === 'superpremium') return SUPER_COLOR
  if (item.tier === 'consolation') return CONSOLATION_COLOR
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length]
}

// Wheel labels have very little radial room. Split names into at most three
// compact lines so long prize names remain inside their own slice.
function labelLines(label, maxChars = 12) {
  const words = String(label || '').split(/\s+/).filter(Boolean)
  const lines = []

  words.forEach((word) => {
    const current = lines[lines.length - 1]
    if (current && `${current} ${word}`.length <= maxChars) {
      lines[lines.length - 1] = `${current} ${word}`
    } else if (lines.length < 3) {
      lines.push(word)
    } else {
      lines[2] = `${lines[2]} ${word}`
    }
  })

  return lines.length ? lines : ['Prize']
}

// Wedge for slice `i`, measured clockwise from 12 o'clock.
function segmentPath(i, total) {
  const step = 360 / total
  const a0 = ((i * step) - 90) * (Math.PI / 180)
  const a1 = (((i + 1) * step) - 90) * (Math.PI / 180)
  const x0 = C + R * Math.cos(a0)
  const y0 = C + R * Math.sin(a0)
  const x1 = C + R * Math.cos(a1)
  const y1 = C + R * Math.sin(a1)
  const largeArc = step > 180 ? 1 : 0
  return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

export default function SpinWheel({ items, winnable, onResult, spinning, disabled, onSpinStart, result }) {
  const reduceMotion = useReducedMotion()
  // Remounting after a trip back through the flow shouldn't snap an
  // already-won wheel back to zero — start it parked on the prize.
  const [rotation, setRotation] = useState(() => {
    const index = result ? items.findIndex((i) => i.id === result.id) : -1
    return index < 0 ? 0 : rotationForIndex(index, items.length)
  })
  // Held aside until the wheel actually stops, so the reveal can't race ahead
  // of the animation.
  const pending = useRef(null)

  const total = items.length
  const step = 360 / total

  const spin = useCallback(() => {
    if (spinning || disabled || !total) return

    const index = pickWinnerIndex(items, winnable)
    if (index < 0) return
    pending.current = items[index]
    onSpinStart()

    const target = rotationForIndex(index, total)
    const current = ((rotation % 360) + 360) % 360
    let delta = target - current
    if (delta < 0) delta += 360

    setRotation(rotation + TURNS * 360 + delta)
  }, [disabled, items, onSpinStart, rotation, spinning, step, total, winnable])

  function settle() {
    if (!pending.current) return
    const won = pending.current
    pending.current = null
    onResult(won)
  }

  return (
    <div className="wheel">
      <div className="wheel__pointer" aria-hidden>▼</div>

      <div className="wheel__disc">
        <motion.svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="wheel__svg"
          animate={{ rotate: rotation }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: SPIN_SECONDS, ease: [0.12, 0.72, 0.12, 1] }
          }
          onAnimationComplete={settle}
          aria-hidden
        >
          <defs>
            <linearGradient id="wheelSuperGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff6d8" />
              <stop offset="45%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r={R + 3} fill="#ffffff" />
          {items.map((item, i) => {
            const color = colorForItem(item, i)
            const mid = i * step + step / 2
            const lines = labelLines(item.short || item.title)
            const labelX = mid > 180 ? C - 71 : C + 71
            return (
              <g key={item.id} className={color.glow ? 'wheel__slice--super' : undefined}>
                <path
                  d={segmentPath(i, total)}
                  fill={color.bg}
                  stroke={color.glow ? '#f5c451' : '#ffffff'}
                  strokeWidth={color.glow ? 2 : 1.2}
                />
                {/* Rotate the slice centre onto the +x axis so the label can
                    simply run outward along it. Slices past the 6 o'clock
                    mark would then come out upside down, so those get a
                    second 180° turn and are mirrored back into place — the
                    label lands in the same spot either way, just upright. */}
                <g transform={`rotate(${mid - 90} ${C} ${C})`}>
                  <g transform={mid > 180 ? `rotate(180 ${C} ${C})` : undefined}>
                    {/* Emoji rides at the rim, label runs inward from it —
                        keeps both clear of the hub on the smallest wheels. */}
                    <text
                      className="wheel__label"
                      x={labelX}
                      y={C - ((lines.length - 1) * 3.4)}
                      fill={color.fg}
                      fontSize="6.6"
                      fontWeight="700"
                      textAnchor={mid > 180 ? 'start' : 'end'}
                    >
                      {lines.map((line, lineIndex) => (
                        <tspan key={lineIndex} x={labelX} dy={lineIndex === 0 ? 0 : 7}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    <text
                      x={mid > 180 ? C - 83 : C + 83}
                      y={C}
                      fontSize="11"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {item.emoji}
                    </text>
                  </g>
                </g>
              </g>
            )
          })}
          <circle cx={C} cy={C} r={R} fill="none" stroke="#ffffff" strokeWidth="4" />
        </motion.svg>

        <button
          type="button"
          className="wheel__hub"
          onClick={spin}
          disabled={spinning || disabled}
          aria-label={disabled ? 'Spin used' : 'Spin the reward wheel'}
        >
          {spinning ? '…' : disabled ? '🎉' : 'SPIN'}
        </button>
      </div>
    </div>
  )
}
