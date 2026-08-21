import { CONFIG } from '../config.js'

function isValidGifts(data) {
  return (
    data &&
    Array.isArray(data.premium) && data.premium.length > 0 &&
    Array.isArray(data.standard) && data.standard.length > 0
  )
}

/**
 * Loads the prize wheel catalog from the booking script's Gifts tab (see
 * google-apps-script-booking.gs) — the sheet is the only source now, no
 * bundled copy to silently fall back to. A misconfigured or unreachable
 * endpoint logs a clear error and leaves the wheel empty rather than
 * quietly serving stale hard-coded prizes.
 */
export async function fetchGifts() {
  if (!CONFIG.bookingEndpoint) {
    console.error('Cannot load gifts: bookingEndpoint is not configured.')
    return { premium: [], standard: [] }
  }

  try {
    const separator = CONFIG.bookingEndpoint.includes('?') ? '&' : '?'
    const url = `${CONFIG.bookingEndpoint}${separator}action=gifts&_=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    if (!data.ok || !isValidGifts(data.gifts)) throw new Error('Unexpected response shape')
    return data.gifts
  } catch (e) {
    console.error('Could not load gifts from the sheet:', e)
    return { premium: [], standard: [] }
  }
}
