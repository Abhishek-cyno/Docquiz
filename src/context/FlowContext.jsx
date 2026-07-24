import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { pickRandom } from '../utils/shuffle.js'
import { fetchAppData } from '../utils/fetchAppData.js'
import { CONFIG } from '../config.js'

const FlowContext = createContext(null)

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
  const [doctor, setDoctor] = useState({ name: '', specialty: '', category: '' })
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([]) // { questionId, chosen, correct }
  const [gift, setGift] = useState(null)
  const [meeting, setMeeting] = useState({ date: '', time: '' })

  // Specialties/categories/questions can live in a Google Sheet (see
  // config.js -> dataEndpoint) so non-developers can edit them without a
  // redeploy. Falls back to the bundled JSON if that's unset or fails.
  const [contentBank, setContentBank] = useState({ specialties: [], categories: [], questions: {} })
  const [contentLoading, setContentLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchAppData().then((data) => {
      if (active) {
        setContentBank(data)
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

  function reset() {
    setStep(STEPS.LANDING)
    setDoctor({ name: '', specialty: '', category: '' })
    setQuestions([])
    setAnswers([])
    setGift(null)
    setMeeting({ date: '', time: '' })
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
