/* =========================================================
   Shared motion language
   ---------------------------------------------------------
   One place for the easing curves, durations and variant
   factories used across the marketing surfaces, so every
   animation on the page moves with the same personality.

   Every factory takes `reduced` (from framer-motion's
   useReducedMotion) as its first argument and degrades to a
   plain, near-instant opacity fade — or to nothing at all for
   ambient loops — when the user prefers reduced motion.

   Only `opacity` and `transform` are ever animated so the
   compositor can keep everything on the GPU at 60fps.
   ========================================================= */

/** Fast start, long settle. No overshoot — this is what makes it feel premium. */
export const EASE_OUT = [0.16, 1, 0.3, 1]
/** Symmetric curve for ambient loops that must never "land". */
export const EASE_SOFT = [0.45, 0, 0.55, 1]

export const DURATION = {
  fast: 0.35,
  base: 0.6,
  slow: 0.85,
}

/* ---------------------------------------------------------
   Entrances
   --------------------------------------------------------- */

/**
 * Fade in while sliding up. The workhorse for hero copy and cards.
 * Pair with `staggerContainer` on a parent, or use standalone with a delay.
 */
export const fadeUp = (reduced = false, { y = 20, duration = DURATION.base, delay = 0 } = {}) => ({
  hidden: { opacity: 0, y: reduced ? 0 : y },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: reduced ? 0.2 : duration,
      delay: reduced ? 0 : delay,
      ease: EASE_OUT,
    },
  },
})

/** Fade in with a whisper of scale — for chips, badges and icon tiles. */
export const fadeScale = (reduced = false, { from = 0.92, duration = DURATION.base, delay = 0 } = {}) => ({
  hidden: { opacity: 0, scale: reduced ? 1 : from },
  show: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: reduced ? 0.2 : duration,
      delay: reduced ? 0 : delay,
      ease: EASE_OUT,
    },
  },
})

/**
 * Orchestrates children that declare `hidden`/`show` variants.
 * Children inherit the parent's animation state automatically.
 */
export const staggerContainer = (reduced = false, { stagger = 0.09, delayChildren = 0 } = {}) => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: reduced ? 0 : stagger,
      delayChildren: reduced ? 0 : delayChildren,
    },
  },
})

/* ---------------------------------------------------------
   Ambient loops
   --------------------------------------------------------- */

/**
 * A slow, never-resting float. Returns `{ animate, transition }` ready to
 * spread onto a motion element — or `{}` when motion is reduced, which
 * leaves the element completely still.
 *
 * `drift` and `rotate` add a touch of organic wander so several floating
 * elements never look mechanically in sync.
 */
export const floatLoop = (
  reduced = false,
  { amplitude = 7, drift = 0, rotate = 0, duration = 6, delay = 0 } = {}
) => {
  if (reduced) return {}

  return {
    animate: {
      y: [0, -amplitude, 0, amplitude * 0.45, 0],
      ...(drift ? { x: [0, drift, 0, -drift * 0.6, 0] } : null),
      ...(rotate ? { rotate: [0, rotate, 0, -rotate * 0.7, 0] } : null),
    },
    transition: {
      duration,
      delay,
      repeat: Infinity,
      repeatType: 'loop',
      ease: EASE_SOFT,
      times: [0, 0.25, 0.5, 0.75, 1],
    },
  }
}

/**
 * Very slow breathing + wander for the background gradient orbs.
 * Long durations keep it below the threshold of conscious notice.
 */
export const orbLoop = (
  reduced = false,
  { scale = 1.14, x = 26, y = 20, duration = 18, delay = 0 } = {}
) => {
  if (reduced) return {}

  return {
    animate: {
      scale: [1, scale, 1],
      x: [0, x, 0],
      y: [0, -y, 0],
    },
    transition: {
      duration,
      delay,
      repeat: Infinity,
      repeatType: 'loop',
      ease: EASE_SOFT,
    },
  }
}

/* ---------------------------------------------------------
   Interactions
   --------------------------------------------------------- */

/** Shared viewport config: fire once, when a third of the element is visible. */
export const VIEWPORT = { once: true, amount: 0.3, margin: '0px 0px -10% 0px' }

/** Lift + stronger shadow on hover, gentle press on tap. */
export const liftOnHover = (reduced = false, { y = -3, shadow = '0 22px 38px -14px rgba(37, 99, 235, 0.55)' } = {}) => ({
  whileHover: reduced ? { boxShadow: shadow } : { y, boxShadow: shadow },
  whileTap: reduced ? {} : { y: y / 2, scale: 0.985 },
  transition: { duration: 0.25, ease: EASE_OUT },
})
