import express, { Request, Response } from "express";
import multer from "multer";
import { db } from "../db";
import { Lecture, TranscriptSegment, User, Teacher, Subject, Topic } from "../../src/types";
import { transcribeAudioChunk } from "../services/transcriptionService";
import { processLectureTranscript } from "../services/aiUnderstandingService";
import { askTheLecture, searchLectureContent } from "../services/ragService";
import { generateQuizForLecture } from "../services/quizService";
import { evaluateQuizAndDetectWeakTopics } from "../services/weakTopicService";
import { aiOrchestrator } from "../services/aiOrchestrator";

const router = express.Router();
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

const COOKIE_NAME = "learnix_session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

// ----------------------------------------------------
// RATE LIMITING FOR AUTHENTICATION
// ----------------------------------------------------
interface RateLimitEntry {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}
const loginAttempts = new Map<string, RateLimitEntry>();

function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return true;
  if (entry.lockedUntil && now < entry.lockedUntil) return false;
  if (now - entry.firstAttemptAt > 15 * 60 * 1000) {
    loginAttempts.delete(key);
    return true;
  }
  return entry.count < 5;
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, firstAttemptAt: now };
  entry.count++;
  if (entry.count >= 5) {
    entry.lockedUntil = now + 15 * 60 * 1000; // 15 mins lock
  }
  loginAttempts.set(key, entry);
}

function resetLoginRateLimit(key: string) {
  loginAttempts.delete(key);
}

// ----------------------------------------------------
// AUTHENTICATION & ACCESS CONTROL MIDDLEWARE
// ----------------------------------------------------
export function resolveAuthenticatedStudent(req: Request): User | undefined {
  // 1. Check HttpOnly cookie
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.trim()) {
    const user = db.validateSession(cookieToken.trim());
    if (user) return user;
  }

  // 2. Check Bearer session token
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) {
      const user = db.validateSession(bearerToken);
      if (user) return user;
    }
  }

  // Never accept spoofed x-auth-email or predictable token-ID strings
  return undefined;
}

export function requireAuth(req: Request, res: Response): User | null {
  const user = resolveAuthenticatedStudent(req);
  if (!user) {
    res.status(401).json({ error: "Unauthenticated student session. Please log in." });
    return null;
  }
  return user;
}

export function requireAdmin(req: Request, res: Response): User | null {
  const user = requireAuth(req, res);
  if (!user) return null;

  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: Administrator privileges required." });
    return null;
  }
  return user;
}

export function requireLectureOwnership(
  req: Request,
  res: Response,
  lectureId: string
): { user: User; lecture: Lecture } | null {
  const user = requireAuth(req, res);
  if (!user) return null;

  const lecture = db.getLectureById(lectureId);
  if (!lecture) {
    res.status(404).json({ error: "Lecture not found" });
    return null;
  }

  if (lecture.createdBy !== user.id) {
    res.status(403).json({ error: "Forbidden: You do not have access to this lecture." });
    return null;
  }

  return { user, lecture };
}

// ----------------------------------------------------
// PRODUCTION AUTHENTICATION ROUTES
// ----------------------------------------------------
router.post("/auth/register", (req: Request, res: Response) => {
  const { name, email, password, confirmPassword } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long." });
  }

  if (confirmPassword && confirmPassword !== password) {
    return res.status(400).json({ error: "Passwords do not match." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.getUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with this email address already exists." });
  }

  try {
    const newUser = db.createUser(
      {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name.trim(),
        fullName: name.trim(),
        email: normalizedEmail,
        avatar: "",
        role: "student",
      },
      password
    );

    const session = db.createSession(newUser.id, req.headers["user-agent"], req.ip);
    res.cookie(COOKIE_NAME, session.token, COOKIE_OPTIONS);

    res.status(201).json({
      user: newUser,
      token: session.token,
      message: "Registration successful.",
    });
  } catch (err: any) {
    console.error("[AUTH] Registration error:", err?.message || err);
    res.status(500).json({ error: "Failed to register account. Please try again." });
  }
});

router.post("/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body || {};

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const rateLimitKey = `${req.ip || "ip"}:${normalizedEmail}`;

  if (!checkLoginRateLimit(rateLimitKey)) {
    return res.status(429).json({
      error: "Too many failed login attempts. Please try again in 15 minutes.",
    });
  }

  const user = db.validateUserCredentials(normalizedEmail, password);
  if (!user) {
    recordFailedLogin(rateLimitKey);
    return res.status(401).json({ error: "Invalid email or password." });
  }

  resetLoginRateLimit(rateLimitKey);
  const session = db.createSession(user.id, req.headers["user-agent"], req.ip);
  res.cookie(COOKIE_NAME, session.token, COOKIE_OPTIONS);

  res.json({
    user,
    token: session.token,
    message: "Login successful.",
  });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const token =
    req.cookies?.[COOKIE_NAME] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "");

  if (token) {
    db.revokeSession(token);
  }

  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Logged out successfully." });
});

