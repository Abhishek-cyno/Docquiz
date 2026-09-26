import { CONFIG } from '../config.js'

/**
 * Client for the booking Apps Script (google-apps-script-booking.gs).
 *
 * Note the deliberate `text/plain` content type on the POST. A JSON
 * content type would make the browser fire a CORS preflight, which Apps
 * Script cannot answer — so the request would die before it ever ran.
 * text/plain keeps it a "simple request", and the script parses the body
 * as JSON regardless. This is also why we can actually READ the response
 * here, unlike the fire-and-forget no-cors POST in storage.js — and we
 * must read it, because that response is how we learn a slot was taken.
 */

function withCacheBuster(url) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_=${Date.now()}`
}

/** Loads the bookable days. Throws so the caller can show a retry. */
export async function fetchSlots() {
  if (!CONFIG.bookingEndpoint) {
    throw new Error('Booking endpoint is not configured.')
  }

  const res = await fetch(withCacheBuster(`${CONFIG.bookingEndpoint}?action=slots`), {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Could not load available times.')

  return data.days || []
}

/**
 * Checks whether this mobile number already has a recorded prize win. The
 * booking sheet is the shared source of truth, so this also catches people
 * returning from a different device or browser.
 */
// Started at registration so the answer is usually ready by the time the
// gift page mounts. Consumed once, so a retry always hits the server fresh.
const prefetchedEligibility = new Map()

export function prefetchGiftEligibility(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 10) return
  prefetchedEligibility.set(digits, fetchGiftEligibility(digits))
}

export function checkGiftEligibility(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  const pending = prefetchedEligibility.get(digits)
  if (pending) {
    prefetchedEligibility.delete(digits)
    return pending
  }
  return fetchGiftEligibility(phone)
}

async function fetchGiftEligibility(phone) {
  if (!CONFIG.bookingEndpoint) {
    return { ok: false, reason: 'config', error: 'Prize validation is not configured.' }
  }

  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 10) {
    return { ok: false, reason: 'invalid', error: 'Please enter a valid mobile number.' }
  }

  try {
    const url = `${CONFIG.bookingEndpoint}?action=eligibility&phone=${encodeURIComponent(digits)}&_${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('Could not validate gift eligibility', e)
    return {
      ok: false,
      reason: 'network',
      error: "We couldn't validate prize eligibility. Please check your connection and try again.",
    }
  }
}

/**
 * Saves name/mobile/specialty/category/clinic the instant the registration
 * form is submitted — before the quiz even starts — so the Sheet has a row
 * for this doctor from the first step. Every later write for this phone
 * number (claimGift, bookSlot, registerGift) finds that same row and
 * upgrades it in place rather than adding another — see registerDoctor()
 * in google-apps-script-booking.gs. Best-effort like claimGift(): a network
 * hiccup here shouldn't hold up the quiz, it just means the row starts
 * later, at whichever of those steps first succeeds.
 */
export async function registerDoctor(doctor) {
  if (!CONFIG.bookingEndpoint) return { ok: false, reason: 'config' }

  try {
    const res = await fetch(CONFIG.bookingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'registerDoctor',
        name: doctor?.name || '',
        phone: doctor?.mobile || '',
        specialty: doctor?.specialty || '',
        category: doctor?.category || '',
        clinic: doctor?.hasClinic || '',
      }),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('Could not save registration details', e)
    return { ok: false, reason: 'network' }
  }
}

/**
 * Spends one unit of a gift's stock the moment the wheel lands on it (see
 * GiftPage.jsx) — this is what lets a limited gift actually run out across
 * every doctor spinning, not just this one browser tab. Best-effort: a
 * failure here (network hiccup, endpoint unset) doesn't undo the win the
 * doctor already saw land, it just means that one unit doesn't get debited
 * from the sheet.
 */
export async function claimGift(giftId, doctor) {
  if (!CONFIG.bookingEndpoint || !giftId) return { ok: false }

  try {
    const res = await fetch(CONFIG.bookingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'claimGift',
        id: giftId,
        name: doctor?.name || '',
        phone: doctor?.mobile || '',
        specialty: doctor?.specialty || '',
        category: doctor?.category || '',
        clinic: doctor?.hasClinic || '',
      }),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('Could not record gift claim', e)
    return { ok: false, reason: 'network' }
  }
}

/**
 * Records a doctor's contact details and quiz/gift result when there's no
 * clinic for a rep to visit, so there's no slot to book — see ContactPage.jsx
 * and registerGift() in google-apps-script-booking.gs. Same endpoint and
 * same "read the real response, don't fire-and-forget" reasoning as
 * bookSlot(), just without a slot.
 */
export async function registerGift(payload) {
  if (!CONFIG.bookingEndpoint) {
    return { ok: false, reason: 'config', error: 'Booking endpoint is not configured.' }
  }

  try {
    const res = await fetch(CONFIG.bookingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'registerGift', ...payload }),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('Registering gift-winner details failed', e)
    return {
      ok: false,
      reason: 'network',
      error: "We couldn't reach the server. Please check your connection and try again.",
    }
  }
}

/**
 * Claims a slot. Resolves with the server's verdict rather than throwing
 * on a rejected booking — `taken` is an expected outcome, not an error,
 * and the UI handles it by refreshing the grid.
 */
export async function bookSlot(payload) {
  if (!CONFIG.bookingEndpoint) {
    return { ok: false, reason: 'config', error: 'Booking endpoint is not configured.' }
  }

  try {
    const res = await fetch(CONFIG.bookingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'book', ...payload }),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.warn('Booking request failed', e)
    return {
      ok: false,
      reason: 'network',
      error: "We couldn't reach the booking service. Please check your connection and try again.",
    }
  }
}
