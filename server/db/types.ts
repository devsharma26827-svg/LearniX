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

export interface UserSession {
  id: string;
  userId: string;
  sessionTokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  revokedAt?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AdminAuditLog {
  id: string;
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  detailsJson?: string | null;
  createdAt: string;
}

export interface DatabaseHealth {
  status: "healthy" | "unhealthy";
  engine: "sqlite" | "postgres";
  provider: "sqlite" | "postgresql";
  connected: boolean;
  migrationVersion: number;
  latencyMs: number;
}

export interface IDatabase {
  // Connection and Health
  checkHealth(): Promise<DatabaseHealth>;
  close(): Promise<void> | void;

  // User Management
  getUsers(): Promise<User[]> | User[];
  getUserById(id: string): Promise<User | undefined> | User | undefined;
  getUserByEmail(email: string): Promise<User | undefined> | User | undefined;
  createUser(user: User, rawPassword?: string): Promise<User> | User;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined> | User | undefined;
  deleteUser(id: string): Promise<boolean> | boolean;
  validateUserCredentials(email: string, rawPassword: string): Promise<User | null> | User | null;

  // Session Management (Multi-User Concurrent Sessions)
  createSession(userId: string, userAgent?: string, ipAddress?: string): Promise<{ token: string; session: UserSession }> | { token: string; session: UserSession };
  validateSession(rawToken: string): Promise<{ user: User; session: UserSession } | null> | { user: User; session: UserSession } | null;
  revokeSession(rawToken: string): Promise<boolean> | boolean;
  revokeAllUserSessions(userId: string): Promise<number> | number;

  // Password Reset Management
  createPasswordResetToken(userId: string): Promise<string> | string;
  consumePasswordResetToken(rawToken: string, newPassword: string): Promise<boolean> | boolean;

  // Academic Master Data: Institutions, Terms, Departments, Programs
  getInstitutions(activeOnly?: boolean): Promise<Institution[]> | Institution[];
  getInstitutionById(id: string): Promise<Institution | undefined> | Institution | undefined;
  createInstitution(inst: Omit<Institution, "id" | "createdAt" | "updatedAt">): Promise<Institution> | Institution;

  getAcademicTerms(institutionId: string, activeOnly?: boolean): Promise<AcademicTerm[]> | AcademicTerm[];
  createAcademicTerm(term: Omit<AcademicTerm, "id" | "createdAt" | "updatedAt">): Promise<AcademicTerm> | AcademicTerm;

  getDepartments(institutionId: string, activeOnly?: boolean): Promise<Department[]> | Department[];
  createDepartment(dept: Omit<Department, "id" | "createdAt" | "updatedAt">): Promise<Department> | Department;

  getAcademicPrograms(institutionId: string, departmentId?: string, activeOnly?: boolean): Promise<AcademicProgram[]> | AcademicProgram[];
  createAcademicProgram(prog: Omit<AcademicProgram, "id" | "createdAt" | "updatedAt">): Promise<AcademicProgram> | AcademicProgram;

  // Teachers, Subjects, Topics
  getTeachers(activeOnly?: boolean): Promise<Teacher[]> | Teacher[];
  getTeacherById(id: string): Promise<Teacher | undefined> | Teacher | undefined;
  createTeacher(teacher: Omit<Teacher, "id" | "createdAt" | "updatedAt">): Promise<Teacher> | Teacher;
  updateTeacher(id: string, updates: Partial<Teacher>): Promise<Teacher | undefined> | Teacher | undefined;
  deleteTeacher(id: string): Promise<boolean> | boolean;

  getSubjects(teacherId?: string, activeOnly?: boolean): Promise<Subject[]> | Subject[];
  getSubjectById(id: string): Promise<Subject | undefined> | Subject | undefined;
  createSubject(subject: Omit<Subject, "id" | "createdAt" | "updatedAt">): Promise<Subject> | Subject;
  updateSubject(id: string, updates: Partial<Subject>): Promise<Subject | undefined> | Subject | undefined;
  deleteSubject(id: string): Promise<boolean> | boolean;