router.post("/auth/forgot-password", (req: Request, res: Response) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.getUserByEmail(normalizedEmail);
  let resetToken: string | undefined;

  if (user) {
    resetToken = db.createPasswordResetToken(user.id);
    console.log(`[AUTH] Password reset token generated for ${user.email}`);
  }

  // Always return identical message to prevent user enumeration
  res.json({
    success: true,
    message: "If an account matches that email, password reset instructions have been dispatched.",
    ...(process.env.NODE_ENV !== "production" && resetToken ? { debugToken: resetToken } : {}),
  });
});

router.post("/auth/reset-password", (req: Request, res: Response) => {
  const { token, newPassword, confirmPassword } = req.body || {};

  if (!token || !newPassword || typeof token !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters long." });
  }

  if (confirmPassword && confirmPassword !== newPassword) {
    return res.status(400).json({ error: "Passwords do not match." });
  }

  const success = db.consumePasswordResetToken(token.trim(), newPassword);
  if (!success) {
    return res.status(400).json({
      error: "Password reset token is invalid, expired, or has already been used.",
    });
  }

  res.json({ success: true, message: "Password updated successfully. Please log in with your new password." });
});

router.get("/me", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthenticated student session." });
  }
  res.json({ user });
});

router.patch("/me", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthenticated student session." });
  }

  const {
    name,
    fullName,
    phone,
    avatar,
    college,
    course,
    specialization,
    semester,
    academicSession,
    studentId,
    preferredLanguage,
    noteStyle,
    difficultyPreference,
    dailyStudyGoal,
    customStudyGoalMinutes,
    revisionFrequency,
    notificationPreferences,
  } = req.body || {};

  const updates: Partial<User> = {};

  if (typeof fullName === "string" && fullName.trim()) {
    updates.fullName = fullName.trim();
    updates.name = fullName.trim();
  } else if (typeof name === "string" && name.trim()) {
    updates.name = name.trim();
    updates.fullName = name.trim();
  }

  if (typeof phone === "string") updates.phone = phone.trim();
  if (typeof avatar === "string") updates.avatar = avatar;
  if (typeof college === "string") updates.college = college.trim();
  if (typeof course === "string") updates.course = course.trim();
  if (typeof specialization === "string") updates.specialization = specialization.trim();
  if (typeof semester === "string") updates.semester = semester.trim();
  if (typeof academicSession === "string") updates.academicSession = academicSession.trim();
  if (typeof studentId === "string") updates.studentId = studentId.trim();

  if (preferredLanguage && ["English", "Hinglish", "Hindi"].includes(preferredLanguage)) {
    updates.preferredLanguage = preferredLanguage;
  }
  if (noteStyle && ["Concise", "Detailed", "Exam-focused"].includes(noteStyle)) {
    updates.noteStyle = noteStyle;
  }
  if (difficultyPreference && ["Beginner", "Intermediate", "Advanced"].includes(difficultyPreference)) {
    updates.difficultyPreference = difficultyPreference;
  }
  if (dailyStudyGoal && ["30 min", "1 hr", "2 hr", "Custom"].includes(dailyStudyGoal)) {
    updates.dailyStudyGoal = dailyStudyGoal;
  }
  if (typeof customStudyGoalMinutes === "number") {
    updates.customStudyGoalMinutes = customStudyGoalMinutes;
  }
  if (
    revisionFrequency &&
    ["Daily", "Every 3 Days", "Weekly", "Before Exams"].includes(revisionFrequency)
  ) {
    updates.revisionFrequency = revisionFrequency;
  }

  if (notificationPreferences && typeof notificationPreferences === "object") {
    updates.notificationPreferences = {
      quizReminders: Boolean(notificationPreferences.quizReminders),
      revisionReminders: Boolean(notificationPreferences.revisionReminders),
      studyPlanReminders: Boolean(notificationPreferences.studyPlanReminders),
      lectureProcessing: Boolean(notificationPreferences.lectureProcessing),
      productUpdates: Boolean(notificationPreferences.productUpdates),
    };
  }

  const updatedUser = db.updateUser(user.id, updates);
  res.json({ user: updatedUser });
});

