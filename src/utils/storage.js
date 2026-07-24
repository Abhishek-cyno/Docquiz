import { CONFIG } from '../config.js'

const LOCAL_KEY = 'setu_pharma_responses'

// Save a completed response. Tries the Google Sheet endpoint if configured,
// and ALWAYS keeps a local copy as a fallback / backup.
export async function saveResponse(data) {
  const payload = {
    ...data,
    submittedAt: new Date().toISOString(),
  }

  // 1) Local backup (works with zero setup)
  try {
    const existing = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
    existing.push(payload)
    localStorage.setItem(LOCAL_KEY, JSON.stringify(existing))
  } catch (e) {
    console.warn('Local save failed', e)
  }

  // 2) Google Sheet (only if endpoint set)
  if (CONFIG.sheetEndpoint) {
    try {
      await fetch(CONFIG.sheetEndpoint, {
        method: 'POST',
        // Apps Script accepts opaque no-cors posts; we send JSON as text.
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })
      return { ok: true, savedToSheet: true }
    } catch (e) {
      console.warn('Sheet save failed, kept local copy', e)
      return { ok: true, savedToSheet: false }
    }
  }

  return { ok: true, savedToSheet: false }
}

// Handy for debugging: read everything saved locally.
export function getLocalResponses() {
  return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
}
