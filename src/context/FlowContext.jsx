import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { pickRandom } from '../utils/shuffle.js'
import { fetchAppData, bundledAppData } from '../utils/fetchAppData.js'
import { fetchGifts } from '../utils/fetchGifts.js'
import { capitalizeName } from '../utils/formatName.js'
import { CONFIG } from '../config.js'
import { SKIP_QUIZ } from '../utils/flowMode.js'

const FlowContext = createContext(null)

const EMPTY_MEETING = {
  date: '', time: '', dateLabel: '', timeLabel: '', ref: '', email: '', phone: '',
}

const EMPTY_DOCTOR = { name: '', mobile: '', specialty: '', category: '', hasClinic: '' }

const EMPTY_GIFTS = { premium: [], standard: [], superpremium: [], consolation: [] }

// Apps Script can take 5–30s to answer a cold request, so the last good copy
// of each sheet is kept on the device and shown instantly while a fresh copy
// loads in the background.
const CONTENT_CACHE_KEY = 'docquiz_content_v1'
const GIFTS_CACHE_KEY = 'docquiz_gifts_v1'
// A brand-new device has no cached copy; past this point the bundled
// specialties are used so the registration form is never stuck waiting.
const CONTENT_FALLBACK_MS = 8000

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked — the app still works, just without the cache.
  }
}

function hasGifts(g) {
  return !!(g && g.premium?.length && g.standard?.length)
}

export const STEPS = {
  LANDING: 'landing',
  REGISTER: 'register',
  QUIZINTRO: 'quizintro',
  QUIZ: 'quiz',
  COMPLETE: 'complete',
  GIFT: 'gift',
  SCHEDULE: 'schedule',
  SCHEDULED: 'scheduled',
  CONTACT: 'contact',
  THANKYOU: 'thankyou',
}

