import { useState } from 'react'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import Float from '../components/motion/Float.jsx'
import doctorFormImg from '../assets/doctor-form.png'

export default function RegisterPage() {
  const { setStep, doctor, setDoctor, specialties, categories, contentLoading } = useFlow()
  const [name, setName] = useState(doctor.name)
  const [mobile, setMobile] = useState(doctor.mobile)
  const [specialty, setSpecialty] = useState(doctor.specialty)
  const [category, setCategory] = useState(doctor.category)
  const [hasClinic, setHasClinic] = useState(doctor.hasClinic)
  const [error, setError] = useState('')

  function onSpecialtyChange(value) {
    setSpecialty(value)
    const match = specialties.find((s) => s.name === value)
    if (match) setCategory(match.category)
  }

  function onSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Please enter your name.')
    if (mobile.replace(/\D/g, '').length < 10) return setError('Please enter a valid mobile number.')
    if (!specialty) return setError('Please select your specialty.')
    if (!category) return setError('Please select your category.')
    if (!hasClinic) return setError('Please tell us whether you have your own clinic.')
    setError('')
    setDoctor({ name: name.trim(), mobile: mobile.trim(), specialty, category, hasClinic })
    setStep(STEPS.QUIZINTRO)
  }

  return (
    <div className="split">
      <div className="split__main">
        <h2 className="card__title">Let's get to know you</h2>
        <p className="card__sub">Please enter your details to continue.</p>

        <form className="form" onSubmit={onSubmit}>
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
            <span className="field__label">Mobile Number</span>
            <input
              className="field__input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Specialty</span>
            <select
              className="field__input"
              value={specialty}
              onChange={(e) => onSpecialtyChange(e.target.value)}
              disabled={contentLoading}
            >
              <option value="">{contentLoading ? 'Loading specialties…' : 'Select your specialty…'}</option>
              {specialties.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">
              Quiz Category <span className="field__hint">(auto-selected — change if needed)</span>
            </span>
            <select
              className="field__input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={!specialty || contentLoading}
            >
              <option value="">Please select a quiz category…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">
              Do you have your clinic?
            </span>
            <select
              className="field__input"
              value={hasClinic}
              onChange={(e) => setHasClinic(e.target.value)}
            >
              <option value="">Select an option…</option>
              <option value="yes">Yes — I have my own clinic</option>
              <option value="no">No — I don't have a clinic</option>
            </select>
          </label>

          {error && <p className="form__error">{error}</p>}

          <div className="form__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep(STEPS.LANDING)}>
              Back
            </button>
            <button type="submit" className="btn btn--primary" disabled={contentLoading}>
              Continue <span className="btn__arrow">→</span>
            </button>
          </div>
        </form>
      </div>

      <div className="split__aside">
        <Float amplitude={7} duration={6}>
          <img className="art" src={doctorFormImg} alt="" />
        </Float>
      </div>
    </div>
  )
}
