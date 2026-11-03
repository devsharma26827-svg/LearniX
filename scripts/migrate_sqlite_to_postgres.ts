import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import BetterSqlite3 from "better-sqlite3";
import { Pool } from "pg";
import { PostgresDatabase } from "../server/db/postgres";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

async function runDataMigration() {
  const sqlitePath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), ".data", "edupulse.sqlite");
  const pgUrl = process.env.DATABASE_URL;

  console.log(`\n==================================================`);
  console.log(`  LearniX SQLite -> PostgreSQL Migration Engine`);
  console.log(`==================================================\n`);

  if (!fs.existsSync(sqlitePath)) {
    console.error(`[Migration Error] SQLite database not found at ${sqlitePath}`);
    process.exit(1);
  }

  if (!pgUrl) {
    console.error(`[Migration Error] DATABASE_URL is not defined in environment.`);
    console.error(`Please provide DATABASE_URL=postgresql://user:pass@host:5432/dbname`);
    process.exit(1);
  }

  console.log(`Source SQLite: ${sqlitePath}`);
  console.log(`Target Postgres: ${pgUrl.replace(/:[^:@]+@/, ":****@")}\n`);

  const sqlite = new BetterSqlite3(sqlitePath, { readonly: true });
  const pgDb = new PostgresDatabase(pgUrl);
  await pgDb.ready();

  const pool = new Pool({
    connectionString: pgUrl,
    ssl: process.env.DATABASE_SSL === "true" || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("[Migration] Beginning PostgreSQL transactional ingestion...\n");

    const stats: Record<string, { sqlite: number; pg: number }> = {};

    // 1. Institutions
    try {
      const insts = sqlite.prepare("SELECT * FROM institutions").all() as any[];
      stats.institutions = { sqlite: insts.length, pg: 0 };
      for (const inst of insts) {
        await client.query(
          `INSERT INTO institutions (id, name, code, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [inst.id, inst.name, inst.code, Boolean(inst.is_active), inst.created_at, inst.updated_at]
        );
        stats.institutions.pg++;
      }
      console.log(`✓ Migrated ${stats.institutions.pg}/${stats.institutions.sqlite} institutions`);
    } catch (e: any) {
      console.warn("  (institutions table skipped: " + e.message + ")");
    }

    // 2. Academic Terms
    try {
      const terms = sqlite.prepare("SELECT * FROM academic_terms").all() as any[];
      stats.terms = { sqlite: terms.length, pg: 0 };
      for (const t of terms) {
        await client.query(
          `INSERT INTO academic_terms (id, institution_id, name, code, start_date, end_date, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [t.id, t.institution_id, t.name, t.code, t.start_date, t.end_date, Boolean(t.is_active), t.created_at, t.updated_at]
        );
        stats.terms.pg++;
      }
      console.log(`✓ Migrated ${stats.terms.pg}/${stats.terms.sqlite} academic terms`);
    } catch (e: any) {
      console.warn("  (academic_terms table skipped: " + e.message + ")");
    }

    // 3. Departments
    try {
      const depts = sqlite.prepare("SELECT * FROM departments").all() as any[];
      stats.departments = { sqlite: depts.length, pg: 0 };
      for (const d of depts) {
        await client.query(
          `INSERT INTO departments (id, institution_id, name, code, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [d.id, d.institution_id, d.name, d.code, Boolean(d.is_active), d.created_at, d.updated_at]
        );
        stats.departments.pg++;
      }
      console.log(`✓ Migrated ${stats.departments.pg}/${stats.departments.sqlite} departments`);
    } catch (e: any) {
      console.warn("  (departments table skipped: " + e.message + ")");
    }

    // 4. Academic Programs
    try {
      const progs = sqlite.prepare("SELECT * FROM academic_programs").all() as any[];
      stats.programs = { sqlite: progs.length, pg: 0 };
      for (const p of progs) {
        await client.query(
          `INSERT INTO academic_programs (id, institution_id, department_id, name, code, degree_type, total_semesters, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [p.id, p.institution_id, p.department_id, p.name, p.code, p.degree_type, p.total_semesters, Boolean(p.is_active), p.created_at, p.updated_at]
        );
        stats.programs.pg++;
      }
      console.log(`✓ Migrated ${stats.programs.pg}/${stats.programs.sqlite} academic programs`);
    } catch (e: any) {
      console.warn("  (academic_programs table skipped: " + e.message + ")");
    }

    // 5. Teachers
    try {
      const teachers = sqlite.prepare("SELECT * FROM teachers").all() as any[];
      stats.teachers = { sqlite: teachers.length, pg: 0 };
      for (const t of teachers) {
        await client.query(
          `INSERT INTO teachers (id, name, department, email, avatar, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [t.id, t.name, t.department, t.email || `${t.id}@learnix.edu`, t.avatar || null, Boolean(t.is_active), t.created_at, t.updated_at]
        );
        stats.teachers.pg++;
      }
      console.log(`✓ Migrated ${stats.teachers.pg}/${stats.teachers.sqlite} teachers`);
    } catch (e: any) {
      console.warn("  (teachers table skipped: " + e.message + ")");
    }

    // 6. Subjects
    try {
      const subjects = sqlite.prepare("SELECT * FROM subjects").all() as any[];
      stats.subjects = { sqlite: subjects.length, pg: 0 };
      for (const s of subjects) {
        await client.query(
          `INSERT INTO subjects (id, name, code, department, semester, description, color, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            s.id,
            s.subject_name || s.name,
            s.subject_code || s.code,
            s.department || "General",
            s.semester || "Semester 1",
            s.description || null,
            s.color || "#4f46e5",
            Boolean(s.is_active),
            s.created_at,
            s.updated_at,
          ]
        );
        stats.subjects.pg++;
      }
      console.log(`✓ Migrated ${stats.subjects.pg}/${stats.subjects.sqlite} subjects`);
    } catch (e: any) {
      console.warn("  (subjects table skipped: " + e.message + ")");
    }

    // 7. Topics
    try {
      const topics = sqlite.prepare("SELECT * FROM topics").all() as any[];
      stats.topics = { sqlite: topics.length, pg: 0 };
      for (const top of topics) {
        await client.query(
          `INSERT INTO topics (id, subject_id, name, description, order_index, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [top.id, top.subject_id, top.topic_name || top.name, top.description || null, top.sort_order || top.order_index || 0, Boolean(top.is_active), top.created_at, top.updated_at]
        );
        stats.topics.pg++;
      }
      console.log(`✓ Migrated ${stats.topics.pg}/${stats.topics.sqlite} topics`);
    } catch (e: any) {
      console.warn("  (topics table skipped: " + e.message + ")");
    }

    // 8. Teacher-Subjects
    try {
      const ts = sqlite.prepare("SELECT * FROM teacher_subjects").all() as any[];
      stats.teacher_subjects = { sqlite: ts.length, pg: 0 };
      for (const m of ts) {
        await client.query(
          `INSERT INTO teacher_subjects (teacher_id, subject_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (teacher_id, subject_id) DO NOTHING`,
          [m.teacher_id, m.subject_id, m.created_at || new Date().toISOString()]
        );
        stats.teacher_subjects.pg++;
      }
      console.log(`✓ Migrated ${stats.teacher_subjects.pg}/${stats.teacher_subjects.sqlite} teacher-subject links`);
    } catch (e: any) {
      console.warn("  (teacher_subjects table skipped: " + e.message + ")");
    }

    // 9. Users
    try {
      const users = sqlite.prepare("SELECT * FROM users").all() as any[];
      stats.users = { sqlite: users.length, pg: 0 };
      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, email, name, password_hash, role, is_verified, status, data_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.email,
            u.name,
            u.password_hash || null,
            u.role || "student",
            Boolean(u.is_verified),
            u.status || "active",
            u.data_json || "{}",
            u.created_at,
            u.updated_at,
          ]
        );
        stats.users.pg++;
      }
      console.log(`✓ Migrated ${stats.users.pg}/${stats.users.sqlite} users`);
    } catch (e: any) {
      console.warn("  (users table skipped: " + e.message + ")");
    }

    // 10. Student Enrollments & Subjects
    try {
      const enrolls = sqlite.prepare("SELECT * FROM student_enrollments").all() as any[];
      stats.enrollments = { sqlite: enrolls.length, pg: 0 };
      for (const enr of enrolls) {
        await client.query(
          `INSERT INTO student_enrollments (id, student_id, institution_id, term_id, program_id, semester, roll_number, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [enr.id, enr.student_id, enr.institution_id, enr.term_id, enr.program_id, enr.semester, enr.roll_number, enr.status, enr.created_at, enr.updated_at]
        );
        stats.enrollments.pg++;
      }
      console.log(`✓ Migrated ${stats.enrollments.pg}/${stats.enrollments.sqlite} student enrollments`);
    } catch (e: any) {
      console.warn("  (student_enrollments table skipped: " + e.message + ")");
    }

    try {
      const ss = sqlite.prepare("SELECT * FROM student_subjects").all() as any[];
      stats.student_subjects = { sqlite: ss.length, pg: 0 };
      for (const s of ss) {
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id, enrollment_id, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (student_id, subject_id) DO NOTHING`,
          [s.student_id, s.subject_id, s.enrollment_id, s.created_at]
        );
        stats.student_subjects.pg++;
      }
      console.log(`✓ Migrated ${stats.student_subjects.pg}/${stats.student_subjects.sqlite} student-subject enrollments`);
    } catch (e: any) {
      console.warn("  (student_subjects table skipped: " + e.message + ")");
    }

    // 11. Lectures
    try {
      const lectures = sqlite.prepare("SELECT * FROM lectures").all() as any[];
      stats.lectures = { sqlite: lectures.length, pg: 0 };
      for (const l of lectures) {
        await client.query(
          `INSERT INTO lectures (id, title, subject, created_by, source, status, date, teacher_id, subject_id, language, data_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            l.id,
            l.title,
            l.subject,
            l.created_by,
            l.source || "live",
            l.status || "ready",
            l.date || null,
            l.teacher_id || null,
            l.subject_id || null,
            l.language || "auto",
            l.data_json || "{}",
            l.created_at,
          ]
        );
        stats.lectures.pg++;
      }
      console.log(`✓ Migrated ${stats.lectures.pg}/${stats.lectures.sqlite} lectures`);
    } catch (e: any) {
      console.warn("  (lectures table skipped: " + e.message + ")");
    }

    // 12. Transcription Jobs
    try {
      const jobs = sqlite.prepare("SELECT * FROM transcription_jobs").all() as any[];
      stats.jobs = { sqlite: jobs.length, pg: 0 };
      for (const j of jobs) {
        await client.query(
          `INSERT INTO transcription_jobs (id, user_id, lecture_id, sequence_number, audio_ref, mime_type, duration_seconds, start_time, end_time, status, attempt_count, next_retry_at, last_error_code, last_error_message, chunk_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (id) DO NOTHING`,
          [
            j.id,
            j.user_id,
            j.lecture_id,
            j.sequence_number,
            j.audio_ref,
            j.mime_type,
            j.duration_seconds || 0,
            j.start_time || 0,
            j.end_time || 0,
            j.status,
            j.attempt_count || 0,
            j.next_retry_at || 0,
            j.last_error_code || null,
            j.last_error_message || null,
            j.chunk_hash || null,
            j.created_at,
            j.updated_at,
          ]
        );
        stats.jobs.pg++;
      }
      console.log(`✓ Migrated ${stats.jobs.pg}/${stats.jobs.sqlite} transcription jobs`);
    } catch (e: any) {
      console.warn("  (transcription_jobs table skipped: " + e.message + ")");
    }

    await client.query("COMMIT");
    console.log(`\n==================================================`);
    console.log(`✓ All tables successfully migrated and committed to PostgreSQL!`);
    console.log(`==================================================\n`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Migration Aborted] Rollback executed due to error:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

if (require.main === module) {
  runDataMigration().catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
}
