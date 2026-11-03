<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# LearniX - EduPulse AI OS

Enterprise-grade AI-powered Lecture Intelligence & Personalized Learning SaaS Platform. LearniX turns classroom lectures and recorded sessions into timestamped transcripts, AI study notes, dynamic chapters, grounded RAG Q&A, adaptive quizzes, weak-topic detection, and personalized revision schedules.

---

## 🌟 Key Platform Features

- **Production-Grade Authentication**: Email & password authentication with `bcryptjs` hashing (10 salt rounds), opaque 32-byte session tokens with SHA-256 token hashing at rest, secure HttpOnly cookies, and ambient CSRF protection.
- **Strict Multi-Tenant Isolation**: Zero-state initialization for every new student account (0 lectures, 0 notes, 0 quizzes, 0% accuracy) with server-enforced ownership checks (`WHERE id = $1 AND user_id = $2`) preventing IDOR vulnerabilities.
- **Relational Academic Master-Data & 5-Step Live Wizard**: 10 relational entities (Institutions, Academic Terms, Departments, Programs, Student Enrollments, Teachers, Subjects, Topics) backing a strict 5-step wizard (`Teacher -> Subject -> Topics -> Language -> Title`) that eliminates instructor-subject mismatch errors.
- **Resilient AI Orchestration & 503 Auto-Recovery**: Intelligent AI queue distinguishing 503 UNAVAILABLE, 504 DEADLINE_EXCEEDED, 429 daily quotas, and 400 invalid requests. Transient errors are retried with exponential backoff and jitter without blocking concurrent tasks, while recoverable requests survive in a `RETRY_WAIT` state with deterministic local fallbacks.
- **Centralized API Key Precedence**: Canonical `GEMINI_API_KEY` prioritization over legacy `GOOGLE_API_KEY` with automatic process environment normalization, preventing SDK key conflict warnings.
- **Dual-Database Architecture**: Zero-config local development with SQLite (`better-sqlite3` in WAL mode) and managed cloud production with PostgreSQL (`pg.Pool` connection pooling).
- **Durable Media Storage**: Abstracted storage provider (`IStorageProvider`) supporting local disk storage in development and Amazon S3 / Cloudflare R2 object storage in production.

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
   DB_PROVIDER=sqlite
   STORAGE_PROVIDER=local
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

LearniX includes 10 comprehensive automated verification suites covering database persistence, multi-user concurrency, audio transcription, AI orchestration, production auth, relational master-data, and live lecture wizard state transitions.

Run all test suites:
```bash
npm test
```

Individual test targets:
```bash
npm run test:fixes         # Final bug fixes verification (Key precedence, 503 backoff, DB selection, diagnostics)
npm run test:wizard        # Live Lecture Wizard 5-step state machine & cascading reset verification
npm run test:sqlite        # SQLite schema, persistence, and legacy migration
npm run test:isolation     # Multi-tenant data isolation & zero-state verification
npm run test:transcribe    # Audio chunking, queueing, and deduplication
npm run test:orchestrator  # Centralized AI quota management & fallbacks
npm run test:auth          # Bcrypt hashing, sessions, cookies, and rate limiting
npm run test:master        # Relational teachers, subjects, and topics
npm run test:multilingual  # Native script preservation & language routing
npm run test:quota         # Gemini 429 quota exhaustion & non-blocking recording
```

Run SaaS Multi-User Concurrency Suite:
```bash
npx tsx scripts/test_saas_multiuser_concurrency.ts
```

---

## 📦 Production Build & Deployment

```bash
# Typecheck & Lint
npm run lint

# Build frontend SPA and bundled Node server
npm run build

# Start production server
npm start
```

---

## 🗄️ Database & Cloud Persistence Architecture

### 1. What PostgreSQL is & Why Production Requires It
PostgreSQL is an advanced, open-source object-relational database system known for reliability, robust concurrency, and transactional ACID guarantees. While SQLite writes directly to a single local file (`.data/edupulse.sqlite`), PostgreSQL runs as an independent, networked service capable of handling hundreds of concurrent student sessions with connection pooling (`pg.Pool`), advisory row locks, and multi-version concurrency control (MVCC).

### 2. Where PostgreSQL Data Physically Resides
In production cloud environments such as Render, AWS RDS, or Supabase, PostgreSQL data is physically stored on dedicated, networked block storage (e.g. Render Persistent Disks or AWS EBS) provisioned independently from the web application container. Even if the web application restarts, redeploys, or crashes, the PostgreSQL disk volume remains intact and unaffected.

### 3. How Render Web Service Connects to PostgreSQL
Render provisions the database as a private backend service.
- The web service connects using the internal database connection string:
  ```
  DATABASE_URL=postgresql://learnix_user:password@dpg-xxxxx-a.oregon-postgres.render.com/learnix
  ```
- Because both services reside in the same Render private network region, latency is sub-millisecond, and database traffic does not traverse the public internet.

