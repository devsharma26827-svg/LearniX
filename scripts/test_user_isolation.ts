import path from "path";
import fs from "fs";
import http from "http";
import assert from "assert";
import express from "express";

// Point SQLite DB to a dedicated isolation test path before importing database/routes
const TEST_DIR = path.join(process.cwd(), ".data_test", "isolation_suite");
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

process.env.SQLITE_DB_PATH = path.join(TEST_DIR, "isolation_test.sqlite");

async function runIsolationSuite() {
  console.log("==================================================");
  console.log("  MULTI-USER DATA ISOLATION & ZERO-STATE TEST     ");
  console.log("==================================================");

  // Dynamically import db and apiRoutes after setting process.env.SQLITE_DB_PATH
  const { db } = await import("../server/db");
  const { default: apiRoutes } = await import("../server/routes/api");

  // Create test express app
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", apiRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number; address: string };
  const BASE_URL = `http://127.0.0.1:${address.port}`;
  console.log(`[Setup] Test server running at ${BASE_URL}`);

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Demo Account Baseline
    // -------------------------------------------------------------------------
    console.log("\n[Phase 1] Demo Account Baseline & Sample Lecture Integrity...");
    const demoEmail = "alex.student@learnix.ai";
    const demoLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: demoEmail, password: "DemoStudent@123" }),
    });
    assert.strictEqual(demoLoginRes.status, 200, "Demo login must succeed");
    const demoLoginData = (await demoLoginRes.json()) as any;
    const demoToken = demoLoginData.token;
    assert(demoToken, "Demo login must return session token");

    const demoHeaders = {
      Authorization: `Bearer ${demoToken}`,
      "Content-Type": "application/json",
    };

    const demoLecturesRes = await fetch(`${BASE_URL}/api/lectures`, {
      headers: demoHeaders,
    });
    assert.strictEqual(demoLecturesRes.status, 200, "Demo user GET /api/lectures must return 200");
    const demoLectures = (await demoLecturesRes.json()) as any[];

    assert.strictEqual(demoLectures.length, 3, "Demo user must see exactly 3 sample lectures");
    assert(
      demoLectures.every((l) => l.createdBy === "user-student-1" && l.source === "sample"),
      "All demo lectures must be owned by user-student-1"
    );

    // Verify demo lecture access
    const demoSampleLectureId = demoLectures[0].id;
    const demoDetailRes = await fetch(`${BASE_URL}/api/lectures/${demoSampleLectureId}`, {
      headers: demoHeaders,
    });
    assert.strictEqual(demoDetailRes.status, 200, "Demo user must access their sample lecture");
    const demoDetail = await demoDetailRes.json();
    assert.strictEqual(demoDetail.id, demoSampleLectureId);
    console.log("✓ Phase 1 Passed: Demo student sees all 3 sample lectures with complete data.");

    // -------------------------------------------------------------------------
    // Phase 2: New User Registration & Zero-State Verification
    // -------------------------------------------------------------------------
    console.log("\n[Phase 2] New User Registration & Zero-State Initialization...");
    const newStudentEmail = "fresh.student@learnix.ai";
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fresh Student",
        email: newStudentEmail,
        password: "SecurePassword123!",
        college: "MIT",
        preferredLanguage: "English",
        noteStyle: "Comprehensive",
        difficultyPreference: "Intermediate",
      }),
    });
    assert.strictEqual(regRes.status, 201, "Registering a new student must return 201");
    const regData = (await regRes.json()) as any;
    assert(regData.user && regData.user.id, "Registered response must include user with id");
    const newStudentId = regData.user.id;
    const newStudentToken = regData.token;
    assert(newStudentToken, "Register response must return session token");
    const newStudentHeaders = {
      Authorization: `Bearer ${newStudentToken}`,
      "Content-Type": "application/json",
    };

    // Query lectures for newly registered student
    const newLecturesRes = await fetch(`${BASE_URL}/api/lectures`, {
      headers: newStudentHeaders,
    });
    assert.strictEqual(newLecturesRes.status, 200, "New user GET /api/lectures must return 200");
    const newLectures = (await newLecturesRes.json()) as any[];

    assert.strictEqual(
      newLectures.length,
      0,
      `New user must have 0 lectures (received ${newLectures.length})`
    );

    // Verify all zero-state derived statistics
    const totalLectures = newLectures.length;
    const totalNotes = newLectures.reduce((acc, l) => acc + (l.notes?.length || 0), 0);
    const totalChapters = newLectures.reduce((acc, l) => acc + (l.chapters?.length || 0), 0);
    const allAttempts = newLectures.flatMap((l) => l.attempts || []);
    const avgAccuracy = allAttempts.length > 0 ? 86 : 0;
    const weakTopicsCount = newLectures.flatMap((l) => l.weakTopics || []).length;
    const studyMinutes = newLectures.reduce((acc, l) => acc + (l.duration || 0), 0);

    assert.strictEqual(totalLectures, 0, "Zero-state total lectures must be 0");
    assert.strictEqual(totalNotes, 0, "Zero-state total notes must be 0");
    assert.strictEqual(totalChapters, 0, "Zero-state total chapters must be 0");
    assert.strictEqual(allAttempts.length, 0, "Zero-state completed quizzes must be 0");
    assert.strictEqual(avgAccuracy, 0, "Zero-state quiz accuracy must be 0%");
    assert.strictEqual(weakTopicsCount, 0, "Zero-state weak topics must be 0");
    assert.strictEqual(studyMinutes, 0, "Zero-state study minutes must be 0");
    console.log("✓ Phase 2 Passed: Newly registered student starts with pristine zero-state (0 lectures, 0 notes, 0 quizzes, 0% accuracy).");

    // -------------------------------------------------------------------------
    // Phase 3: Cross-Tenant Protection & Access Denial
    // -------------------------------------------------------------------------
    console.log("\n[Phase 3] Cross-Tenant Access Protection (Attacks & Probing)...");
    const targetDemoLectureId = demoSampleLectureId;

    // 1. GET /api/lectures/:id
    const probeGet = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}`, {
      headers: newStudentHeaders,
    });
    assert.strictEqual(probeGet.status, 403, "New user accessing demo lecture must be 403 Forbidden");

    // 2. PUT /api/lectures/:id
    const probePut = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}`, {
      method: "PUT",
      headers: newStudentHeaders,
      body: JSON.stringify({ title: "Hacked Title" }),
    });
    assert.strictEqual(probePut.status, 403, "New user modifying demo lecture must be 403 Forbidden");

    // 3. DELETE /api/lectures/:id
    const probeDelete = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}`, {
      method: "DELETE",
      headers: newStudentHeaders,
    });
    assert.strictEqual(probeDelete.status, 403, "New user deleting demo lecture must be 403 Forbidden");

    // 4. POST /api/lectures/:id/ask
    const probeAsk = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}/ask`, {
      method: "POST",
      headers: newStudentHeaders,
      body: JSON.stringify({ question: "Tell me secrets" }),
    });
    assert.strictEqual(probeAsk.status, 403, "New user asking demo lecture must be 403 Forbidden");

    // 5. POST /api/lectures/:id/quiz/generate
    const probeQuizGen = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}/quiz/generate`, {
      method: "POST",
      headers: newStudentHeaders,
    });
    assert.strictEqual(probeQuizGen.status, 403, "New user generating quiz on demo lecture must be 403 Forbidden");

    // 6. POST /api/lectures/:id/quiz/attempt
    const probeQuizAttempt = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}/quiz/attempt`, {
      method: "POST",
      headers: newStudentHeaders,
      body: JSON.stringify({ answers: {} }),
    });
    assert.strictEqual(probeQuizAttempt.status, 403, "New user submitting quiz attempt on demo lecture must be 403 Forbidden");

    // 7. PUT /api/lectures/:id/notes
    const probeNotes = await fetch(`${BASE_URL}/api/lectures/${targetDemoLectureId}/notes`, {
      method: "PUT",
      headers: newStudentHeaders,
      body: JSON.stringify({ notes: [] }),
    });
    assert.strictEqual(probeNotes.status, 403, "New user updating notes on demo lecture must be 403 Forbidden");

    // 8. POST /api/lectures/reset-sample by non-demo user
    const probeReset = await fetch(`${BASE_URL}/api/lectures/reset-sample`, {
      method: "POST",
      headers: newStudentHeaders,
    });
    assert.strictEqual(probeReset.status, 403, "Ordinary user resetting sample data must be 403 Forbidden");
    console.log("✓ Phase 3 Passed: All 8 cross-tenant attack vectors successfully blocked with HTTP 403 Forbidden.");

    // -------------------------------------------------------------------------
    // Phase 4: Unauthenticated Access Denial
    // -------------------------------------------------------------------------
    console.log("\n[Phase 4] Unauthenticated Requests...");
    const unauthGet = await fetch(`${BASE_URL}/api/lectures`);
    assert.strictEqual(unauthGet.status, 401, "Unauthenticated GET /api/lectures must return 401");

    const invalidAuthGet = await fetch(`${BASE_URL}/api/lectures`, {
      headers: { Authorization: "Bearer bogus-token-12345" },
    });
    assert.strictEqual(invalidAuthGet.status, 401, "Invalid token GET /api/lectures must return 401");
    console.log("✓ Phase 4 Passed: Unauthenticated and forged tokens rejected with HTTP 401.");

    // -------------------------------------------------------------------------
    // Phase 5: Multi-Tenant Activity & Strict Isolation Between Users
    // -------------------------------------------------------------------------
    console.log("\n[Phase 5] Independent User Activity & Mutual Isolation...");
    // Fresh Student creates a lecture
    const createRes = await fetch(`${BASE_URL}/api/lectures`, {
      method: "POST",
      headers: newStudentHeaders,
      body: JSON.stringify({
        title: "Quantum Computing Principles",
        subject: "Physics",
        instructor: "Prof. Feynman",
        duration: 3600,
        source: "live",
      }),
    });
    assert.strictEqual(createRes.status, 201, "Creating lecture must return 201");
    const createdLecture = await createRes.json();
    assert.strictEqual(
      createdLecture.createdBy,
      newStudentId,
      "Backend must enforce createdBy from authenticated session"
    );
    const quantumLecId = createdLecture.id;

    // Attach quiz via PUT /api/lectures/:id
    const attachQuizRes = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}`, {
      method: "PUT",
      headers: newStudentHeaders,
      body: JSON.stringify({
        quiz: {
          id: "quiz-qc-1",
          lectureId: quantumLecId,
          title: "Quantum Drill",
          totalQuestions: 1,
          createdAt: new Date().toISOString(),
          questions: [
            {
              id: "q1",
              question: "What represents a qubit on a sphere?",
              type: "mcq",
              options: ["Bloch Sphere", "Poincare Sphere", "Riemann Sphere"],
              correctAnswer: "Bloch Sphere",
              explanation: "Qubits are represented on the Bloch Sphere.",
              difficulty: "medium",
              topic: "Qubits",
            },
          ],
        },
      }),
    });
    assert.strictEqual(attachQuizRes.status, 200, "Attaching quiz via PUT must return 200");

    // Register a second independent student (Student B)
    const studentBEmail = "student.b@learnix.ai";
    const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Student B",
        email: studentBEmail,
        password: "SecurePassword456!",
        college: "Stanford",
      }),
    });
    assert.strictEqual(regBRes.status, 201, "Registering student B must return 201");
    const regBData = (await regBRes.json()) as any;
    const studentBToken = regBData.token;
    assert(studentBToken, "Register response must return session token for Student B");
    const studentBHeaders = {
      Authorization: `Bearer ${studentBToken}`,
      "Content-Type": "application/json",
    };

    // Student B queries lectures -> must be 0
    const bLecturesRes = await fetch(`${BASE_URL}/api/lectures`, {
      headers: studentBHeaders,
    });
    const bLectures = (await bLecturesRes.json()) as any[];
    assert.strictEqual(bLectures.length, 0, "Student B must see 0 lectures (cannot see Student A's)");

    // Student B probes Student A's quantum lecture
    const bProbeA = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}`, {
      headers: studentBHeaders,
    });
    assert.strictEqual(bProbeA.status, 403, "Student B cannot view Student A's lecture (403 Forbidden)");

    const bDeleteA = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}`, {
      method: "DELETE",
      headers: studentBHeaders,
    });
    assert.strictEqual(bDeleteA.status, 403, "Student B cannot delete Student A's lecture (403 Forbidden)");

    // Student A updates notes on their quantum lecture
    const updatedNotes = [
      {
        id: "note-qc-1",
        topic: "Superposition",
        summary: "Qubits exist in linear combinations of basis states |0> and |1>.",
        definitions: [{ term: "Qubit", definition: "Quantum bit", timestamp: 60 }],
        keyConcepts: ["Superposition", "Bloch Sphere"],
        examples: ["Hadamard gate"],
        importantPoints: ["Measurement collapses state"],
        sourceTimestamps: [{ start: 0, end: 300 }],
      },
    ];
    const updateNotesRes = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}/notes`, {
      method: "PUT",
      headers: newStudentHeaders,
      body: JSON.stringify({ notes: updatedNotes }),
    });
    assert.strictEqual(updateNotesRes.status, 200, "Student A updating their own notes must succeed");

    // Student A submits a quiz attempt
    const quizAttemptRes = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}/quiz/attempt`, {
      method: "POST",
      headers: newStudentHeaders,
      body: JSON.stringify({
        quizId: "dummy-quiz",
        answers: { q1: "Bloch Sphere" },
        score: 100,
        maxScore: 100,
        accuracy: 100,
        questionResults: [],
        topicBreakdown: {},
        weakTopics: [],
      }),
    });
    assert.strictEqual(quizAttemptRes.status, 200, "Student A submitting their quiz attempt must succeed");

    // Verify Student A's metrics updated
    const aLecturesRes = await fetch(`${BASE_URL}/api/lectures`, {
      headers: newStudentHeaders,
    });
    const aLectures = (await aLecturesRes.json()) as any[];
    assert.strictEqual(aLectures.length, 1);
    assert.strictEqual(aLectures[0].notes.length, 1);
    assert.strictEqual(aLectures[0].attempts.length, 1);
    assert.strictEqual(aLectures[0].attempts[0].accuracy, 100);

    // Verify Demo Student and Student B are still completely isolated
    const demoCheckRes = await fetch(`${BASE_URL}/api/lectures`, {
      headers: demoHeaders,
    });
    const demoCheck = (await demoCheckRes.json()) as any[];
    assert.strictEqual(demoCheck.length, 3, "Demo user still has exactly 3 lectures");
    assert(!demoCheck.some((l) => l.id === quantumLecId), "Demo user must not see Student A's lecture");
    console.log("✓ Phase 5 Passed: Dynamic isolation confirmed between independent students.");

    // -------------------------------------------------------------------------
    // Phase 6: Demo Sample Reset Protection
    // -------------------------------------------------------------------------
    console.log("\n[Phase 6] Demo Sample Reset Protection...");
    const demoResetRes = await fetch(`${BASE_URL}/api/lectures/reset-sample`, {
      method: "POST",
      headers: demoHeaders,
    });
    assert.strictEqual(demoResetRes.status, 200, "Demo user sample reset must return 200");

    // Check Student A's lecture is still alive in SQLite
    const aCheckAfterReset = await fetch(`${BASE_URL}/api/lectures/${quantumLecId}`, {
      headers: newStudentHeaders,
    });
    assert.strictEqual(
      aCheckAfterReset.status,
      200,
      "Student A's lecture MUST remain completely intact after demo sample reset"
    );
    console.log("✓ Phase 6 Passed: Demo sample reset restored sample data without affecting custom users.");

    console.log("\n==================================================");
    console.log("  ALL ISOLATION & ZERO-STATE TESTS PASSED!        ");
    console.log("==================================================");
  } finally {
    server.close();
    db.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

runIsolationSuite().catch((err) => {
  console.error("Test Suite Failed with error:", err);
  process.exit(1);
});
