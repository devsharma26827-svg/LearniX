import assert from "assert";

const BASE_URL = "http://localhost:4242";

async function runApiTests() {
  console.log("==================================================");
  console.log("  RUNNING COMPREHENSIVE END-TO-END API TESTS      ");
  console.log("==================================================");

  // 1. Health check
  console.log("\n[1] Testing GET /api/health...");
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.strictEqual(healthRes.status, 200, "Health check should return 200");
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, "ok");
  assert.strictEqual(healthData.appName, "LearniX");
  console.log("✓ /api/health is healthy:", healthData);

  // 2. Auth: Register
  console.log("\n[2] Testing POST /api/auth/register...");
  const regEmail = `test.student.${Date.now()}@university.edu`;
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: regEmail,
      name: "Morgan Lee",
    }),
  });
  assert.strictEqual(regRes.status, 200, "Register should return 200");
  const regData = await regRes.json();
  assert(regData.user, "Should return registered user");
  assert.strictEqual(regData.user.email, regEmail);
  assert.strictEqual(regData.user.name, "Morgan Lee");
  const token = regData.token;
  const userId = regData.user.id;
  console.log("✓ Registration succeeded for user:", userId);

  // 3. Auth: Login
  console.log("\n[3] Testing POST /api/auth/login...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: regEmail }),
  });
  assert.strictEqual(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.strictEqual(loginData.user.id, userId);
  console.log("✓ Login succeeded");

  // 4. Profile: GET /api/me
  console.log("\n[4] Testing GET /api/me...");
  const meRes = await fetch(`${BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(meRes.status, 200);
  const meData = await meRes.json();
  assert.strictEqual(meData.user.email, regEmail);
  console.log("✓ GET /api/me returned current user profile");

  // 5. Profile: PATCH /api/me
  console.log("\n[5] Testing PATCH /api/me...");
  const patchRes = await fetch(`${BASE_URL}/api/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fullName: "Morgan Lee, M.S.",
      dailyStudyGoal: "2 hr",
      preferredLanguage: "English",
      notificationPreferences: {
        quizReminders: false,
        revisionReminders: true,
        studyPlanReminders: true,
        lectureProcessing: true,
        productUpdates: false,
      },
    }),
  });
  assert.strictEqual(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.strictEqual(patchData.user.name, "Morgan Lee, M.S.");
  assert.strictEqual(patchData.user.dailyStudyGoal, "2 hr");
  assert.strictEqual(patchData.user.notificationPreferences.quizReminders, false);
  console.log("✓ Profile update persisted");

  // 6. Lectures: GET /api/lectures
  console.log("\n[6] Testing GET /api/lectures (with user session)...");
  const lecturesRes = await fetch(`${BASE_URL}/api/lectures`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(lecturesRes.status, 200);
  const initialLectures = await lecturesRes.json();
  assert(Array.isArray(initialLectures));
  assert(initialLectures.length >= 3, "Should include shared sample lectures");
  console.log(`✓ Fetched ${initialLectures.length} accessible lectures`);

  // 7. Lectures: POST /api/lectures (Create new lecture)
  console.log("\n[7] Testing POST /api/lectures...");
  const newLecRes = await fetch(`${BASE_URL}/api/lectures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "Introduction to Machine Learning",
      subject: "Artificial Intelligence",
      instructor: "Prof. Andrew Ng",
      source: "live",
      createdBy: userId,
    }),
  });
  assert.strictEqual(newLecRes.status, 201, "POST /api/lectures returns 201");
  const createdLec = await newLecRes.json();
  assert(createdLec.id);
  assert.strictEqual(createdLec.title, "Introduction to Machine Learning");
  assert.strictEqual(createdLec.createdBy, userId);
  const lectureId = createdLec.id;
  console.log("✓ Created custom lecture with ID:", lectureId);

  // 8. Lectures: Append transcript segment
  console.log("\n[8] Testing POST /api/lectures/:id/append-transcript...");
  const transRes = await fetch(`${BASE_URL}/api/lectures/${lectureId}/append-transcript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text: "Supervised learning algorithms map inputs to desired outputs based on labeled training pairs.",
      startTime: 0,
      endTime: 15,
      topic: "Supervised Learning",
      isImportant: true,
    }),
  });
  assert.strictEqual(transRes.status, 200);
  const transData = await transRes.json();
  assert.strictEqual(transData.segment.text, "Supervised learning algorithms map inputs to desired outputs based on labeled training pairs.");
  console.log("✓ Appended transcript segment to SQLite");

  // 9. Lectures: Update status
  console.log("\n[9] Testing POST /api/lectures/:id/status...");
  const statusRes = await fetch(`${BASE_URL}/api/lectures/${lectureId}/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "ready" }),
  });
  assert.strictEqual(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.status, "ready");
  console.log("✓ Updated lecture status to 'ready'");

  // 10. Lectures: Update Smart Notes
  console.log("\n[10] Testing PUT /api/lectures/:id/notes...");
  const notesRes = await fetch(`${BASE_URL}/api/lectures/${lectureId}/notes`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      notes: [
        {
          id: "note_ml_1",
          topic: "Supervised Learning",
          summary: "Learning mapping from inputs x to outputs y given training examples.",
          definitions: [
            {
              term: "Supervised Learning",
              definition: "Algorithms that learn from labeled training data.",
            },
          ],
          keyConcepts: ["Features", "Labels", "Loss Function"],
          examples: ["Spam classification", "Housing price prediction"],
          importantPoints: ["Overfitting occurs when model memorizes training noise."],
          sourceTimestamps: [{ start: 0, end: 15 }],
        },
      ],
    }),
  });
  assert.strictEqual(notesRes.status, 200);
  console.log("✓ Smart notes successfully updated");

  // 11. Lectures: Verify Lecture Details
  console.log("\n[11] Testing GET /api/lectures/:id...");
  const getLecRes = await fetch(`${BASE_URL}/api/lectures/${lectureId}`);
  assert.strictEqual(getLecRes.status, 200);
  const fullLec = await getLecRes.json();
  assert.strictEqual(fullLec.notes.length, 1);
  assert.strictEqual(fullLec.notes[0].topic, "Supervised Learning");
  assert.strictEqual(fullLec.transcript.length, 1);
  console.log("✓ Verified full nested lecture from SQLite");

  // 12. Quiz Attempt & Weak Topic Detection
  console.log("\n[12] Testing POST /api/lectures/:id/quiz/attempt on Sample Lecture...");
  const sampleLecId = "lecture-dsa-stack-queue";
  const attemptRes = await fetch(`${BASE_URL}/api/lectures/${sampleLecId}/quiz/attempt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
  assert(Array.isArray(attemptData.weakTopics));
  console.log(`✓ Submitted quiz attempt. Recorded attempt ID: ${attemptData.attempt.id}`);

  // 13. Search in Lecture
  console.log("\n[13] Testing GET /api/lectures/:id/search...");
  const searchRes = await fetch(`${BASE_URL}/api/lectures/${sampleLecId}/search?q=stack`);
  assert.strictEqual(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert(Array.isArray(searchData), "search returns an array of matched items");
  console.log(`✓ Search returned ${searchData.length} matched segments`);

  // 14. Delete custom lecture
  console.log("\n[14] Testing DELETE /api/lectures/:id...");
  const delLecRes = await fetch(`${BASE_URL}/api/lectures/${lectureId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(delLecRes.status, 200);
  console.log("✓ Custom lecture deleted successfully");

  // 15. Delete user
  console.log("\n[15] Testing DELETE /api/me...");
  const delUserRes = await fetch(`${BASE_URL}/api/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(delUserRes.status, 200);
  console.log("✓ User deleted successfully");

  console.log("\n==================================================");
  console.log("  ALL END-TO-END API TESTS PASSED SUCCESSFULLY!   ");
  console.log("==================================================\n");
}

runApiTests().catch((err) => {
  console.error("API Tests Failed:", err);
  process.exit(1);
});
