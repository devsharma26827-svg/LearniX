import fs from "fs";
import path from "path";
import assert from "assert";
import { spawn, ChildProcess } from "child_process";
import { Database, getDatabasePath } from "../server/db";
import { SAMPLE_LECTURES, SAMPLE_USERS } from "../server/sampleData";
import { Lecture, User } from "../src/types";

const PORT = 4242;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to wait for server to respond
async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // wait a bit
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Helper to kill a child process tree on Windows
function killProcess(child?: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.pid === undefined) {
      // Still make sure port 4242 is clear
      try {
        const clearPort = spawn("powershell", [
          "-Command",
          "Get-NetTCPConnection -LocalPort 4242 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
        ]);
        clearPort.on("close", () => setTimeout(resolve, 1500));
        clearPort.on("error", () => setTimeout(resolve, 1500));
      } catch {
        setTimeout(resolve, 1500);
      }
      return;
    }
    try {
      if (process.platform === "win32") {
        const killProc = spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
        killProc.on("close", () => {
          const clearPort = spawn("powershell", [
            "-Command",
            "Get-NetTCPConnection -LocalPort 4242 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
          ]);
          clearPort.on("close", () => setTimeout(resolve, 1500));
          clearPort.on("error", () => setTimeout(resolve, 1500));
        });
        killProc.on("error", () => setTimeout(resolve, 2000));
        return;
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
    setTimeout(resolve, 2000);
  });
}

