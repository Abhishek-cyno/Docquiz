# Setu Pharma — Doctor Connect Quiz

A mobile-first React app for collecting doctor information via a QR-code funnel:

**QR scan → Landing → Register (name + specialty, auto-mapped category) → Quiz intro → Personalised 3-question quiz (instant green/red feedback, progress bar) → Result → Choose a gift → Book a slot (Cal.com) → Meeting confirmed & data saved.**

Built with Vite + React + Framer Motion. All questions live in JSON (no hardcoding in components).

---

## Run it locally

You need [Node.js](https://nodejs.org) (v18+). Then in this folder:

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

To build for production / hosting:

```bash
npm run build      # output in /dist
npm run preview    # preview the build
```

Host the `/dist` folder free on Netlify, Vercel, or GitHub Pages, then point your QR code at that URL.

---

## Folder structure

```
docquiz/
├─ index.html
├─ package.json
├─ vite.config.js
├─ google-apps-script.gs        # paste into Google Apps Script (Sheet saving)
├─ google-apps-script-data-source.gs  # paste into Apps Script (Sheet as live content source)
├─ public/
│  └─ favicon.svg
└─ src/
   ├─ main.jsx                  # app entry
   ├─ App.jsx                   # step router + page transitions
   ├─ config.js                 # ⚙️ EDIT ME (brand, questions per quiz, Sheet URL)
   ├─ context/
   │  └─ FlowContext.jsx        # funnel state (doctor, questions, score, gift)
   ├─ data/
   │  ├─ specialties.json       # specialty → category mapping
   │  ├─ questions.json         # question bank (10 per specialty set)
   │  └─ gifts.json             # gift options
   ├─ components/
   │  ├─ Stepper.jsx            # named top progress stepper
   │  └─ Illustrations.jsx      # inline SVG artwork
   ├─ pages/
   │  ├─ LandingPage.jsx        # full-screen hero
   │  ├─ RegisterPage.jsx
   │  ├─ QuizIntroPage.jsx      # "ready for a quick quiz?"
   │  ├─ QuizPage.jsx
   │  ├─ CompletePage.jsx       # trophy + score
   │  ├─ GiftPage.jsx
   │  ├─ SchedulePage.jsx       # Cal.com inline embed
   │  └─ ScheduledPage.jsx      # meeting confirmed (saves the response)
   ├─ utils/
   │  ├─ shuffle.js             # random 3-of-10 picker
   │  └─ storage.js             # Sheet + localStorage saving
   └─ styles/
      └─ index.css
```

---

## Configure (src/config.js)

| Setting | What it does |
|---|---|
| `brandName`, `tagline` | Branding text |
| `questionsPerQuiz` | How many questions per doctor (default 3) |
| `sheetEndpoint` | Google Apps Script URL — see below. Empty = save to browser only |
| `dataEndpoint` | Google Apps Script URL for live specialties/questions — see below. Empty = use bundled `src/data/*.json` |
| `calLink` | Your Cal.com event link — the part after `cal.com/`, e.g. `dr-priya/intro-call` |

---

## Save responses to a Google Sheet (free, no backend server)

Browser JavaScript can't write to Google Sheets directly and securely. The standard free way is a **Google Apps Script Web App** — a script hosted on Google, not a server you run.

1. Open `google-apps-script.gs` in this folder and follow the setup steps at the top.
2. Paste the Web App URL into `sheetEndpoint` in `src/config.js`.

Until you do that, every response is still saved in the browser's `localStorage` under `setu_pharma_responses`, so nothing is lost during testing. Each saved row includes the **score**, specialty, category, chosen gift, booked **meeting date & time**, and full answer breakdown.

---

## Drive specialties/questions from a Google Sheet (optional)

By default, specialties/categories and the question bank come from the bundled `src/data/specialties.json` and `src/data/questions.json` — editing them means a code change and redeploy.

To make a **non-developer-editable** Google Sheet the source of truth instead:

1. Open `google-apps-script-data-source.gs` in this folder and follow the setup steps at the top — it walks through creating a new Sheet (**separate from the responses Sheet**) with a `Specialties` tab and a `Questions` tab.
2. Paste the Web App URL into `dataEndpoint` in `src/config.js`.

From then on, every page load fetches the current sheet contents — edit a row in Sheets and the next visitor sees it, no redeploy. If the endpoint is unset, unreachable, or returns something unexpected, the app silently falls back to the bundled JSON so a Sheet problem never takes the funnel down.

---

## The questions

- `src/data/questions.json` (or the `Questions` tab, if `dataEndpoint` is set) holds a `default` set plus per-specialty sets.
- Filled sets: **Cardiologist, Diabetologist, Dermatologist, Pediatrician, Gynecologist, General Physician** (10 each). Any specialty without its own set falls back to `default`.
- Each doctor gets a **random 3** from their set, so two doctors of the same specialty rarely see the same questions.
- To add a specialty set in the bundled JSON: add a key matching the specialty name in `specialties.json`, with an array of `{ id, q, options: [4], answer: <index 0-3> }`. In the Sheet version, just add rows to the `Questions` tab.

> ⚠️ The medical MCQs are reasonable placeholders. Have a qualified clinician review them before you go live — wrong "correct answers" will damage credibility with doctors.

---

## Notes

- Fully responsive (mobile-first — most QR scans happen on phones).
- Scheduling uses the **Cal.com inline embed** (`@calcom/embed-react`) in `SchedulePage.jsx`. Set your event in `config.js` → `calLink`. When a doctor completes a booking, the app captures the chosen date/time (via Cal's `bookingSuccessful` event) and saves it with the response, then advances automatically.
