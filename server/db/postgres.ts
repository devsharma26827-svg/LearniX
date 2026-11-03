import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import {
  User,
  Lecture,
  Teacher,
  Subject,
  Topic,
  Institution,
  AcademicTerm,
  Department,
  AcademicProgram,
  StudentEnrollment,
  StudentAcademicContext,
} from "../../src/types";
import {
  IDatabase,
  DatabaseHealth,
  TranscriptionJob,
  TranscriptionJobStatus,
  UserSession,
  AdminAuditLog,
} from "./types";
import { SAMPLE_LECTURES, SAMPLE_USERS } from "../sampleData";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class PostgresDatabase implements IDatabase {
  private pool: Pool;
  private initialized: Promise<void>;

  constructor(connectionString?: string) {
    const connStr =
      connectionString ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/learnix";

    this.pool = new Pool({
      connectionString: connStr,
      ssl:
        process.env.DATABASE_SSL === "true" || process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on("error", (err) => {
      console.error("[PostgreSQL Pool Error]", err);
    });

    this.initialized = this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.runMigrations();
      await this.recoverInterruptedJobs();
      await this.seedMissingSamples();
      await this.seedMasterDataIfEmpty();
      console.log("[PostgreSQL] Connected, migrated and verified successfully.");
    } catch (err) {
      console.error("[PostgreSQL Initialization Error]:", err);
      throw err;
    }
  }

  public async ready(): Promise<void> {
    await this.initialized;
  }

  private async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Advisory lock to prevent race conditions during concurrent container startups
      await client.query("SELECT pg_advisory_lock(7462831)");

      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const migrationsDir = path.join(__dirname, "../migrations/postgres");
      if (fs.existsSync(migrationsDir)) {
        const files = fs
          .readdirSync(migrationsDir)
          .filter((f) => f.endsWith(".sql"))
          .sort();

        for (const file of files) {
          const migrationId = path.basename(file, ".sql");
          const check = await client.query("SELECT id FROM _migrations WHERE id = $1", [
            migrationId,
          ]);

          if (check.rows.length === 0) {
            console.log(`[PostgreSQL Migration] Applying ${file}...`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
            await client.query("BEGIN");
            try {
              await client.query(sql);
              await client.query(
                "INSERT INTO _migrations (id, applied_at) VALUES ($1, CURRENT_TIMESTAMP)",
                [migrationId]
              );
              await client.query("COMMIT");
              console.log(`[PostgreSQL Migration] Applied ${file}`);
            } catch (migErr) {
              await client.query("ROLLBACK");
              throw migErr;
            }
          }
        }
      }
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(7462831)");
      } catch (e) {}
      client.release();
    }
  }

  public async checkHealth(): Promise<DatabaseHealth> {
    const start = Date.now();
    try {
      const res = await this.pool.query("SELECT 1 as alive");
      const latencyMs = Date.now() - start;
      let migrationVersion = 7;
      try {
        const migRes = await this.pool.query("SELECT COUNT(*) as count FROM _migrations");
        if (migRes.rows.length > 0) {
          migrationVersion = parseInt(migRes.rows[0].count, 10) || 7;
        }
      } catch {}
      if (res.rows.length > 0) {
        return {
          status: "healthy",
          engine: "postgres",
          provider: "postgresql",
          connected: true,
          migrationVersion,
          latencyMs,
        };
      }
      return {
        status: "unhealthy",
        engine: "postgres",
        provider: "postgresql",
        connected: false,
        migrationVersion: 0,
        latencyMs,
      };
    } catch (err) {
      return {
        status: "unhealthy",
        engine: "postgres",
        provider: "postgresql",
        connected: false,
        migrationVersion: 0,
        latencyMs: Date.now() - start,
      };
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  // =========================================================================
  // USER MANAGEMENT
  // =========================================================================

  public async getUsers(): Promise<User[]> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM users ORDER BY created_at ASC");
    return res.rows.map(this.mapUserRow);
  }

  public async getUserById(id: string): Promise<User | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapUserRow(res.rows[0]);
  }

  public async getUserByEmail(email: string): Promise<User | undefined> {
    await this.ready();
    if (!email) return undefined;
    const cleanEmail = email.trim().toLowerCase();
    const res = await this.pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [cleanEmail]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapUserRow(res.rows[0]);
  }

  public async createUser(user: User, rawPassword?: string): Promise<User> {
    await this.ready();
    const cleanEmail = user.email.trim().toLowerCase();
    const id = user.id || `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const name = user.name || user.fullName || "Student";
    const role = user.role || "student";
    const isVerified = user.isVerified ?? true;
    const status = user.status || "active";
    const passwordHash = rawPassword ? bcrypt.hashSync(rawPassword, 10) : null;

    const dataJson = { ...user, id, email: cleanEmail, name, role, isVerified, status };

    const query = `
      INSERT INTO users (id, email, name, password_hash, role, is_verified, status, data_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        data_json = EXCLUDED.data_json,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await this.pool.query(query, [
      id,
      cleanEmail,
      name,
      passwordHash,
      role,
      isVerified,
      status,
      JSON.stringify(dataJson),
    ]);
    return this.mapUserRow(res.rows[0]);
  }

  public async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    await this.ready();
    const existing = await this.getUserById(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...updates, id };
    const query = `
      UPDATE users
      SET name = $1, role = $2, status = $3, data_json = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *;
    `;
    const res = await this.pool.query(query, [
      merged.name || merged.fullName || "Student",
      merged.role || "student",
      merged.status || "active",
      JSON.stringify(merged),
      id,
    ]);
    if (res.rows.length === 0) return undefined;
    return this.mapUserRow(res.rows[0]);
  }

  public async deleteUser(id: string): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query("DELETE FROM users WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async validateUserCredentials(email: string, rawPassword: string): Promise<User | null> {
    await this.ready();
    if (!email || !rawPassword) return null;
    const cleanEmail = email.trim().toLowerCase();
    const res = await this.pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [cleanEmail]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    if (!row.password_hash) return null;

    const match = bcrypt.compareSync(rawPassword, row.password_hash);
    if (!match) return null;

    return this.mapUserRow(row);
  }

  private mapUserRow(row: any): User {
    let extra: any = {};
    try {
      if (row.data_json) {
        extra = typeof row.data_json === "string" ? JSON.parse(row.data_json) : row.data_json;
      }
    } catch (e) {}

    return {
      ...extra,
      id: row.id,
      email: row.email,
      name: row.name,
      fullName: row.name,
      role: row.role || "student",
      isVerified: row.is_verified ?? true,
      status: row.status || "active",
    };
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  public async createSession(
    userId: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<{ token: string; session: UserSession; expiresAt: Date }> {
    await this.ready();
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const id = `sess-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const query = `
      INSERT INTO user_sessions (id, user_id, session_token_hash, created_at, expires_at, last_activity_at, user_agent, ip_address)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP, $5, $6)
      RETURNING *;
    `;
    const res = await this.pool.query(query, [
      id,
      userId,
      tokenHash,
      expiresAt.toISOString(),
      userAgent || null,
      ipAddress || null,
    ]);
    const row = res.rows[0];
    const session: UserSession = {
      id: row.id,
      userId: row.user_id,
      sessionTokenHash: row.session_token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastActivityAt: row.last_activity_at,
      revokedAt: row.revoked_at,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    };
    return { token: rawToken, session, expiresAt };
  }

  public async validateSession(
    rawToken: string
  ): Promise<({ user: User; session: UserSession } & User) | null> {
    await this.ready();
    if (!rawToken || typeof rawToken !== "string") return null;
    const tokenHash = hashToken(rawToken);

    const query = `
      SELECT s.*, u.*, s.id as session_id, s.created_at as session_created_at
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token_hash = $1
        AND (s.revoked_at IS NULL)
        AND s.expires_at > CURRENT_TIMESTAMP;
    `;
    const res = await this.pool.query(query, [tokenHash]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    // Update last activity async
    this.pool.query(
      "UPDATE user_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1",
      [row.session_id]
    ).catch(() => {});

    const user = this.mapUserRow(row);
    const session: UserSession = {
      id: row.session_id,
      userId: row.user_id,
      sessionTokenHash: row.session_token_hash,
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
      lastActivityAt: row.last_activity_at,
      revokedAt: row.revoked_at,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    };

    return Object.assign({}, user, { user, session });
  }

  public async revokeSession(rawToken: string): Promise<boolean> {
    await this.ready();
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);
    const res = await this.pool.query(
      "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_token_hash = $1",
      [tokenHash]
    );
    return (res.rowCount ?? 0) > 0;
  }

  public async revokeAllUserSessions(userId: string): Promise<number> {
    await this.ready();
    const res = await this.pool.query(
      "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL",
      [userId]
    );
    return res.rowCount ?? 0;
  }

  // =========================================================================
  // PASSWORD RESET
  // =========================================================================

  public async createPasswordResetToken(userId: string): Promise<string> {
    await this.ready();
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const id = `reset-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    await this.pool.query(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [id, userId, tokenHash, expiresAt]
    );
    return rawToken;
  }

  public async consumePasswordResetToken(rawToken: string, newPassword: string): Promise<boolean> {
    await this.ready();
    if (!rawToken) return false;
    const tokenHash = hashToken(rawToken);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        "SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE",
        [tokenHash]
      );
      if (res.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const resetRow = res.rows[0];
      const newHash = bcrypt.hashSync(newPassword, 10);
      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [newHash, resetRow.user_id]
      );
      await client.query(
        "UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = $1",
        [resetRow.id]
      );
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // ACADEMIC MASTER DATA
  // =========================================================================

  public async getInstitutions(activeOnly = true): Promise<Institution[]> {
    await this.ready();
    const query = activeOnly
      ? "SELECT * FROM institutions WHERE is_active = true ORDER BY name ASC"
      : "SELECT * FROM institutions ORDER BY name ASC";
    const res = await this.pool.query(query);
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async getInstitutionById(id: string): Promise<Institution | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM institutions WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async createInstitution(
    inst: Omit<Institution, "id" | "createdAt" | "updatedAt">
  ): Promise<Institution> {
    await this.ready();
    const id = `inst-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const res = await this.pool.query(
      `INSERT INTO institutions (id, name, code, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, inst.name, inst.code, inst.isActive ?? true]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async getAcademicTerms(institutionId: string, activeOnly = true): Promise<AcademicTerm[]> {
    await this.ready();
    const query = activeOnly
      ? "SELECT * FROM academic_terms WHERE institution_id = $1 AND is_active = true ORDER BY created_at DESC"
      : "SELECT * FROM academic_terms WHERE institution_id = $1 ORDER BY created_at DESC";
    const res = await this.pool.query(query, [institutionId]);
    return res.rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      termName: r.name,
      name: r.name,
      code: r.code,
      startDate: r.start_date,
      endDate: r.end_date,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createAcademicTerm(
    term: Omit<AcademicTerm, "id" | "createdAt" | "updatedAt">
  ): Promise<AcademicTerm> {
    await this.ready();
    const id = `term-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const name = term.termName || term.name || "Academic Term";
    const code = term.code || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase();
    const res = await this.pool.query(
      `INSERT INTO academic_terms (id, institution_id, name, code, start_date, end_date, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, term.institutionId, name, code, term.startDate || null, term.endDate || null, term.isActive ?? true]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      institutionId: r.institution_id,
      termName: r.name,
      name: r.name,
      code: r.code,
      startDate: r.start_date,
      endDate: r.end_date,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async getDepartments(institutionId: string, activeOnly = true): Promise<Department[]> {
    await this.ready();
    const query = activeOnly
      ? "SELECT * FROM departments WHERE institution_id = $1 AND is_active = true ORDER BY name ASC"
      : "SELECT * FROM departments WHERE institution_id = $1 ORDER BY name ASC";
    const res = await this.pool.query(query, [institutionId]);
    return res.rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      name: r.name,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createDepartment(
    dept: Omit<Department, "id" | "createdAt" | "updatedAt">
  ): Promise<Department> {
    await this.ready();
    const id = `dept-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const res = await this.pool.query(
      `INSERT INTO departments (id, institution_id, name, code, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, dept.institutionId, dept.name, dept.code, dept.isActive ?? true]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      institutionId: r.institution_id,
      name: r.name,
      code: r.code,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async getAcademicPrograms(
    institutionId: string,
    departmentId?: string,
    activeOnly = true
  ): Promise<AcademicProgram[]> {
    await this.ready();
    let query = "SELECT * FROM academic_programs WHERE institution_id = $1";
    const params: any[] = [institutionId];
    if (departmentId) {
      params.push(departmentId);
      query += ` AND department_id = $${params.length}`;
    }
    if (activeOnly) {
      query += " AND is_active = true";
    }
    query += " ORDER BY name ASC";
    const res = await this.pool.query(query, params);
    return res.rows.map((r) => ({
      id: r.id,
      institutionId: r.institution_id,
      departmentId: r.department_id,
      name: r.name,
      code: r.code,
      degreeType: r.degree_type,
      totalSemesters: r.total_semesters,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createAcademicProgram(
    prog: Omit<AcademicProgram, "id" | "createdAt" | "updatedAt">
  ): Promise<AcademicProgram> {
    await this.ready();
    const id = `prog-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const res = await this.pool.query(
      `INSERT INTO academic_programs (id, institution_id, department_id, name, code, degree_type, total_semesters, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        prog.institutionId,
        prog.departmentId,
        prog.name,
        prog.code,
        prog.degreeType || "bachelors",
        prog.totalSemesters || 8,
        prog.isActive ?? true,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      institutionId: r.institution_id,
      departmentId: r.department_id,
      name: r.name,
      code: r.code,
      degreeType: r.degree_type,
      totalSemesters: r.total_semesters,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // =========================================================================
  // TEACHERS, SUBJECTS, TOPICS
  // =========================================================================

  public async getTeachers(activeOnly = true): Promise<Teacher[]> {
    await this.ready();
    const query = activeOnly
      ? "SELECT * FROM teachers WHERE is_active = true ORDER BY name ASC"
      : "SELECT * FROM teachers ORDER BY name ASC";
    const res = await this.pool.query(query);
    return res.rows.map(this.mapTeacherRow);
  }

  public async getTeacherById(id: string): Promise<Teacher | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM teachers WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapTeacherRow(res.rows[0]);
  }

  public async createTeacher(
    teacher: Omit<Teacher, "id" | "createdAt" | "updatedAt">
  ): Promise<Teacher> {
    await this.ready();
    const id = `teacher-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const res = await this.pool.query(
      `INSERT INTO teachers (id, name, department, email, avatar, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        teacher.name,
        teacher.department,
        teacher.email,
        teacher.avatar || null,
        teacher.isActive ?? true,
      ]
    );
    return this.mapTeacherRow(res.rows[0]);
  }

  public async updateTeacher(id: string, updates: Partial<Teacher>): Promise<Teacher | undefined> {
    await this.ready();
    const existing = await this.getTeacherById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    const res = await this.pool.query(
      `UPDATE teachers
       SET name = $1, department = $2, email = $3, avatar = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [merged.name, merged.department, merged.email, merged.avatar || null, merged.isActive, id]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapTeacherRow(res.rows[0]);
  }

  public async deleteTeacher(id: string): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query("DELETE FROM teachers WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapTeacherRow(r: any): Teacher {
    return {
      id: r.id,
      name: r.name,
      department: r.department,
      designation: r.designation || "Faculty",
      email: r.email,
      avatar: r.avatar,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async getSubjects(teacherId?: string, activeOnly = true): Promise<Subject[]> {
    await this.ready();
    let query: string;
    let params: any[] = [];
    if (teacherId) {
      query = `
        SELECT s.* FROM subjects s
        JOIN teacher_subjects ts ON s.id = ts.subject_id
        WHERE ts.teacher_id = $1
      `;
      params.push(teacherId);
      if (activeOnly) query += " AND s.is_active = true";
      query += " ORDER BY s.name ASC";
    } else {
      query = activeOnly
        ? "SELECT * FROM subjects WHERE is_active = true ORDER BY name ASC"
        : "SELECT * FROM subjects ORDER BY name ASC";
    }
    const res = await this.pool.query(query, params);
    return res.rows.map(this.mapSubjectRow);
  }

  public async getSubjectById(id: string): Promise<Subject | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM subjects WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapSubjectRow(res.rows[0]);
  }

  public async createSubject(
    subject: Omit<Subject, "id" | "createdAt" | "updatedAt">
  ): Promise<Subject> {
    await this.ready();
    const id = `subj-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const name = subject.subjectName || subject.name || "Untitled Subject";
    const code = (subject.subjectCode || subject.code || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10)).toUpperCase();
    const res = await this.pool.query(
      `INSERT INTO subjects (id, name, code, department, semester, description, color, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        name,
        code,
        subject.department || "General",
        subject.semester || "Semester 1",
        subject.description || null,
        subject.color || "#4f46e5",
        subject.isActive ?? true,
      ]
    );
    return this.mapSubjectRow(res.rows[0]);
  }

  public async updateSubject(id: string, updates: Partial<Subject>): Promise<Subject | undefined> {
    await this.ready();
    const existing = await this.getSubjectById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    const name = merged.subjectName || merged.name;
    const code = merged.subjectCode || merged.code;
    const res = await this.pool.query(
      `UPDATE subjects
       SET name = $1, code = $2, department = $3, semester = $4, description = $5, color = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        name,
        code,
        merged.department,
        merged.semester,
        merged.description || null,
        merged.color || "#4f46e5",
        merged.isActive,
        id,
      ]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapSubjectRow(res.rows[0]);
  }

  public async deleteSubject(id: string): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query("DELETE FROM subjects WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapSubjectRow(r: any): Subject {
    return {
      id: r.id,
      name: r.name || r.subject_name,
      subjectName: r.name || r.subject_name,
      code: r.code || r.subject_code,
      subjectCode: r.code || r.subject_code,
      department: r.department,
      semester: r.semester,
      description: r.description,
      color: r.color,
      isActive: r.is_active,
      sortOrder: r.sort_order ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async getTopics(subjectId?: string, activeOnly = true): Promise<Topic[]> {
    await this.ready();
    let query: string;
    let params: any[] = [];
    if (subjectId) {
      query = activeOnly
        ? "SELECT * FROM topics WHERE subject_id = $1 AND is_active = true ORDER BY order_index ASC"
        : "SELECT * FROM topics WHERE subject_id = $1 ORDER BY order_index ASC";
      params.push(subjectId);
    } else {
      query = activeOnly
        ? "SELECT * FROM topics WHERE is_active = true ORDER BY order_index ASC"
        : "SELECT * FROM topics ORDER BY order_index ASC";
    }
    const res = await this.pool.query(query, params);
    return res.rows.map(this.mapTopicRow);
  }

  public async getTopicById(id: string): Promise<Topic | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM topics WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapTopicRow(res.rows[0]);
  }

  public async createTopic(
    topic: Omit<Topic, "id" | "createdAt" | "updatedAt">
  ): Promise<Topic> {
    await this.ready();
    const id = `top-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const name = topic.topicName || topic.name || "Untitled Topic";
    const orderIndex = topic.orderIndex ?? topic.sortOrder ?? 0;
    const res = await this.pool.query(
      `INSERT INTO topics (id, subject_id, name, description, order_index, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        topic.subjectId,
        name,
        topic.description || null,
        orderIndex,
        topic.isActive ?? true,
      ]
    );
    return this.mapTopicRow(res.rows[0]);
  }

  public async updateTopic(id: string, updates: Partial<Topic>): Promise<Topic | undefined> {
    await this.ready();
    const existing = await this.getTopicById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    const name = merged.topicName || merged.name;
    const orderIndex = merged.orderIndex ?? merged.sortOrder ?? 0;
    const res = await this.pool.query(
      `UPDATE topics
       SET name = $1, description = $2, order_index = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, merged.description || null, orderIndex, merged.isActive, id]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapTopicRow(res.rows[0]);
  }

  public async deleteTopic(id: string): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query("DELETE FROM topics WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapTopicRow(r: any): Topic {
    return {
      id: r.id,
      subjectId: r.subject_id,
      name: r.name || r.topic_name,
      topicName: r.name || r.topic_name,
      description: r.description,
      orderIndex: r.order_index ?? r.sort_order ?? 0,
      sortOrder: r.order_index ?? r.sort_order ?? 0,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async assignSubjectToTeacher(teacherId: string, subjectId: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      `INSERT INTO teacher_subjects (teacher_id, subject_id, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (teacher_id, subject_id) DO NOTHING`,
      [teacherId, subjectId]
    );
  }

  public async removeSubjectFromTeacher(teacherId: string, subjectId: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      "DELETE FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2",
      [teacherId, subjectId]
    );
  }

  public async getTeacherSubjectIds(teacherId: string): Promise<string[]> {
    await this.ready();
    const res = await this.pool.query(
      "SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1",
      [teacherId]
    );
    return res.rows.map((r) => r.subject_id);
  }

  // =========================================================================
  // STUDENT ACADEMIC CONTEXT & ENROLLMENTS
  // =========================================================================

  public async getStudentAcademicContext(studentId: string): Promise<StudentAcademicContext> {
    await this.ready();
    const enrollRes = await this.pool.query(
      `SELECT e.*, i.name as institution_name, i.code as institution_code,
              t.name as term_name, t.code as term_code,
              p.name as program_name, p.code as program_code
       FROM student_enrollments e
       LEFT JOIN institutions i ON e.institution_id = i.id
       LEFT JOIN academic_terms t ON e.term_id = t.id
       LEFT JOIN academic_programs p ON e.program_id = p.id
       WHERE e.student_id = $1 AND e.status = 'active'
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [studentId]
    );

    let enrollment: StudentEnrollment | undefined;
    let enrolledSubjects: Subject[] = [];

    if (enrollRes.rows.length > 0) {
      const er = enrollRes.rows[0];
      enrollment = {
        id: er.id,
        studentId: er.student_id,
        institutionId: er.institution_id,
        academicTermId: er.term_id,
        termId: er.term_id,
        programId: er.program_id,
        semester: er.semester,
        rollNumber: er.roll_number,
        status: er.status,
        isActive: er.status === "active",
        createdAt: er.created_at,
        updatedAt: er.updated_at,
      };

      const subjRes = await this.pool.query(
        `SELECT s.* FROM subjects s
         JOIN student_subjects ss ON s.id = ss.subject_id
         WHERE ss.student_id = $1 AND s.is_active = true
         ORDER BY s.name ASC`,
        [studentId]
      );
      enrolledSubjects = subjRes.rows.map(this.mapSubjectRow);
    }

    // If student has no explicit enrollment yet, fallback to active subjects for seamless transition
    if (enrolledSubjects.length === 0) {
      enrolledSubjects = await this.getSubjects(undefined, true);
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

  public async enrollStudentInSubjects(
    studentId: string,
    institutionId: string,
    termId: string,
    programId: string,
    semester: string,
    subjectIds: string[]
  ): Promise<void> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const enrollId = `enr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      await client.query(
        `INSERT INTO student_enrollments (id, student_id, institution_id, term_id, program_id, semester, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (student_id, term_id) DO UPDATE SET
           institution_id = EXCLUDED.institution_id,
           program_id = EXCLUDED.program_id,
           semester = EXCLUDED.semester,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [enrollId, studentId, institutionId, termId, programId, semester]
      );

      for (const subjId of subjectIds) {
        await client.query(
          `INSERT INTO student_subjects (student_id, subject_id, enrollment_id, created_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (student_id, subject_id) DO NOTHING`,
          [studentId, subjId, enrollId]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  public async getStudentAllowedTeachers(studentId: string): Promise<Teacher[]> {
    await this.ready();
    const context = await this.getStudentAcademicContext(studentId);
    const subjectIds = context.enrolledSubjectIds || (context.enrolledSubjects ? context.enrolledSubjects.map((s) => s.id) : []);
    if (subjectIds.length === 0) {
      return this.getTeachers(true);
    }

    const res = await this.pool.query(
      `SELECT DISTINCT t.* FROM teachers t
       JOIN teacher_subjects ts ON t.id = ts.teacher_id
       WHERE ts.subject_id = ANY($1::varchar[]) AND t.is_active = true
       ORDER BY t.name ASC`,
      [subjectIds]
    );

    if (res.rows.length === 0) {
      return this.getTeachers(true);
    }
    return res.rows.map(this.mapTeacherRow);
  }

  public async getStudentAllowedSubjectsForTeacher(
    studentId: string,
    teacherId: string
  ): Promise<Subject[]> {
    await this.ready();
    const context = await this.getStudentAcademicContext(studentId);
    const subjectIds = context.enrolledSubjectIds || (context.enrolledSubjects ? context.enrolledSubjects.map((s) => s.id) : []);

    const res = await this.pool.query(
      `SELECT s.* FROM subjects s
       JOIN teacher_subjects ts ON s.id = ts.subject_id
       WHERE ts.teacher_id = $1
         AND s.id = ANY($2::varchar[])
         AND s.is_active = true
       ORDER BY s.name ASC`,
      [teacherId, subjectIds]
    );
    return res.rows.map(this.mapSubjectRow);
  }

  public async validateStudentLectureCreation(
    studentId: string,
    teacherId: string,
    subjectId: string,
    topicIds?: string[]
  ): Promise<{ valid: boolean; reason?: string }> {
    await this.ready();
    // 1. Verify Teacher exists and is active
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || !teacher.isActive) {
      return { valid: false, reason: "Teacher does not exist or is inactive." };
    }

    // 2. Verify Subject exists and is active
    const subject = await this.getSubjectById(subjectId);
    if (!subject || !subject.isActive) {
      return { valid: false, reason: "Subject does not exist or is inactive." };
    }

    // 3. Verify Teacher is assigned to this Subject
    const assignedSubjRes = await this.pool.query(
      "SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2",
      [teacherId, subjectId]
    );
    if (assignedSubjRes.rows.length === 0) {
      return {
        valid: false,
        reason: `Teacher ${teacher.name} is not assigned to teach ${subject.subjectName || subject.name}.`,
      };
    }

    // 4. Verify Student is enrolled in this Subject
    const context = await this.getStudentAcademicContext(studentId);
    const isEnrolled = context.enrolledSubjectIds?.includes(subjectId) || context.enrolledSubjects?.some((s) => s.id === subjectId);
    if (!isEnrolled) {
      return {
        valid: false,
        reason: `Student is not enrolled in ${subject.subjectName || subject.name} for their current academic term.`,
      };
    }

    // 5. If topicIds provided, verify they belong to this Subject
    if (topicIds && topicIds.length > 0) {
      const topicCheck = await this.pool.query(
        "SELECT id FROM topics WHERE id = ANY($1::varchar[]) AND subject_id = $2",
        [topicIds, subjectId]
      );
      if (topicCheck.rows.length !== topicIds.length) {
        return {
          valid: false,
          reason: "One or more selected topics do not belong to the selected subject.",
        };
      }
    }

    return { valid: true };
  }

  // =========================================================================
  // LECTURES (STRICT MULTI-USER ISOLATION)
  // =========================================================================

  public async getLectures(userId?: string): Promise<Lecture[]> {
    await this.ready();
    let query: string;
    let params: any[] = [];
    if (userId) {
      query = "SELECT * FROM lectures WHERE created_by = $1 ORDER BY created_at DESC";
      params.push(userId);
    } else {
      query = "SELECT * FROM lectures ORDER BY created_at DESC";
    }
    const res = await this.pool.query(query, params);
    return res.rows.map(this.mapLectureRow);
  }

  public async getLectureById(id: string): Promise<Lecture | undefined> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM lectures WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return this.mapLectureRow(res.rows[0]);
  }

  public async saveLecture(lecture: Lecture): Promise<Lecture> {
    await this.ready();
    const id = lecture.id;
    const title = lecture.title || "Untitled Lecture";
    const subject = lecture.subject || "General";
    const createdBy = lecture.createdBy;
    const source = lecture.source || "live";
    const status = lecture.status || "ready";
    const date = lecture.date || new Date().toISOString();
    const teacherId = lecture.teacherId || null;
    const subjectId = lecture.subjectId || null;
    const language = lecture.language || "auto";

    const dataJson = { ...lecture };

    const query = `
      INSERT INTO lectures (id, title, subject, created_by, source, status, date, teacher_id, subject_id, language, data_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        subject = EXCLUDED.subject,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        date = EXCLUDED.date,
        teacher_id = EXCLUDED.teacher_id,
        subject_id = EXCLUDED.subject_id,
        language = EXCLUDED.language,
        data_json = EXCLUDED.data_json
      RETURNING *;
    `;
    const res = await this.pool.query(query, [
      id,
      title,
      subject,
      createdBy,
      source,
      status,
      date,
      teacherId,
      subjectId,
      language,
      JSON.stringify(dataJson),
    ]);
    return this.mapLectureRow(res.rows[0]);
  }

  public async updateLecture(id: string, updates: Partial<Lecture>): Promise<Lecture | undefined> {
    await this.ready();
    const existing = await this.getLectureById(id);
    if (!existing) return undefined;

    const merged = { ...existing, ...updates, id };
    const res = await this.pool.query(
      `UPDATE lectures
       SET title = $1, subject = $2, status = $3, teacher_id = $4, subject_id = $5, language = $6, data_json = $7
       WHERE id = $8
       RETURNING *`,
      [
        merged.title,
        merged.subject,
        merged.status,
        merged.teacherId || null,
        merged.subjectId || null,
        merged.language || "auto",
        JSON.stringify(merged),
        id,
      ]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapLectureRow(res.rows[0]);
  }

  public async deleteLecture(id: string): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query("DELETE FROM lectures WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async resetToSample(targetUserId: string = "user-student-1"): Promise<void> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM lectures WHERE created_by = $1", [targetUserId]);
      for (const lecture of SAMPLE_LECTURES) {
        const sampleClone: Lecture = JSON.parse(JSON.stringify(lecture));
        sampleClone.createdBy = targetUserId;
        await this.saveLecture(sampleClone);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  private mapLectureRow(row: any): Lecture {
    let extra: any = {};
    try {
      if (row.data_json) {
        extra = typeof row.data_json === "string" ? JSON.parse(row.data_json) : row.data_json;
      }
    } catch (e) {}

    return {
      ...extra,
      id: row.id,
      title: row.title,
      subject: row.subject,
      createdBy: row.created_by,
      source: row.source,
      status: row.status,
      date: row.date,
      teacherId: row.teacher_id,
      subjectId: row.subject_id,
      language: row.language,
    };
  }

  // =========================================================================
  // TRANSCRIPTION CHUNKS & JOBS
  // =========================================================================

  public async recordTranscriptionChunk(
    lectureId: string,
    sequenceNumber: number,
    chunkHash: string
  ): Promise<boolean> {
    await this.ready();
    try {
      const res = await this.pool.query(
        `INSERT INTO transcription_chunks (lecture_id, sequence_number, chunk_hash, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (lecture_id, sequence_number) DO NOTHING
         RETURNING id`,
        [lectureId, sequenceNumber, chunkHash]
      );
      return res.rows.length > 0;
    } catch (e) {
      return false;
    }
  }

  public async hasTranscriptionChunk(lectureId: string, sequenceNumber: number): Promise<boolean> {
    await this.ready();
    const res = await this.pool.query(
      "SELECT 1 FROM transcription_chunks WHERE lecture_id = $1 AND sequence_number = $2",
      [lectureId, sequenceNumber]
    );
    return res.rows.length > 0;
  }

  public async createTranscriptionJob(
    job: Omit<TranscriptionJob, "id" | "createdAt" | "updatedAt" | "attemptCount" | "nextRetryAt"> & {
      id?: string;
      attemptCount?: number;
      nextRetryAt?: number;
    }
  ): Promise<TranscriptionJob> {
    await this.ready();
    const id = job.id || `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const res = await this.pool.query(
      `INSERT INTO transcription_jobs (id, user_id, lecture_id, sequence_number, audio_ref, mime_type, duration_seconds, start_time, end_time, status, attempt_count, next_retry_at, last_error_code, last_error_message, chunk_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        job.userId,
        job.lectureId,
        job.sequenceNumber,
        job.audioRef,
        job.mimeType,
        job.durationSeconds || 0,
        job.startTime || 0,
        job.endTime || 0,
        job.status || "PENDING",
        job.attemptCount || 0,
        job.nextRetryAt || 0,
        job.lastErrorCode || null,
        job.lastErrorMessage || null,
        job.chunkHash || null,
      ]
    );
    return this.mapJobRow(res.rows[0]);
  }

  public async getTranscriptionJobById(id: string): Promise<TranscriptionJob | null> {
    await this.ready();
    const res = await this.pool.query("SELECT * FROM transcription_jobs WHERE id = $1", [id]);
    if (res.rows.length === 0) return null;
    return this.mapJobRow(res.rows[0]);
  }

  public async getTranscriptionJobsByLecture(
    lectureId: string,
    userId: string
  ): Promise<TranscriptionJob[]> {
    await this.ready();
    const res = await this.pool.query(
      "SELECT * FROM transcription_jobs WHERE lecture_id = $1 AND user_id = $2 ORDER BY sequence_number ASC",
      [lectureId, userId]
    );
    return res.rows.map(this.mapJobRow);
  }

  public async getPendingTranscriptionJobs(limit = 10): Promise<TranscriptionJob[]> {
    await this.ready();
    const now = Date.now();
    const res = await this.pool.query(
      `SELECT * FROM transcription_jobs
       WHERE status IN ('PENDING', 'RETRY_WAIT', 'QUOTA_EXHAUSTED')
         AND next_retry_at <= $1
       ORDER BY sequence_number ASC
       LIMIT $2`,
      [now, limit]
    );
    return res.rows.map(this.mapJobRow);
  }

  public async getPendingJobCountForLecture(lectureId: string, userId: string): Promise<number> {
    await this.ready();
    const res = await this.pool.query(
      `SELECT COUNT(*) as count FROM transcription_jobs
       WHERE lecture_id = $1 AND user_id = $2
         AND status IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'QUOTA_EXHAUSTED')`,
      [lectureId, userId]
    );
    return parseInt(res.rows[0]?.count || "0", 10);
  }

  public async updateTranscriptionJobStatus(
    id: string,
    updates: {
      status: TranscriptionJobStatus;
      attemptCount?: number;
      nextRetryAt?: number;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    }
  ): Promise<void> {
    await this.ready();
    await this.pool.query(
      `UPDATE transcription_jobs
       SET status = $1,
           attempt_count = COALESCE($2, attempt_count),
           next_retry_at = COALESCE($3, next_retry_at),
           last_error_code = COALESCE($4, last_error_code),
           last_error_message = COALESCE($5, last_error_message),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        updates.status,
        updates.attemptCount !== undefined ? updates.attemptCount : null,
        updates.nextRetryAt !== undefined ? updates.nextRetryAt : null,
        updates.lastErrorCode !== undefined ? updates.lastErrorCode : null,
        updates.lastErrorMessage !== undefined ? updates.lastErrorMessage : null,
        id,
      ]
    );
  }

  public async recoverInterruptedJobs(): Promise<number> {
    const res = await this.pool.query(
      `UPDATE transcription_jobs
       SET status = 'PENDING', next_retry_at = 0, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'PROCESSING'`
    );
    return res.rowCount ?? 0;
  }

  public async resetJobsForLecture(lectureId: string, userId: string): Promise<number> {
    await this.ready();
    const res = await this.pool.query(
      `UPDATE transcription_jobs
       SET status = 'PENDING', attempt_count = 0, next_retry_at = 0, updated_at = CURRENT_TIMESTAMP
       WHERE lecture_id = $1 AND user_id = $2 AND status != 'COMPLETED'`,
      [lectureId, userId]
    );
    return res.rowCount ?? 0;
  }

  private mapJobRow(r: any): TranscriptionJob {
    return {
      id: r.id,
      userId: r.user_id,
      lectureId: r.lecture_id,
      sequenceNumber: r.sequence_number,
      audioRef: r.audio_ref,
      mimeType: r.mime_type,
      durationSeconds: parseFloat(r.duration_seconds || 0),
      startTime: parseFloat(r.start_time || 0),
      endTime: parseFloat(r.end_time || 0),
      status: r.status as TranscriptionJobStatus,
      attemptCount: r.attempt_count || 0,
      nextRetryAt: Number(r.next_retry_at || 0),
      lastErrorCode: r.last_error_code,
      lastErrorMessage: r.last_error_message,
      chunkHash: r.chunk_hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // =========================================================================
  // ADMIN AUDIT LOGS
  // =========================================================================

  public async recordAdminAuditLog(
    adminId: string,
    action: string,
    entityType: string,
    entityId?: string,
    details?: any
  ): Promise<void> {
    await this.ready();
    const id = `audit-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    await this.pool.query(
      `INSERT INTO admin_audit_logs (id, admin_id, action, entity_type, entity_id, details_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [id, adminId, action, entityType, entityId || null, details ? JSON.stringify(details) : null]
    );
  }

  public async getAdminAuditLogs(limit = 100): Promise<AdminAuditLog[]> {
    await this.ready();
    const res = await this.pool.query(
      "SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      detailsJson: r.details_json,
      createdAt: r.created_at,
    }));
  }

  // =========================================================================
  // SEEDING
  // =========================================================================

  private async seedMasterDataIfEmpty(): Promise<void> {
    const existing = await this.pool.query("SELECT COUNT(*) as count FROM teachers");
    if (parseInt(existing.rows[0]?.count || "0", 10) > 0) return;

    console.log("[PostgreSQL Master Data] Seeding institutions, departments, teachers, subjects...");

    // 1. Institution
    const inst = await this.createInstitution({
      name: "Massachusetts Institute of Technology (Demo)",
      code: "MIT-ENG",
      isActive: true,
    });

    // 2. Academic Term
    const term = await this.createAcademicTerm({
      institutionId: inst.id,
      termName: "Academic Year 2025-2026 (Semester 5)",
      name: "Academic Year 2025-2026 (Semester 5)",
      code: "AY-2025-26-S5",
      startDate: "2025-08-01",
      endDate: "2026-05-31",
      isActive: true,
    });

    // 3. Department
    const dept = await this.createDepartment({
      institutionId: inst.id,
      name: "Department of Computer Science & Engineering",
      code: "CSE",
      isActive: true,
    });

    // 4. Program
    const prog = await this.createAcademicProgram({
      institutionId: inst.id,
      departmentId: dept.id,
      name: "Bachelor of Technology in Computer Science",
      code: "BTECH-CS",
      degreeType: "bachelors",
      totalSemesters: 8,
      isActive: true,
    });

    // 5. Teachers
    const teachers = [
      { id: "teacher-jenkins", name: "Prof. Sarah Jenkins", email: "s.jenkins@learnix.edu", department: "Computer Science", designation: "Associate Professor" },
      { id: "teacher-chen", name: "Prof. Marcus Chen", email: "m.chen@learnix.edu", department: "Computer Systems & Networks", designation: "Professor" },
      { id: "teacher-peterson", name: "Dr. Alan Peterson", email: "a.peterson@learnix.edu", department: "Computer Science", designation: "Assistant Professor" },
      { id: "teacher-sharma", name: "Dr. Priya Sharma", email: "p.sharma@learnix.edu", department: "Artificial Intelligence", designation: "Assistant Professor" },
    ];
    for (const t of teachers) {
      await this.pool.query(
        `INSERT INTO teachers (id, name, department, email, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.name, t.department, t.email]
      );
    }

    // 6. Subjects
    const subjects = [
      { id: "subj-dsa", code: "CS-201", name: "Data Structures & Algorithms", description: "Foundational abstract data types, linear structures, trees and graphs.", semester: "Semester 3", department: "Computer Science", color: "#4f46e5" },
      { id: "subj-os", code: "CS-301", name: "Operating Systems & Virtual Memory", description: "Kernel design, memory virtualization, paging, and process scheduling.", semester: "Semester 5", department: "Computer Science", color: "#06b6d4" },
      { id: "subj-net", code: "CS-401", name: "Computer Networks & Protocols", description: "TCP/IP architecture, socket protocols, sliding windows, and congestion.", semester: "Semester 5", department: "Computer Systems & Networks", color: "#10b981" },
      { id: "subj-ai", code: "CS-501", name: "Artificial Intelligence & Machine Learning", description: "Search heuristics, neural representations, and natural language models.", semester: "Semester 7", department: "Artificial Intelligence", color: "#8b5cf6" },
    ];
    for (const s of subjects) {
      await this.pool.query(
        `INSERT INTO subjects (id, code, name, description, semester, department, color, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.code, s.name, s.description, s.semester, s.department, s.color]
      );
    }

    // 7. Teacher-Subjects
    const assignments = [
      { teacher_id: "teacher-jenkins", subject_id: "subj-dsa" },
      { teacher_id: "teacher-chen", subject_id: "subj-net" },
      { teacher_id: "teacher-peterson", subject_id: "subj-os" },
      { teacher_id: "teacher-sharma", subject_id: "subj-ai" },
      { teacher_id: "teacher-sharma", subject_id: "subj-dsa" },
    ];
    for (const a of assignments) {
      await this.assignSubjectToTeacher(a.teacher_id, a.subject_id);
    }

    // 8. Enroll Demo Student if exists
    const demoUser = await this.getUserById("user-student-1");
    if (demoUser) {
      await this.enrollStudentInSubjects(
        "user-student-1",
        inst.id,
        term.id,
        prog.id,
        "Semester 5",
        ["subj-dsa", "subj-os", "subj-net", "subj-ai"]
      );
    }
  }

  private async seedMissingSamples(): Promise<void> {
    if (process.env.ENABLE_DEMO_ACCOUNT === "false") return;
    const existing = await this.pool.query("SELECT COUNT(*) as count FROM users WHERE id = 'user-student-1'");
    if (parseInt(existing.rows[0]?.count || "0", 10) === 0) {
      console.log("[PostgreSQL] Seeding demo user-student-1 and sample lectures...");
      for (const sampleUser of SAMPLE_USERS) {
        await this.createUser(sampleUser, "DemoStudent@123");
      }
      for (const sampleLecture of SAMPLE_LECTURES) {
        await this.saveLecture(sampleLecture);
      }
    }
  }
}
