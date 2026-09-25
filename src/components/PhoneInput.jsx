import { COUNTRY_CODES, cleanNumber } from '../utils/phone.js'

/** Country-code dropdown (India by default) beside a digits-only, 10-digit number box. */
export default function PhoneInput({ id, label, hint, code, number, onCodeChange, onNumberChange, autoFocus }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {hint && <span className="field__hint">{hint}</span>}
      </label>
      <div className="phone-input">
        <select
          className="field__input phone-input__code"
          aria-label="Country code"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
        <input
          id={id}
          className="field__input phone-input__number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          placeholder="98765 43210"
          value={number}
          onChange={(e) => onNumberChange(cleanNumber(e.target.value))}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  )
}
