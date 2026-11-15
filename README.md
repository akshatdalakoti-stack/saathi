# Saathi: care that keeps elders in charge

**Challenge:** Elderly Care & Medication Management Platform

Saathi ("companion") is a shared care platform for an elderly person, their family and their caretakers.
It handles medicines, adherence, doctor visits and proactive email reminders. It is built around one idea from
the brief: **the elder stays at the centre of their own healthcare decisions.**

## What makes it more than a reminder app

| Elderly people think… | So Saathi… |
|---|---|
| "I can't read this well" | puts pictures first: 🍛 for "after lunch", a clock face with hands, pills drawn the way they look and repeated for "2 tablets", 🍽️✅ for "after food", big emoji tiles, and a full-screen ✔ when a dose is done |
| "I can't say *Atorvastatin*" | writes what every medicine is for in brackets, in their language, with a picture: **Atorvastatin (🫀 cholesterol medicine)**, **Metformin (शुगर की दवा)**. Voice reads out "cholesterol medicine, 1 blue tablet", never the hard name |
| "English isn't my language" | runs the elder's screen in **20 languages** (12 Indian, 8 world), with each language name in its own script in the picker. Urdu and Arabic are right-to-left |
| "I'd rather listen than read" | can read everything aloud in all 20 languages (the phone's voice when it has one, Gemini's voice when it doesn't) and understands spoken commands in any of them |
| in routines ("after lunch"), not clock times | labels every dose by the elder's own routine |
| "the small pink one", not "Amlodipine" | draws each pill in its real colour and shape |
| "did I already take it?" | answers that in one tap or by voice, and warns against a double dose |
| "I'm not sure" | lets them say exactly that, instead of guessing, and asks the family to check |
| "it's my body, my decision" | turns family edits into **proposals the elder approves**, lets the elder choose who joins and what each person can do, and logs every change |
| "I don't want to be a bother" | has one Help button that tells everyone, a silent alarm if there's no sign of them by 11 AM, and "I'm okay" with one tap |
| "I forget what to ask the doctor" | keeps a voice/typed question list that prints first on the doctor visit sheet |

### Features against the brief

- **Shared ecosystem, passcode-based access.** Each elder has a Care ID. Family members and caretakers join with the Care ID and a 6-digit circle passcode, then the **elder approves** them as *can see*, *can suggest* or *can manage*. Everyone has a personal PIN, hashed with scrypt. Five wrong guesses locks a login for 5 minutes. The elder gets a big-keypad PIN login that stays signed in on their own phone.
- **View, add, edit and manage medication schedules.** Medicines have routine-based quick times, specific weekdays, food instructions, pill colour and shape, and a "critical" flag. **AI prescription scan** (Gemini) fills the form from a photo of a prescription, and a person reviews every line before saving.
- **Adherence tracking.** Every dose is logged as taken, missed, skipped by choice, or not sure. The app shows a 28-day calendar, a breakdown by time of day, weekend patterns, streaks and plain-language insights.
- **Upcoming doctor appointments.** Visits have a companion ("Ravi is going with you") and a printable **visit sheet**: the elder's questions first, current medicines, adherence since the last visit, missed doses and the days they felt unwell.
- **Proactive email reminders, as an escalation ladder:**
  1. 10 min before: "Your medicines are coming up" (elder)
  2. +30 min: "Did you take them?" with **one-tap buttons** ("Yes", "Remind me later", "I'm not sure") that need no login (elder)
  3. +60 min: "Please check in" (caretaker)
  4. +2 h: marked missed, and the whole family is emailed

  Critical medicines climb twice as fast. Saathi also emails a day before and two hours before each appointment, before medicines run out (based on the pill count), and when the elder feels unwell, presses Help, or goes quiet.
- **Healthcare routines, not just pills.** BP, sugar and weight checks, walks, exercise and water sit in the elder's **"My day"** timeline alongside the medicines. Readings go in on a big number pad. Out-of-range values (for example BP of 140/90 or above, sugar under 70 or 180 and over) email the family straight away, and very high or very low values are marked urgent. The family's **Health readings** page charts 30 days of BP and sugar against the normal range, with a table view.
- **Weekly family summary** every Sunday at 7 PM: medicines taken (and the trend), missed doses, health tasks, average BP and sugar, days unwell, refills due, and the next visit.
- **The elder's own emails are in their language**, the same 20 as the app. Family emails stay in English.
- **"I'll pick it up"** on a refill alert: one person takes it, the rest of the circle is told, and the elder's screen says who is bringing it.
- **Works offline:** the elder's screen opens with no internet (service worker plus a saved copy of the day). "I took it" taps are queued on the phone and sent when the connection returns. A chime and a buzz sound the moment medicines become due.
- **Extras:** an emergency QR card for the fridge (allergies, medicines and contacts, no login needed), family notes the elder can "heart", three text sizes, and the Atkinson Hyperlegible typeface (designed for low vision), with Noto fonts loaded for each Indian script.

### Languages and voice

- **Elder screen languages:** English, हिन्दी, বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, ಕನ್ನಡ, മലയാളം, ਪੰਜਾਬੀ, ଓଡ଼ିଆ, اردو, नेपाली, Español, Français, العربية, Português, 中文, Deutsch and Bahasa Indonesia. The family dashboard stays in English.
- **Translations** are in `client/src/locales/*.json`. They were produced by `scripts/translate.mjs` (Gemini, told to use the everyday words a grandparent uses, like "शुगर की दवा"), and every `{placeholder}` is checked. Edit any file by hand to correct a word, or run `node scripts/translate.mjs ta` to redo one language.
- **What each medicine is for** comes from 21 categories (`shared/categories.js`), each with an emoji and a translated name. The family picks one when adding a medicine. The prescription scanner picks one too, and if nobody does, Saathi guesses from the name (Metformin → sugar).
- **Voice out:** the browser's own voice is used when it has one for the language, otherwise `/api/tts` uses Gemini TTS (about 4 s the first time, then cached on disk). Laptop browsers often have no Tamil, Telugu or Odia voice, which is why the fallback exists.
- **Voice in:** the browser's speech recognition hears the elder's language. English and Hindi phrases are understood on the device, and other languages are understood by Gemini (`/api/elder/voice`).

## Try the demo

Open the app and pick a person under **Live demo**:

| Person | Role | Manual login |
|---|---|---|
| Kamla ji (79) | the elder | Care ID `KAMLA-4821`, PIN `1234` |
| Ravi | son, can manage | `ravi@example.com` / `1111` |
| Priya | home nurse (caretaker) | `priya@example.com` / `2222` |
| Anjali | granddaughter, can only suggest | `anjali@example.com` / `3333` |
| Sunita | daughter-in-law, waiting for Kamla ji to approve | `sunita@example.com` / `4444` |

The circle passcode is `246810`.

**A 3-minute demo script**

1. Open **Kamla ji** on a phone (or a narrow window), and **Ravi** in another window.
2. As Kamla ji, approve Anjali's suggestion under *Your family is asking you*, and let Sunita join. Ravi's activity log shows both.
3. As Ravi, on **Today**, press **Make medicines due now**. This also turns on fast mode, where the escalation steps are 1, 2 and 3 minutes apart.
4. Kamla ji's screen shows the big *Time for your… medicines* card. Tap **I've taken them**, or leave it and watch the ladder climb in **Emails and activity**.
5. Tap the 🌐 globe on Kamla ji's screen and pick தமிழ் or اردو. Everything changes, including "Metformin (சுகர் மாத்திரை)", and **Listen** speaks it.
6. On Kamla ji's screen, tap **Check BP** in "My day" and enter 176 / 104. Ravi's **Today** page and **Health readings** chart flag it, and an email goes out.
7. As Ravi, press **I'll pick it up** on the Metformin alert, then **Send weekly summary**, and open **Emails and activity**.
8. Try **Did I take my medicine?**, **Help**, and **Scan prescription → Use a sample prescription** on the Medicines page.

Demo people use `@example.com` addresses, which are never really emailed. Put your own email in **Care circle → Your details**, or set `DEMO_EMAIL`, to receive the real emails.

## Run it locally

Requires Node.js 22.13 or newer. The app uses Node's built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
cp .env.example .env      # optional: add GEMINI_API_KEY, BREVO_API_KEY...
npm run dev               # API on :3000, web app on http://localhost:5173
```

Production mode (what Render runs):

```bash
npm run build && npm start   # everything on http://localhost:3000
```

`npm run seed` resets the demo family.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` sets everything up.
3. Fill in the secret env vars when asked: `GEMINI_API_KEY`, `BREVO_API_KEY`, `MAIL_FROM` and (optionally) `DEMO_EMAIL`.

Notes on Render's free plan:
- **SMTP is blocked** (ports 25, 465 and 587), so use Brevo: create a free account, verify your sender email, then create an API key. It allows 300 emails a day.
- The disk is temporary: the database resets on each deploy or restart, and the demo family is re-created automatically. Attach a persistent disk (paid plan) and set `DB_PATH` to keep real data.
- Free services sleep after 15 minutes without traffic, and no reminders are sent while asleep. An uptime pinger hitting `/api/health` every 10 minutes keeps it awake.

## How it's built

```
client/  React 19 + Vite + Tailwind 4 (elder screen, family dashboard, visit sheet)
  src/locales/   the elder screen's words in 20 languages
shared/  medicine categories and the language list, used by both client and server
scripts/translate.mjs   regenerates translations with Gemini
server/
  tts.js      Gemini text-to-speech fallback with a file cache
  health.js   health routines, readings, safe-range checks
  i18n.js     the elder's emails in their own language (reads client/src/locales)
  index.js    Express app, serves the API and the built client
  db.js       SQLite schema (node:sqlite) and small query helpers
  auth.js     PIN/passcode hashing (scrypt), sessions, lockout, permissions
  logic.js    doses, routine labels, adherence, insights, proposals and approvals
  engine.js   reminder engine: runs every 20 s, escalation ladder, refills, silent alarm
  notify.js   who gets which email, and the email templates
  mailer.js   Brevo / Resend / SMTP / outbox delivery
  pages.js    one-tap email action pages and the emergency card (no login)
  gemini.js   prescription scan and clash check (questions for the doctor, never advice)
  seed.js     demo family with four weeks of history
```

Saathi is not a substitute for medical advice. AI output is always reviewed by a person, and possible clashes are framed as questions to ask the doctor.
