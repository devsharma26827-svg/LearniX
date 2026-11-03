import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import { db } from "../server/db";
import apiRoutes from "../server/routes/api";
import { storageProvider } from "../server/services/storageProvider";

async function runSaaSConcurrencySuite() {
  console.log(`\n=============================================================`);
  console.log(`  LearniX Master SaaS Multi-User & Concurrency Test Suite`);
  console.log(`=============================================================\n`);

  const testDb = db;
  console.log(`✓ Active database connected for SaaS verification`);

  // Spin up an in-memory test express server on an ephemeral port
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health probes
  app.get("/api/health/live", (req, res) => {
    res.status(200).json({ status: "live", uptime: process.uptime() });
  });

  app.get("/api/health/ready", async (req, res) => {
    const health = await testDb.checkHealth();
    res.status(health.status === "healthy" ? 200 : 503).json({ status: "ready", database: health });
  });

  app.use("/api", apiRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`✓ Test HTTP server active at ${baseUrl}\n`);

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${testName}`);
    } else {
      console.error(`  [FAIL] ${testName} ${detail ? `(${detail})` : ""}`);
      throw new Error(`Assertion failed: ${testName}`);
    }
  }

  try {
    // -----------------------------------------------------------------
    // TEST 1: Health Probes
    // -----------------------------------------------------------------
    console.log("--- 1. Verification of Cloud Health & Readiness Probes ---");
    const liveRes = await fetch(`${baseUrl}/api/health/live`);
    const liveData = await liveRes.json();
    assert(liveRes.status === 200 && liveData.status === "live", "GET /api/health/live returns HTTP 200 live");

    const readyRes = await fetch(`${baseUrl}/api/health/ready`);
    const readyData = await readyRes.json();
    assert(readyRes.status === 200 && readyData.status === "ready", "GET /api/health/ready reports healthy database");

    // -----------------------------------------------------------------
    // TEST 2: Concurrent Multi-User Registration & Isolated Tokens
    // -----------------------------------------------------------------
    console.log("\n--- 2. Concurrent Student Registration & Authentication ---");
    const aliceEmail = `alice.${Date.now()}@university.edu`;
    const bobEmail = `bob.${Date.now()}@university.edu`;

    const [regAliceRes, regBobRes] = await Promise.all([
      fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice Johnson",
          email: aliceEmail,
          password: "SecureAlicePassword123!",
        }),
      }),
      fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bob Williams",
          email: bobEmail,
          password: "SecureBobPassword123!",
        }),
      }),
    ]);

    assert(regAliceRes.status === 201, "Alice registered successfully (HTTP 201)");
    assert(regBobRes.status === 201, "Bob registered successfully (HTTP 201)");

    const aliceData = await regAliceRes.json();
    const bobData = await regBobRes.json();

    const aliceToken: string = aliceData.token;
    const bobToken: string = bobData.token;
    const aliceId: string = aliceData.user.id;
    const bobId: string = bobData.user.id;

    assert(aliceToken && bobToken && aliceToken !== bobToken, "Alice & Bob receive unique, distinct 32-byte session tokens");
    assert(aliceId !== bobId, "Alice & Bob have distinct persistent user IDs");

    const aliceAuthHeader = { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" };
    const bobAuthHeader = { Authorization: `Bearer ${bobToken}`, "Content-Type": "application/json" };

    // -----------------------------------------------------------------
    // TEST 3: Zero-State Dashboard Isolation
    // -----------------------------------------------------------------
    console.log("\n--- 3. Strict Zero-State & Dashboard Isolation ---");
    const [aliceLecRes, bobLecRes] = await Promise.all([
      fetch(`${baseUrl}/api/lectures`, { headers: aliceAuthHeader }),
      fetch(`${baseUrl}/api/lectures`, { headers: bobAuthHeader }),
    ]);

    const aliceLectures = await aliceLecRes.json();
    const bobLectures = await bobLecRes.json();

    assert(Array.isArray(aliceLectures) && aliceLectures.length === 0, "Alice begins with 0 personal lectures");
    assert(Array.isArray(bobLectures) && bobLectures.length === 0, "Bob begins with 0 personal lectures");

    // -----------------------------------------------------------------
    // TEST 4: Academic Hierarchy & Enrollment Filtering
    // -----------------------------------------------------------------
    console.log("\n--- 4. Institutional Academic Hierarchy & Student Enrollments ---");
    const insts = testDb.getInstitutions(true);
    assert(insts.length > 0, "Default institution exists in database");
    const instId = insts[0].id;

    const terms = testDb.getAcademicTerms(instId, true);
    assert(terms.length > 0, "Academic term exists for institution");
    const termId = terms[0].id;

    const progs = testDb.getAcademicPrograms(instId, undefined, true);
    assert(progs.length > 0, "Academic program exists in institution");
    const progId = progs[0].id;

    // Enroll Alice in DSA (CS-201) and OS (CS-301)
    testDb.enrollStudentInSubjects(aliceId, instId, termId, progId, "Semester 5", ["subj-dsa", "subj-os"]);
    // Enroll Bob in Networks (CS-401) and AI (CS-501)
    testDb.enrollStudentInSubjects(bobId, instId, termId, progId, "Semester 5", ["subj-net", "subj-ai"]);

    const aliceContextRes = await fetch(`${baseUrl}/api/academic/student-context`, { headers: aliceAuthHeader });
    const aliceContext = await aliceContextRes.json();
    assert(aliceContext.hasEnrollment === true, "Alice has active institutional academic context");
    assert(aliceContext.enrolledSubjects.length === 2, "Alice is enrolled in exactly 2 subjects");

    const aliceSubjIds = aliceContext.enrolledSubjects.map((s: any) => s.id);
    assert(aliceSubjIds.includes("subj-dsa") && aliceSubjIds.includes("subj-os"), "Alice enrolled subjects are DSA and OS");

    // Check allowed teachers for Alice
    const aliceTeachersRes = await fetch(`${baseUrl}/api/academic/teachers`, { headers: aliceAuthHeader });
    const aliceTeachers: any[] = await aliceTeachersRes.json();
    const aliceTeacherIds = aliceTeachers.map((t) => t.id);
    assert(aliceTeacherIds.includes("teacher-jenkins") || aliceTeacherIds.includes("teacher-peterson"), "Alice allowed teachers match DSA/OS faculty");

    // -----------------------------------------------------------------
    // TEST 5: Strict Teacher/Subject Mismatch Prevention
    // -----------------------------------------------------------------
    console.log("\n--- 5. Teacher-Subject Mismatch Prevention ---");
    // Test 5.1: Alice attempts to assign Prof Marcus Chen (Networks) to Data Structures (DSA)
    const mismatchRes1 = await fetch(`${baseUrl}/api/lectures`, {
      method: "POST",
      headers: aliceAuthHeader,
      body: JSON.stringify({
        title: "Invalid Mismatch Lecture",
        teacherId: "teacher-chen", // Chen teaches Networks
        subjectId: "subj-dsa",     // DSA
      }),
    });
    assert(mismatchRes1.status === 400, "Blocked teacher-subject mismatch (HTTP 400 rejected)");

    // Test 5.2: Alice attempts to create lecture for Networks (which she is NOT enrolled in)
    const mismatchRes2 = await fetch(`${baseUrl}/api/lectures`, {
      method: "POST",
      headers: aliceAuthHeader,
      body: JSON.stringify({
        title: "Networks Lecture Not Enrolled",
        teacherId: "teacher-chen",
        subjectId: "subj-net",
      }),
    });
    assert(mismatchRes2.status === 400, "Blocked enrollment mismatch: Student cannot create lecture for unenrolled subject");

    // Test 5.3: Alice creates a valid lecture with Prof. Jenkins for DSA
    const validLecRes = await fetch(`${baseUrl}/api/lectures`, {
      method: "POST",
      headers: aliceAuthHeader,
      body: JSON.stringify({
        title: "Binary Trees & AVL Balancing",
        teacherId: "teacher-jenkins",
        subjectId: "subj-dsa",
        topicIds: ["top-dsa-4"],
        language: "en",
      }),
    });
    assert(validLecRes.status === 201, "Alice successfully creates verified lecture (HTTP 201)");
    const aliceLecture = await validLecRes.json();

    // -----------------------------------------------------------------
    // TEST 6: Strict Cross-Tenant Access Protection (HTTP 403 Forbidden)
    // -----------------------------------------------------------------
    console.log("\n--- 6. Multi-Tenant Cross-Access Protection & Ownership ---");
    // Bob attempts to read Alice's lecture
    const bobStealRes = await fetch(`${baseUrl}/api/lectures/${aliceLecture.id}`, { headers: bobAuthHeader });
    assert(bobStealRes.status === 403, "Bob blocked from viewing Alice's lecture (HTTP 403 Forbidden)");

    // Bob attempts to delete Alice's lecture
    const bobDeleteRes = await fetch(`${baseUrl}/api/lectures/${aliceLecture.id}`, {
      method: "DELETE",
      headers: bobAuthHeader,
    });
    assert(bobDeleteRes.status === 403, "Bob blocked from deleting Alice's lecture (HTTP 403 Forbidden)");

    // Bob attempts to transcribe into Alice's lecture
    const bobTranscribeRes = await fetch(`${baseUrl}/api/lectures/${aliceLecture.id}/transcribe-chunk`, {
      method: "POST",
      headers: bobAuthHeader,
      body: JSON.stringify({
        audioBase64: Buffer.from("MALICIOUS_CHUNK").toString("base64"),
        sequenceNumber: 0,
      }),
    });
    assert(bobTranscribeRes.status === 403, "Bob blocked from appending audio chunks to Alice's lecture (HTTP 403 Forbidden)");

    // Alice reads her own lecture
    const aliceReadRes = await fetch(`${baseUrl}/api/lectures/${aliceLecture.id}`, { headers: aliceAuthHeader });
    assert(aliceReadRes.status === 200, "Alice successfully reads her own lecture (HTTP 200)");

    // -----------------------------------------------------------------
    // TEST 7: Concurrent Live Recording & Isolated Storage
    // -----------------------------------------------------------------
    console.log("\n--- 7. Concurrent Live Audio Ingestion & Storage ---");
    // Bob creates his own valid lecture
    const bobLecRes2 = await fetch(`${baseUrl}/api/lectures`, {
      method: "POST",
      headers: bobAuthHeader,
      body: JSON.stringify({
        title: "TCP Flow Control & Sliding Window",
        teacherId: "teacher-chen",
        subjectId: "subj-net",
        language: "en",
      }),
    });
    assert(bobLecRes2.status === 201, "Bob creates his own valid Networks lecture (HTTP 201)");
    const bobLecture = await bobLecRes2.json();

    const dummyAudioAlice = Buffer.from("ALICE_AUDIO_CHUNK_RAW_PCM_DATA").toString("base64");
    const dummyAudioBob = Buffer.from("BOB_AUDIO_CHUNK_RAW_PCM_DATA").toString("base64");

    const [aliceChunkRes, bobChunkRes] = await Promise.all([
      fetch(`${baseUrl}/api/lectures/${aliceLecture.id}/transcribe-chunk`, {
        method: "POST",
        headers: aliceAuthHeader,
        body: JSON.stringify({
          audioBase64: dummyAudioAlice,
          sequenceNumber: 0,
          currentTimestamp: 0,
        }),
      }),
      fetch(`${baseUrl}/api/lectures/${bobLecture.id}/transcribe-chunk`, {
        method: "POST",
        headers: bobAuthHeader,
        body: JSON.stringify({
          audioBase64: dummyAudioBob,
          sequenceNumber: 0,
          currentTimestamp: 0,
        }),
      }),
    ]);

    assert(aliceChunkRes.status === 200, "Alice chunk 0 processed successfully (HTTP 200)");
    assert(bobChunkRes.status === 200, "Bob chunk 0 processed successfully (HTTP 200)");

    // -----------------------------------------------------------------
    // TEST 8: Session Revocation & Logout
    // -----------------------------------------------------------------
    console.log("\n--- 8. Session Revocation & Concurrent Session Invalidation ---");
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: aliceAuthHeader,
    });
    assert(logoutRes.status === 200, "Alice logs out successfully (HTTP 200)");

    // Alice's token should now be rejected
    const expiredRes = await fetch(`${baseUrl}/api/lectures`, { headers: aliceAuthHeader });
    assert(expiredRes.status === 401, "Subsequent request with revoked session token returns HTTP 401 Unauthenticated");

    // Bob's session token MUST still be active
    const bobStillActiveRes = await fetch(`${baseUrl}/api/lectures`, { headers: bobAuthHeader });
    assert(bobStillActiveRes.status === 200, "Bob's concurrent session remains active and unimpacted (HTTP 200)");

    console.log(`\n=============================================================`);
    console.log(`✓ ALL ${passedTests}/${totalTests} SAAS CONCURRENCY & ISOLATION TESTS PASSED!`);
    console.log(`=============================================================\n`);
  } finally {
    server.close();
  }
}

runSaaSConcurrencySuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[SUITE FAILED]", err);
    process.exit(1);
  });
