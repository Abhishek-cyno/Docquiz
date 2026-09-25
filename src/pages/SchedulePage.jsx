import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFlow, STEPS } from '../context/FlowContext.jsx'
import { fetchSlots, bookSlot } from '../utils/booking.js'
import LoadingOverlay from '../components/motion/LoadingOverlay.jsx'
import { capitalizeName } from '../utils/formatName.js'
import PhoneInput from '../components/PhoneInput.jsx'
import { splitPhone, joinPhone } from '../utils/phone.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// The slot grid is only ever a snapshot. Someone else can take a time
// between the page loading and this doctor pressing Confirm, so we re-pull
// it periodically and whenever the tab regains focus. The booking script
// still has the final say — this just keeps the UI honest most of the time.
const REFRESH_MS = 60000

export default function SchedulePage() {
  const { doctor, gift, score, questions, answers, setMeeting, setStep } = useFlow()

  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')

  const [name, setName] = useState(doctor.name || '')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState(() => splitPhone(doctor.mobile).code)
  const [phone, setPhone] = useState(() => splitPhone(doctor.mobile).number)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')

  const submittingRef = useRef(false)

  const load = useCallback(async ({ keepSelection = false } = {}) => {
    try {
      const fresh = await fetchSlots()
      setDays(fresh)
      setLoadError('')

      setSelectedDate((current) => {
        const stillOpen = fresh.find((d) => d.date === current && d.openCount > 0)
        if (keepSelection && stillOpen) return current
        return (fresh.find((d) => d.openCount > 0) || fresh[0] || {}).date || ''
      })
    } catch (e) {
      setLoadError(e.message || 'Could not load available times.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Quiet background refresh. Never runs mid-submit, so the grid cannot
  // shift underneath a booking that is already in flight.
  useEffect(() => {
    function refresh() {
      if (submittingRef.current || document.hidden) return
      load({ keepSelection: true })
    }
    const id = setInterval(refresh, REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  const activeDay = useMemo(
    () => days.find((d) => d.date === selectedDate) || null,
    [days, selectedDate]
  )

  // A slot chosen earlier can be taken by someone else on the next refresh —
  // drop the selection rather than letting Confirm submit a dead time.
  useEffect(() => {
    if (!selectedTime) return
    const slot = activeDay?.slots.find((s) => s.time === selectedTime)
    if (!slot || !slot.available) setSelectedTime('')
  }, [activeDay, selectedTime])

  function pickDate(date) {
    setSelectedDate(date)
    setSelectedTime('')
    setNotice('')
  }

  async function onConfirm() {
    if (!selectedDate || !selectedTime) return setFormError('Please pick a date and time.')
    if (!name.trim()) return setFormError('Please enter your name.')
    if (email.trim() && !EMAIL_RE.test(email.trim())) return setFormError('Please enter a valid email address.')
    if (phone.length !== 10) return setFormError('Please enter a valid 10-digit WhatsApp number.')

    const fullPhone = joinPhone(countryCode, phone)

    setFormError('')
    setNotice('')
    setSubmitting(true)
    submittingRef.current = true

    const total = questions.length
    const result = await bookSlot({
      date: selectedDate,
      time: selectedTime,
      name: capitalizeName(name).trim(),
      email: email.trim(),
      phone: fullPhone,
      specialty: doctor.specialty,
      category: doctor.category,
      clinic: doctor.hasClinic,
      score,
      total,
      percent: total ? Math.round((score / total) * 100) : 0,
      gift: gift?.title || '',
      answers,
    })

    submittingRef.current = false
    setSubmitting(false)

    if (result.ok) {
      setMeeting({
        date: result.date,
        time: result.time,
        dateLabel: result.dateLabel,
        timeLabel: result.timeLabel,
        ref: result.ref,
        email: email.trim(),
        phone: fullPhone,
      })
      setStep(STEPS.SCHEDULED)
      return
    }

    if (result.reason === 'taken') {
      // Someone beat us to it. Refresh so the grid reflects reality, and
      // keep the doctor on the same day so re-picking is one tap.
      setSelectedTime('')
      setNotice('Sorry — that slot was booked a moment ago. Please pick another time.')
      load({ keepSelection: true })
      return
    }

    setFormError(result.error || 'Something went wrong. Please try again.')
  }

  const ready = selectedDate && selectedTime && name.trim() && phone.length === 10

  return (
    <div className="card schedule-card">
      <LoadingOverlay show={loading} />
      <LoadingOverlay show={submitting} />

      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <h2 className="card__title">Schedule a Meeting 📅</h2>
        <p className="card__sub" style={{ margin: '6px auto 0' }}>
          Pick a date &amp; time that works for you. Our representative will visit you and hand over the gift you won — in person.
        </p>
      </div>

      {loading ? (
        <div className="slot-empty" />
      ) : loadError ? (
        <div className="slot-empty slot-empty--error">
          <p>{loadError}</p>
          <button className="btn btn--ghost" onClick={() => { setLoading(true); load() }}>Try again</button>
        </div>
      ) : !days.length ? (
        <div className="slot-empty">No times are open right now. Please check back shortly.</div>
      ) : (
        <div className="slot-layout">
          <div className="slot-picker">
            <div className="slot-picker__label">Select a date</div>
            <div className="date-strip">
              {days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={
                    'date-chip' +
                    (day.date === selectedDate ? ' is-active' : '') +
                    (day.openCount === 0 ? ' is-full' : '')
                  }
                  onClick={() => pickDate(day.date)}
                  disabled={day.openCount === 0}
                >
                  <span className="date-chip__day">{day.weekday.slice(0, 3)}</span>
                  <span className="date-chip__date">{day.shortLabel}</span>
                  <span className="date-chip__count">
                    {day.openCount === 0 ? 'Full' : `${day.openCount} open`}
                  </span>
                </button>
              ))}
            </div>

            <div className="slot-picker__label">
              Select a time <span className="field__hint">(IST)</span>
            </div>
            <div className="slot-grid">
              {activeDay?.slots.map((slot) => (
                <button
                  key={slot.time}
                  type="button"
                  className={
                    'slot' +
                    (slot.time === selectedTime ? ' is-active' : '') +
                    (slot.available ? '' : ' is-taken')
                  }
                  onClick={() => { setSelectedTime(slot.time); setNotice('') }}
                  disabled={!slot.available}
                  title={slot.available ? '' : (slot.capacity > 1 ? 'Fully booked' : 'Already booked')}
                >
                  <span className="slot__time">{slot.label}</span>
                  {/* Older/un-redeployed booking scripts won't send capacity — falls back to the plain single-slot look. */}
                  {slot.capacity > 1 && (
                    <span className="slot__seats">{slot.available ? `${slot.remaining} left` : 'Full'}</span>
                  )}
                </button>
              ))}
            </div>
            <p className="slot-selection" aria-live="polite">
              {selectedTime
                ? `Selected appointment: ${activeDay?.label} at ${activeDay?.slots.find((s) => s.time === selectedTime)?.label}`
                : 'Choose a time above to continue.'}
            </p>
          </div>

          <div className="slot-details">
            <div className="slot-details__label">Your details</div>

            <label className="field">
              <span className="field__label">Full Name</span>
              <input
                className="field__input"
                type="text"
                placeholder="Dr. Shivangi Mittal"
                value={name}
                onChange={(e) => setName(capitalizeName(e.target.value))}
                autoCapitalize="words"
              />
            </label>

            <label className="field">
              <span className="field__label">
                Email <span className="field__hint">(optional)</span>
              </span>
              <input
                className="field__input"
                type="email"
                placeholder="you@hospital.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <PhoneInput
              id="schedule-phone"
              label="WhatsApp Number"
              hint="(for your confirmation)"
              code={countryCode}
              number={phone}
              onCodeChange={setCountryCode}
              onNumberChange={setPhone}
            />

            {notice && <p className="form__notice">{notice}</p>}
            {formError && <p className="form__error">{formError}</p>}
          </div>
        </div>
      )}

      <div className="form__actions" style={{ marginTop: 22 }}>
        <button className="btn btn--ghost" onClick={() => setStep(STEPS.GIFT)} disabled={submitting}>
          Back
        </button>
        <button className="btn btn--primary" onClick={onConfirm} disabled={!ready || submitting}>
          {submitting ? 'Booking…' : 'Confirm Booking ✓'}
        </button>
      </div>
    </div>
  )
}