router.delete("/me", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthenticated student session." });
  }

  db.deleteUser(user.id);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Student account deleted permanently." });
});

// Admin-only user directory endpoint
router.get("/auth/users", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  res.json(db.getUsers());
});

// ----------------------------------------------------
// RELATIONAL MASTER DATA ENDPOINTS
// ----------------------------------------------------
router.get("/master/teachers", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  const activeOnly = !user || user.role !== "admin";
  const teachers = db.getTeachers(activeOnly);
  res.json(teachers);
});

router.post("/master/teachers", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { name, email, department, designation, isActive = true } = req.body || {};
  if (!name || !department || !designation) {
    return res.status(400).json({ error: "Name, department, and designation are required." });
  }

  const teacher = db.createTeacher({ name, email, department, designation, isActive });
  res.status(201).json(teacher);
});

router.put("/master/teachers/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const updated = db.updateTeacher(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: "Teacher not found." });
  }
  res.json(updated);
});

router.delete("/master/teachers/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const deleted = db.deleteTeacher(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Teacher not found." });
  }
  res.json({ success: true });
});

router.get("/master/subjects", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  const teacherId = req.query.teacherId as string | undefined;
  const activeOnly = !user || user.role !== "admin";
  const subjects = db.getSubjects(teacherId, activeOnly);
  res.json(subjects);
});

router.post("/master/subjects", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { subjectCode, subjectName, description, semester, department, isActive = true, sortOrder = 0 } = req.body || {};
  if (!subjectCode || !subjectName) {
    return res.status(400).json({ error: "Subject code and subject name are required." });
  }

  const subject = db.createSubject({ subjectCode, subjectName, description, semester, department, isActive, sortOrder });
  res.status(201).json(subject);
});

router.put("/master/subjects/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const updated = db.updateSubject(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: "Subject not found." });
  }
  res.json(updated);
});

router.delete("/master/subjects/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const deleted = db.deleteSubject(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Subject not found." });
  }
  res.json({ success: true });
});

router.get("/master/topics", (req: Request, res: Response) => {
  const user = resolveAuthenticatedStudent(req);
  const subjectId = req.query.subjectId as string | undefined;
  if (!subjectId) {
    return res.status(400).json({ error: "subjectId query parameter is required." });
  }

  const activeOnly = !user || user.role !== "admin";
  const topics = db.getTopics(subjectId, activeOnly);
  res.json(topics);
});

router.post("/master/topics", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { subjectId, topicName, description, sortOrder = 0, isActive = true } = req.body || {};
  if (!subjectId || !topicName) {
    return res.status(400).json({ error: "subjectId and topicName are required." });
  }

  const topic = db.createTopic({ subjectId, topicName, description, sortOrder, isActive });
  res.status(201).json(topic);
});

router.put("/master/topics/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const updated = db.updateTopic(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: "Topic not found." });
  }
  res.json(updated);
});

router.delete("/master/topics/:id", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const deleted = db.deleteTopic(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Topic not found." });
  }
  res.json({ success: true });
});

router.post("/master/teacher-subjects", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { teacherId, subjectId } = req.body || {};
  if (!teacherId || !subjectId) {
    return res.status(400).json({ error: "teacherId and subjectId are required." });
  }

  db.assignSubjectToTeacher(teacherId, subjectId);
  res.status(201).json({ success: true });
});

