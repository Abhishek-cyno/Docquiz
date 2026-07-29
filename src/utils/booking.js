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
