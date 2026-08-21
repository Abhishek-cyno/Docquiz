import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { pickRandom } from '../utils/shuffle.js'
import { fetchAppData } from '../utils/fetchAppData.js'
import { fetchGifts } from '../utils/fetchGifts.js'
import { CONFIG } from '../config.js'

const FlowContext = createContext(null)

const EMPTY_MEETING = {
  date: '', time: '', dateLabel: '', timeLabel: '', ref: '', email: '', phone: '',
}

const EMPTY_DOCTOR = { name: '', specialty: '', category: '', hasClinic: '' }

export const STEPS = {
  LANDING: 'landing',
  REGISTER: 'register',
  QUIZINTRO: 'quizintro',
  QUIZ: 'quiz',
  COMPLETE: 'complete',
  GIFT: 'gift',
  SCHEDULE: 'schedule',
  SCHEDULED: 'scheduled',
  THANKYOU: 'thankyou',
}

export function FlowProvider({ children }) {
  const [step, setStep] = useState(STEPS.LANDING)
  const [doctor, setDoctor] = useState(EMPTY_DOCTOR)
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
  const [contentBank, setContentBank] = useState({ specialties: [], categories: [], questions: {} })
  // Prize wheel catalog — lives entirely in the booking Sheet's Gifts tab
  // (see fetchGifts.js). No bundled fallback: an unreachable endpoint
  // leaves this empty rather than quietly serving stale hard-coded prizes.
  const [gifts, setGifts] = useState({ premium: [], standard: [] })
  const [contentLoading, setContentLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([fetchAppData(), fetchGifts()]).then(([data, giftData]) => {
      if (active) {
        setContentBank(data)
        setGifts(giftData)
        setContentLoading(false)
      }
    })
    return () => { active = false }
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

  // Everyone sees the same wheel with every prize on it — premium and standard
  // interleaved so neither tier sits in an obvious block. Only `winnableGifts`
  // differs, and that decides which slice the wheel is allowed to stop on.
  const giftWheel = useMemo(() => {
    const mixed = []
    const longest = Math.max(gifts.premium.length, gifts.standard.length)
    for (let i = 0; i < longest; i++) {
      if (gifts.premium[i]) mixed.push(gifts.premium[i])
      if (gifts.standard[i]) mixed.push(gifts.standard[i])
    }
    return mixed
  }, [gifts])

  const winnableGifts = useMemo(
    () => (hasClinic ? gifts.premium : gifts.standard),
    [gifts, hasClinic]
  )

  function reset() {
    setStep(STEPS.LANDING)
    setDoctor(EMPTY_DOCTOR)
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
    questions, buildQuiz,
    answers, recordAnswer,
    score,
    gift, setGift,
    hasClinic, giftWheel, winnableGifts,
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
