import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useFlow, STEPS } from '../context/FlowContext.jsx'

export default function QuizPage() {
  const { questions, recordAnswer, setStep } = useFlow()
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [locked, setLocked] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)

  const current = questions[index]
  if (!current) return null

  const total = questions.length
  const pct = Math.round((index / total) * 100)

  function choose(optionIndex) {
    if (locked) return
    setSelected(optionIndex)
    setLocked(true)
    if (optionIndex === current.answer) setCorrectCount((count) => count + 1)
    recordAnswer({
      questionId: current.id,
      question: current.q,
      chosen: optionIndex,
      correct: optionIndex === current.answer,
    })
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1)
      setSelected(null)
      setLocked(false)
    } else {
      // A score of zero goes straight to GiftPage's existing Try Again
      // state instead of showing the Quiz Completed screen first.
      setStep(correctCount === 0 ? STEPS.GIFT : STEPS.COMPLETE)
    }
  }

  function optionClass(i) {
    if (!locked) return 'option'
    if (i === current.answer) return 'option option--correct'
    if (i === selected) return 'option option--wrong'
    return 'option option--muted'
  }

  return (
    <div className="quiz-layout">
      <div className="card">
        <div className="quiz__head">
          <span className="quiz__count">Question {index + 1} of {total}</span>
          <span className="quiz__pct">{pct}%</span>
        </div>
        <div className="quiz__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.div className="quiz__bar-fill" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, x: 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -36 }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="quiz__question">{current.q}</h2>

            <div className="quiz__options">
              {current.options.map((opt, i) => (
                <motion.button
                  key={i}
                  className={optionClass(i)}
                  onClick={() => choose(i)}
                  disabled={locked}
                  whileTap={!locked ? { scale: 0.98 } : {}}
                >
                  <span className="option__letter">{String.fromCharCode(65 + i)}</span>
                  <span className="option__text">{opt}</span>
                  {locked && i === current.answer && <span className="option__icon">✓</span>}
                  {locked && i === selected && i !== current.answer && <span className="option__icon">✕</span>}
                </motion.button>
              ))}
            </div>

            {locked && (
              <motion.div
                className={`quiz__feedback ${selected === current.answer ? 'is-correct' : 'is-wrong'}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {selected === current.answer ? 'Correct! 🎉 ' : 'Not quite. '}
                {selected !== current.answer && `Correct answer: ${String.fromCharCode(65 + current.answer)}.`}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="quiz__footer">
          <button className="btn btn--primary" onClick={next} disabled={!locked}>
            {index + 1 < total ? 'Next Question' : 'See Result'} <span className="btn__arrow">→</span>
          </button>
        </div>
      </div>

      <aside className="quiz-side">
        <div className="quiz-side__title">Quiz Progress</div>
        <div className="quiz-side__dots">
          {questions.map((q, i) => (
            <span key={q.id} className={`qdot ${i < index ? 'is-done' : i === index ? 'is-current' : ''}`}>{i + 1}</span>
          ))}
        </div>
      </aside>
    </div>
  )
}
