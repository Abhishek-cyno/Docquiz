import { useReducedMotion } from 'framer-motion'
import { Reveal, RevealGroup, RevealItem } from './motion/Reveal.jsx'
import { ClipboardIcon, EcgIcon, GiftIcon } from './hero/MedicalIcons.jsx'
import { EASE_OUT } from '../animations/motion.js'

/* =========================================================
   HowItWorks — three step cards that fade up on scroll with a
   staggered delay, then lift on hover.

   The hover lift is Framer Motion rather than CSS because the
   reveal already owns the card's inline transform; a CSS
   :hover transform would simply be outranked by it.
   ========================================================= */

const STEPS = [
  {
    Icon: ClipboardIcon,
    tone: 'blue',
    step: '01',
    title: 'Tell us about you',
    text: 'Your name and specialty — that is all we need to tailor the questions to your practice.',
  },
  {
    Icon: EcgIcon,
    tone: 'teal',
    step: '02',
    title: 'Answer 3 questions',
    text: 'Short, clinically relevant and written for your field. It takes less than a minute.',
  },
  {
    Icon: GiftIcon,
    tone: 'violet',
    step: '03',
    title: 'Spin & win your reward',
    text: 'Spin the prize wheel and we will get your gift to you — clinic owners also book a visit.',
  },
]

export default function HowItWorks() {
  const reduced = useReducedMotion()

  const hover = {
    y: reduced ? 0 : -5,
    boxShadow: '0 28px 46px -28px rgba(30, 58, 138, 0.45)',
  }

  return (
    <section className="how" id="how-it-works">
      <Reveal as="div" className="how__head">
        <span className="how__eyebrow">How It Works</span>
        <h2 className="how__title">Three steps. Under a minute.</h2>
        <p className="how__lede">
          No paperwork, no long forms — just your expertise and a reward you spin for.
        </p>
      </Reveal>

      <RevealGroup className="how__grid" stagger={0.12}>
        {STEPS.map(({ Icon, tone, step, title, text }) => (
          <RevealItem
            key={step}
            className={`how__card how__card--${tone}`}
            whileHover={hover}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <span className="how__icon">
              <Icon width="22" height="22" />
            </span>
            <span className="how__step">{step}</span>
            <h3 className="how__card-title">{title}</h3>
            <p className="how__card-text">{text}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  )
}
