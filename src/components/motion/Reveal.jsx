import { motion, useReducedMotion } from 'framer-motion'
import { fadeUp, staggerContainer, VIEWPORT } from '../../animations/motion.js'

/* =========================================================
   Reveal — scroll / load entrance primitives
   ---------------------------------------------------------
   <Reveal>              standalone fade-up, triggered on scroll
   <RevealGroup>         orchestrates staggered children
     <RevealItem>        a single staggered child

   All three respect prefers-reduced-motion via the shared
   variant factories in animations/motion.js.
   ========================================================= */

/**
 * Fades + slides its children up when they scroll into view.
 * Use `on="load"` for above-the-fold content that should not wait
 * for a scroll event.
 */
export function Reveal({
  as = 'div',
  on = 'view',
  y,
  delay = 0,
  duration,
  className,
  children,
  ...rest
}) {
  const reduced = useReducedMotion()
  const Tag = motion[as]
  const variants = fadeUp(reduced, { y, delay, duration })

  const trigger =
    on === 'load'
      ? { animate: 'show' }
      : { whileInView: 'show', viewport: VIEWPORT }

  return (
    <Tag className={className} variants={variants} initial="hidden" {...trigger} {...rest}>
      {children}
    </Tag>
  )
}

/**
 * Parent orchestrator. Children rendered as <RevealItem> (or any motion
 * element declaring `hidden`/`show`) animate in sequence.
 */
export function RevealGroup({
  as = 'div',
  on = 'view',
  stagger,
  delayChildren,
  className,
  children,
  ...rest
}) {
  const reduced = useReducedMotion()
  const Tag = motion[as]

  const trigger =
    on === 'load'
      ? { animate: 'show' }
      : { whileInView: 'show', viewport: VIEWPORT }

  return (
    <Tag
      className={className}
      variants={staggerContainer(reduced, { stagger, delayChildren })}
      initial="hidden"
      {...trigger}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** A child of <RevealGroup>. Inherits the group's animation state. */
export function RevealItem({ as = 'div', y, duration, className, children, ...rest }) {
  const reduced = useReducedMotion()
  const Tag = motion[as]

  return (
    <Tag className={className} variants={fadeUp(reduced, { y, duration })} {...rest}>
      {children}
    </Tag>
  )
}

export default Reveal
