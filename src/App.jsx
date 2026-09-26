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
import ContactPage from './pages/ContactPage.jsx'
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
  [STEPS.CONTACT]: ContactPage,
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
            <img className="brand__logo" src="/images/eqova-logo.png" alt={CONFIG.brandName} />
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

      <footer className="app__footer">
          {/* <p className="app__footer-copy">
            © {new Date().getFullYear()} {CONFIG.brandName}. For registered healthcare professionals.
          </p> */}
          <div className="powered-by">
            <img className="powered-by__logo" src="/images/cyno-logo.png" alt="Cyno Pharma" />
            <span className="powered-by__text">Powered by <strong>Cyno Pharma</strong></span>
          </div>
      </footer>
    </div>
  )
}