export function FlowProvider({ children }) {
  const [step, setStep] = useState(STEPS.LANDING)
  const [doctor, setDoctorRaw] = useState(EMPTY_DOCTOR)
  // Single choke point for the doctor's name, so every screen that greets
  // them (quiz intro, completion, thank-you, booking payloads) shows it
  // capitalised without each one having to remember to.
  const setDoctor = useCallback(
    (next) => setDoctorRaw({ ...next, name: capitalizeName(next.name).trim() }),
    []
  )
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([]) // { questionId, chosen, correct }
  const [gift, setGift] = useState(null)
  // Filled in by SchedulePage once the booking script confirms the slot.
  // `date`/`time` are the machine values (2026-08-04 / 15:30); the *Label
  // fields are what we show, formatted server-side so the doctor and the
  // confirmation email can never disagree about the time.
  const [meeting, setMeeting] = useState(EMPTY_MEETING)

  // Specialties/categories/questions can live in a Google Sheet (see
  // config.js -> dataEndpoint) so non-developers can edit them without a
  // redeploy. Falls back to the bundled JSON if that's unset or fails.
  const [cachedContent] = useState(() => readCache(CONTENT_CACHE_KEY))
  const [cachedGifts] = useState(() => {
    const g = readCache(GIFTS_CACHE_KEY)
    return hasGifts(g) ? g : null
  })
  const [contentBank, setContentBank] = useState(
    cachedContent || { specialties: [], categories: [], questions: {} }
  )
  // Prize wheel catalog — lives entirely in the booking Sheet's Gifts tab
  // (see fetchGifts.js). No bundled fallback: an unreachable endpoint
  // leaves this empty rather than quietly serving stale hard-coded prizes.
  // superpremium/consolation are optional tiers (jackpot prizes, and a
  // "no real prize" outcome) — see the PRIZE WHEEL note in
  // google-apps-script-booking.gs.
  const [gifts, setGifts] = useState(cachedGifts || EMPTY_GIFTS)
  const [contentLoading, setContentLoading] = useState(!cachedContent)
  const [giftsLoading, setGiftsLoading] = useState(!cachedGifts)

  // A failed fetch comes back empty; never let that wipe out a good copy.
  const applyGifts = useCallback((giftData) => {
    if (hasGifts(giftData)) {
      setGifts(giftData)
      writeCache(GIFTS_CACHE_KEY, giftData)
    }
    setGiftsLoading(false)
  }, [])

  const reloadGifts = useCallback(async () => {
    const giftData = await fetchGifts()
    applyGifts(giftData)
    return giftData
  }, [applyGifts])

  // The two sheets load independently so the faster one isn't held back by
  // the slower, and neither blocks the landing page.
  useEffect(() => {
    let active = true

    const fallbackTimer = cachedContent ? null : setTimeout(() => {
      if (!active) return
      setContentBank((current) => (current.specialties.length ? current : bundledAppData()))
      setContentLoading(false)
    }, CONTENT_FALLBACK_MS)

    fetchAppData().then((data) => {
      if (!active) return
      clearTimeout(fallbackTimer)
      if (data.source === 'remote') {
        setContentBank(data)
        writeCache(CONTENT_CACHE_KEY, data)
      } else if (!cachedContent) {
        setContentBank(data)
      }
      setContentLoading(false)
    })

    fetchGifts().then((giftData) => {
      if (active) applyGifts(giftData)
    })

    return () => {
      active = false
      clearTimeout(fallbackTimer)
    }
  }, [])

  // Build the randomised 3-question quiz for this doctor.
  function buildQuiz(specialty) {
    const set = contentBank.questions[specialty] || contentBank.questions.default || []
    const chosen = pickRandom(set, CONFIG.questionsPerQuiz)
    setQuestions(chosen)
    setAnswers([])
  }

  function recordAnswer(entry) {
    setAnswers((prev) => [...prev, entry])
  }

  const score = useMemo(
    () => answers.filter((a) => a.correct).length,
    [answers]
  )

  // Clinic owners are the ones our reps can actually visit, so they win the
  // high-value prizes and go on to book a meeting. Everyone else wins from the
  // lower-value set and we simply ship the gift — no meeting.
  const hasClinic = doctor.hasClinic === 'yes'

  // Everyone sees the same wheel with every prize on it — the clinic-owner
  // side (jackpot + premium) and the everyone-else side (standard +
  // consolation) interleaved so neither side sits in an obvious block. Only
  // `winnableGifts` differs, and that decides which slice the wheel is
  // allowed to stop on.
  const giftWheel = useMemo(() => {
    const premiumSide = [...gifts.superpremium, ...gifts.premium]
    const standardSide = [...gifts.standard, ...gifts.consolation]
    const mixed = []
    const longest = Math.max(premiumSide.length, standardSide.length)
    for (let i = 0; i < longest; i++) {
      if (premiumSide[i]) mixed.push(premiumSide[i])
      if (standardSide[i]) mixed.push(standardSide[i])
    }
    return mixed
  }, [gifts])

  const winnableGifts = useMemo(() => {
    // The ?skipquiz=1 variant (see flowMode.js) skips straight to the wheel
    // with no quiz to "lose" — so the wheel must never actually land on the
    // consolation ("better luck next time") slice there, even though it's
    // still shown on giftWheel above for visual symmetry.
    const pool = hasClinic
      ? [...gifts.superpremium, ...gifts.premium]
      : SKIP_QUIZ
      ? [...gifts.standard]
      : [...gifts.standard, ...gifts.consolation]
    // stock === 0 means out of stock. The gift still has a slice on
    // giftWheel above (so the wheel doesn't visibly shrink), but it must
    // never be the one the wheel actually lands on — see pickWinnerIndex in
    // src/utils/wheel.js, which only ever picks among `winnableGifts`.
    // Inactive gifts stay in `giftWheel` for display, but are never eligible
    // for the weighted draw. The server enforces the same rule in claimGift.
    return pool.filter((g) => g.active !== false && g.stock !== 0)
  }, [gifts, hasClinic])

  function reset() {
    setStep(STEPS.LANDING)
    setDoctorRaw(EMPTY_DOCTOR)
    setQuestions([])
    setAnswers([])
    setGift(null)
    setMeeting(EMPTY_MEETING)
  }

  const value = {
    step, setStep,
    doctor, setDoctor,
    specialties: contentBank.specialties,
    categories: contentBank.categories,
    contentLoading,
    giftsLoading,
    questions, buildQuiz,
    answers, recordAnswer,
    score,
    gift, setGift,
    hasClinic, giftWheel, winnableGifts, reloadGifts,
    meeting, setMeeting,
    reset,
  }

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useFlow() {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useFlow must be used inside FlowProvider')
  return ctx
}