  getTopics(subjectId?: string, activeOnly?: boolean): Promise<Topic[]> | Topic[];
  getTopicById(id: string): Promise<Topic | undefined> | Topic | undefined;
  createTopic(topic: Omit<Topic, "id" | "createdAt" | "updatedAt">): Promise<Topic> | Topic;
  updateTopic(id: string, updates: Partial<Topic>): Promise<Topic | undefined> | Topic | undefined;
  deleteTopic(id: string): Promise<boolean> | boolean;

  assignSubjectToTeacher(teacherId: string, subjectId: string): Promise<void> | void;
  removeSubjectFromTeacher(teacherId: string, subjectId: string): Promise<void> | void;
  getTeacherSubjectIds(teacherId: string): Promise<string[]> | string[];

  // Student Academic Context & Mismatch Prevention
  getStudentAcademicContext(studentId: string): Promise<StudentAcademicContext> | StudentAcademicContext;
  enrollStudentInSubjects(
    studentId: string,
    institutionId: string,
    termId: string,
    programId: string,
    semester: string,
    subjectIds: string[]
  ): Promise<void> | void;
  getStudentAllowedTeachers(studentId: string): Promise<Teacher[]> | Teacher[];
  getStudentAllowedSubjectsForTeacher(studentId: string, teacherId: string): Promise<Subject[]> | Subject[];
  validateStudentLectureCreation(studentId: string, teacherId: string, subjectId: string, topicIds?: string[]): Promise<{ valid: boolean; reason?: string }> | { valid: boolean; reason?: string };

  // Lectures Management (Strict Multi-User Isolation)
  getLectures(userId?: string): Promise<Lecture[]> | Lecture[];
  getLectureById(id: string): Promise<Lecture | undefined> | Lecture | undefined;
  saveLecture(lecture: Lecture): Promise<Lecture> | Lecture;
  updateLecture(id: string, updates: Partial<Lecture>): Promise<Lecture | undefined> | Lecture | undefined;
  deleteLecture(id: string): Promise<boolean> | boolean;
  resetToSample(targetUserId?: string): Promise<void> | void;

  // Chunk Tracking & Transcription Jobs
  recordTranscriptionChunk(lectureId: string, sequenceNumber: number, chunkHash: string): Promise<boolean> | boolean;
  hasTranscriptionChunk(lectureId: string, sequenceNumber: number): Promise<boolean> | boolean;

  createTranscriptionJob(
    job: Omit<TranscriptionJob, "id" | "createdAt" | "updatedAt" | "attemptCount" | "nextRetryAt"> & {
      id?: string;
      attemptCount?: number;
      nextRetryAt?: number;
    }
  ): Promise<TranscriptionJob> | TranscriptionJob;
  getTranscriptionJobById(id: string): Promise<TranscriptionJob | null> | TranscriptionJob | null;
  getTranscriptionJobsByLecture(lectureId: string, userId: string): Promise<TranscriptionJob[]> | TranscriptionJob[];
  getPendingTranscriptionJobs(limit?: number): Promise<TranscriptionJob[]> | TranscriptionJob[];
  getPendingJobCountForLecture(lectureId: string, userId: string): Promise<number> | number;
  updateTranscriptionJobStatus(
    id: string,
    updates: {
      status: TranscriptionJobStatus;
      attemptCount?: number;
      nextRetryAt?: number;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    }
  ): Promise<void> | void;
  recoverInterruptedJobs(): Promise<number> | number;
  resetJobsForLecture(lectureId: string, userId: string): Promise<number> | number;

  // Admin Audit Logging
  recordAdminAuditLog(adminId: string, action: string, entityType: string, entityId?: string, details?: any): Promise<void> | void;
  getAdminAuditLogs(limit?: number): Promise<AdminAuditLog[]> | AdminAuditLog[];
}
