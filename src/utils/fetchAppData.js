import specialtiesData from '../data/specialties.json'
import questionsData from '../data/questions.json'
import { CONFIG } from '../config.js'

const FALLBACK = {
  specialties: specialtiesData.specialties,
  categories: specialtiesData.categories,
  questions: questionsData,
}

// Basic shape + non-empty check so a misconfigured or not-yet-populated
// sheet (e.g. the tabs don't exist yet) degrades to the fallback instead
// of handing the app an empty specialty list.
function isValidPayload(data) {
  return (
    data &&
    Array.isArray(data.specialties) &&
    data.specialties.length > 0 &&
    Array.isArray(data.categories) &&
    data.questions &&
    typeof data.questions === 'object'
  )
}

/**
 * Loads specialties/categories/questions from the configured Google Sheet
 * endpoint. Falls back to the bundled JSON in src/data/ if the endpoint
 * isn't configured, is unreachable, or returns something unexpected —
 * the app should never be blocked by a Sheet problem.
 */
export async function fetchAppData() {
  if (!CONFIG.dataEndpoint) {
    return { ...FALLBACK, source: 'bundled' }
  }

  try {
    const res = await fetch(CONFIG.dataEndpoint)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!isValidPayload(data)) throw new Error('Unexpected response shape')
    return {
      specialties: data.specialties,
      categories: data.categories,
      questions: data.questions,
      source: 'remote',
    }
  } catch (e) {
    console.warn('Falling back to bundled specialties/questions data:', e)
    return { ...FALLBACK, source: 'bundled' }
  }
}
