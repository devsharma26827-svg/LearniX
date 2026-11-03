<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# LearniX - EduPulse AI OS

Enterprise-grade AI-powered Lecture Intelligence & Personalized Learning SaaS Platform. LearniX turns classroom lectures and recorded sessions into timestamped transcripts, AI study notes, dynamic chapters, grounded RAG Q&A, adaptive quizzes, weak-topic detection, and personalized revision schedules.

---

## 🌟 Key Platform Features

- **Production-Grade Authentication**: Email & password authentication with `bcryptjs` hashing (10 salt rounds), secure HttpOnly session cookies, brute-force rate-limiting, and account recovery.
- **Strict Multi-Tenant Isolation**: Zero-state initialization for every new student account (0 lectures, 0 notes, 0 quizzes, 0% accuracy) with server-enforced ownership checks on all private resources.
- **Relational Academic Master-Data**: Structured SQLite tables for Teachers, Subjects, Topics, and Teacher-Subject assignments with dynamic cascading selection (Instructor -> Subject -> Topics).
- **Multilingual Live Audio Capture**: Real-time transcription supporting auto-detection, English, Hindi (हिन्दी in authentic Devanagari script), Hinglish, Bengali (বাংলা), Tamil (தமிழ்), and more without forced English translation.
- **Centralized AI Quota Management**: Intelligent AI Orchestration layer with priority queueing, sliding-window RPM/RPD tracking, fallback routing, and deduplication.
- **Permanent SQLite Storage**: High-performance local storage powered by `better-sqlite3` with WAL mode and foreign key constraints.

---

## 🚀 One-Click Run (Windows)

Just **double-click** either:
- **`run.bat`** or **`start.bat`**

The launcher will automatically:
1. Verify Node.js is installed.
2. Install dependencies (`npm install`) if running for the first time.
3. Start the LearniX server on port **`4242`**.
4. Automatically open your default web browser to: **http://localhost:4242**

---

## 🛠 Manual Execution

**Prerequisites:** Node.js (v18+)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure your Gemini API key in [`.env.local`](.env.local) or [`.env`](.env) (see [`.env.example`](.env.example)):
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   PORT=4242
   ENABLE_DEMO_ACCOUNT=true
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   Or run and automatically open the browser:
   ```bash
   npm run dev:open
   ```
4. Open [http://localhost:4242](http://localhost:4242) in your browser.

---

## 🧪 Comprehensive Automated Test Suites

LearniX includes 7 comprehensive automated verification suites covering database persistence, multi-user isolation, audio transcription, AI orchestration, production auth, relational master-data, and multilingual speech processing.

Run all test suites:
```bash
npm test
```

Individual test targets:
```bash
npm run test:sqlite        # SQLite schema, persistence, and legacy migration
npm run test:isolation     # Multi-tenant data isolation & zero-state verification
npm run test:transcribe    # Audio chunking, queueing, and deduplication
npm run test:orchestrator  # Centralized AI quota management & fallbacks
npm run test:auth          # Bcrypt hashing, sessions, cookies, and rate limiting
npm run test:master        # Relational teachers, subjects, and topics
npm run test:multilingual  # Native script preservation & language routing
```

---

## 📦 Production Build & Deployment

```bash
# Typecheck & Lint
npm run lint

# Build frontend and bundled Node server
npm run build

# Start production server
npm start
```

---

## 🗄️ Database Architecture

LearniX stores all application data permanently in SQLite (`.data/edupulse.sqlite`):
- `users`: Student & admin accounts, bcrypt password hashes, notification preferences.
- `sessions`: SHA-256 hashed session tokens, client IPs, user agents, expiration.
- `password_resets`: Secure account recovery tokens.
- `lectures`: Full lecture documents, transcripts, chapters, smart notes, quizzes, attempts, and weak topics.
- `teachers`, `subjects`, `topics`, `teacher_subjects`: Relational academic syllabus structures.
- `transcription_chunks`: Audio hash deduplication store.
