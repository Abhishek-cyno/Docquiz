import { CONFIG } from '../config.js'

const EMPTY_GIFTS = { premium: [], standard: [], superpremium: [], consolation: [] }

// superpremium/consolation are optional tiers — a sheet that hasn't added
// them yet still has a working wheel, just without a jackpot or a no-win
// slice. premium/standard stay mandatory: an empty one of those means a
// whole audience (clinic owners, or everyone else) has nothing to win.
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
    return EMPTY_GIFTS
  }

  try {
    const separator = CONFIG.bookingEndpoint.includes('?') ? '&' : '?'
    const url = `${CONFIG.bookingEndpoint}${separator}action=gifts&_=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    if (!data.ok || !isValidGifts(data.gifts)) throw new Error('Unexpected response shape')
    return {
      premium: data.gifts.premium,
      standard: data.gifts.standard,
      superpremium: data.gifts.superpremium || [],
      consolation: data.gifts.consolation || [],
    }
  } catch (e) {
    console.error('Could not load gifts from the sheet:', e)
    return EMPTY_GIFTS
  }
}