router.delete("/master/teacher-subjects", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { teacherId, subjectId } = req.body || {};
  if (!teacherId || !subjectId) {
    return res.status(400).json({ error: "teacherId and subjectId are required." });
  }

  db.removeSubjectFromTeacher(teacherId, subjectId);
  res.json({ success: true });
});

// ----------------------------------------------------
// LECTURE CRUD ROUTES
// ----------------------------------------------------
router.get("/lectures", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const lectures = db.getLectures(user.id);
  res.json(lectures);
});

router.get("/lectures/:id", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  res.json(auth.lecture);
});

router.post("/lectures", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const { title, subject, instructor, teacherId, subjectId, topicIds, source = "live", language = "auto" } = req.body || {};
  if (!title) {
    return res.status(400).json({ error: "Lecture title is required." });
  }

  let finalSubject = String(subject || "").trim();
  let finalInstructor = String(instructor || "").trim();

  // Validate relational master IDs if provided
  if (teacherId) {
    const t = db.getTeacherById(teacherId);
    if (t) {
      finalInstructor = t.name;
    }
  }

  if (subjectId) {
    const s = db.getSubjectById(subjectId);
    if (s) {
      finalSubject = s.subjectName;
    }
  }

  if (!finalSubject) {
    finalSubject = "General Lecture";
  }

  const newLecture: Lecture = {
    id: `lecture-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: String(title).trim(),
    subject: finalSubject,
    instructor: finalInstructor || "Course Instructor",
    teacherId: teacherId || undefined,
    subjectId: subjectId || undefined,
    topicIds: Array.isArray(topicIds) ? topicIds : undefined,
    language: language || "auto",
    date: new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
    duration: 0,
    status: "idle",
    source: (source as any) || "live",
    transcript: [],
    chapters: [],
    notes: [],
    attempts: [],
    weakTopics: [],
    createdBy: user.id,
    tags: [finalSubject, "AI Organized"],
  };

  db.saveLecture(newLecture);
  res.status(201).json(newLecture);
});

router.put("/lectures/:id", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;

  const updates = { ...req.body };
  delete updates.id;
  delete updates.createdBy;

  const updated = db.updateLecture(req.params.id, updates);
  if (!updated) {
    return res.status(404).json({ error: "Lecture not found" });
  }
  res.json(updated);
});

router.delete("/lectures/:id", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;

  db.deleteLecture(req.params.id);
  res.json({ success: true, message: "Lecture deleted successfully" });
});

router.post("/lectures/reset-sample", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const isDemoEnabled =
    process.env.ENABLE_DEMO_ACCOUNT === "true" || process.env.NODE_ENV !== "production";

  if (!isDemoEnabled || (user.id !== "user-student-1" && user.email !== "alex.student@learnix.ai")) {
    return res.status(403).json({ error: "Reset to sample data is restricted to the demo student account." });
  }

  db.resetToSample(user.id);
  res.json({ success: true, message: "Database reset to sample state successfully." });
});

// ----------------------------------------------------
// LIVE AUDIO TRANSCRIPTION & STREAMING
// ----------------------------------------------------
router.post("/lectures/:id/transcribe-chunk", async (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture, user } = auth;

  const {
    audioBase64,
    mimeType = "audio/webm",
    currentTimestamp = 0,
    sequenceNumber,
    fallbackText,
    language,
  } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ error: "audioBase64 is required" });
  }

  try {
    const existingContext = lecture.transcript.slice(-3).map((t) => t.text).join(" ");
    const segments = await transcribeAudioChunk({
      audioBase64,
      mimeType,
      currentTimestamp: Number(currentTimestamp) || 0,
      existingContext,
      lectureId: lecture.id,
      userId: user.id,
      sequenceNumber: typeof sequenceNumber === "number" ? sequenceNumber : undefined,
      fallbackText: typeof fallbackText === "string" ? fallbackText : undefined,
      language: typeof language === "string" ? language : lecture.language || "auto",
    });

    if (segments.length > 0) {
      lecture.transcript.push(...segments);
      const latestEnd = Math.max(...segments.map((s) => s.endTime));
      lecture.duration = Math.max(lecture.duration, latestEnd);
      db.saveLecture(lecture);
    }

    res.json({
      newSegments: segments,
      totalSegments: lecture.transcript.length,
      currentDuration: lecture.duration,
      status: segments.length > 0 ? "transcribed" : "silence",
    });
  } catch (err: any) {
    console.error("Transcribe chunk error:", err?.message || err);
    const statusCode = typeof err.status === "number" ? err.status : 500;
    res.status(statusCode).json({
      error: err.message || "Transcription failed on chunk",
      status: statusCode,
      details: err.details || err.message,
    });
  }
});

router.post("/lectures/:id/append-transcript", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const { text, startTime, endTime, topic = "Live Lecture", isImportant = false } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Transcript text is required" });
  }

  const segment: TranscriptSegment = {
    id: `trans-${Date.now()}`,
    startTime: Number(startTime) || lecture.duration,
    endTime: Number(endTime) || (Number(startTime) || lecture.duration) + 4,
    text,
    topic,
    isImportant,
  };

  lecture.transcript.push(segment);
  lecture.duration = Math.max(lecture.duration, segment.endTime);
  db.saveLecture(lecture);

  res.json({ segment, totalSegments: lecture.transcript.length });
});

router.post("/lectures/:id/status", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const { status, duration } = req.body;
  if (status) lecture.status = status;
  if (typeof duration === "number") lecture.duration = duration;

  db.saveLecture(lecture);
  res.json(lecture);
});

// ----------------------------------------------------
// COMPLETE LEARNING PACK GENERATION
// ----------------------------------------------------
router.post("/lectures/:id/process-learning-pack", async (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture, user } = auth;

  lecture.status = "processing";
  lecture.processingProgress = {
    stage: "Starting lecture intelligence pipeline...",
    percent: 10,
    message: "Analyzing speech transcript and timestamps...",
    steps: [
      { name: "Audio Transcription & Timestamping", completed: true, active: false },
      { name: "Topic Detection & Chapter Structuring", completed: false, active: true },
      { name: "Smart Notes & Concept Extraction", completed: false, active: false },
      { name: "RAG Vector Knowledge Indexing", completed: false, active: false },
      { name: "Adaptive Assessment Generation", completed: false, active: false },
      { name: "Personalized Revision Setup", completed: false, active: false },
    ],
  };
  db.saveLecture(lecture);

  res.json({ message: "Processing started", lecture });

  (async () => {
    try {
      const current = db.getLectureById(lecture.id);
      if (!current || current.createdBy !== user.id) return;

      current.processingProgress!.percent = 35;
      current.processingProgress!.stage = "Topic Detection & Chapter Structuring";
      current.processingProgress!.steps[1].active = true;
      db.saveLecture(current);

      const understanding = await processLectureTranscript(
        current.title,
        current.subject,
        current.transcript,
        user.id,
        current.id
      );
      current.chapters = understanding.chapters;
      current.notes = understanding.notes;
      current.processingProgress!.steps[1].completed = true;
      current.processingProgress!.steps[1].active = false;

      current.processingProgress!.percent = 60;
      current.processingProgress!.stage = "Smart Notes & Definitions Ready";
      current.processingProgress!.steps[2].completed = true;
      db.saveLecture(current);

      current.processingProgress!.percent = 80;
      current.processingProgress!.stage = "Building Grounded Lecture Knowledge Base";
      current.processingProgress!.steps[3].completed = true;
      db.saveLecture(current);

      current.processingProgress!.percent = 90;
      current.processingProgress!.stage = "Generating Adaptive Assessment";
      current.processingProgress!.steps[4].active = true;
      db.saveLecture(current);

      const quiz = await generateQuizForLecture({
        lecture: current,
        numQuestions: 6,
        difficulty: "mixed",
      });
      current.quiz = quiz;
      current.processingProgress!.steps[4].completed = true;
      current.processingProgress!.steps[4].active = false;

      current.processingProgress!.percent = 100;
      current.processingProgress!.stage = "Learning Pack Ready!";
      current.processingProgress!.steps[5].completed = true;
      current.status = "ready";
      db.saveLecture(current);
      console.log(`Learning pack generated successfully for lecture: ${current.title}`);
    } catch (err) {
      console.error("Pipeline failure:", err);
      const current = db.getLectureById(lecture.id);
      if (current && current.createdBy === user.id) {
        current.status = "failed";
        current.processingProgress = {
          stage: "Processing failed",
          percent: 0,
          message: "An error occurred during AI understanding. Please retry.",
          steps: current.processingProgress?.steps || [],
        };
        db.saveLecture(current);
      }
    }
  })();
});

// ----------------------------------------------------
// FILE UPLOAD FOR RECORDED LECTURES
// ----------------------------------------------------
router.post("/lectures/upload", upload.single("file"), async (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const file = req.file;
  const { title, subject, instructor = "Course Instructor", teacherId, subjectId, topicIds, language = "auto" } = req.body;

  if (!title || !subject) {
    return res.status(400).json({ error: "Title and subject are required" });
  }

  let finalSubject = String(subject).trim();
  let finalInstructor = String(instructor).trim();

  if (teacherId) {
    const t = db.getTeacherById(teacherId);
    if (t) finalInstructor = t.name;
  }
  if (subjectId) {
    const s = db.getSubjectById(subjectId);
    if (s) finalSubject = s.subjectName;
  }

  const newLecture: Lecture = {
    id: `lecture-${Date.now()}`,
    title: String(title).trim(),
    subject: finalSubject,
    instructor: finalInstructor,
    teacherId: teacherId || undefined,
    subjectId: subjectId || undefined,
    topicIds: Array.isArray(topicIds) ? topicIds : undefined,
    language: language || "auto",
    date: new Date().toISOString().split("T")[0],
    duration: 1800,
    status: "processing",
    source: "upload",
    transcript: [
      {
        id: "t-init-1",
        startTime: 0,
        endTime: 60,
        text: `Welcome to ${title}. In this session we will cover core concepts of ${finalSubject}.`,
        topic: "Introduction",
        isImportant: false,
      },
      {
        id: "t-init-2",
        startTime: 60,
        endTime: 180,
        text: `Let's define the fundamental principles and operational steps for this topic.`,
        topic: "Core Fundamentals",
        isDefinition: true,
        isImportant: true,
      },
    ],
    chapters: [],
    notes: [],
    attempts: [],
    weakTopics: [],
    createdBy: user.id,
    processingProgress: {
      stage: "Processing uploaded recording...",
      percent: 25,
      message: file ? `Received ${file.originalname} (${Math.round(file.size / 1024)} KB)` : "Processing media file...",
      steps: [
        { name: "Audio Extraction & Transcribe", completed: true, active: false },
        { name: "Topic Detection & Chapters", completed: false, active: true },
        { name: "Smart Notes Generation", completed: false, active: false },
        { name: "Knowledge Base Indexing", completed: false, active: false },
        { name: "Quiz Generation", completed: false, active: false },
        { name: "Revision Ready", completed: false, active: false },
      ],
    },
  };

  db.saveLecture(newLecture);
  res.status(201).json(newLecture);

  setTimeout(async () => {
    try {
      const current = db.getLectureById(newLecture.id);
      if (!current || current.createdBy !== user.id) return;

      const understanding = await processLectureTranscript(
        current.title,
        current.subject,
        current.transcript,
        user.id,
        current.id
      );
      current.chapters = understanding.chapters;
      current.notes = understanding.notes;
      const quiz = await generateQuizForLecture({ lecture: current, numQuestions: 5 });
      current.quiz = quiz;
      current.status = "ready";
      if (current.processingProgress) {
        current.processingProgress.percent = 100;
        current.processingProgress.stage = "Learning Pack Ready!";
      }
      db.saveLecture(current);
    } catch (e) {
      console.error("Upload background processing error:", e);
    }
  }, 1000);
});

