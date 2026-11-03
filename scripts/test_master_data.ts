import assert from "assert";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";

const TEST_DIR = path.join(process.cwd(), ".data_test_master_data");
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const TEST_DB = path.join(TEST_DIR, "master_data.sqlite");
process.env.SQLITE_DB_PATH = TEST_DB;
process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_ACCOUNT = "true";

async function runMasterDataSuite() {
  console.log("==================================================");
  console.log("  LEARNIX RELATIONAL MASTER DATA & SCOPE TEST    ");
  console.log("==================================================");

  const { db } = await import("../server/db");
  const { default: apiRouter } = await import("../server/routes/api");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number; address: string };
  const BASE_URL = `http://127.0.0.1:${address.port}`;
  console.log(`[Setup] Master data test server running at ${BASE_URL}`);

  try {
    // Register student account
    const studentEmail = "stud.master@learnix.edu";
    const studentPass = "MasterDataPass123!";
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Master Tester",
        email: studentEmail,
        password: studentPass,
      }),
    });
    const regData = (await regRes.json()) as any;
    const studentToken = regData.token;
    const studentHeaders = {
      Authorization: `Bearer ${studentToken}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------------------
    // Test 1: Fetch Master Teachers
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Querying master teachers list...");
    const teachersRes = await fetch(`${BASE_URL}/api/master/teachers`, {
      headers: studentHeaders,
    });
    assert.strictEqual(teachersRes.status, 200, "GET /api/master/teachers must return 200");
    const teachers = (await teachersRes.json()) as any[];
    assert(Array.isArray(teachers) && teachers.length >= 4, "Must return at least 4 seeded teachers");

    const jenkins = teachers.find((t) => t.id === "teacher-jenkins");
    assert(jenkins, "Prof. Sarah Jenkins must be seeded");
    assert.strictEqual(jenkins.department, "Computer Science");
    console.log(`✓ Test 1 Passed: Found ${teachers.length} relational teachers.`);

    // -------------------------------------------------------------------------
    // Test 2: Fetch Subjects Cascading by Teacher
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Querying subjects filtered by teacher (cascading)...");
    const jenkinsSubjectsRes = await fetch(`${BASE_URL}/api/master/subjects?teacherId=teacher-jenkins`, {
      headers: studentHeaders,
    });
    assert.strictEqual(jenkinsSubjectsRes.status, 200);
    const jenkinsSubjects = (await jenkinsSubjectsRes.json()) as any[];
    assert(jenkinsSubjects.length > 0, "Jenkins must teach at least 1 subject");
    assert(jenkinsSubjects.some((s) => s.id === "subj-dsa"), "Jenkins must teach Data Structures & Algorithms");

    const petersonSubjectsRes = await fetch(`${BASE_URL}/api/master/subjects?teacherId=teacher-peterson`, {
      headers: studentHeaders,
    });
    const petersonSubjects = (await petersonSubjectsRes.json()) as any[];
    assert(petersonSubjects.some((s) => s.id === "subj-os"), "Peterson must teach Operating Systems");
    console.log("✓ Test 2 Passed: Teacher-to-subject relational cascade functioning accurately.");

    // -------------------------------------------------------------------------
    // Test 3: Fetch Topics Cascading by Subject
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Querying topics filtered by subject in sorted order...");
    const dsaTopicsRes = await fetch(`${BASE_URL}/api/master/topics?subjectId=subj-dsa`, {
      headers: studentHeaders,
    });
    assert.strictEqual(dsaTopicsRes.status, 200);
    const dsaTopics = (await dsaTopicsRes.json()) as any[];
    assert(dsaTopics.length >= 5, "DSA must have at least 5 topics");
    assert.strictEqual(dsaTopics[0].id, "top-dsa-1", "First topic must be Stack Basics (sort order 1)");
    assert(dsaTopics.every((t) => t.subjectId === "subj-dsa"), "All topics must reference subj-dsa");
    console.log(`✓ Test 3 Passed: Found ${dsaTopics.length} ordered topics for DSA.`);

    // -------------------------------------------------------------------------
    // Test 4: Relational Lecture Creation with Teacher, Subject, Topics, Language
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Lecture creation binding relational master IDs & language...");
    const createLecRes = await fetch(`${BASE_URL}/api/lectures`, {
      method: "POST",
      headers: studentHeaders,
      body: JSON.stringify({
        title: "Stack Architecture & Memory Boundaries",
        subject: "Data Structures & Algorithms",
        instructor: "Prof. Sarah Jenkins",
        teacherId: "teacher-jenkins",
        subjectId: "subj-dsa",
        topicIds: ["top-dsa-1", "top-dsa-2"],
        language: "hi",
        source: "live",
      }),
    });
    assert.strictEqual(createLecRes.status, 201, "Creating relational lecture must return 201");
    const createdLec = (await createLecRes.json()) as any;
    assert.strictEqual(createdLec.teacherId, "teacher-jenkins");
    assert.strictEqual(createdLec.subjectId, "subj-dsa");
    assert.deepStrictEqual(createdLec.topicIds, ["top-dsa-1", "top-dsa-2"]);
    assert.strictEqual(createdLec.language, "hi");

    // Verify persisted directly in SQLite columns
    const fetchedLecRes = await fetch(`${BASE_URL}/api/lectures/${createdLec.id}`, {
      headers: studentHeaders,
    });
    assert.strictEqual(fetchedLecRes.status, 200);
    const fetchedLec = (await fetchedLecRes.json()) as any;
    assert.strictEqual(fetchedLec.teacherId, "teacher-jenkins");
    assert.strictEqual(fetchedLec.subjectId, "subj-dsa");
    assert.strictEqual(fetchedLec.language, "hi");
    console.log("✓ Test 4 Passed: Relational references and language persisted and retrieved from SQLite.");

    // -------------------------------------------------------------------------
    // Test 5: Master Data Mutation Protection (RBAC / Security)
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Student role cannot mutate master data tables...");
    const attackCreateTeacher = await fetch(`${BASE_URL}/api/master/teachers`, {
      method: "POST",
      headers: studentHeaders,
      body: JSON.stringify({
        id: "teacher-hacker",
        name: "Hacker Instructor",
        department: "Exploit",
        designation: "Root",
      }),
    });
    assert.strictEqual(attackCreateTeacher.status, 403, "Student mutating master teachers must return 403 Forbidden");

    const attackDeleteTeacher = await fetch(`${BASE_URL}/api/master/teachers/teacher-jenkins`, {
      method: "DELETE",
      headers: studentHeaders,
    });
    assert.strictEqual(attackDeleteTeacher.status, 403, "Student deleting master teachers must return 403 Forbidden");

    const attackCreateSubject = await fetch(`${BASE_URL}/api/master/subjects`, {
      method: "POST",
      headers: studentHeaders,
      body: JSON.stringify({
        id: "subj-hacked",
        subjectCode: "HACK-101",
        subjectName: "Hacking Master",
      }),
    });
    assert.strictEqual(attackCreateSubject.status, 403, "Student mutating subjects must return 403 Forbidden");
    console.log("✓ Test 5 Passed: All master data mutations strictly protected with 403 Forbidden.");

    console.log("\n==================================================");
    console.log("  ALL MASTER DATA & RELATIONAL TESTS PASSED!      ");
    console.log("==================================================");
  } finally {
    server.close();
    db.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

runMasterDataSuite().catch((err) => {
  console.error("Master Data Test Suite Failed:", err);
  process.exit(1);
});
