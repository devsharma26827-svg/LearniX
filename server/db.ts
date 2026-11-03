import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import BetterSqlite3, { type Database as BetterSqlite3Database, type Statement } from "better-sqlite3";
import {
  Lecture,
  User,
  Teacher,
  Subject,
  Topic,
  Institution,
  AcademicTerm,
  Department,
  AcademicProgram,
  StudentEnrollment,
  StudentAcademicContext,
} from "../src/types";
import { IDatabase, DatabaseHealth, UserSession, AdminAuditLog } from "./db/types";
import { SAMPLE_LECTURES, SAMPLE_USERS } from "./sampleData";

const DEFAULT_DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, "edupulse.sqlite");
const DEFAULT_USERS_FILE = path.join(DEFAULT_DATA_DIR, "users.json");

export const DEFAULT_DEMO_PASSWORD = process.env.DEMO_STUDENT_PASSWORD || "DemoStudent@123";

export type TranscriptionJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "RETRY_WAIT"
  | "QUOTA_EXHAUSTED"
  | "FAILED"
  | "CANCELLED";

export interface TranscriptionJob {
  id: string;
  userId: string;
  lectureId: string;
  sequenceNumber: number;
  audioRef: string;
  mimeType: string;
  durationSeconds: number;
  startTime: number;
  endTime: number;
  status: TranscriptionJobStatus;
  attemptCount: number;
  nextRetryAt: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  chunkHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function saveAudioChunkToDisk(
  userId: string,
  lectureId: string,
  sequenceNumber: number,
  audioBuffer: Buffer,
  mimeType = "audio/webm"
): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeLecture = lectureId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" : "webm";
  const dir = path.join(DEFAULT_DATA_DIR, "audio_chunks", safeUser, safeLecture);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filename = `chunk_${String(sequenceNumber).padStart(5, "0")}.${ext}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, audioBuffer);
  return path.join("audio_chunks", safeUser, safeLecture, filename).replace(/\\/g, "/");
}

export function readAudioChunkFromDisk(audioRef: string): Buffer | null {
  try {
    const fullPath = path.isAbsolute(audioRef) ? audioRef : path.join(DEFAULT_DATA_DIR, audioRef);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath);
    }
    return null;
  } catch (e) {
    console.error("[Database] Failed to read audio chunk from disk:", e);
    return null;
  }
}

export function deleteLectureAudioChunks(userId: string, lectureId: string): void {
  try {
    const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeLecture = lectureId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dir = path.join(DEFAULT_DATA_DIR, "audio_chunks", safeUser, safeLecture);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("[Database] Failed to delete audio chunks folder:", e);
  }
}

export function getDatabasePath(): string {
  const envPath = process.env.SQLITE_DB_PATH?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return DEFAULT_DB_PATH;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class Database implements IDatabase {
  private sqlite: BetterSqlite3Database;
  private dbPath: string;
  private usersFile: string;

  // Prepared statements for Users
  private stmtGetUsers!: Statement;
  private stmtGetUserById!: Statement;
  private stmtGetUserByEmail!: Statement;
  private stmtGetUserAuthByEmail!: Statement;
  private stmtUpsertUser!: Statement;
  private stmtInsertIgnoreUser!: Statement;
  private stmtUpdateUserPassword!: Statement;
  private stmtDeleteUser!: Statement;
  private stmtDeleteUserLectures!: Statement;

  // Prepared statements for Sessions
  private stmtInsertSession!: Statement;
  private stmtGetSessionByHash!: Statement;
  private stmtDeleteSessionByHash!: Statement;
  private stmtDeleteSessionsByUser!: Statement;
  private stmtUpdateSessionActivity!: Statement;
  private stmtRevokeSessionByHash!: Statement;
  private stmtRevokeSessionsByUser!: Statement;

  // Prepared statements for Password Resets
  private stmtInsertPasswordReset!: Statement;
  private stmtGetPasswordResetByHash!: Statement;
  private stmtMarkPasswordResetUsed!: Statement;

  // Prepared statements for Master Data: Institutions, Terms, Departments, Programs
  private stmtGetActiveInstitutions!: Statement;
  private stmtGetAllInstitutions!: Statement;
  private stmtGetInstitutionById!: Statement;
  private stmtInsertInstitution!: Statement;

  private stmtGetActiveAcademicTerms!: Statement;
  private stmtGetAllAcademicTerms!: Statement;
  private stmtInsertAcademicTerm!: Statement;

  private stmtGetActiveDepartments!: Statement;
  private stmtGetAllDepartments!: Statement;
  private stmtInsertDepartment!: Statement;

  private stmtGetActiveAcademicPrograms!: Statement;
  private stmtGetActiveAcademicProgramsByDept!: Statement;
  private stmtInsertAcademicProgram!: Statement;

  private stmtGetStudentEnrollment!: Statement;
  private stmtUpsertStudentEnrollment!: Statement;
  private stmtInsertStudentSubject!: Statement;
  private stmtGetStudentSubjects!: Statement;

  private stmtInsertAdminAuditLog!: Statement;
  private stmtGetAdminAuditLogs!: Statement;

  // Prepared statements for Master Data
  private stmtGetActiveTeachers!: Statement;
  private stmtGetAllTeachers!: Statement;
  private stmtGetTeacherById!: Statement;
  private stmtInsertTeacher!: Statement;
  private stmtUpdateTeacher!: Statement;
  private stmtDeleteTeacher!: Statement;

  private stmtGetActiveSubjects!: Statement;
  private stmtGetAllSubjects!: Statement;
  private stmtGetSubjectsByTeacher!: Statement;
  private stmtGetSubjectById!: Statement;
  private stmtInsertSubject!: Statement;
  private stmtUpdateSubject!: Statement;
  private stmtDeleteSubject!: Statement;

  private stmtGetActiveTopicsBySubject!: Statement;
  private stmtGetAllTopicsBySubject!: Statement;
  private stmtGetTopicById!: Statement;
  private stmtInsertTopic!: Statement;
  private stmtUpdateTopic!: Statement;
  private stmtDeleteTopic!: Statement;

  private stmtInsertTeacherSubject!: Statement;
  private stmtDeleteTeacherSubject!: Statement;
  private stmtGetTeacherSubjectIds!: Statement;

  // Prepared statements for Lectures
  private stmtGetLecturesAll!: Statement;
  private stmtGetLecturesForUser!: Statement;
  private stmtGetLectureById!: Statement;
  private stmtUpsertLecture!: Statement;
  private stmtInsertIgnoreLecture!: Statement;
  private stmtDeleteLecture!: Statement;
  private stmtDeleteAllLectures!: Statement;

  // Prepared statements for Chunk Tracking
  private stmtInsertChunkRecord!: Statement;
  private stmtGetChunkRecord!: Statement;

  // Prepared statements for Transcription Jobs
  private stmtInsertTranscriptionJob!: Statement;
  private stmtGetTranscriptionJobById!: Statement;
  private stmtGetTranscriptionJobsByLecture!: Statement;
  private stmtGetPendingJobs!: Statement;
  private stmtGetPendingJobCountForLecture!: Statement;
  private stmtUpdateJobStatus!: Statement;
  private stmtRecoverInterruptedJobs!: Statement;
  private stmtResetJobsForLecture!: Statement;
  private stmtDeleteLectureJobs!: Statement;

  constructor(customPath?: string, customUsersFile?: string) {
    this.dbPath = customPath || getDatabasePath();
    this.usersFile = customUsersFile || DEFAULT_USERS_FILE;

    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
      } catch (err) {
        console.error(`[Database Error] Could not create database directory at ${dbDir}:`, err);
        throw err;
      }
    }

    try {
      this.sqlite = new BetterSqlite3(this.dbPath, {
        timeout: 5000,
      });

      // Configure SQLite engine settings
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.pragma("foreign_keys = ON");
      this.sqlite.pragma("busy_timeout = 5000");
      this.sqlite.pragma("synchronous = NORMAL");
    } catch (err) {
      console.error(`[Database Fatal Error] Failed to connect to SQLite at ${this.dbPath}:`, err);
      throw err;
    }

    this.runMigrations();
    this.prepareStatements();
    this.recoverInterruptedJobs();
    this.seedMissingSamples();
    this.seedMasterDataIfEmpty();
    this.migrateLegacyUsers();
  }

  private runMigrations(): void {
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      // Migration 1: Base Core Tables
      this.applyMigration("001_core_tables", () => {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL COLLATE NOCASE,
            name TEXT NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'student',
            is_verified INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT,
            data_json TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);

          CREATE TABLE IF NOT EXISTS lectures (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            created_by TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            date TEXT,
            created_at TEXT,
            data_json TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_lectures_created_by ON lectures(created_by);
          CREATE INDEX IF NOT EXISTS idx_lectures_source ON lectures(source);
          CREATE INDEX IF NOT EXISTS idx_lectures_status ON lectures(status);
        `);
      });

      // Migration 2: Upgrade Users & Lectures columns if already existing
      this.applyMigration("002_upgrade_user_columns", () => {
        const userCols = (this.sqlite.pragma("table_info(users)") as any[]).map((c) => c.name);
        if (!userCols.includes("password_hash")) {
          this.sqlite.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
        }
        if (!userCols.includes("role")) {
          this.sqlite.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'");
        }
        if (!userCols.includes("is_verified")) {
          this.sqlite.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 1");
        }
        if (!userCols.includes("status")) {
          this.sqlite.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
        }
        if (!userCols.includes("created_at")) {
          this.sqlite.exec(`ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT '${new Date().toISOString()}'`);
        }

        const lectureCols = (this.sqlite.pragma("table_info(lectures)") as any[]).map((c) => c.name);
        if (!lectureCols.includes("teacher_id")) {
          this.sqlite.exec("ALTER TABLE lectures ADD COLUMN teacher_id TEXT");
        }
        if (!lectureCols.includes("subject_id")) {
          this.sqlite.exec("ALTER TABLE lectures ADD COLUMN subject_id TEXT");
        }
        if (!lectureCols.includes("language")) {
          this.sqlite.exec("ALTER TABLE lectures ADD COLUMN language TEXT");
        }
      });

      // Migration 3: Sessions & Auth Tokens
      this.applyMigration("003_auth_sessions_tokens", () => {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            user_agent TEXT,
            ip_address TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
          CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

          CREATE TABLE IF NOT EXISTS password_resets (
            id TEXT PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

          CREATE TABLE IF NOT EXISTS email_verifications (
            id TEXT PRIMARY KEY,
            token_hash TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
      });

      // Migration 4: Relational Master Data
      this.applyMigration("004_master_data_tables", () => {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS teachers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            department TEXT NOT NULL,
            designation TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS subjects (
            id TEXT PRIMARY KEY,
            subject_code TEXT UNIQUE NOT NULL,
            subject_name TEXT NOT NULL,
            description TEXT,
            semester TEXT,
            department TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS topics (
            id TEXT PRIMARY KEY,
            subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            topic_name TEXT NOT NULL,
            description TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS teacher_subjects (
            id TEXT PRIMARY KEY,
            teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
            subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            UNIQUE(teacher_id, subject_id)
          );

          CREATE INDEX IF NOT EXISTS idx_topics_subject_id ON topics(subject_id);
          CREATE INDEX IF NOT EXISTS idx_teacher_subjects_teacher ON teacher_subjects(teacher_id);
          CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject ON teacher_subjects(subject_id);
        `);
      });

      // Migration 5: Transcription Chunks
      this.applyMigration("005_transcription_chunks", () => {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS transcription_chunks (
            id TEXT PRIMARY KEY,
            lecture_id TEXT NOT NULL,
            sequence_number INTEGER NOT NULL,
            chunk_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at TEXT NOT NULL,
            UNIQUE(lecture_id, sequence_number)
          );

          CREATE INDEX IF NOT EXISTS idx_chunks_lecture ON transcription_chunks(lecture_id);
        `);
      });

      // Migration 6: Persistent Transcription Jobs Queue
      this.applyMigration("006_transcription_jobs", () => {
        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS transcription_jobs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            lecture_id TEXT NOT NULL,
            sequence_number INTEGER NOT NULL,
            audio_ref TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            duration_seconds REAL DEFAULT 0,
            start_time REAL DEFAULT 0,
            end_time REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER DEFAULT 0,
            last_error_code TEXT,
            last_error_message TEXT,
            chunk_hash TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(lecture_id, sequence_number)
          );

          CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user ON transcription_jobs(user_id);
          CREATE INDEX IF NOT EXISTS idx_transcription_jobs_lecture ON transcription_jobs(lecture_id);
          CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON transcription_jobs(status);
          CREATE INDEX IF NOT EXISTS idx_transcription_jobs_pending ON transcription_jobs(status, next_retry_at);
        `);
      });

      // Migration 7: Academic Hierarchy, Enrollments & Audit Logs
      this.applyMigration("007_academic_hierarchy_and_enrollments", () => {
        // Upgrade sessions table if columns missing
        const sessionCols = (this.sqlite.pragma("table_info(sessions)") as any[]).map((c) => c.name);
        if (!sessionCols.includes("last_activity_at")) {
          this.sqlite.exec("ALTER TABLE sessions ADD COLUMN last_activity_at TEXT");
        }
        if (!sessionCols.includes("revoked_at")) {
          this.sqlite.exec("ALTER TABLE sessions ADD COLUMN revoked_at TEXT");
        }

        this.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS institutions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            code TEXT UNIQUE NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS academic_terms (
            id TEXT PRIMARY KEY,
            institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(institution_id, code)
          );

          CREATE TABLE IF NOT EXISTS departments (
            id TEXT PRIMARY KEY,
            institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(institution_id, code)
          );

          CREATE TABLE IF NOT EXISTS academic_programs (
            id TEXT PRIMARY KEY,
            institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
            department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            code TEXT NOT NULL,
            degree_type TEXT NOT NULL DEFAULT 'bachelors',
            total_semesters INTEGER NOT NULL DEFAULT 8,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(institution_id, code)
          );

          CREATE TABLE IF NOT EXISTS student_enrollments (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
            term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
            program_id TEXT NOT NULL REFERENCES academic_programs(id) ON DELETE CASCADE,
            semester TEXT NOT NULL DEFAULT 'Semester 1',
            roll_number TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(student_id, term_id)
          );

          CREATE TABLE IF NOT EXISTS student_subjects (
            student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            enrollment_id TEXT REFERENCES student_enrollments(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY(student_id, subject_id)
          );

          CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id TEXT PRIMARY KEY,
            admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            details_json TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_student_enrollments_student ON student_enrollments(student_id);
          CREATE INDEX IF NOT EXISTS idx_student_subjects_student ON student_subjects(student_id);
          CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at);
        `);
      });
    } catch (err) {
      console.error("[Database Error] Migration failure:", err);
      throw err;
    }
  }

  private applyMigration(id: string, action: () => void) {
    const existing = this.sqlite.prepare("SELECT id FROM _migrations WHERE id = ?").get(id);
    if (existing) return;

    const tx = this.sqlite.transaction(() => {
      action();
      this.sqlite.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, new Date().toISOString());
    });
    tx();
  }

  private prepareStatements(): void {
    try {
      // User statements
      this.stmtGetUsers = this.sqlite.prepare("SELECT data_json, role, is_verified, status FROM users");
      this.stmtGetUserById = this.sqlite.prepare("SELECT data_json, role, is_verified, status, password_hash FROM users WHERE id = ?");
      this.stmtGetUserByEmail = this.sqlite.prepare("SELECT data_json, role, is_verified, status, password_hash FROM users WHERE email = ? COLLATE NOCASE LIMIT 1");
      this.stmtGetUserAuthByEmail = this.sqlite.prepare("SELECT id, email, password_hash, role, is_verified, status, data_json FROM users WHERE email = ? COLLATE NOCASE LIMIT 1");

      this.stmtUpsertUser = this.sqlite.prepare(`
        INSERT INTO users (id, email, name, password_hash, role, is_verified, status, created_at, updated_at, data_json)
        VALUES (@id, @email, @name, @password_hash, @role, @is_verified, @status, @created_at, @updated_at, @data_json)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          password_hash = COALESCE(excluded.password_hash, users.password_hash),
          role = excluded.role,
          is_verified = excluded.is_verified,
          status = excluded.status,
          updated_at = excluded.updated_at,
          data_json = excluded.data_json
      `);

      this.stmtInsertIgnoreUser = this.sqlite.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, password_hash, role, is_verified, status, created_at, updated_at, data_json)
        VALUES (@id, @email, @name, @password_hash, @role, @is_verified, @status, @created_at, @updated_at, @data_json)
      `);

      this.stmtUpdateUserPassword = this.sqlite.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?");
      this.stmtDeleteUser = this.sqlite.prepare("DELETE FROM users WHERE id = ?");
      this.stmtDeleteUserLectures = this.sqlite.prepare("DELETE FROM lectures WHERE created_by = ?");

      // Sessions
      this.stmtInsertSession = this.sqlite.prepare(`
        INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_activity_at, revoked_at, user_agent, ip_address)
        VALUES (@id, @token_hash, @user_id, @expires_at, @created_at, @last_activity_at, @revoked_at, @user_agent, @ip_address)
      `);
      this.stmtGetSessionByHash = this.sqlite.prepare("SELECT * FROM sessions WHERE token_hash = ? AND (revoked_at IS NULL) AND expires_at > datetime('now')");
      this.stmtDeleteSessionByHash = this.sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?");
      this.stmtDeleteSessionsByUser = this.sqlite.prepare("DELETE FROM sessions WHERE user_id = ?");
      this.stmtUpdateSessionActivity = this.sqlite.prepare("UPDATE sessions SET last_activity_at = ? WHERE id = ?");
      this.stmtRevokeSessionByHash = this.sqlite.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?");
      this.stmtRevokeSessionsByUser = this.sqlite.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL");

      // Password resets
      this.stmtInsertPasswordReset = this.sqlite.prepare(`
        INSERT INTO password_resets (id, token_hash, user_id, expires_at, created_at)
        VALUES (@id, @token_hash, @user_id, @expires_at, @created_at)
      `);
      this.stmtGetPasswordResetByHash = this.sqlite.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')");
      this.stmtMarkPasswordResetUsed = this.sqlite.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?");

      // Master Data Statements
      this.stmtGetActiveTeachers = this.sqlite.prepare("SELECT * FROM teachers WHERE is_active = 1 ORDER BY name ASC");
      this.stmtGetAllTeachers = this.sqlite.prepare("SELECT * FROM teachers ORDER BY name ASC");
      this.stmtGetTeacherById = this.sqlite.prepare("SELECT * FROM teachers WHERE id = ?");
      this.stmtInsertTeacher = this.sqlite.prepare(`
        INSERT INTO teachers (id, name, email, department, designation, is_active, created_at, updated_at)
        VALUES (@id, @name, @email, @department, @designation, @is_active, @created_at, @updated_at)
      `);
      this.stmtUpdateTeacher = this.sqlite.prepare(`
        UPDATE teachers SET name = @name, email = @email, department = @department,
          designation = @designation, is_active = @is_active, updated_at = @updated_at
        WHERE id = @id
      `);
      this.stmtDeleteTeacher = this.sqlite.prepare("DELETE FROM teachers WHERE id = ?");

      this.stmtGetActiveSubjects = this.sqlite.prepare("SELECT * FROM subjects WHERE is_active = 1 ORDER BY sort_order ASC, subject_name ASC");
      this.stmtGetAllSubjects = this.sqlite.prepare("SELECT * FROM subjects ORDER BY sort_order ASC, subject_name ASC");
      this.stmtGetSubjectsByTeacher = this.sqlite.prepare(`
        SELECT s.* FROM subjects s
        JOIN teacher_subjects ts ON s.id = ts.subject_id
        WHERE ts.teacher_id = ? AND s.is_active = 1
        ORDER BY s.sort_order ASC, s.subject_name ASC
      `);
      this.stmtGetSubjectById = this.sqlite.prepare("SELECT * FROM subjects WHERE id = ?");
      this.stmtInsertSubject = this.sqlite.prepare(`
        INSERT INTO subjects (id, subject_code, subject_name, description, semester, department, is_active, sort_order, created_at, updated_at)
        VALUES (@id, @subject_code, @subject_name, @description, @semester, @department, @is_active, @sort_order, @created_at, @updated_at)
      `);
      this.stmtUpdateSubject = this.sqlite.prepare(`
        UPDATE subjects SET subject_code = @subject_code, subject_name = @subject_name,
          description = @description, semester = @semester, department = @department,
          is_active = @is_active, sort_order = @sort_order, updated_at = @updated_at
        WHERE id = @id
      `);
      this.stmtDeleteSubject = this.sqlite.prepare("DELETE FROM subjects WHERE id = ?");

      this.stmtGetActiveTopicsBySubject = this.sqlite.prepare("SELECT * FROM topics WHERE subject_id = ? AND is_active = 1 ORDER BY sort_order ASC, topic_name ASC");
      this.stmtGetAllTopicsBySubject = this.sqlite.prepare("SELECT * FROM topics WHERE subject_id = ? ORDER BY sort_order ASC, topic_name ASC");
      this.stmtGetTopicById = this.sqlite.prepare("SELECT * FROM topics WHERE id = ?");
      this.stmtInsertTopic = this.sqlite.prepare(`
        INSERT INTO topics (id, subject_id, topic_name, description, sort_order, is_active, created_at, updated_at)
        VALUES (@id, @subject_id, @topic_name, @description, @sort_order, @is_active, @created_at, @updated_at)
      `);
      this.stmtUpdateTopic = this.sqlite.prepare(`
        UPDATE topics SET topic_name = @topic_name, description = @description,
          sort_order = @sort_order, is_active = @is_active, updated_at = @updated_at
        WHERE id = @id
      `);
      this.stmtDeleteTopic = this.sqlite.prepare("DELETE FROM topics WHERE id = ?");

      this.stmtInsertTeacherSubject = this.sqlite.prepare(`
        INSERT OR IGNORE INTO teacher_subjects (id, teacher_id, subject_id, created_at)
        VALUES (@id, @teacher_id, @subject_id, @created_at)
      `);
      this.stmtDeleteTeacherSubject = this.sqlite.prepare("DELETE FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?");
      this.stmtGetTeacherSubjectIds = this.sqlite.prepare("SELECT subject_id FROM teacher_subjects WHERE teacher_id = ?");

      // Lectures
      this.stmtGetLecturesAll = this.sqlite.prepare("SELECT data_json FROM lectures");
      this.stmtGetLecturesForUser = this.sqlite.prepare("SELECT data_json FROM lectures WHERE created_by = ?");
      this.stmtGetLectureById = this.sqlite.prepare("SELECT data_json FROM lectures WHERE id = ?");

      this.stmtUpsertLecture = this.sqlite.prepare(`
        INSERT INTO lectures (id, title, subject, created_by, source, status, date, created_at, data_json, teacher_id, subject_id, language)
        VALUES (@id, @title, @subject, @created_by, @source, @status, @date, @created_at, @data_json, @teacher_id, @subject_id, @language)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          subject = excluded.subject,
          created_by = excluded.created_by,
          source = excluded.source,
          status = excluded.status,
          date = excluded.date,
          created_at = excluded.created_at,
          data_json = excluded.data_json,
          teacher_id = excluded.teacher_id,
          subject_id = excluded.subject_id,
          language = excluded.language
      `);

      this.stmtInsertIgnoreLecture = this.sqlite.prepare(`
        INSERT OR IGNORE INTO lectures (id, title, subject, created_by, source, status, date, created_at, data_json, teacher_id, subject_id, language)
        VALUES (@id, @title, @subject, @created_by, @source, @status, @date, @created_at, @data_json, @teacher_id, @subject_id, @language)
      `);

      this.stmtDeleteLecture = this.sqlite.prepare("DELETE FROM lectures WHERE id = ?");
      this.stmtDeleteAllLectures = this.sqlite.prepare("DELETE FROM lectures");

      // Chunks
      this.stmtInsertChunkRecord = this.sqlite.prepare(`
        INSERT OR IGNORE INTO transcription_chunks (id, lecture_id, sequence_number, chunk_hash, status, created_at)
        VALUES (@id, @lecture_id, @sequence_number, @chunk_hash, @status, @created_at)
      `);
      this.stmtGetChunkRecord = this.sqlite.prepare("SELECT * FROM transcription_chunks WHERE lecture_id = ? AND sequence_number = ?");

      // Transcription Jobs
      this.stmtInsertTranscriptionJob = this.sqlite.prepare(`
        INSERT INTO transcription_jobs (
          id, user_id, lecture_id, sequence_number, audio_ref, mime_type,
          duration_seconds, start_time, end_time, status, attempt_count,
          next_retry_at, last_error_code, last_error_message, chunk_hash,
          created_at, updated_at
        ) VALUES (
          @id, @user_id, @lecture_id, @sequence_number, @audio_ref, @mime_type,
          @duration_seconds, @start_time, @end_time, @status, @attempt_count,
          @next_retry_at, @last_error_code, @last_error_message, @chunk_hash,
          @created_at, @updated_at
        )
        ON CONFLICT(lecture_id, sequence_number) DO UPDATE SET
          audio_ref = excluded.audio_ref,
          mime_type = excluded.mime_type,
          chunk_hash = excluded.chunk_hash,
          status = CASE WHEN transcription_jobs.status = 'COMPLETED' THEN 'COMPLETED' ELSE excluded.status END,
          updated_at = excluded.updated_at
      `);

      this.stmtGetTranscriptionJobById = this.sqlite.prepare(
        "SELECT * FROM transcription_jobs WHERE id = ?"
      );

      this.stmtGetTranscriptionJobsByLecture = this.sqlite.prepare(
        "SELECT * FROM transcription_jobs WHERE lecture_id = ? AND user_id = ? ORDER BY sequence_number ASC"
      );

      this.stmtGetPendingJobs = this.sqlite.prepare(
        "SELECT * FROM transcription_jobs WHERE status IN ('PENDING', 'RETRY_WAIT') AND next_retry_at <= ? ORDER BY sequence_number ASC LIMIT ?"
      );

      this.stmtGetPendingJobCountForLecture = this.sqlite.prepare(
        "SELECT COUNT(*) as count FROM transcription_jobs WHERE lecture_id = ? AND user_id = ? AND status IN ('PENDING', 'RETRY_WAIT', 'PROCESSING', 'QUOTA_EXHAUSTED')"
      );

      this.stmtUpdateJobStatus = this.sqlite.prepare(`
        UPDATE transcription_jobs SET
          status = @status,
          attempt_count = @attempt_count,
          next_retry_at = @next_retry_at,
          last_error_code = @last_error_code,
          last_error_message = @last_error_message,
          updated_at = @updated_at
        WHERE id = @id
      `);

      this.stmtRecoverInterruptedJobs = this.sqlite.prepare(
        "UPDATE transcription_jobs SET status = 'RETRY_WAIT', updated_at = ? WHERE status = 'PROCESSING'"
      );

      this.stmtResetJobsForLecture = this.sqlite.prepare(
        "UPDATE transcription_jobs SET status = 'PENDING', attempt_count = 0, next_retry_at = 0, updated_at = ? WHERE lecture_id = ? AND user_id = ? AND status IN ('QUOTA_EXHAUSTED', 'FAILED', 'RETRY_WAIT')"
      );

      this.stmtDeleteLectureJobs = this.sqlite.prepare(
        "DELETE FROM transcription_jobs WHERE lecture_id = ?"
      );

      // Academic Hierarchy Statements
      this.stmtGetActiveInstitutions = this.sqlite.prepare("SELECT * FROM institutions WHERE is_active = 1 ORDER BY name ASC");
      this.stmtGetAllInstitutions = this.sqlite.prepare("SELECT * FROM institutions ORDER BY name ASC");
      this.stmtGetInstitutionById = this.sqlite.prepare("SELECT * FROM institutions WHERE id = ?");
      this.stmtInsertInstitution = this.sqlite.prepare(`
        INSERT INTO institutions (id, name, code, is_active, created_at, updated_at)
        VALUES (@id, @name, @code, @is_active, @created_at, @updated_at)
      `);

      this.stmtGetActiveAcademicTerms = this.sqlite.prepare("SELECT * FROM academic_terms WHERE institution_id = ? AND is_active = 1 ORDER BY created_at DESC");
      this.stmtGetAllAcademicTerms = this.sqlite.prepare("SELECT * FROM academic_terms WHERE institution_id = ? ORDER BY created_at DESC");
      this.stmtInsertAcademicTerm = this.sqlite.prepare(`
        INSERT INTO academic_terms (id, institution_id, name, code, start_date, end_date, is_active, created_at, updated_at)
        VALUES (@id, @institution_id, @name, @code, @start_date, @end_date, @is_active, @created_at, @updated_at)
      `);

      this.stmtGetActiveDepartments = this.sqlite.prepare("SELECT * FROM departments WHERE institution_id = ? AND is_active = 1 ORDER BY name ASC");
      this.stmtGetAllDepartments = this.sqlite.prepare("SELECT * FROM departments WHERE institution_id = ? ORDER BY name ASC");
      this.stmtInsertDepartment = this.sqlite.prepare(`
        INSERT INTO departments (id, institution_id, name, code, is_active, created_at, updated_at)
        VALUES (@id, @institution_id, @name, @code, @is_active, @created_at, @updated_at)
      `);

      this.stmtGetActiveAcademicPrograms = this.sqlite.prepare("SELECT * FROM academic_programs WHERE institution_id = ? AND is_active = 1 ORDER BY name ASC");
      this.stmtGetActiveAcademicProgramsByDept = this.sqlite.prepare("SELECT * FROM academic_programs WHERE institution_id = ? AND department_id = ? AND is_active = 1 ORDER BY name ASC");
      this.stmtInsertAcademicProgram = this.sqlite.prepare(`
        INSERT INTO academic_programs (id, institution_id, department_id, name, code, degree_type, total_semesters, is_active, created_at, updated_at)
        VALUES (@id, @institution_id, @department_id, @name, @code, @degree_type, @total_semesters, @is_active, @created_at, @updated_at)
      `);

      this.stmtGetStudentEnrollment = this.sqlite.prepare(`
        SELECT e.*, i.name as institution_name, i.code as institution_code,
               t.name as term_name, t.code as term_code,
               p.name as program_name, p.code as program_code
        FROM student_enrollments e
        LEFT JOIN institutions i ON e.institution_id = i.id
        LEFT JOIN academic_terms t ON e.term_id = t.id
        LEFT JOIN academic_programs p ON e.program_id = p.id
        WHERE e.student_id = ? AND e.status = 'active'
        ORDER BY e.created_at DESC
        LIMIT 1
      `);
      this.stmtUpsertStudentEnrollment = this.sqlite.prepare(`
        INSERT INTO student_enrollments (id, student_id, institution_id, term_id, program_id, semester, status, created_at, updated_at)
        VALUES (@id, @student_id, @institution_id, @term_id, @program_id, @semester, @status, @created_at, @updated_at)
        ON CONFLICT(student_id, term_id) DO UPDATE SET
          institution_id = excluded.institution_id,
          program_id = excluded.program_id,
          semester = excluded.semester,
          updated_at = excluded.updated_at
      `);
      this.stmtInsertStudentSubject = this.sqlite.prepare(`
        INSERT OR IGNORE INTO student_subjects (student_id, subject_id, enrollment_id, created_at)
        VALUES (?, ?, ?, ?)
      `);
      this.stmtGetStudentSubjects = this.sqlite.prepare(`
        SELECT s.* FROM subjects s
        JOIN student_subjects ss ON s.id = ss.subject_id
        WHERE ss.student_id = ? AND s.is_active = 1
        ORDER BY s.subject_name ASC
      `);

      this.stmtInsertAdminAuditLog = this.sqlite.prepare(`
        INSERT INTO admin_audit_logs (id, admin_id, action, entity_type, entity_id, details_json, created_at)
        VALUES (@id, @admin_id, @action, @entity_type, @entity_id, @details_json, @created_at)
      `);
      this.stmtGetAdminAuditLogs = this.sqlite.prepare("SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?");
    } catch (err) {
      console.error("[Database Error] Failed to prepare SQL statements:", err);
      throw err;
    }
  }

  private seedMasterDataIfEmpty(): void {
    const now = new Date().toISOString();

    const teacherCount = (this.sqlite.prepare("SELECT COUNT(*) as count FROM teachers").get() as { count: number })?.count || 0;
    if (teacherCount === 0) {
      console.log("[Master Data] Seeding relational teachers, subjects, and topics...");
      const seedTeachersTx = this.sqlite.transaction(() => {
        // 1. Teachers
        const teachers = [
          { id: "teacher-jenkins", name: "Prof. Sarah Jenkins", email: "s.jenkins@learnix.edu", department: "Computer Science", designation: "Associate Professor" },
          { id: "teacher-chen", name: "Prof. Marcus Chen", email: "m.chen@learnix.edu", department: "Computer Systems & Networks", designation: "Professor" },
          { id: "teacher-peterson", name: "Dr. Alan Peterson", email: "a.peterson@learnix.edu", department: "Computer Science", designation: "Assistant Professor" },
          { id: "teacher-sharma", name: "Dr. Priya Sharma", email: "p.sharma@learnix.edu", department: "Artificial Intelligence", designation: "Assistant Professor" },
        ];

        for (const t of teachers) {
          this.stmtInsertTeacher.run({
            ...t,
            is_active: 1,
            created_at: now,
            updated_at: now,
          });
        }

        // 2. Subjects
        const subjects = [
          { id: "subj-dsa", subject_code: "CS-201", subject_name: "Data Structures & Algorithms", description: "Foundational abstract data types, linear structures, trees and graphs.", semester: "Semester 3", department: "Computer Science", sort_order: 1 },
          { id: "subj-os", subject_code: "CS-301", subject_name: "Operating Systems & Virtual Memory", description: "Kernel design, memory virtualization, paging, and process scheduling.", semester: "Semester 5", department: "Computer Science", sort_order: 2 },
          { id: "subj-net", subject_code: "CS-401", subject_name: "Computer Networks & Protocols", description: "TCP/IP architecture, socket protocols, sliding windows, and congestion.", semester: "Semester 5", department: "Computer Systems & Networks", sort_order: 3 },
          { id: "subj-ai", subject_code: "CS-501", subject_name: "Artificial Intelligence & Machine Learning", description: "Search heuristics, neural representations, and natural language models.", semester: "Semester 7", department: "Artificial Intelligence", sort_order: 4 },
        ];

        for (const s of subjects) {
          this.stmtInsertSubject.run({
            ...s,
            is_active: 1,
            created_at: now,
            updated_at: now,
          });
        }

        // 3. Topics (9 per subject = 36 total)
        const topics = [
          // DSA
          { id: "top-dsa-1", subject_id: "subj-dsa", topic_name: "Stack Basics & LIFO Architecture", description: "LIFO protocol, stack pointer, and memory layout.", sort_order: 1 },
          { id: "top-dsa-2", subject_id: "subj-dsa", topic_name: "Push & Pop Pointer Operations & Boundary Guards", description: "Constant-time O(1) insertion, retrieval, and boundary guards.", sort_order: 2 },
          { id: "top-dsa-3", subject_id: "subj-dsa", topic_name: "Queue Mechanics & Circular Buffer Implementations", description: "Dual-pointer enqueue and dequeue implementations, circular array buffers.", sort_order: 3 },
          { id: "top-dsa-4", subject_id: "subj-dsa", topic_name: "Binary Search Trees & Recursive Traversals", description: "In-order, pre-order, and post-order tree visitations, BST search property.", sort_order: 4 },
          { id: "top-dsa-5", subject_id: "subj-dsa", topic_name: "Hash Tables, Open Addressing & Collision Resolution", description: "Hash functions, separate chaining, linear probing, and load factor thresholding.", sort_order: 5 },
          { id: "top-dsa-6", subject_id: "subj-dsa", topic_name: "Graph Representations: Adjacency Matrix & Lists", description: "Directed vs undirected graphs, edge weights, space-time tradeoffs.", sort_order: 6 },
          { id: "top-dsa-7", subject_id: "subj-dsa", topic_name: "Graph Traversals: Breadth-First & Depth-First Search", description: "Queue-driven BFS, recursion/stack DFS, cycle detection and connectivity.", sort_order: 7 },
          { id: "top-dsa-8", subject_id: "subj-dsa", topic_name: "Dynamic Programming: Memoization & Tabulation", description: "Optimal substructure, overlapping subproblems, 0/1 Knapsack, LCS.", sort_order: 8 },
          { id: "top-dsa-9", subject_id: "subj-dsa", topic_name: "Heaps, Priority Queues & Heap Sort", description: "Max/min-heap invariant, swim/sink heapify operations, O(N log N) sorting.", sort_order: 9 },

          // OS
          { id: "top-os-1", subject_id: "subj-os", topic_name: "Virtual Memory Abstraction & Memory Hierarchies", description: "Contiguous virtual address space mapped dynamically onto physical RAM.", sort_order: 1 },
          { id: "top-os-2", subject_id: "subj-os", topic_name: "Paging, Page Tables & Physical Frame Allocation", description: "Virtual page numbers, frame tables, multilevel page tables, offset preservation.", sort_order: 2 },
          { id: "top-os-3", subject_id: "subj-os", topic_name: "Page Fault Traps, Demand Paging & Disk Swapping", description: "Hardware trap triggers, swap space I/O, page eviction policies (FIFO, LRU).", sort_order: 3 },
          { id: "top-os-4", subject_id: "subj-os", topic_name: "TLB Hardware Caching & Translation Lookaside Architecture", description: "Hardware associative cache accelerating page translation, hit rates, flushes.", sort_order: 4 },
          { id: "top-os-5", subject_id: "subj-os", topic_name: "Process Lifecycle, PCB & Context Switching", description: "Process states, Process Control Block registers, kernel mode switches.", sort_order: 5 },
          { id: "top-os-6", subject_id: "subj-os", topic_name: "CPU Scheduling Algorithms: FCFS, Round Robin & Multi-Level Feedback", description: "Preemptive vs non-preemptive scheduling, turnaround time, quantum sizing.", sort_order: 6 },
          { id: "top-os-7", subject_id: "subj-os", topic_name: "Inter-Process Communication & Synchronization Primitives", description: "Shared memory, message queues, mutexes, semaphores, race conditions.", sort_order: 7 },
          { id: "top-os-8", subject_id: "subj-os", topic_name: "Deadlock Prevention, Detection & Bankers Algorithm", description: "Mutual exclusion, hold and wait, no preemption, circular wait, safe states.", sort_order: 8 },
          { id: "top-os-9", subject_id: "subj-os", topic_name: "Virtual File Systems, Inodes & Disk Scheduling", description: "File control blocks, inode allocation, directory structures, SCAN/LOOK algorithms.", sort_order: 9 },

          // Networks
          { id: "top-net-1", subject_id: "subj-net", topic_name: "OSI & TCP/IP Layered Reference Models", description: "Layer boundaries, encapsulation, protocols, and data link frame abstraction.", sort_order: 1 },
          { id: "top-net-2", subject_id: "subj-net", topic_name: "TCP 3-Way Handshake State Machine & ISN Negotiation", description: "SYN, SYN-ACK, ACK connection setup, Initial Sequence Numbers, teardown.", sort_order: 2 },
          { id: "top-net-3", subject_id: "subj-net", topic_name: "Sliding Window Flow Control & Buffer Management", description: "Advertised receiver window (rwnd) preventing receiver buffer overflow.", sort_order: 3 },
          { id: "top-net-4", subject_id: "subj-net", topic_name: "TCP Congestion Control: AIMD, Slow Start & Fast Recovery", description: "Congestion window (cwnd), ssthresh, Reno vs Cubic, duplicate ACKs.", sort_order: 4 },
          { id: "top-net-5", subject_id: "subj-net", topic_name: "IP Addressing, CIDR Subnetting & Supernetting", description: "IPv4/IPv6 headers, subnet masks, slash notation, network vs host IDs.", sort_order: 5 },
          { id: "top-net-6", subject_id: "subj-net", topic_name: "Routing Protocols: Distance Vector vs Link State", description: "Bellman-Ford vs Dijkstra, RIP, OSPF link state advertisements, BGP peering.", sort_order: 6 },
          { id: "top-net-7", subject_id: "subj-net", topic_name: "Domain Name System (DNS) & Hierarchy Resolution", description: "Root nameservers, TLD, authoritative DNS, caching, recursive lookups.", sort_order: 7 },
          { id: "top-net-8", subject_id: "subj-net", topic_name: "Transport Layer Security (TLS/HTTPS) & Cryptographic Handshakes", description: "Cipher suites, asymmetric public key exchange, symmetric session encryption.", sort_order: 8 },
          { id: "top-net-9", subject_id: "subj-net", topic_name: "Application Layer Protocols: HTTP/1.1, HTTP/2, WebSocket & QUIC", description: "Multiplexing, header compression, persistent bidirectional sockets, UDP-based QUIC.", sort_order: 9 },

          // AI
          { id: "top-ai-1", subject_id: "subj-ai", topic_name: "Heuristic Search, State Space & A* Pathfinding", description: "Admissible and consistent heuristics, open/closed lists, graph exploration.", sort_order: 1 },
          { id: "top-ai-2", subject_id: "subj-ai", topic_name: "Supervised Learning: Linear & Logistic Regression", description: "Hypothesis functions, mean squared error, cross-entropy, decision boundaries.", sort_order: 2 },
          { id: "top-ai-3", subject_id: "subj-ai", topic_name: "Deep Neural Networks, Activation Functions & Backpropagation", description: "Multilayer perceptrons, ReLU, Sigmoid, chain rule gradient propagation.", sort_order: 3 },
          { id: "top-ai-4", subject_id: "subj-ai", topic_name: "Loss Functions, Optimization Algorithms & Stochastic Gradient Descent", description: "Mini-batch SGD, momentum, RMSprop, Adam optimizer, learning rate schedules.", sort_order: 4 },
          { id: "top-ai-5", subject_id: "subj-ai", topic_name: "Convolutional Neural Networks (CNNs) & Computer Vision", description: "Kernel filters, feature maps, stride, padding, pooling layers, ResNet skip connections.", sort_order: 5 },
          { id: "top-ai-6", subject_id: "subj-ai", topic_name: "Recurrent Neural Networks, LSTMs & Sequence Modeling", description: "Hidden state feedback, vanishing gradients, forget gates, cell state highway.", sort_order: 6 },
          { id: "top-ai-7", subject_id: "subj-ai", topic_name: "Self-Attention Mechanics, Encoders & Transformer Architectures", description: "Query-Key-Value dot-product scaling, multi-head attention, positional encoding.", sort_order: 7 },
          { id: "top-ai-8", subject_id: "subj-ai", topic_name: "Large Language Models, Context Windows & Prompt Engineering", description: "Causal masking, auto-regressive decoding, temperature, Top-P, token embeddings.", sort_order: 8 },
          { id: "top-ai-9", subject_id: "subj-ai", topic_name: "Reinforcement Learning: Markov Decision Processes & Q-Learning", description: "Agent-environment loop, Bellman optimality equation, exploration vs exploitation.", sort_order: 9 },
        ];

        for (const top of topics) {
          this.stmtInsertTopic.run({
            ...top,
            is_active: 1,
            created_at: now,
            updated_at: now,
          });
        }

        // 4. Teacher-Subject Assignments
        const assignments = [
          { teacher_id: "teacher-jenkins", subject_id: "subj-dsa" },
          { teacher_id: "teacher-chen", subject_id: "subj-net" },
          { teacher_id: "teacher-peterson", subject_id: "subj-os" },
          { teacher_id: "teacher-sharma", subject_id: "subj-ai" },
          { teacher_id: "teacher-sharma", subject_id: "subj-dsa" },
        ];

        for (const a of assignments) {
          this.stmtInsertTeacherSubject.run({
            id: `ts-${a.teacher_id}-${a.subject_id}`,
            teacher_id: a.teacher_id,
            subject_id: a.subject_id,
            created_at: now,
          });
        }
      });
      seedTeachersTx();
    } else {
      // Ensure all 36 syllabus topics are seeded in existing databases
      const topicCount = (this.sqlite.prepare("SELECT COUNT(*) as count FROM topics").get() as { count: number })?.count || 0;
      if (topicCount < 36) {
        const subjectCount = (this.sqlite.prepare("SELECT COUNT(*) as count FROM subjects").get() as { count: number })?.count || 0;
        if (subjectCount > 0) {
          const enrichedTopics = [
            // DSA
            { id: "top-dsa-1", subject_id: "subj-dsa", topic_name: "Stack Basics & LIFO Architecture", description: "LIFO protocol, stack pointer, and memory layout.", sort_order: 1 },
            { id: "top-dsa-2", subject_id: "subj-dsa", topic_name: "Push & Pop Pointer Operations & Boundary Guards", description: "Constant-time O(1) insertion, retrieval, and boundary guards.", sort_order: 2 },
            { id: "top-dsa-3", subject_id: "subj-dsa", topic_name: "Queue Mechanics & Circular Buffer Implementations", description: "Dual-pointer enqueue and dequeue implementations, circular array buffers.", sort_order: 3 },
            { id: "top-dsa-4", subject_id: "subj-dsa", topic_name: "Binary Search Trees & Recursive Traversals", description: "In-order, pre-order, and post-order tree visitations, BST search property.", sort_order: 4 },
            { id: "top-dsa-5", subject_id: "subj-dsa", topic_name: "Hash Tables, Open Addressing & Collision Resolution", description: "Hash functions, separate chaining, linear probing, and load factor thresholding.", sort_order: 5 },
            { id: "top-dsa-6", subject_id: "subj-dsa", topic_name: "Graph Representations: Adjacency Matrix & Lists", description: "Directed vs undirected graphs, edge weights, space-time tradeoffs.", sort_order: 6 },
            { id: "top-dsa-7", subject_id: "subj-dsa", topic_name: "Graph Traversals: Breadth-First & Depth-First Search", description: "Queue-driven BFS, recursion/stack DFS, cycle detection and connectivity.", sort_order: 7 },
            { id: "top-dsa-8", subject_id: "subj-dsa", topic_name: "Dynamic Programming: Memoization & Tabulation", description: "Optimal substructure, overlapping subproblems, 0/1 Knapsack, LCS.", sort_order: 8 },
            { id: "top-dsa-9", subject_id: "subj-dsa", topic_name: "Heaps, Priority Queues & Heap Sort", description: "Max/min-heap invariant, swim/sink heapify operations, O(N log N) sorting.", sort_order: 9 },

            // OS
            { id: "top-os-1", subject_id: "subj-os", topic_name: "Virtual Memory Abstraction & Memory Hierarchies", description: "Contiguous virtual address space mapped dynamically onto physical RAM.", sort_order: 1 },
            { id: "top-os-2", subject_id: "subj-os", topic_name: "Paging, Page Tables & Physical Frame Allocation", description: "Virtual page numbers, frame tables, multilevel page tables, offset preservation.", sort_order: 2 },
            { id: "top-os-3", subject_id: "subj-os", topic_name: "Page Fault Traps, Demand Paging & Disk Swapping", description: "Hardware trap triggers, swap space I/O, page eviction policies (FIFO, LRU).", sort_order: 3 },
            { id: "top-os-4", subject_id: "subj-os", topic_name: "TLB Hardware Caching & Translation Lookaside Architecture", description: "Hardware associative cache accelerating page translation, hit rates, flushes.", sort_order: 4 },
            { id: "top-os-5", subject_id: "subj-os", topic_name: "Process Lifecycle, PCB & Context Switching", description: "Process states, Process Control Block registers, kernel mode switches.", sort_order: 5 },
            { id: "top-os-6", subject_id: "subj-os", topic_name: "CPU Scheduling Algorithms: FCFS, Round Robin & Multi-Level Feedback", description: "Preemptive vs non-preemptive scheduling, turnaround time, quantum sizing.", sort_order: 6 },
            { id: "top-os-7", subject_id: "subj-os", topic_name: "Inter-Process Communication & Synchronization Primitives", description: "Shared memory, message queues, mutexes, semaphores, race conditions.", sort_order: 7 },
            { id: "top-os-8", subject_id: "subj-os", topic_name: "Deadlock Prevention, Detection & Bankers Algorithm", description: "Mutual exclusion, hold and wait, no preemption, circular wait, safe states.", sort_order: 8 },
            { id: "top-os-9", subject_id: "subj-os", topic_name: "Virtual File Systems, Inodes & Disk Scheduling", description: "File control blocks, inode allocation, directory structures, SCAN/LOOK algorithms.", sort_order: 9 },

            // Networks
            { id: "top-net-1", subject_id: "subj-net", topic_name: "OSI & TCP/IP Layered Reference Models", description: "Layer boundaries, encapsulation, protocols, and data link frame abstraction.", sort_order: 1 },
            { id: "top-net-2", subject_id: "subj-net", topic_name: "TCP 3-Way Handshake State Machine & ISN Negotiation", description: "SYN, SYN-ACK, ACK connection setup, Initial Sequence Numbers, teardown.", sort_order: 2 },
            { id: "top-net-3", subject_id: "subj-net", topic_name: "Sliding Window Flow Control & Buffer Management", description: "Advertised receiver window (rwnd) preventing receiver buffer overflow.", sort_order: 3 },
            { id: "top-net-4", subject_id: "subj-net", topic_name: "TCP Congestion Control: AIMD, Slow Start & Fast Recovery", description: "Congestion window (cwnd), ssthresh, Reno vs Cubic, duplicate ACKs.", sort_order: 4 },
            { id: "top-net-5", subject_id: "subj-net", topic_name: "IP Addressing, CIDR Subnetting & Supernetting", description: "IPv4/IPv6 headers, subnet masks, slash notation, network vs host IDs.", sort_order: 5 },
            { id: "top-net-6", subject_id: "subj-net", topic_name: "Routing Protocols: Distance Vector vs Link State", description: "Bellman-Ford vs Dijkstra, RIP, OSPF link state advertisements, BGP peering.", sort_order: 6 },
            { id: "top-net-7", subject_id: "subj-net", topic_name: "Domain Name System (DNS) & Hierarchy Resolution", description: "Root nameservers, TLD, authoritative DNS, caching, recursive lookups.", sort_order: 7 },
            { id: "top-net-8", subject_id: "subj-net", topic_name: "Transport Layer Security (TLS/HTTPS) & Cryptographic Handshakes", description: "Cipher suites, asymmetric public key exchange, symmetric session encryption.", sort_order: 8 },
            { id: "top-net-9", subject_id: "subj-net", topic_name: "Application Layer Protocols: HTTP/1.1, HTTP/2, WebSocket & QUIC", description: "Multiplexing, header compression, persistent bidirectional sockets, UDP-based QUIC.", sort_order: 9 },

            // AI
            { id: "top-ai-1", subject_id: "subj-ai", topic_name: "Heuristic Search, State Space & A* Pathfinding", description: "Admissible and consistent heuristics, open/closed lists, graph exploration.", sort_order: 1 },
            { id: "top-ai-2", subject_id: "subj-ai", topic_name: "Supervised Learning: Linear & Logistic Regression", description: "Hypothesis functions, mean squared error, cross-entropy, decision boundaries.", sort_order: 2 },
            { id: "top-ai-3", subject_id: "subj-ai", topic_name: "Deep Neural Networks, Activation Functions & Backpropagation", description: "Multilayer perceptrons, ReLU, Sigmoid, chain rule gradient propagation.", sort_order: 3 },
            { id: "top-ai-4", subject_id: "subj-ai", topic_name: "Loss Functions, Optimization Algorithms & Stochastic Gradient Descent", description: "Mini-batch SGD, momentum, RMSprop, Adam optimizer, learning rate schedules.", sort_order: 4 },
            { id: "top-ai-5", subject_id: "subj-ai", topic_name: "Convolutional Neural Networks (CNNs) & Computer Vision", description: "Kernel filters, feature maps, stride, padding, pooling layers, ResNet skip connections.", sort_order: 5 },
            { id: "top-ai-6", subject_id: "subj-ai", topic_name: "Recurrent Neural Networks, LSTMs & Sequence Modeling", description: "Hidden state feedback, vanishing gradients, forget gates, cell state highway.", sort_order: 6 },
            { id: "top-ai-7", subject_id: "subj-ai", topic_name: "Self-Attention Mechanics, Encoders & Transformer Architectures", description: "Query-Key-Value dot-product scaling, multi-head attention, positional encoding.", sort_order: 7 },
            { id: "top-ai-8", subject_id: "subj-ai", topic_name: "Large Language Models, Context Windows & Prompt Engineering", description: "Causal masking, auto-regressive decoding, temperature, Top-P, token embeddings.", sort_order: 8 },
            { id: "top-ai-9", subject_id: "subj-ai", topic_name: "Reinforcement Learning: Markov Decision Processes & Q-Learning", description: "Agent-environment loop, Bellman optimality equation, exploration vs exploitation.", sort_order: 9 },
          ];
          const stmtUpsert = this.sqlite.prepare(`
            INSERT INTO topics (id, subject_id, topic_name, description, sort_order, is_active, created_at, updated_at)
            VALUES (@id, @subject_id, @topic_name, @description, @sort_order, 1, @now, @now)
            ON CONFLICT(id) DO UPDATE SET
              topic_name = excluded.topic_name,
              description = excluded.description,
              sort_order = excluded.sort_order,
              is_active = excluded.is_active,
              updated_at = excluded.updated_at
          `);
          for (const t of enrichedTopics) {
            stmtUpsert.run({ ...t, now });
          }
        }
      }
    }

    const instCount = (this.sqlite.prepare("SELECT COUNT(*) as count FROM institutions").get() as { count: number })?.count || 0;
    if (instCount === 0) {
      console.log("[Master Data] Seeding institutions, academic terms, programs, and student enrollments...");
      const seedInstTx = this.sqlite.transaction(() => {
        // 5. Default Academic Hierarchy & Demo Enrollment
        const instId = "inst-mit";
        this.stmtInsertInstitution.run({
          id: instId,
          name: "Massachusetts Institute of Technology (Demo)",
          code: "MIT-ENG",
          is_active: 1,
          created_at: now,
          updated_at: now,
        });

        const termId = "term-2025-2026";
        this.stmtInsertAcademicTerm.run({
          id: termId,
          institution_id: instId,
          name: "Academic Year 2025-2026 (Semester 5)",
          code: "AY-2025-26-S5",
          start_date: "2025-08-01",
          end_date: "2026-05-31",
          is_active: 1,
          created_at: now,
          updated_at: now,
        });

        const deptId = "dept-cs";
        this.stmtInsertDepartment.run({
          id: deptId,
          institution_id: instId,
          name: "Department of Computer Science & Engineering",
          code: "CSE",
          is_active: 1,
          created_at: now,
          updated_at: now,
        });

        const progId = "prog-btech-cs";
        this.stmtInsertAcademicProgram.run({
          id: progId,
          institution_id: instId,
          department_id: deptId,
          name: "Bachelor of Technology in Computer Science",
          code: "BTECH-CS",
          degree_type: "bachelors",
          total_semesters: 8,
          is_active: 1,
          created_at: now,
          updated_at: now,
        });

        // Enroll default student user-student-1 if present
        const demoStudent = this.stmtGetUserById.get("user-student-1");
        if (demoStudent) {
          this.stmtUpsertStudentEnrollment.run({
            id: "enr-student-1",
            student_id: "user-student-1",
            institution_id: instId,
            term_id: termId,
            program_id: progId,
            semester: "Semester 5",
            status: "active",
            created_at: now,
            updated_at: now,
          });

          for (const subj of ["subj-dsa", "subj-os", "subj-net", "subj-ai"]) {
            this.stmtInsertStudentSubject.run("user-student-1", subj, "enr-student-1", now);
          }
        }
      });
      seedInstTx();
    }
  }

  private isDemoEnabled(): boolean {
    if (process.env.ENABLE_DEMO_ACCOUNT === "true") return true;
    if (process.env.ENABLE_DEMO_ACCOUNT === "false") return false;
    return process.env.NODE_ENV !== "production";
  }

  private seedMissingSamples(): void {
    if (!this.isDemoEnabled()) {
      return; // Never seed sample student records in production unless explicitly enabled
    }

    try {
      const seedTx = this.sqlite.transaction(() => {
        const defaultHash = bcrypt.hashSync(DEFAULT_DEMO_PASSWORD, 10);
        const now = new Date().toISOString();

        // Seed default sample users if not already present
        for (const u of SAMPLE_USERS) {
          const email = (u.email || "").trim();
          const name = u.name || u.fullName || "Student";
          const updatedAt = u.updatedAt || now;
          const dataJson = JSON.stringify(u);

          this.stmtInsertIgnoreUser.run({
            id: u.id,
            email,
            name,
            password_hash: defaultHash,
            role: u.role || (u.id === "user-student-1" ? "student" : "student"),
            is_verified: 1,
            status: "active",
            created_at: now,
            updated_at: updatedAt,
            data_json: dataJson,
          });

          // Ensure pre-existing sample accounts receive the demo password hash if NULL
          this.sqlite.prepare(
            "UPDATE users SET password_hash = ? WHERE id = ? AND (password_hash IS NULL OR password_hash = '')"
          ).run(defaultHash, u.id);
        }

        // Seed default sample lectures if not already present
        for (const lecture of SAMPLE_LECTURES) {
          const sampleClone: Lecture = JSON.parse(JSON.stringify(lecture));
          const id = sampleClone.id;
          const title = sampleClone.title || "";
          const subject = sampleClone.subject || "";
          const createdBy = sampleClone.createdBy || "";
          const source = sampleClone.source || "sample";
          const status = sampleClone.status || "ready";
          const date = sampleClone.date || "";
          const createdAt = sampleClone.createdAt || now;
          const dataJson = JSON.stringify(sampleClone);

          this.stmtInsertIgnoreLecture.run({
            id,
            title,
            subject,
            created_by: createdBy,
            source,
            status,
            date,
            created_at: createdAt,
            data_json: dataJson,
            teacher_id: sampleClone.teacherId || null,
            subject_id: sampleClone.subjectId || null,
            language: sampleClone.language || "en",
          });
        }
      });

      seedTx();
    } catch (err) {
      console.error("[Database Error] Failed to seed missing sample records:", err);
      throw err;
    }
  }

  private migrateLegacyUsers(): void {
    try {
      const row = this.sqlite
        .prepare("SELECT id FROM _migrations WHERE id = 'legacy_users_json'")
        .get();
      if (row) return;

      if (!fs.existsSync(this.usersFile)) {
        this.sqlite
          .prepare("INSERT INTO _migrations (id, applied_at) VALUES ('legacy_users_json', ?)")
          .run(new Date().toISOString());
        return;
      }

      const raw = fs.readFileSync(this.usersFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.sqlite
          .prepare("INSERT INTO _migrations (id, applied_at) VALUES ('legacy_users_json', ?)")
          .run(new Date().toISOString());
        return;
      }

      const migrateTx = this.sqlite.transaction((userList: any[]) => {
        let migratedCount = 0;
        const now = new Date().toISOString();
        const defaultHash = bcrypt.hashSync(DEFAULT_DEMO_PASSWORD, 10);

        for (const u of userList) {
          if (u && typeof u.id === "string" && u.id.trim() && typeof u.email === "string" && u.email.trim()) {
            const userObj: User = u;
            const email = userObj.email.trim();
            const name = userObj.name || userObj.fullName || "Student";
            const updatedAt = userObj.updatedAt || now;
            const dataJson = JSON.stringify(userObj);

            this.stmtUpsertUser.run({
              id: userObj.id,
              email,
              name,
              password_hash: defaultHash,
              role: userObj.role || "student",
              is_verified: 1,
              status: "active",
              created_at: now,
              updated_at: updatedAt,
              data_json: dataJson,
            });
            migratedCount++;
          }
        }
        this.sqlite
          .prepare("INSERT INTO _migrations (id, applied_at) VALUES ('legacy_users_json', ?)")
          .run(now);
        return migratedCount;
      });

      const count = migrateTx(parsed);
      console.log(`[Database Migration] Successfully migrated ${count} legacy user(s) from ${this.usersFile} to SQLite.`);
    } catch (err) {
      console.error(`[Database Migration Error] Failed to migrate ${this.usersFile}:`, err);
      throw err;
    }
  }

  // =========================================================================
  // AUTHENTICATION & SESSION METHODS
  // =========================================================================

  public validateUserCredentials(email: string, passwordPlain: string): User | null {
    if (!email || !passwordPlain) return null;
    const cleanEmail = email.trim().toLowerCase();

    const row = this.stmtGetUserAuthByEmail.get(cleanEmail) as {
      id: string;
      email: string;
      password_hash: string | null;
      role: string;
      is_verified: number;
      status: string;
      data_json: string;
    } | undefined;

    if (!row || !row.password_hash) {
      // Dummy compare to mitigate user-enumeration timing attacks
      bcrypt.compareSync(passwordPlain, "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
      return null;
    }

    if (row.status !== "active") {
      return null;
    }

    const isMatch = bcrypt.compareSync(passwordPlain, row.password_hash);
    if (!isMatch) {
      return null;
    }

    try {
      const userObj: User = JSON.parse(row.data_json);
      userObj.role = (row.role as any) || "student";
      userObj.isVerified = Boolean(row.is_verified);
      userObj.status = (row.status as any) || "active";
      return userObj;
    } catch {
      return null;
    }
  }

  public getUserAuthByEmail(email: string): {
    id: string;
    email: string;
    password_hash: string;
    role: string;
    is_verified: number;
    status: string;
  } | null {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    const row = this.stmtGetUserAuthByEmail.get(cleanEmail) as any;
    return row || null;
  }

  public createSession(
    userId: string,
    userAgent?: string,
    ipAddress?: string
  ): { token: string; session: UserSession; expiresAt: Date } {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const now = new Date().toISOString();
    const id = `sess-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    this.stmtInsertSession.run({
      id,
      token_hash: tokenHash,
      user_id: userId,
      expires_at: expiresAt.toISOString(),
      created_at: now,
      last_activity_at: now,
      revoked_at: null,
      user_agent: userAgent || null,
      ip_address: ipAddress || null,
    });

    const session: UserSession = {
      id,
      userId,
      sessionTokenHash: tokenHash,
      createdAt: now,
      expiresAt: expiresAt.toISOString(),
      lastActivityAt: now,
      revokedAt: null,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
    };

    return { token: rawToken, session, expiresAt };
  }

  public validateSession(
    rawToken: string
  ): ({ user: User; session: UserSession } & User) | null {
    if (!rawToken || typeof rawToken !== "string") return null;
    const tokenHash = hashToken(rawToken);

    const sessionRow = this.stmtGetSessionByHash.get(tokenHash) as {
      id: string;
      user_id: string;
      expires_at: string;
      created_at: string;
      last_activity_at?: string;
      revoked_at?: string;
      user_agent?: string;
      ip_address?: string;
    } | undefined;

    if (!sessionRow) return null;
    if (sessionRow.revoked_at) return null;
    if (new Date(sessionRow.expires_at).getTime() <= Date.now()) return null;

    const user = this.getUserById(sessionRow.user_id);
    if (!user) return null;

    try {
      this.stmtUpdateSessionActivity.run(new Date().toISOString(), sessionRow.id);
    } catch (e) {}

    const session: UserSession = {
      id: sessionRow.id,
      userId: sessionRow.user_id,
      sessionTokenHash: tokenHash,
      createdAt: sessionRow.created_at,
      expiresAt: sessionRow.expires_at,
      lastActivityAt: sessionRow.last_activity_at || sessionRow.created_at,
      revokedAt: sessionRow.revoked_at || null,
      userAgent: sessionRow.user_agent || null,
      ipAddress: sessionRow.ip_address || null,
    };

    return Object.assign({}, user, { user, session });
  }

  public revokeSession(rawToken: string): boolean {
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);
    const now = new Date().toISOString();
    const res = this.stmtRevokeSessionByHash.run(now, tokenHash);
    return res.changes > 0;
  }

  public revokeAllUserSessions(userId: string): number {
    const now = new Date().toISOString();
    const res = this.stmtRevokeSessionsByUser.run(now, userId);
    return res.changes;
  }

  public createPasswordResetToken(userId: string): string {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    const now = new Date().toISOString();

    this.stmtInsertPasswordReset.run({
      id: `reset-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      token_hash: tokenHash,
      user_id: userId,
      expires_at: expiresAt,
      created_at: now,
    });

    return rawToken;
  }

  public validatePasswordResetToken(rawToken: string): string | null {
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const row = this.stmtGetPasswordResetByHash.get(tokenHash) as { id: string; user_id: string } | undefined;
    return row ? row.user_id : null;
  }

  public consumePasswordResetToken(rawToken: string, newPasswordPlain: string): boolean {
    const userId = this.validatePasswordResetToken(rawToken);
    if (!userId) return false;

    const tokenHash = hashToken(rawToken);
    const row = this.stmtGetPasswordResetByHash.get(tokenHash) as { id: string } | undefined;
    if (!row) return false;

    const newHash = bcrypt.hashSync(newPasswordPlain, 10);
    const now = new Date().toISOString();

    const tx = this.sqlite.transaction(() => {
      this.stmtUpdateUserPassword.run(newHash, now, userId);
      this.stmtMarkPasswordResetUsed.run(now, row.id);
      this.stmtDeleteSessionsByUser.run(userId);
    });

    tx();
    return true;
  }

  // =========================================================================
  // USER METHODS
  // =========================================================================

  public getUsers(): User[] {
    try {
      const rows = this.stmtGetUsers.all() as { data_json: string; role: string; is_verified: number; status: string }[];
      const results: User[] = [];
      for (const row of rows) {
        try {
          const parsed: User = JSON.parse(row.data_json);
          parsed.role = (row.role as any) || "student";
          parsed.isVerified = Boolean(row.is_verified);
          parsed.status = (row.status as any) || "active";
          results.push(parsed);
        } catch (e) {
          console.error("[Database] Corrupted user data_json encountered:", e);
        }
      }
      return results;
    } catch (err) {
      console.error("[Database Error] getUsers failed:", err);
      throw err;
    }
  }

  public getUserById(id: string): User | undefined {
    if (!id) return undefined;
    try {
      const row = this.stmtGetUserById.get(id) as { data_json: string; role: string; is_verified: number; status: string } | undefined;
      if (!row) return undefined;
      try {
        const parsed: User = JSON.parse(row.data_json);
        parsed.role = (row.role as any) || "student";
        parsed.isVerified = Boolean(row.is_verified);
        parsed.status = (row.status as any) || "active";
        return parsed;
      } catch (e) {
        console.error(`[Database] Corrupted user data_json for id=${id}:`, e);
        return undefined;
      }
    } catch (err) {
      console.error(`[Database Error] getUserById failed for id=${id}:`, err);
      throw err;
    }
  }

  public getUserByEmail(email: string): User | undefined {
    if (!email || typeof email !== "string") return undefined;
    try {
      const row = this.stmtGetUserByEmail.get(email.trim().toLowerCase()) as { data_json: string; role: string; is_verified: number; status: string } | undefined;
      if (!row) return undefined;
      try {
        const parsed: User = JSON.parse(row.data_json);
        parsed.role = (row.role as any) || "student";
        parsed.isVerified = Boolean(row.is_verified);
        parsed.status = (row.status as any) || "active";
        return parsed;
      } catch (e) {
        console.error(`[Database] Corrupted user data_json for email=${email}:`, e);
        return undefined;
      }
    } catch (err) {
      console.error(`[Database Error] getUserByEmail failed for email=${email}:`, err);
      throw err;
    }
  }

  public createUser(user: User, passwordPlain?: string, role: "student" | "admin" = "student"): User {
    const existing = this.getUserById(user.id);
    const now = new Date().toISOString();

    const merged: User = {
      preferredLanguage: "English",
      noteStyle: "Detailed",
      difficultyPreference: "Intermediate",
      dailyStudyGoal: "1 hr",
      revisionFrequency: "Every 3 Days",
      notificationPreferences: {
        quizReminders: true,
        revisionReminders: true,
        studyPlanReminders: true,
        lectureProcessing: true,
        productUpdates: false,
      },
      ...existing,
      ...user,
      role: user.role || role,
      isVerified: user.isVerified ?? true,
      status: user.status || "active",
      fullName: user.fullName || user.name,
      name: user.name || user.fullName || "Student",
      createdAt: user.createdAt || existing?.createdAt || now,
      updatedAt: now,
    };

    const email = (merged.email || "").trim().toLowerCase();
    const name = merged.name || merged.fullName || "Student";
    const passwordHash = passwordPlain ? bcrypt.hashSync(passwordPlain, 10) : null;
    const dataJson = JSON.stringify(merged);

    try {
      this.stmtUpsertUser.run({
        id: merged.id,
        email,
        name,
        password_hash: passwordHash,
        role: merged.role || "student",
        is_verified: merged.isVerified ? 1 : 0,
        status: merged.status || "active",
        created_at: merged.createdAt,
        updated_at: merged.updatedAt,
        data_json: dataJson,
      });
      return merged;
    } catch (err) {
      console.error("[Database Error] createUser failed:", err);
      throw err;
    }
  }

  public updateUser(id: string, updates: Partial<User>): User | undefined {
    const existing = this.getUserById(id);
    if (!existing) return undefined;

    const nextName =
      typeof updates.fullName === "string" && updates.fullName.trim()
        ? updates.fullName.trim()
        : typeof updates.name === "string" && updates.name.trim()
        ? updates.name.trim()
        : existing.name;

    const updated: User = {
      ...existing,
      ...updates,
      id: existing.id,
      email: existing.email,
      name: nextName,
      fullName: nextName,
      role: updates.role || existing.role || "student",
      isVerified: updates.isVerified ?? existing.isVerified ?? true,
      status: updates.status || existing.status || "active",
      notificationPreferences: updates.notificationPreferences
        ? {
            quizReminders: Boolean(updates.notificationPreferences.quizReminders),
            revisionReminders: Boolean(updates.notificationPreferences.revisionReminders),
            studyPlanReminders: Boolean(updates.notificationPreferences.studyPlanReminders),
            lectureProcessing: Boolean(updates.notificationPreferences.lectureProcessing),
            productUpdates: Boolean(updates.notificationPreferences.productUpdates),
          }
        : existing.notificationPreferences,
      updatedAt: new Date().toISOString(),
    };

    const email = (updated.email || "").trim().toLowerCase();
    const name = updated.name || updated.fullName || "Student";
    const updatedAt = updated.updatedAt || new Date().toISOString();
    const dataJson = JSON.stringify(updated);

    try {
      this.stmtUpsertUser.run({
        id: updated.id,
        email,
        name,
        password_hash: null, // do not overwrite password on normal profile update
        role: updated.role,
        is_verified: updated.isVerified ? 1 : 0,
        status: updated.status,
        created_at: updated.createdAt || updatedAt,
        updated_at: updatedAt,
        data_json: dataJson,
      });
      return updated;
    } catch (err) {
      console.error(`[Database Error] updateUser failed for id=${id}:`, err);
      throw err;
    }
  }

  public deleteUser(id: string): boolean {
    const existing = this.getUserById(id);
    if (!existing) return false;

    try {
      const deleteTx = this.sqlite.transaction(() => {
        this.stmtDeleteSessionsByUser.run(id);
        this.stmtDeleteUserLectures.run(id);
        this.stmtDeleteUser.run(id);
      });
      deleteTx();
      return true;
    } catch (err) {
      console.error(`[Database Error] deleteUser failed for id=${id}:`, err);
      throw err;
    }
  }

  // =========================================================================
  // MASTER DATA METHODS
  // =========================================================================

  public getTeachers(activeOnly = true): Teacher[] {
    const stmt = activeOnly ? this.stmtGetActiveTeachers : this.stmtGetAllTeachers;
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email || undefined,
      department: r.department,
      designation: r.designation,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getTeacherById(id: string): Teacher | undefined {
    const r = this.stmtGetTeacherById.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      email: r.email || undefined,
      department: r.department,
      designation: r.designation,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createTeacher(teacher: Omit<Teacher, "id" | "createdAt" | "updatedAt">): Teacher {
    const id = `teacher-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertTeacher.run({
      id,
      name: teacher.name.trim(),
      email: teacher.email ? teacher.email.trim().toLowerCase() : null,
      department: teacher.department.trim(),
      designation: teacher.designation.trim(),
      is_active: teacher.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...teacher,
      isActive: teacher.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateTeacher(id: string, updates: Partial<Teacher>): Teacher | undefined {
    const current = this.getTeacherById(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const updated = { ...current, ...updates, updatedAt: now };

    this.stmtUpdateTeacher.run({
      id,
      name: updated.name.trim(),
      email: updated.email ? updated.email.trim().toLowerCase() : null,
      department: updated.department.trim(),
      designation: updated.designation.trim(),
      is_active: updated.isActive ? 1 : 0,
      updated_at: now,
    });
    return updated;
  }

  public deleteTeacher(id: string): boolean {
    const res = this.stmtDeleteTeacher.run(id);
    return res.changes > 0;
  }

  public getSubjects(teacherId?: string, activeOnly = true): Subject[] {
    let rows: any[];
    if (teacherId) {
      rows = this.stmtGetSubjectsByTeacher.all(teacherId) as any[];
    } else {
      const stmt = activeOnly ? this.stmtGetActiveSubjects : this.stmtGetAllSubjects;
      rows = stmt.all() as any[];
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.subject_name,
      subjectName: r.subject_name,
      code: r.subject_code,
      subjectCode: r.subject_code,
      description: r.description || undefined,
      semester: r.semester || undefined,
      department: r.department || undefined,
      isActive: Boolean(r.is_active),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getSubjectById(id: string): Subject | undefined {
    const r = this.stmtGetSubjectById.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.subject_name,
      subjectName: r.subject_name,
      code: r.subject_code,
      subjectCode: r.subject_code,
      description: r.description || undefined,
      semester: r.semester || undefined,
      department: r.department || undefined,
      isActive: Boolean(r.is_active),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createSubject(subject: Omit<Subject, "id" | "createdAt" | "updatedAt">): Subject {
    const id = `subj-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    const code = (subject.code || subject.subjectCode || "").trim().toUpperCase();
    const name = (subject.name || subject.subjectName || "").trim();
    this.stmtInsertSubject.run({
      id,
      subject_code: code,
      subject_name: name,
      description: subject.description ? subject.description.trim() : null,
      semester: subject.semester ? subject.semester.trim() : null,
      department: subject.department ? subject.department.trim() : null,
      is_active: subject.isActive ?? 1 ? 1 : 0,
      sort_order: subject.sortOrder || 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      name,
      subjectName: name,
      code,
      subjectCode: code,
      ...subject,
      isActive: subject.isActive ?? true,
      sortOrder: subject.sortOrder || 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateSubject(id: string, updates: Partial<Subject>): Subject | undefined {
    const current = this.getSubjectById(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const updated = { ...current, ...updates, updatedAt: now };
    const code = (updated.code || updated.subjectCode || "").trim().toUpperCase();
    const name = (updated.name || updated.subjectName || "").trim();

    this.stmtUpdateSubject.run({
      id,
      subject_code: code,
      subject_name: name,
      description: updated.description ? updated.description.trim() : null,
      semester: updated.semester ? updated.semester.trim() : null,
      department: updated.department ? updated.department.trim() : null,
      is_active: updated.isActive ? 1 : 0,
      sort_order: updated.sortOrder || 0,
      updated_at: now,
    });
    return {
      ...updated,
      name,
      subjectName: name,
      code,
      subjectCode: code,
    };
  }

  public deleteSubject(id: string): boolean {
    const res = this.stmtDeleteSubject.run(id);
    return res.changes > 0;
  }

  public getTopics(subjectId?: string, activeOnly = true): Topic[] {
    let rows: any[];
    if (subjectId) {
      const stmt = activeOnly ? this.stmtGetActiveTopicsBySubject : this.stmtGetAllTopicsBySubject;
      rows = stmt.all(subjectId) as any[];
    } else {
      const query = activeOnly
        ? "SELECT * FROM topics WHERE is_active = 1 ORDER BY sort_order ASC, topic_name ASC"
        : "SELECT * FROM topics ORDER BY sort_order ASC, topic_name ASC";
      rows = this.sqlite.prepare(query).all() as any[];
    }
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subject_id,
      name: r.topic_name,
      topicName: r.topic_name,
      description: r.description || undefined,
      orderIndex: r.sort_order,
      sortOrder: r.sort_order,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getTopicById(id: string): Topic | undefined {
    const r = this.stmtGetTopicById.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      subjectId: r.subject_id,
      name: r.topic_name,
      topicName: r.topic_name,
      description: r.description || undefined,
      orderIndex: r.sort_order,
      sortOrder: r.sort_order,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createTopic(topic: Omit<Topic, "id" | "createdAt" | "updatedAt">): Topic {
    const id = `top-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    const name = (topic.name || topic.topicName || "").trim();
    this.stmtInsertTopic.run({
      id,
      subject_id: topic.subjectId,
      topic_name: name,
      description: topic.description ? topic.description.trim() : null,
      sort_order: topic.orderIndex ?? topic.sortOrder ?? 0,
      is_active: topic.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      name,
      topicName: name,
      orderIndex: topic.orderIndex ?? topic.sortOrder ?? 0,
      sortOrder: topic.orderIndex ?? topic.sortOrder ?? 0,
      ...topic,
      isActive: topic.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateTopic(id: string, updates: Partial<Topic>): Topic | undefined {
    const current = this.getTopicById(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const updated = { ...current, ...updates, updatedAt: now };
    const name = (updated.name || updated.topicName || "").trim();

    this.stmtUpdateTopic.run({
      id,
      topic_name: name,
      description: updated.description ? updated.description.trim() : null,
      sort_order: updated.orderIndex ?? updated.sortOrder ?? 0,
      is_active: updated.isActive ? 1 : 0,
      updated_at: now,
    });
    return {
      ...updated,
      name,
      topicName: name,
    };
  }

  public deleteTopic(id: string): boolean {
    const res = this.stmtDeleteTopic.run(id);
    return res.changes > 0;
  }

  public assignSubjectToTeacher(teacherId: string, subjectId: string): void {
    const now = new Date().toISOString();
    this.stmtInsertTeacherSubject.run({
      id: `ts-${teacherId}-${subjectId}`,
      teacher_id: teacherId,
      subject_id: subjectId,
      created_at: now,
    });
  }

  public removeSubjectFromTeacher(teacherId: string, subjectId: string): void {
    this.stmtDeleteTeacherSubject.run(teacherId, subjectId);
  }

  public getTeacherSubjectIds(teacherId: string): string[] {
    const rows = this.stmtGetTeacherSubjectIds.all(teacherId) as { subject_id: string }[];
    return rows.map((r) => r.subject_id);
  }

  // =========================================================================
  // ACADEMIC HIERARCHY METHODS
  // =========================================================================

  public getInstitutions(activeOnly = true): Institution[] {
    const stmt = activeOnly ? this.stmtGetActiveInstitutions : this.stmtGetAllInstitutions;
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getInstitutionById(id: string): Institution | undefined {
    const r = this.stmtGetInstitutionById.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createInstitution(inst: Omit<Institution, "id" | "createdAt" | "updatedAt">): Institution {
    const id = `inst-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertInstitution.run({
      id,
      name: inst.name.trim(),
      code: inst.code.trim().toUpperCase(),
      is_active: inst.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...inst,
      isActive: inst.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getAcademicTerms(institutionId: string, activeOnly = true): AcademicTerm[] {
    const stmt = activeOnly ? this.stmtGetActiveAcademicTerms : this.stmtGetAllAcademicTerms;
    const rows = stmt.all(institutionId) as any[];
    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      termName: r.name,
      name: r.name,
      code: r.code,
      startDate: r.start_date || undefined,
      endDate: r.end_date || undefined,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public createAcademicTerm(term: Omit<AcademicTerm, "id" | "createdAt" | "updatedAt">): AcademicTerm {
    const id = `term-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    const name = (term.termName || term.name || "").trim();
    const code = (term.code || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10)).trim().toUpperCase();
    this.stmtInsertAcademicTerm.run({
      id,
      institution_id: term.institutionId,
      name,
      code,
      start_date: term.startDate || null,
      end_date: term.endDate || null,
      is_active: term.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...term,
      termName: name,
      name,
      code,
      isActive: term.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getDepartments(institutionId: string, activeOnly = true): Department[] {
    const stmt = activeOnly ? this.stmtGetActiveDepartments : this.stmtGetAllDepartments;
    const rows = stmt.all(institutionId) as any[];
    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      name: r.name,
      code: r.code,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public createDepartment(dept: Omit<Department, "id" | "createdAt" | "updatedAt">): Department {
    const id = `dept-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertDepartment.run({
      id,
      institution_id: dept.institutionId,
      name: dept.name.trim(),
      code: dept.code.trim().toUpperCase(),
      is_active: dept.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...dept,
      isActive: dept.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getAcademicPrograms(institutionId: string, departmentId?: string, activeOnly = true): AcademicProgram[] {
    let rows: any[];
    if (departmentId) {
      rows = this.stmtGetActiveAcademicProgramsByDept.all(institutionId, departmentId) as any[];
    } else {
      const q = activeOnly
        ? "SELECT * FROM academic_programs WHERE institution_id = ? AND is_active = 1 ORDER BY name ASC"
        : "SELECT * FROM academic_programs WHERE institution_id = ? ORDER BY name ASC";
      rows = this.sqlite.prepare(q).all(institutionId) as any[];
    }
    return rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      departmentId: r.department_id,
      name: r.name,
      code: r.code,
      degreeType: r.degree_type,
      totalSemesters: r.total_semesters,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public createAcademicProgram(prog: Omit<AcademicProgram, "id" | "createdAt" | "updatedAt">): AcademicProgram {
    const id = `prog-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertAcademicProgram.run({
      id,
      institution_id: prog.institutionId,
      department_id: prog.departmentId,
      name: prog.name.trim(),
      code: prog.code.trim().toUpperCase(),
      degree_type: prog.degreeType || "bachelors",
      total_semesters: prog.totalSemesters || 8,
      is_active: prog.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...prog,
      degreeType: prog.degreeType || "bachelors",
      totalSemesters: prog.totalSemesters || 8,
      isActive: prog.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  // =========================================================================
  // STUDENT ENROLLMENT & ACADEMIC CONTEXT
  // =========================================================================

  public getStudentAcademicContext(studentId: string): StudentAcademicContext {
    const er = this.stmtGetStudentEnrollment.get(studentId) as any;
    let enrollment: StudentEnrollment | undefined;
    let enrolledSubjects: Subject[] = [];

    if (er) {
      enrollment = {
        id: er.id,
        studentId: er.student_id,
        institutionId: er.institution_id,
        academicTermId: er.term_id,
        termId: er.term_id,
        programId: er.program_id,
        semester: er.semester,
        rollNumber: er.roll_number || undefined,
        status: er.status,
        isActive: er.status === "active",
        createdAt: er.created_at,
        updatedAt: er.updated_at,
      };

      const subjRows = this.stmtGetStudentSubjects.all(studentId) as any[];
      enrolledSubjects = subjRows.map((r) => ({
        id: r.id,
        name: r.subject_name,
        subjectName: r.subject_name,
        code: r.subject_code,
        subjectCode: r.subject_code,
        description: r.description || undefined,
        semester: r.semester || undefined,
        department: r.department || undefined,
        isActive: Boolean(r.is_active),
        sortOrder: r.sort_order,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }

    if (enrolledSubjects.length === 0) {
      enrolledSubjects = this.getSubjects(undefined, true);
    }

    const hasEnrollment = Boolean(enrollment);
    const enrolledSubjectIds = enrolledSubjects.map((s) => s.id);
    return {
      studentId,
      hasEnrollment,
      enrollment,
      enrolledSubjects,
      enrolledSubjectIds,
      semester: enrollment?.semester,
    };
  }

  public enrollStudentInSubjects(
    studentId: string,
    institutionId: string,
    termId: string,
    programId: string,
    semester: string,
    subjectIds: string[]
  ): void {
    const now = new Date().toISOString();
    const enrollId = `enr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const tx = this.sqlite.transaction(() => {
      this.stmtUpsertStudentEnrollment.run({
        id: enrollId,
        student_id: studentId,
        institution_id: institutionId,
        term_id: termId,
        program_id: programId,
        semester,
        status: "active",
        created_at: now,
        updated_at: now,
      });

      for (const subjId of subjectIds) {
        this.stmtInsertStudentSubject.run(studentId, subjId, enrollId, now);
      }
    });

    tx();
  }

  public getStudentAllowedTeachers(studentId: string): Teacher[] {
    const context = this.getStudentAcademicContext(studentId);
    if (!context.enrolledSubjects || context.enrolledSubjects.length === 0) {
      return this.getTeachers(true);
    }

    const subjectIds = context.enrolledSubjects.map((s) => s.id);
    const placeholders = subjectIds.map(() => "?").join(",");
    const rows = this.sqlite
      .prepare(
        `SELECT DISTINCT t.* FROM teachers t
         JOIN teacher_subjects ts ON t.id = ts.teacher_id
         WHERE ts.subject_id IN (${placeholders}) AND t.is_active = 1
         ORDER BY t.name ASC`
      )
      .all(...subjectIds) as any[];

    if (rows.length === 0) {
      return this.getTeachers(true);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email || undefined,
      department: r.department,
      designation: r.designation,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getStudentAllowedSubjectsForTeacher(studentId: string, teacherId: string): Subject[] {
    const context = this.getStudentAcademicContext(studentId);
    const subjectIds = context.enrolledSubjects.map((s) => s.id);

    if (subjectIds.length === 0) {
      return this.getSubjects(teacherId, true);
    }

    const placeholders = subjectIds.map(() => "?").join(",");
    const rows = this.sqlite
      .prepare(
        `SELECT s.* FROM subjects s
         JOIN teacher_subjects ts ON s.id = ts.subject_id
         WHERE ts.teacher_id = ?
           AND s.id IN (${placeholders})
           AND s.is_active = 1
         ORDER BY s.sort_order ASC, s.subject_name ASC`
      )
      .all(teacherId, ...subjectIds) as any[];

    return rows.map((r) => ({
      id: r.id,
      name: r.subject_name,
      subjectName: r.subject_name,
      code: r.subject_code,
      subjectCode: r.subject_code,
      description: r.description || undefined,
      semester: r.semester || undefined,
      department: r.department || undefined,
      isActive: Boolean(r.is_active),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public validateStudentLectureCreation(
    studentId: string,
    teacherId: string,
    subjectId: string,
    topicIds?: string[]
  ): { valid: boolean; reason?: string } {
    // 1. Verify Teacher exists and is active
    const teacher = this.getTeacherById(teacherId);
    if (!teacher || !teacher.isActive) {
      return { valid: false, reason: "Teacher does not exist or is inactive." };
    }

    // 2. Verify Subject exists and is active
    const subject = this.getSubjectById(subjectId);
    if (!subject || !subject.isActive) {
      return { valid: false, reason: "Subject does not exist or is inactive." };
    }

    // 3. Verify Teacher is assigned to this Subject
    const assigned = this.sqlite
      .prepare("SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?")
      .get(teacherId, subjectId);
    if (!assigned) {
      return {
        valid: false,
        reason: `Teacher ${teacher.name} is not assigned to teach ${subject.name || subject.subjectName}.`,
      };
    }

    // 4. Verify Student is enrolled in this Subject
    const context = this.getStudentAcademicContext(studentId);
    const isEnrolled = context.enrolledSubjects.some((s) => s.id === subjectId);
    if (!isEnrolled) {
      return {
        valid: false,
        reason: `Student is not enrolled in ${subject.name || subject.subjectName} for their current academic term.`,
      };
    }

    // 5. If topicIds provided, verify they belong to this Subject
    if (topicIds && topicIds.length > 0) {
      const placeholders = topicIds.map(() => "?").join(",");
      const topicCount = this.sqlite
        .prepare(`SELECT COUNT(*) as count FROM topics WHERE id IN (${placeholders}) AND subject_id = ?`)
        .get(...topicIds, subjectId) as { count: number };
      if (topicCount.count !== topicIds.length) {
        return {
          valid: false,
          reason: "One or more selected topics do not belong to the selected subject.",
        };
      }
    }

    return { valid: true };
  }

  // =========================================================================
  // ADMIN AUDIT LOGS
  // =========================================================================

  public recordAdminAuditLog(
    adminId: string,
    action: string,
    entityType: string,
    entityId?: string,
    details?: any
  ): void {
    const id = `audit-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertAdminAuditLog.run({
      id,
      admin_id: adminId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details_json: details ? JSON.stringify(details) : null,
      created_at: now,
    });
  }

  public getAdminAuditLogs(limit = 100): AdminAuditLog[] {
    const rows = this.stmtGetAdminAuditLogs.all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id || undefined,
      detailsJson: r.details_json || undefined,
      createdAt: r.created_at,
    }));
  }

  // =========================================================================
  // CHUNK TRACKING METHODS
  // =========================================================================

  public recordTranscriptionChunk(lectureId: string, sequenceNumber: number, chunkHash: string): boolean {
    try {
      const now = new Date().toISOString();
      const res = this.stmtInsertChunkRecord.run({
        id: `chunk-${lectureId}-${sequenceNumber}`,
        lecture_id: lectureId,
        sequence_number: sequenceNumber,
        chunk_hash: chunkHash,
        status: "completed",
        created_at: now,
      });
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  public hasTranscriptionChunk(lectureId: string, sequenceNumber: number): boolean {
    const row = this.stmtGetChunkRecord.get(lectureId, sequenceNumber);
    return Boolean(row);
  }

  // =========================================================================
  // TRANSCRIPTION JOB METHODS
  // =========================================================================

  public createTranscriptionJob(
    job: Omit<TranscriptionJob, "id" | "createdAt" | "updatedAt" | "attemptCount" | "nextRetryAt"> & {
      id?: string;
      attemptCount?: number;
      nextRetryAt?: number;
    }
  ): TranscriptionJob {
    const id = job.id || `job-${job.lectureId}-${job.sequenceNumber}`;
    const now = new Date().toISOString();
    const fullJob: TranscriptionJob = {
      id,
      userId: job.userId,
      lectureId: job.lectureId,
      sequenceNumber: job.sequenceNumber,
      audioRef: job.audioRef,
      mimeType: job.mimeType,
      durationSeconds: job.durationSeconds || 0,
      startTime: job.startTime || 0,
      endTime: job.endTime || 0,
      status: job.status || "PENDING",
      attemptCount: job.attemptCount || 0,
      nextRetryAt: job.nextRetryAt || 0,
      lastErrorCode: job.lastErrorCode || null,
      lastErrorMessage: job.lastErrorMessage || null,
      chunkHash: job.chunkHash || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      this.stmtInsertTranscriptionJob.run({
        id: fullJob.id,
        user_id: fullJob.userId,
        lecture_id: fullJob.lectureId,
        sequence_number: fullJob.sequenceNumber,
        audio_ref: fullJob.audioRef,
        mime_type: fullJob.mimeType,
        duration_seconds: fullJob.durationSeconds,
        start_time: fullJob.startTime,
        end_time: fullJob.endTime,
        status: fullJob.status,
        attempt_count: fullJob.attemptCount,
        next_retry_at: fullJob.nextRetryAt,
        last_error_code: fullJob.lastErrorCode,
        last_error_message: fullJob.lastErrorMessage,
        chunk_hash: fullJob.chunkHash,
        created_at: fullJob.createdAt,
        updated_at: fullJob.updatedAt,
      });
      return fullJob;
    } catch (err) {
      console.error("[Database Error] createTranscriptionJob failed:", err);
      throw err;
    }
  }

  public getTranscriptionJobById(id: string): TranscriptionJob | null {
    try {
      const row = this.stmtGetTranscriptionJobById.get(id) as any;
      if (!row) return null;
      return this.mapTranscriptionJobRow(row);
    } catch (err) {
      console.error("[Database Error] getTranscriptionJobById failed:", err);
      return null;
    }
  }

  public getTranscriptionJobsByLecture(lectureId: string, userId: string): TranscriptionJob[] {
    try {
      const rows = this.stmtGetTranscriptionJobsByLecture.all(lectureId, userId) as any[];
      return rows.map((r) => this.mapTranscriptionJobRow(r));
    } catch (err) {
      console.error("[Database Error] getTranscriptionJobsByLecture failed:", err);
      return [];
    }
  }

  public getPendingTranscriptionJobs(limit = 10): TranscriptionJob[] {
    try {
      const now = Date.now();
      const rows = this.stmtGetPendingJobs.all(now, limit) as any[];
      return rows.map((r) => this.mapTranscriptionJobRow(r));
    } catch (err) {
      console.error("[Database Error] getPendingTranscriptionJobs failed:", err);
      return [];
    }
  }

  public getPendingJobCountForLecture(lectureId: string, userId: string): number {
    try {
      const res = this.stmtGetPendingJobCountForLecture.get(lectureId, userId) as { count: number };
      return res?.count || 0;
    } catch (err) {
      console.error("[Database Error] getPendingJobCountForLecture failed:", err);
      return 0;
    }
  }

  public updateTranscriptionJobStatus(
    id: string,
    updates: {
      status: TranscriptionJobStatus;
      attemptCount?: number;
      nextRetryAt?: number;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    }
  ): void {
    try {
      const existing = this.getTranscriptionJobById(id);
      if (!existing) return;
      const now = new Date().toISOString();
      this.stmtUpdateJobStatus.run({
        id,
        status: updates.status,
        attempt_count: typeof updates.attemptCount === "number" ? updates.attemptCount : existing.attemptCount,
        next_retry_at: typeof updates.nextRetryAt === "number" ? updates.nextRetryAt : existing.nextRetryAt,
        last_error_code: updates.lastErrorCode !== undefined ? updates.lastErrorCode : existing.lastErrorCode || null,
        last_error_message: updates.lastErrorMessage !== undefined ? updates.lastErrorMessage : existing.lastErrorMessage || null,
        updated_at: now,
      });
    } catch (err) {
      console.error("[Database Error] updateTranscriptionJobStatus failed:", err);
    }
  }

  public recoverInterruptedJobs(): number {
    try {
      const now = new Date().toISOString();
      const res = this.stmtRecoverInterruptedJobs.run(now);
      if (res.changes > 0) {
        console.log(`[Database] Recovered ${res.changes} interrupted transcription jobs from PROCESSING to RETRY_WAIT`);
      }
      return res.changes;
    } catch (err) {
      console.error("[Database Error] recoverInterruptedJobs failed:", err);
      return 0;
    }
  }

  public resetJobsForLecture(lectureId: string, userId: string): number {
    try {
      const now = new Date().toISOString();
      const res = this.stmtResetJobsForLecture.run(now, lectureId, userId);
      return res.changes;
    } catch (err) {
      console.error("[Database Error] resetJobsForLecture failed:", err);
      return 0;
    }
  }

  private mapTranscriptionJobRow(row: any): TranscriptionJob {
    return {
      id: row.id,
      userId: row.user_id,
      lectureId: row.lecture_id,
      sequenceNumber: row.sequence_number,
      audioRef: row.audio_ref,
      mimeType: row.mime_type,
      durationSeconds: row.duration_seconds,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status as TranscriptionJobStatus,
      attemptCount: row.attempt_count,
      nextRetryAt: row.next_retry_at,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      chunkHash: row.chunk_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =========================================================================
  // LECTURE METHODS
  // =========================================================================

  public getLectures(userId?: string): Lecture[] {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      return [];
    }
    try {
      const rows = this.stmtGetLecturesForUser.all(userId.trim()) as { data_json: string }[];
      const results: Lecture[] = [];
      for (const row of rows) {
        try {
          results.push(JSON.parse(row.data_json));
        } catch (e) {
          console.error("[Database] Corrupted lecture data_json encountered:", e);
        }
      }
      return results;
    } catch (err) {
      console.error("[Database Error] getLectures failed:", err);
      throw err;
    }
  }

  public getLectureById(id: string): Lecture | undefined {
    if (!id) return undefined;
    try {
      const row = this.stmtGetLectureById.get(id) as { data_json: string } | undefined;
      if (!row) return undefined;
      try {
        return JSON.parse(row.data_json);
      } catch (e) {
        console.error(`[Database] Corrupted lecture data_json for id=${id}:`, e);
        return undefined;
      }
    } catch (err) {
      console.error(`[Database Error] getLectureById failed for id=${id}:`, err);
      throw err;
    }
  }

  public saveLecture(lecture: Lecture): Lecture {
    const id = lecture.id;
    const title = lecture.title || "";
    const subject = lecture.subject || "";
    const createdBy = lecture.createdBy || "";
    const source = lecture.source || "live";
    const status = lecture.status || "ready";
    const date = lecture.date || "";
    const createdAt = lecture.createdAt || new Date().toISOString();
    const dataJson = JSON.stringify(lecture);

    try {
      this.stmtUpsertLecture.run({
        id,
        title,
        subject,
        created_by: createdBy,
        source,
        status,
        date,
        created_at: createdAt,
        data_json: dataJson,
        teacher_id: lecture.teacherId || null,
        subject_id: lecture.subjectId || null,
        language: lecture.language || "auto",
      });
      return lecture;
    } catch (err) {
      console.error(`[Database Error] saveLecture failed for id=${id}:`, err);
      throw err;
    }
  }

  public updateLecture(id: string, updates: Partial<Lecture>): Lecture | undefined {
    const existing = this.getLectureById(id);
    if (!existing) return undefined;
    const updated: Lecture = { ...existing, ...updates };
    this.saveLecture(updated);
    return updated;
  }

  public deleteLecture(id: string): boolean {
    if (!id) return false;
    try {
      const lecture = this.getLectureById(id);
      if (lecture) {
        deleteLectureAudioChunks(lecture.createdBy, lecture.id);
      }
      this.stmtDeleteLectureJobs.run(id);
      const info = this.stmtDeleteLecture.run(id);
      return info.changes > 0;
    } catch (err) {
      console.error(`[Database Error] deleteLecture failed for id=${id}:`, err);
      throw err;
    }
  }

  public resetToSample(targetUserId: string = "user-student-1"): void {
    try {
      const resetTx = this.sqlite.transaction(() => {
        this.stmtDeleteUserLectures.run(targetUserId);
        for (const lecture of SAMPLE_LECTURES) {
          const sampleClone: Lecture = JSON.parse(JSON.stringify(lecture));
          sampleClone.createdBy = targetUserId;
          this.saveLecture(sampleClone);
        }
      });
      resetTx();
    } catch (err) {
      console.error("[Database Error] resetToSample failed:", err);
      throw err;
    }
  }

  // =========================================================================
  // UTILITY & HEALTH METHODS
  // =========================================================================

  public async checkHealth(): Promise<DatabaseHealth> {
    const start = Date.now();
    try {
      this.sqlite.prepare("SELECT 1").get();
      let migrationVersion = 7;
      try {
        const row = this.sqlite.prepare("SELECT COUNT(*) as count FROM _migrations").get() as { count: number };
        if (row && typeof row.count === "number") migrationVersion = row.count;
      } catch {}
      return {
        status: "healthy",
        engine: "sqlite",
        provider: "sqlite",
        connected: true,
        migrationVersion,
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return {
        status: "unhealthy",
        engine: "sqlite",
        provider: "sqlite",
        connected: false,
        migrationVersion: 0,
        latencyMs: Date.now() - start,
      };
    }
  }

  public close(): void {
    try {
      this.sqlite.close();
    } catch (err) {
      console.error("[Database Error] Failed to close SQLite database:", err);
    }
  }

  public getSqlite(): BetterSqlite3Database {
    return this.sqlite;
  }
}

export const db = new Database();