### 4. How DATABASE_URL is Configured
In the Render Dashboard:
1. Navigate to your Web Service -> **Environment**.
2. Add `DATABASE_URL` and select **Add from database** -> `learnix-postgres` -> **Internal Database URL**.
3. Set `DB_PROVIDER=postgresql`.
4. Set `NODE_ENV=production`.
If `DATABASE_URL` is omitted in production, LearniX fails fast at startup with a descriptive error, preventing silent degradation or accidental in-memory fallback.

### 5. How to Inspect Database Tables
To inspect PostgreSQL tables directly:
```bash
# Connect using psql CLI
psql "postgresql://user:password@host/learnix"

# View all 13 core relational tables
\dt

# Check applied migrations
SELECT * FROM _migrations ORDER BY applied_at DESC;

# Check active users and lecture counts
SELECT id, email, role, created_at FROM users;
SELECT id, title, subject, user_id FROM lectures;
```

### 6. How Audio Files are Stored in Production
Application containers in cloud platforms like Render have ephemeral filesystems. Any local files saved to disk are wiped when the service spins down or redeploys.
- In production, audio chunks and media files are stored in **S3-compatible Object Storage** (AWS S3, Cloudflare R2, or MinIO).
- Configure:
  ```env
  STORAGE_PROVIDER=s3
  S3_BUCKET_NAME=learnix-audio-production
  AWS_REGION=us-east-1
  AWS_ACCESS_KEY_ID=your_key
  AWS_SECRET_ACCESS_KEY=your_secret
  ```
- The application stores unique object keys in PostgreSQL while streaming binary buffers directly to object storage. Downloads are authenticated and scoped to the lecture owner.

### 7. Why Filesystem Persistence & PostgreSQL Persistence are Different
- **Web Service Container Filesystem**: Ephemeral. Every Git deployment or container restart rebuilds the filesystem from scratch.
- **PostgreSQL Database**: Persistent state stored on a persistent volume. All relational tables (users, transcripts, notes, quizzes) survive deployments.
- **S3 Object Storage**: Permanently durable. All audio recordings survive deployments and scale to terabytes of storage.

### 8. Backups & Disaster Recovery
- **PostgreSQL Automated Backups**: Render provides automatic daily backups for paid PostgreSQL instances.
- **Manual Database Backup**:
  ```bash
  pg_dump -Fc --no-acl --no-owner -d "$DATABASE_URL" > learnix_backup.dump
  ```

### 9. How to Restore Data
To restore a database dump:
```bash
pg_restore --verbose --clean --no-acl --no-owner -d "$DATABASE_URL" learnix_backup.dump
```
To migrate existing local SQLite data to production PostgreSQL, run the built-in transactional migrator:
```bash
DATABASE_URL="postgresql://user:pass@host/learnix" npx tsx scripts/migrate_sqlite_to_postgres.ts
```

### 10. Distinguishing SQLite Development Data from PostgreSQL Production Data
| Metric | SQLite (Development) | PostgreSQL (Production) |
| :--- | :--- | :--- |
| **Provider Flag** | `DB_PROVIDER=sqlite` | `DB_PROVIDER=postgresql` |
| **Storage Location** | Local file: `.data/edupulse.sqlite` | Managed cloud volume |
| **Startup Log** | `[DATABASE] Provider: SQLite` | `[DATABASE] Provider: PostgreSQL` |
| **Health API** | `/api/health/ready` -> `{"database": {"provider": "sqlite"}}` | `/api/health/ready` -> `{"database": {"provider": "postgresql"}}` |
| **Concurrency** | Single process (WAL mode) | Multi-process connection pool (`pg.Pool`) |

### 11. Render Plan-Specific Persistence Limitations
> [!NOTE]
> **Render Free Instance Notice**: Render's Free Web Service spins down after 15 minutes of inactivity, and free PostgreSQL databases expire after 30 days unless upgraded. For permanent institutional deployment, deploy on a **Starter or Standard** instance with a persistent PostgreSQL database and S3 storage.

---

## 📋 Production Environment Reference (`.env`)

```env
# Server & Environment
PORT=4242
NODE_ENV=production
APP_BASE_URL=https://learnix.onrender.com

# Database Selection
DB_PROVIDER=postgresql
DATABASE_URL=postgresql://learnix:secret@dpg-xxxxx:5432/learnix
DATABASE_SSL=true

# Security & Sessions
SESSION_SECRET=a8f9c1e74b2d6a5f9e3c8d1a4b7e2f5c9a1d3e7b5c8f2a4d6e9b1c3a7f4e8d2a
ALLOWED_ORIGINS=https://learnix.onrender.com

# Google Gemini Artificial Intelligence
GEMINI_API_KEY=AIzaSy...your_gemini_api_key...
GEMINI_TEXT_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_TEXT_MODEL=gemini-2.5-flash
GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe

# Media Storage (S3 in Production)
STORAGE_PROVIDER=s3
S3_BUCKET_NAME=learnix-audio
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Multi-User Demo Data Toggle
ENABLE_DEMO_ACCOUNT=false
```