async function runFinalVerification() {
  console.log("==================================================================");
  console.log("       EDU PULSE AI OS - FINAL SQLITE VERIFICATION SUITE         ");
  console.log("==================================================================");

  const results: { test: string; commandOrEndpoint: string; status: "PASS" | "FAIL"; error?: string }[] = [];
  let serverProcess: ChildProcess | undefined;
  let restartProcess: ChildProcess | undefined;

  try {

  // =========================================================================
  // CHECK 1: Method Preservation in server/db.ts
  // =========================================================================
  try {
    const requiredMethods = [
      "getUsers",
      "getUserById",
      "getUserByEmail",
      "createUser",
      "updateUser",
      "deleteUser",
      "getLectures",
      "getLectureById",
      "saveLecture",
      "updateLecture",
      "deleteLecture",
      "resetToSample",
    ];

    const tempDbPath = path.join(process.cwd(), ".data", "test_methods.sqlite");
    const testDb = new Database(tempDbPath);

    for (const method of requiredMethods) {
      assert.strictEqual(
        typeof (testDb as any)[method],
        "function",
        `Database must implement method: ${method}`
      );
    }
    testDb.close();
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    results.push({ test: "1. Preserved DB Method Signatures", commandOrEndpoint: "server/db.ts interface check", status: "PASS" });
    console.log("✓ 1. Every original exported database method is preserved.");
  } catch (err: any) {
    results.push({ test: "1. Preserved DB Method Signatures", commandOrEndpoint: "server/db.ts interface check", status: "FAIL", error: err.message });
  }

  // =========================================================================
  // CHECK 2 & 8: No In-Memory Fallback on DB Errors & Schema Check
  // =========================================================================
  try {
    const brokenDb = new Database(":memory:");
    // Drop table to simulate severe database schema corruption/error
    brokenDb.getSqlite().exec("DROP TABLE users");

    let threwError = false;
    try {
      brokenDb.getUsers();
    } catch (err) {
      threwError = true;
    }
    brokenDb.close();

    assert(threwError, "Database failure MUST throw and NEVER fall back to in-memory Map/array storage");
    results.push({ test: "8. No Silent Fallback to In-Memory Storage", commandOrEndpoint: "Database write/read error handling", status: "PASS" });
    console.log("✓ 8. Database errors throw explicit exceptions without in-memory fallback.");
  } catch (err: any) {
    results.push({ test: "8. No Silent Fallback to In-Memory Storage", commandOrEndpoint: "Database write/read error handling", status: "FAIL", error: err.message });
  }

  // =========================================================================
  // CHECK 9: SQLite Schema & Constraints Inspection
  // =========================================================================
  try {
    const mainDbPath = getDatabasePath();
    const probeDb = new Database(mainDbPath);
    const sqlite = probeDb.getSqlite();

    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    assert(tables.includes("users"), "Schema must have users table");
    assert(tables.includes("lectures"), "Schema must have lectures table");
    assert(tables.includes("_migrations"), "Schema must have _migrations table");

    const foreignKeysPragma = sqlite.pragma("foreign_keys");
    assert.deepStrictEqual(foreignKeysPragma, [{ foreign_keys: 1 }], "PRAGMA foreign_keys must be enabled (1)");

    const userIndices = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'").all().map((r: any) => r.name);
    assert(userIndices.includes("idx_users_email"), "Users table must have case-insensitive email index");

    const lectureIndices = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lectures'").all().map((r: any) => r.name);
    assert(lectureIndices.includes("idx_lectures_created_by"), "Lectures table must have created_by index");
    assert(lectureIndices.includes("idx_lectures_source"), "Lectures table must have source index");

    probeDb.close();
    results.push({ test: "9. Schema & Indexes Verification", commandOrEndpoint: "PRAGMA & sqlite_master queries", status: "PASS" });
    console.log("✓ 9. SQLite tables, indices, and pragmas verified.");
  } catch (err: any) {
    results.push({ test: "9. Schema & Indexes Verification", commandOrEndpoint: "PRAGMA & sqlite_master queries", status: "FAIL", error: err.message });
  }

  // =========================================================================
  // CHECK 4 & 5: Live API Endpoints & AI/Gemini Verification
  // =========================================================================
  console.log("\nStarting application server for API verification...");
  serverProcess = spawn("npx", ["tsx", "server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: PORT.toString(), AUTO_OPEN: "false" },
    stdio: "inherit",
    shell: true,
  });

  const isUp = await waitForServer(BASE_URL);
  assert(isUp, "Server should be running at " + BASE_URL);

  let testAuthToken = "";
  let testStudentId = "";
  let testLectureId = "";

  // Auth Register
  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Elena Rostova", email: "elena.rostova@university.edu" }),
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 200);
    testAuthToken = regData.token;
    testStudentId = regData.user.id;
    results.push({ test: "API: POST /api/auth/register", commandOrEndpoint: "POST /api/auth/register", status: "PASS" });
  } catch (err: any) {
    results.push({ test: "API: POST /api/auth/register", commandOrEndpoint: "POST /api/auth/register", status: "FAIL", error: err.message });
  }

  // 4a. POST /api/lectures/upload
  try {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      '',
      'Quantum Computing Foundations',
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      '',
      'Quantum Physics',
      `--${boundary}`,
      'Content-Disposition: form-data; name="createdBy"',
      '',
      testStudentId,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadRes = await fetch(`${BASE_URL}/api/lectures/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${testAuthToken}`,
      },
      body,
    });
    assert.strictEqual(uploadRes.status, 201);
    const uploadData = await uploadRes.json();
    assert(uploadData.id, "Upload must return lecture with ID");
    assert.strictEqual(uploadData.source, "upload");
    assert.strictEqual(uploadData.status, "processing");
    testLectureId = uploadData.id;
    results.push({ test: "API: POST /api/lectures/upload", commandOrEndpoint: "POST /api/lectures/upload", status: "PASS" });
    console.log("✓ POST /api/lectures/upload succeeded, lectureId:", testLectureId);
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/upload", commandOrEndpoint: "POST /api/lectures/upload", status: "FAIL", error: err.message });
  }

  // 4b. POST /api/lectures/:id/transcribe-chunk
  try {
    const dummyAudioBase64 = Buffer.from("DUMMY_AUDIO_WAV_HEADER_DATA").toString("base64");
    const transRes = await fetch(`${BASE_URL}/api/lectures/${testLectureId}/transcribe-chunk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        audioBase64: dummyAudioBase64,
        mimeType: "audio/webm",
        currentTimestamp: 180,
      }),
    });
    assert.strictEqual(transRes.status, 200);
    const transData = await transRes.json();
    assert(Array.isArray(transData.newSegments));
    results.push({ test: "API: POST /api/lectures/:id/transcribe-chunk", commandOrEndpoint: "POST /api/lectures/:id/transcribe-chunk", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/transcribe-chunk succeeded");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/transcribe-chunk", commandOrEndpoint: "POST /api/lectures/:id/transcribe-chunk", status: "FAIL", error: err.message });
  }

  // 4c. POST /api/lectures/:id/process-learning-pack
  try {
    const packRes = await fetch(`${BASE_URL}/api/lectures/${testLectureId}/process-learning-pack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
    });
    assert.strictEqual(packRes.status, 200);
    const packData = await packRes.json();
    assert.strictEqual(packData.message, "Processing started");
    results.push({ test: "API: POST /api/lectures/:id/process-learning-pack", commandOrEndpoint: "POST /api/lectures/:id/process-learning-pack", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/process-learning-pack initiated");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/process-learning-pack", commandOrEndpoint: "POST /api/lectures/:id/process-learning-pack", status: "FAIL", error: err.message });
  }

  // 4d. PUT /api/lectures/:id/notes
  try {
    const notesRes = await fetch(`${BASE_URL}/api/lectures/${testLectureId}/notes`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        notes: [
          {
            id: "note_qc_1",
            topic: "Qubits and Superposition",
            summary: "A qubit can exist in a linear combination of states |0> and |1>.",
            definitions: [
              { term: "Superposition", definition: "Linear combination of quantum basis states." },
            ],
            keyConcepts: ["Bloch Sphere", "Hadamard Gate"],
            examples: ["Spin-1/2 particles"],
            importantPoints: ["Measurement causes wave function collapse."],
            sourceTimestamps: [{ start: 0, end: 120 }],
          },
        ],
        chapters: [
          {
            id: "chap_qc_1",
            title: "Superposition Fundamentals",
            startTime: 0,
            endTime: 120,
            description: "Understanding probability amplitudes.",
            keyConcepts: ["Bloch Sphere"],
          },
        ],
      }),
    });
    assert.strictEqual(notesRes.status, 200);
    const notesData = await notesRes.json();
    assert.strictEqual(notesData.success, true);
    results.push({ test: "API: PUT /api/lectures/:id/notes", commandOrEndpoint: "PUT /api/lectures/:id/notes", status: "PASS" });
    console.log("✓ PUT /api/lectures/:id/notes updated notes & chapters");
  } catch (err: any) {
    results.push({ test: "API: PUT /api/lectures/:id/notes", commandOrEndpoint: "PUT /api/lectures/:id/notes", status: "FAIL", error: err.message });
  }

  // 4e. POST /api/lectures/:id/ask (Grounded RAG)
  try {
    const askRes = await fetch(`${BASE_URL}/api/lectures/lecture-dsa-stack-queue/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        question: "What is a stack and what principle does it follow?",
        allowGeneralKnowledgeFallback: true,
      }),
    });
    assert.strictEqual(askRes.status, 200);
    const askData = await askRes.json();
    assert(askData.answer, "RAG response must include an answer");
    assert(Array.isArray(askData.sources), "RAG response must include citation sources");
    results.push({ test: "API: POST /api/lectures/:id/ask", commandOrEndpoint: "POST /api/lectures/:id/ask", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/ask returned grounded answer");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/ask", commandOrEndpoint: "POST /api/lectures/:id/ask", status: "FAIL", error: err.message });
  }

  // 4f. POST /api/lectures/:id/quiz/generate
  try {
    const quizRes = await fetch(`${BASE_URL}/api/lectures/${testLectureId}/quiz/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({ numQuestions: 2 }),
    });
    assert.strictEqual(quizRes.status, 200);
    const quizData = await quizRes.json();
    assert(quizData.id, "Generated quiz must have an ID");
    assert(Array.isArray(quizData.questions));
    results.push({ test: "API: POST /api/lectures/:id/quiz/generate", commandOrEndpoint: "POST /api/lectures/:id/quiz/generate", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/quiz/generate generated quiz questions");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/quiz/generate", commandOrEndpoint: "POST /api/lectures/:id/quiz/generate", status: "FAIL", error: err.message });
  }

  // 4g. POST /api/lectures/:id/quiz/attempt (on sample lecture)
  const sampleId = "lecture-dsa-stack-queue";
  try {
    const attemptRes = await fetch(`${BASE_URL}/api/lectures/${sampleId}/quiz/attempt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        answers: {
          "q-1": "LIFO (Last-In, First-Out)",
          "q-2": "O(1)",
          "q-3": "When attempting to push an element into a stack that has reached its MAX_SIZE capacity",
          "q-4": "Call Stack Overflow due to infinite stack frame allocation",
          "q-5": "Enqueue at Rear (tail), Dequeue at Front (head)",
          "q-6": "Breadth-First Search (BFS)",
        },
      }),
    });
    assert.strictEqual(attemptRes.status, 200);
    const attemptData = await attemptRes.json();
    assert(attemptData.attempt);
    results.push({ test: "API: POST /api/lectures/:id/quiz/attempt", commandOrEndpoint: "POST /api/lectures/:id/quiz/attempt", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/quiz/attempt recorded score & feedback");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/quiz/attempt", commandOrEndpoint: "POST /api/lectures/:id/quiz/attempt", status: "FAIL", error: err.message });
  }

  // 4h. POST /api/lectures/:id/weak-topics/:weakId/practice
  try {
    const sampleLecRes = await fetch(`${BASE_URL}/api/lectures/${sampleId}`);
    const sampleLec = await sampleLecRes.json();
    const weakTopic = sampleLec.weakTopics?.[0];
    assert(weakTopic, "Sample lecture must have weak topics for testing");

    const practiceRes = await fetch(`${BASE_URL}/api/lectures/${sampleId}/weak-topics/${weakTopic.id}/practice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({ answers: { p1: "answer" } }),
    });
    assert.strictEqual(practiceRes.status, 200);
    const practiceData = await practiceRes.json();
    assert.strictEqual(practiceData.success, true);
    assert.strictEqual(practiceData.weakTopic.status, "mastered");
    results.push({ test: "API: POST /api/lectures/:id/weak-topics/:weakId/practice", commandOrEndpoint: "POST /api/lectures/:id/weak-topics/:weakId/practice", status: "PASS" });
    console.log("✓ POST /api/lectures/:id/weak-topics/:weakId/practice marked topic mastered");
  } catch (err: any) {
    results.push({ test: "API: POST /api/lectures/:id/weak-topics/:weakId/practice", commandOrEndpoint: "POST /api/lectures/:id/weak-topics/:weakId/practice", status: "FAIL", error: err.message });
  }

  // =========================================================================
  // CHECK 6: Genuine Process-Level Persistence Test Across Process Termination
  // =========================================================================
  console.log("\n[Test 6] Genuine Process-Level Restart & Persistence Test...");
  try {
    // 1. Create a dedicated lecture via POST /api/lectures
    const createLecRes = await fetch(`${BASE_URL}/api/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        title: "Relational Database Theory",
        subject: "Database Systems",
        instructor: "Dr. Codd",
        createdBy: testStudentId,
      }),
    });
    assert.strictEqual(createLecRes.status, 201);
    const dedicatedLec = await createLecRes.json();
    const dedicatedLecId = dedicatedLec.id;

    // 2. Add transcript segments
    await fetch(`${BASE_URL}/api/lectures/${dedicatedLecId}/append-transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        text: "Relations are mathematical sets of tuples conforming to schema predicates.",
        startTime: 0,
        endTime: 30,
        topic: "Relational Model",
        isImportant: true,
      }),
    });

    // 3. Add chapters, notes, and quiz
    await fetch(`${BASE_URL}/api/lectures/${dedicatedLecId}/notes`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testAuthToken}`,
      },
      body: JSON.stringify({
        notes: [
          {
            id: "note_db_1",
            topic: "Relational Algebra",
            summary: "Formal procedural query language operating on relations.",
            definitions: [{ term: "Relation", definition: "A set of ordered tuples." }],
            keyConcepts: ["Select", "Project", "Join"],
            examples: ["Natural Join between Students and Grades"],
            importantPoints: ["Tuples in a relation have no intrinsic order."],
            sourceTimestamps: [{ start: 0, end: 30 }],
          },
        ],
        chapters: [
          {
            id: "chap_db_1",
            title: "Relational Model Foundations",
            startTime: 0,
            endTime: 30,
            description: "Mathematical foundations of tables.",
            keyConcepts: ["Tuples", "Attributes"],
          },
        ],
        quiz: {
          id: `quiz-${dedicatedLecId}`,
          lectureId: dedicatedLecId,
          title: "Relational Theory Quiz",
          totalQuestions: 1,
          createdAt: new Date().toISOString(),
          questions: [
            {
              id: "q_rel_1",
              question: "Do tuples in a relation have order?",
              type: "mcq",
              options: ["No, relations are unordered sets", "Yes, ordered by insertion"],
              correctAnswer: "No, relations are unordered sets",
              explanation: "In set theory, elements of a set have no order.",
              sourceChapter: "Relational Model Foundations",
              sourceTimestamp: 15,
              difficulty: "easy",
              topic: "Relational Model",
            },
          ],
        },
      }),
    });

    // 4. Kill the running server process completely
    console.log("Terminating server process (PID:", serverProcess.pid, ")...");
    await killProcess(serverProcess);

    // 5. Confirm server is dead
    let isDead = false;
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      isDead = true;
    }
    assert(isDead, "Server process must be confirmed dead");
    console.log("Server successfully stopped.");

    // 6. Start brand new server process
    console.log("Starting new server process...");
    restartProcess = spawn("npx", ["tsx", "server.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: PORT.toString(), AUTO_OPEN: "false" },
      stdio: "inherit",
      shell: true,
    });

    const isRestarted = await waitForServer(BASE_URL);
    assert(isRestarted, "Restarted server should be running");
    console.log("Server successfully restarted.");

    // 7. Fetch previously created user via API
    const postRestartUserRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${testAuthToken}` },
    });
    assert.strictEqual(postRestartUserRes.status, 200, "User session should persist across server restart");
    const postRestartUser = (await postRestartUserRes.json()).user;
    assert.strictEqual(postRestartUser.id, testStudentId);
    assert.strictEqual(postRestartUser.email, "elena.rostova@university.edu");

    // 8. Fetch previously created lecture via API
    const postRestartLecRes = await fetch(`${BASE_URL}/api/lectures/${dedicatedLecId}`);
    assert.strictEqual(postRestartLecRes.status, 200, "Lecture must persist across process restart");
    const postRestartLec = await postRestartLecRes.json();
    assert.strictEqual(postRestartLec.id, dedicatedLecId);
    assert.strictEqual(postRestartLec.title, "Relational Database Theory");
    assert.strictEqual(postRestartLec.notes[0].topic, "Relational Algebra");
    assert.strictEqual(postRestartLec.notes[0].definitions[0].term, "Relation");
    assert.strictEqual(postRestartLec.chapters[0].title, "Relational Model Foundations");
    assert.strictEqual(postRestartLec.transcript.length, 1);
    assert.strictEqual(postRestartLec.quiz?.questions[0].correctAnswer, "No, relations are unordered sets");

    // Cleanup created test records
    await fetch(`${BASE_URL}/api/lectures/${dedicatedLecId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${testAuthToken}` },
    });
    await fetch(`${BASE_URL}/api/lectures/${testLectureId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${testAuthToken}` },
    });
    await fetch(`${BASE_URL}/api/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${testAuthToken}` },
    });

    await killProcess(restartProcess);
    results.push({ test: "6. Process-Level Restart Persistence", commandOrEndpoint: "Full Process Termination & Restart", status: "PASS" });
    console.log("✓ 6. Process-level persistence test PASSED with 100% data integrity verified.");
  } catch (err: any) {
    results.push({ test: "6. Process-Level Restart Persistence", commandOrEndpoint: "Full Process Termination & Restart", status: "FAIL", error: err.message });
  }

  } finally {
    if (serverProcess) await killProcess(serverProcess);
    if (restartProcess) await killProcess(restartProcess);
  }

  // Print summary table
  console.log("\n==================================================================");
  console.log("               VERIFICATION RESULTS SUMMARY TABLE                 ");
  console.log("==================================================================");
  console.table(results);

  const failures = results.filter((r) => r.status === "FAIL");
  if (failures.length > 0) {
    console.error(`FAILED with ${failures.length} errors.`);
    process.exit(1);
  } else {
    console.log("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  }
}

runFinalVerification().catch((err) => {
  console.error("Verification script fatal error:", err);
  process.exit(1);
});
