export const DEFAULT_COUNTRY_CODE = '+91'

export const COUNTRY_CODES = [
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+966', label: '🇸🇦 +966' },
  { code: '+974', label: '🇶🇦 +974' },
  { code: '+977', label: '🇳🇵 +977' },
  { code: '+880', label: '🇧🇩 +880' },
  { code: '+94', label: '🇱🇰 +94' },
]

/** Keeps only digits, capped at the 10 the number box allows. */
export const cleanNumber = (value) => String(value || '').replace(/\D/g, '').slice(0, 10)

/**
 * Splits a stored number ("+91 9876543210", or an older free-typed
 * "098765 43210") back into its country code and 10-digit local part.
 */
export function splitPhone(value) {
  const raw = String(value || '').trim()
  const match = raw.startsWith('+')
    ? [...COUNTRY_CODES]
        .sort((a, b) => b.code.length - a.code.length)
        .find((c) => raw.replace(/\s/g, '').startsWith(c.code))
    : null
  const rest = match ? raw.replace(/\s/g, '').slice(match.code.length) : raw
  return {
    code: match ? match.code : DEFAULT_COUNTRY_CODE,
    number: rest.replace(/\D/g, '').slice(-10),
  }
}

export const joinPhone = (code, number) => `${code} ${number}`
