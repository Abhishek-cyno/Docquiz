import { useState } from 'react'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import { registerGift } from '../utils/booking.js'
import LoadingOverlay from '../components/motion/LoadingOverlay.jsx'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * The no-clinic counterpart to SchedulePage: no slot to book (there's no rep
 * visit), but this is still the ONLY point in the whole funnel where a
 * doctor without a clinic types an email or WhatsApp number — without it,
 * a won gift has nowhere to be delivered to.
 */
export default function ContactPage() {
  const { doctor, gift, score, questions, answers, setMeeting, setStep } = useFlow()

  const [name, setName] = useState(doctor.name || '')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  async function onConfirm() {
    if (!name.trim()) return setFormError('Please enter your name.')
    if (!EMAIL_RE.test(email.trim())) return setFormError('Please enter a valid email address.')
    if (phone.replace(/\D/g, '').length < 10) return setFormError('Please enter a valid WhatsApp number.')

    setFormError('')
    setSubmitting(true)

    const total = questions.length
    const result = await registerGift({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      specialty: doctor.specialty,
      category: doctor.category,
      clinic: doctor.hasClinic,
      score,
      total,
      percent: total ? Math.round((score / total) * 100) : 0,
      gift: gift?.title || '',
      answers,
    })

    setSubmitting(false)

    if (result.ok) {
      setMeeting({
        date: '', time: '', dateLabel: '', timeLabel: '',
        ref: result.ref || '',
        email: email.trim(),
        phone: phone.trim(),
      })
      setStep(STEPS.THANKYOU)
      return
    }

    setFormError(result.error || 'Something went wrong. Please try again.')
  }

  const ready = name.trim() && email.trim() && phone.trim()

  return (
    <div className="card center-narrow">
      <LoadingOverlay show={submitting} />

      <div style={{ textAlign: 'center' }}>
        <h2 className="card__title">Almost done — your details</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          So we can arrange delivery of <strong>{gift?.title}</strong>, please share how to reach you.
        </p>
      </div>

      <form className="form" onSubmit={(e) => { e.preventDefault(); onConfirm() }}>
        <label className="field">
          <span className="field__label">Full Name</span>
          <input
            className="field__input"
            type="text"
            placeholder="Dr. Shivangi Mittal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            placeholder="you@hospital.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">
            WhatsApp Number <span className="field__hint">(for delivery updates)</span>
          </span>
          <input
            className="field__input"
            type="tel"
            inputMode="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>

        {formError && <p className="form__error">{formError}</p>}

        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setStep(STEPS.GIFT)} disabled={submitting}>
            Back
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready || submitting}>
            {submitting ? 'Saving…' : 'Continue'} <span className="btn__arrow">→</span>
          </button>
        </div>
      </form>
    </div>
  )
}
