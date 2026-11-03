import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import BetterSqlite3, { type Database as BetterSqlite3Database, type Statement } from "better-sqlite3";
import { Lecture, User, Teacher, Subject, Topic } from "../src/types";
import { SAMPLE_LECTURES, SAMPLE_USERS } from "./sampleData";

const DEFAULT_DATA_DIR = path.join(process.cwd(), ".data");
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, "edupulse.sqlite");
const DEFAULT_USERS_FILE = path.join(DEFAULT_DATA_DIR, "users.json");

export const DEFAULT_DEMO_PASSWORD = process.env.DEMO_STUDENT_PASSWORD || "DemoStudent@123";

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

export class Database {
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

  // Prepared statements for Password Resets
  private stmtInsertPasswordReset!: Statement;
  private stmtGetPasswordResetByHash!: Statement;
  private stmtMarkPasswordResetUsed!: Statement;

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
    this.seedMasterDataIfEmpty();
    this.seedMissingSamples();
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
        INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, user_agent, ip_address)
        VALUES (@id, @token_hash, @user_id, @expires_at, @created_at, @user_agent, @ip_address)
      `);
      this.stmtGetSessionByHash = this.sqlite.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')");
      this.stmtDeleteSessionByHash = this.sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?");
      this.stmtDeleteSessionsByUser = this.sqlite.prepare("DELETE FROM sessions WHERE user_id = ?");

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
    } catch (err) {
      console.error("[Database Error] Failed to prepare SQL statements:", err);
      throw err;
    }
  }

  private seedMasterDataIfEmpty(): void {
    const existing = this.sqlite.prepare("SELECT COUNT(*) as count FROM teachers").get() as { count: number };
    if (existing && existing.count > 0) return;

    console.log("[Master Data] Seeding relational teachers, subjects, and topics...");
    const seedTx = this.sqlite.transaction(() => {
      const now = new Date().toISOString();

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

      // 3. Topics
      const topics = [
        // DSA
        { id: "top-dsa-1", subject_id: "subj-dsa", topic_name: "Stack Basics & LIFO Architecture", description: "LIFO protocol, stack pointer, and memory layout.", sort_order: 1 },
        { id: "top-dsa-2", subject_id: "subj-dsa", topic_name: "Push & Pop Pointer Operations", description: "Constant-time O(1) insertion, retrieval, and boundary guards.", sort_order: 2 },
        { id: "top-dsa-3", subject_id: "subj-dsa", topic_name: "Queue Mechanics & FIFO Processing", description: "Dual-pointer enqueue and dequeue implementations.", sort_order: 3 },
        { id: "top-dsa-4", subject_id: "subj-dsa", topic_name: "Binary Trees & Recursive Traversals", description: "In-order, pre-order, and post-order tree visitations.", sort_order: 4 },
        { id: "top-dsa-5", subject_id: "subj-dsa", topic_name: "Hash Tables & Collision Resolution", description: "Hash functions, separate chaining, and open addressing.", sort_order: 5 },

        // OS
        { id: "top-os-1", subject_id: "subj-os", topic_name: "Virtual Memory Abstraction", description: "Contiguous virtual address space mapped dynamically onto RAM.", sort_order: 1 },
        { id: "top-os-2", subject_id: "subj-os", topic_name: "Paging & Physical Frame Allocation", description: "Virtual page numbers, frame tables, and offset preservation.", sort_order: 2 },
        { id: "top-os-3", subject_id: "subj-os", topic_name: "Page Faults & Disk Swapping", description: "Hardware trap triggers, page eviction, and swap I/O latency.", sort_order: 3 },
        { id: "top-os-4", subject_id: "subj-os", topic_name: "TLB Caching & Translation Lookaside", description: "Hardware associative cache accelerating page translation.", sort_order: 4 },

        // Networks
        { id: "top-net-1", subject_id: "subj-net", topic_name: "TCP 3-Way Handshake State Machine", description: "SYN, SYN-ACK, ACK connection setup and ISN negotiation.", sort_order: 1 },
        { id: "top-net-2", subject_id: "subj-net", topic_name: "Sliding Window Flow Control", description: "Advertised receiver window (rwnd) preventing buffer overflow.", sort_order: 2 },
        { id: "top-net-3", subject_id: "subj-net", topic_name: "IP Addressing & Subnet Routing", description: "IPv4/IPv6 headers, CIDR masks, and router lookup tables.", sort_order: 3 },
        { id: "top-net-4", subject_id: "subj-net", topic_name: "TCP Congestion Control Algorithms", description: "Slow start, congestion avoidance, fast retransmit, and AIMD.", sort_order: 4 },

        // AI
        { id: "top-ai-1", subject_id: "subj-ai", topic_name: "Heuristic Search & A* Pathfinding", description: "Admissible heuristics, frontier queues, and graph search.", sort_order: 1 },
        { id: "top-ai-2", subject_id: "subj-ai", topic_name: "Neural Networks & Backpropagation", description: "Gradient descent, loss functions, and weight updates.", sort_order: 2 },
        { id: "top-ai-3", subject_id: "subj-ai", topic_name: "Attention Mechanisms & Transformers", description: "Scaled dot-product attention and self-attention blocks.", sort_order: 3 },
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

    seedTx();
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
  ): { token: string; expiresAt: Date } {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const now = new Date().toISOString();

    this.stmtInsertSession.run({
      id: `sess-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      token_hash: tokenHash,
      user_id: userId,
      expires_at: expiresAt.toISOString(),
      created_at: now,
      user_agent: userAgent || null,
      ip_address: ipAddress || null,
    });

    return { token: rawToken, expiresAt };
  }

  public validateSession(rawToken: string): User | undefined {
    if (!rawToken || typeof rawToken !== "string") return undefined;
    const tokenHash = hashToken(rawToken);

    const session = this.stmtGetSessionByHash.get(tokenHash) as {
      id: string;
      user_id: string;
      expires_at: string;
    } | undefined;

    if (!session) return undefined;
    return this.getUserById(session.user_id);
  }

  public revokeSession(rawToken: string): boolean {
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);
    const res = this.stmtDeleteSessionByHash.run(tokenHash);
    return res.changes > 0;
  }

  public revokeAllUserSessions(userId: string): void {
    this.stmtDeleteSessionsByUser.run(userId);
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
      subjectCode: r.subject_code,
      subjectName: r.subject_name,
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
      subjectCode: r.subject_code,
      subjectName: r.subject_name,
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
    this.stmtInsertSubject.run({
      id,
      subject_code: subject.subjectCode.trim().toUpperCase(),
      subject_name: subject.subjectName.trim(),
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

    this.stmtUpdateSubject.run({
      id,
      subject_code: updated.subjectCode.trim().toUpperCase(),
      subject_name: updated.subjectName.trim(),
      description: updated.description ? updated.description.trim() : null,
      semester: updated.semester ? updated.semester.trim() : null,
      department: updated.department ? updated.department.trim() : null,
      is_active: updated.isActive ? 1 : 0,
      sort_order: updated.sortOrder || 0,
      updated_at: now,
    });
    return updated;
  }

  public deleteSubject(id: string): boolean {
    const res = this.stmtDeleteSubject.run(id);
    return res.changes > 0;
  }

  public getTopics(subjectId?: string, activeOnly = true): Topic[] {
    if (!subjectId) return [];
    const stmt = activeOnly ? this.stmtGetActiveTopicsBySubject : this.stmtGetAllTopicsBySubject;
    const rows = stmt.all(subjectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subject_id,
      topicName: r.topic_name,
      description: r.description || undefined,
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
      topicName: r.topic_name,
      description: r.description || undefined,
      sortOrder: r.sort_order,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public createTopic(topic: Omit<Topic, "id" | "createdAt" | "updatedAt">): Topic {
    const id = `top-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    this.stmtInsertTopic.run({
      id,
      subject_id: topic.subjectId,
      topic_name: topic.topicName.trim(),
      description: topic.description ? topic.description.trim() : null,
      sort_order: topic.sortOrder || 0,
      is_active: topic.isActive ?? 1 ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return {
      id,
      ...topic,
      isActive: topic.isActive ?? true,
      sortOrder: topic.sortOrder || 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateTopic(id: string, updates: Partial<Topic>): Topic | undefined {
    const current = this.getTopicById(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const updated = { ...current, ...updates, updatedAt: now };

    this.stmtUpdateTopic.run({
      id,
      topic_name: updated.topicName.trim(),
      description: updated.description ? updated.description.trim() : null,
      sort_order: updated.sortOrder || 0,
      is_active: updated.isActive ? 1 : 0,
      updated_at: now,
    });
    return updated;
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
  // UTILITY METHODS
  // =========================================================================

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