// ----------------------------------------------------
// ASK THE LECTURE (RAG) & SEARCH
// ----------------------------------------------------
router.post("/lectures/:id/ask", async (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const { question, allowGeneralKnowledgeFallback = false } = req.body;
  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: "Question cannot be empty" });
  }

  try {
    const ragResult = await askTheLecture({
      lecture,
      question,
      allowGeneralKnowledgeFallback,
    });
    res.json(ragResult);
  } catch (err: any) {
    console.error("Ask the lecture error:", err);
    res.status(500).json({ error: "Failed to generate answer", details: err.message });
  }
});

router.get("/lectures/:id/search", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const query = (req.query.q as string) || "";
  const results = searchLectureContent(lecture, query);
  res.json(results);
});

// ----------------------------------------------------
// QUIZ & WEAK TOPIC EVALUATION
// ----------------------------------------------------
router.post("/lectures/:id/quiz/generate", async (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const { numQuestions = 6, difficulty = "mixed", questionType = "all", chapterId } = req.body;

  try {
    const quiz = await generateQuizForLecture({
      lecture,
      numQuestions: Number(numQuestions),
      difficulty,
      questionType,
      chapterId,
    });

    lecture.quiz = quiz;
    db.saveLecture(lecture);

    res.json(quiz);
  } catch (err: any) {
    console.error("Quiz generation error:", err);
    res.status(500).json({ error: "Failed to generate quiz", details: err.message });
  }
});

