import { AnimatePresence, motion } from 'framer-motion'
import { useFlow, STEPS } from './context/FlowContext.jsx'
import { CONFIG } from './config.js'
import Stepper from './components/Stepper.jsx'

import LandingPage from './pages/LandingPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import QuizIntroPage from './pages/QuizIntroPage.jsx'
import QuizPage from './pages/QuizPage.jsx'
import CompletePage from './pages/CompletePage.jsx'
import GiftPage from './pages/GiftPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import ScheduledPage from './pages/ScheduledPage.jsx'
import ThankYouPage from './pages/ThankYouPage.jsx'

const variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
}

const screens = {
  [STEPS.LANDING]: LandingPage,
  [STEPS.REGISTER]: RegisterPage,
  [STEPS.QUIZINTRO]: QuizIntroPage,
  [STEPS.QUIZ]: QuizPage,
  [STEPS.COMPLETE]: CompletePage,
  [STEPS.GIFT]: GiftPage,
  [STEPS.SCHEDULE]: SchedulePage,
  [STEPS.SCHEDULED]: ScheduledPage,
  [STEPS.THANKYOU]: ThankYouPage,
}

export default function App() {
  const { step } = useFlow()
  const Screen = screens[step] || LandingPage
  const isLanding = step === STEPS.LANDING

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="brand__name">{CONFIG.brandName.split(' ')[0]}<span> {CONFIG.brandName.split(' ').slice(1).join(' ')}</span></span>
          </div>
        </div>
      </header>

      <main className={`app__main ${isLanding ? 'app__main--bleed' : ''}`}>
        <Stepper step={step} />
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="screen-wrap"
          >
            <Screen />
          </motion.div>
        </AnimatePresence>
      </main>

      {!isLanding && (
        <footer className="app__footer">
          © {new Date().getFullYear()} {CONFIG.brandName}. For registered healthcare professionals.
        </footer>
      )}
    </div>
  )
}