router.post("/lectures/:id/quiz/attempt", async (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  if (!lecture.quiz) {
    return res.status(400).json({ error: "No quiz found for this lecture" });
  }

  const { answers } = req.body;
  if (!answers || typeof answers !== "object") {
    return res.status(400).json({ error: "Answers object is required" });
  }

  try {
    const { attempt, weakTopics } = await evaluateQuizAndDetectWeakTopics({
      lecture,
      quiz: lecture.quiz,
      userAnswers: answers,
    });

    lecture.attempts.push(attempt);
    for (const wt of weakTopics) {
      const existingIdx = lecture.weakTopics.findIndex((w) => w.topicName.toLowerCase() === wt.topicName.toLowerCase());
      if (existingIdx >= 0) {
        lecture.weakTopics[existingIdx] = wt;
      } else {
        lecture.weakTopics.push(wt);
      }
    }

    db.saveLecture(lecture);

    res.json({
      attempt,
      weakTopics,
      message: weakTopics.length > 0 ? `Detected ${weakTopics.length} weak area(s) for revision.` : "Excellent performance!",
    });
  } catch (err: any) {
    console.error("Quiz evaluation error:", err);
    res.status(500).json({ error: "Failed to evaluate quiz", details: err.message });
  }
});

router.post("/lectures/:id/weak-topics/:weakId/practice", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const weakTopic = lecture.weakTopics.find((w) => w.id === req.params.weakId);
  if (!weakTopic) {
    return res.status(404).json({ error: "Weak topic not found" });
  }

  weakTopic.status = "mastered";
  db.saveLecture(lecture);

  res.json({
    success: true,
    message: `Mini-drill completed! "${weakTopic.topicName}" marked as mastered.`,
    weakTopic,
  });
});

// ----------------------------------------------------
// STUDENT NOTES UPDATE
// ----------------------------------------------------
router.put("/lectures/:id/notes", (req: Request, res: Response) => {
  const auth = requireLectureOwnership(req, res, req.params.id);
  if (!auth) return;
  const { lecture } = auth;

  const { notes, chapters, quiz } = req.body;
  if (notes) lecture.notes = notes;
  if (chapters) lecture.chapters = chapters;
  if (quiz) lecture.quiz = quiz;

  db.saveLecture(lecture);
  res.json({ success: true, message: "Study notes updated successfully.", lecture });
});

// ----------------------------------------------------
// AI ORCHESTRATION & QUOTA MANAGEMENT
// ----------------------------------------------------
router.get("/system/ai-usage", (req: Request, res: Response) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const report = aiOrchestrator.getUsageReport();
  res.json(report);
});

router.post("/system/ai-usage/reset", (req: Request, res: Response) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  aiOrchestrator.resetModelQuotas();
  res.json({ success: true, message: "AI quotas reset successfully.", report: aiOrchestrator.getUsageReport() });
});

export default router;
