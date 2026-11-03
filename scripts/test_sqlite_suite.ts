import fs from "fs";
import path from "path";
import assert from "assert";
import { Database } from "../server/db";
import { SAMPLE_LECTURES, SAMPLE_USERS } from "../server/sampleData";
import { Lecture, User } from "../src/types";

const TEST_DIR = path.join(process.cwd(), ".data_test");

function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

async function runTestSuite() {
  console.log("==================================================");
  console.log("  RUNNING SQLITE INTEGRATION UNIT & BEHAVIOR TESTS");
  console.log("==================================================");

  cleanupTestDir();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const testDbPath = path.join(TEST_DIR, "test_edupulse.sqlite");
  const testUsersJson = path.join(TEST_DIR, "test_users.json");

  // -------------------------------------------------------------------------
  // Test A: First launch
  // -------------------------------------------------------------------------
  console.log("\n[Test A] First Launch & Schema Initialization...");
  let dbInstance = new Database(testDbPath, testUsersJson);

  assert(fs.existsSync(testDbPath), "SQLite file should exist on first launch");

  const usersA = dbInstance.getUsers();
  assert(usersA.length >= SAMPLE_USERS.length, "Sample users should be initialized");
  const sampleUser1 = dbInstance.getUserById(SAMPLE_USERS[0].id);
  assert(sampleUser1, "Sample user 1 must be found by ID");
  assert.strictEqual(sampleUser1.email, SAMPLE_USERS[0].email);

  const lecturesA = dbInstance.getLectures(SAMPLE_USERS[0].id);
  assert(lecturesA.length >= SAMPLE_LECTURES.length, "Sample lectures should be initialized for demo student");
  const sampleLecture1 = dbInstance.getLectureById(SAMPLE_LECTURES[0].id);
  assert(sampleLecture1, "Sample lecture 1 must be found by ID");
  assert.strictEqual(sampleLecture1.title, SAMPLE_LECTURES[0].title);
  console.log("✓ Test A Passed: Schema created, sample users & lectures seeded successfully.");

  // -------------------------------------------------------------------------
  // Test B: User persistence across restarts
  // -------------------------------------------------------------------------
  console.log("\n[Test B] User Persistence Across Restarts...");
  const newUser: User = {
    id: "user_test_persistence",
    name: "Alex Rivera",
    fullName: "Alex Rivera",
    email: "alex.rivera@university.edu",
    college: "Tech Institute",
    preferredLanguage: "English",
    noteStyle: "Exam-focused",
    difficultyPreference: "Advanced",
    dailyStudyGoal: "2 hr",
    customStudyGoalMinutes: 120,
    notificationPreferences: {
      quizReminders: true,
      revisionReminders: false,
      studyPlanReminders: true,
      lectureProcessing: true,
      productUpdates: false,
    },
  };

  const createdUser = dbInstance.createUser(newUser);
  assert.strictEqual(createdUser.id, newUser.id);

  // Update profile
  const updatedUser = dbInstance.updateUser(newUser.id, {
    fullName: "Alex Rivera, Ph.D.",
    noteStyle: "Detailed",
    notificationPreferences: {
      quizReminders: false,
      revisionReminders: true,
      studyPlanReminders: false,
      lectureProcessing: true,
      productUpdates: true,
    },
  });
  assert(updatedUser, "Updated user should be returned");
  assert.strictEqual(updatedUser.fullName, "Alex Rivera, Ph.D.");
  assert.strictEqual(updatedUser.noteStyle, "Detailed");
  assert.strictEqual(updatedUser.notificationPreferences?.quizReminders, false);
  assert.strictEqual(updatedUser.notificationPreferences?.revisionReminders, true);

  // Close and simulate restart
  dbInstance.close();
  dbInstance = new Database(testDbPath, testUsersJson);

  const persistedUser = dbInstance.getUserById(newUser.id);
  assert(persistedUser, "User must persist across database restart");
  assert.strictEqual(persistedUser.fullName, "Alex Rivera, Ph.D.");
  assert.strictEqual(persistedUser.name, "Alex Rivera, Ph.D.");
  assert.strictEqual(persistedUser.noteStyle, "Detailed");
  assert.strictEqual(persistedUser.notificationPreferences?.quizReminders, false);
  assert.strictEqual(persistedUser.notificationPreferences?.revisionReminders, true);
  console.log("✓ Test B Passed: User profile and notification preferences persisted across restart.");

  // -------------------------------------------------------------------------
  // Test C: Lecture persistence with nested data across restarts
  // -------------------------------------------------------------------------
  console.log("\n[Test C] Deeply Nested Lecture Persistence Across Restarts...");
  const customLecture: Lecture = {
    id: "lec_test_deep",
    title: "Advanced Distributed Consensus",
    subject: "Distributed Systems",
    instructor: "Dr. Lamport",
    date: "2026-11-02",
    duration: 3600,
    status: "ready",
    source: "live",
    createdBy: newUser.id,
    transcript: [
      {
        id: "seg_1",
        startTime: 0,
        endTime: 45,
        text: "Today we begin Paxos consensus protocol.",
        topic: "Introduction",
        isImportant: true,
      },
    ],
    chapters: [
      {
        id: "chap_1",
        title: "Paxos Foundations",
        startTime: 0,
        endTime: 1200,
        description: "Understanding proposers, acceptors, and learners.",
        keyConcepts: ["Quorum", "Ballot Number", "Safety"],
      },
    ],
    notes: [
      {
        id: "note_1",
        topic: "Paxos Consensus",
        summary: "A fault-tolerant consensus algorithm in asynchronous networks.",
        definitions: [
          {
            term: "Quorum",
            definition: "Majority of acceptors required to reach agreement.",
            timestamp: 120,
          },
        ],
        keyConcepts: ["Consensus", "Fault Tolerance"],
        examples: ["Raft leader election comparison"],
        importantPoints: ["Never commit two different values at same ballot."],
        sourceTimestamps: [{ start: 0, end: 1200 }],
      },
    ],
    quiz: {
      id: "quiz_1",
      lectureId: "lec_test_deep",
      title: "Paxos Quiz",
      totalQuestions: 1,
      createdAt: new Date().toISOString(),
      questions: [
        {
          id: "q_1",
          question: "What is required for an acceptor quorum?",
          type: "mcq",
          options: ["Strict majority", "100% consensus", "Single node"],
          correctAnswer: "Strict majority",
          explanation: "Quorums overlap by at least one node to guarantee safety.",
          sourceChapter: "Paxos Foundations",
          sourceTimestamp: 150,
          difficulty: "medium",
          topic: "Quorum",
        },
      ],
    },
    attempts: [
      {
        id: "att_1",
        quizId: "quiz_1",
        lectureId: "lec_test_deep",
        timestamp: new Date().toISOString(),
        answers: { q_1: "Strict majority" },
        score: 1,
        maxScore: 1,
        accuracy: 100,
        questionResults: [
          {
            questionId: "q_1",
            userAnswer: "Strict majority",
            isCorrect: true,
            score: 1,
            feedback: "Correct!",
            topic: "Quorum",
            difficulty: "medium",
          },
        ],
        topicBreakdown: {
          Quorum: { total: 1, correct: 1, accuracy: 100 },
        },
        weakTopics: [],
      },
    ],
    weakTopics: [
      {
        id: "weak_1",
        lectureId: "lec_test_deep",
        topicName: "Ballot Numbers",
        accuracy: 40,
        explanation: "Need more practice on ballot monotonicity.",
        recommendedTimestampStart: 300,
        recommendedTimestampEnd: 600,
        practiceDrill: [],
        recommendedAction: "Review Phase 1 prepare messages",
        status: "pending",
      },
    ],
  };

  dbInstance.saveLecture(customLecture);

  // Close and simulate restart
  dbInstance.close();
  dbInstance = new Database(testDbPath, testUsersJson);

  const retrievedLecture = dbInstance.getLectureById("lec_test_deep");
  assert(retrievedLecture, "Lecture must exist after restart");
  assert.strictEqual(retrievedLecture.title, customLecture.title);
  assert.strictEqual(retrievedLecture.transcript.length, 1);
  assert.strictEqual(retrievedLecture.transcript[0].text, customLecture.transcript[0].text);
  assert.strictEqual(retrievedLecture.chapters[0].keyConcepts[0], "Quorum");
  assert.strictEqual(retrievedLecture.notes[0].definitions[0].term, "Quorum");
  assert.strictEqual(retrievedLecture.quiz?.questions[0].correctAnswer, "Strict majority");
  assert.strictEqual(retrievedLecture.attempts[0].accuracy, 100);
  assert.strictEqual(retrievedLecture.weakTopics[0].topicName, "Ballot Numbers");
  console.log("✓ Test C Passed: Deeply nested lecture structures verified after server restart.");

  // -------------------------------------------------------------------------
  // Test D: User isolation
  // -------------------------------------------------------------------------
  console.log("\n[Test D] User Isolation in Lecture Retrieval...");
  const userBob: User = {
    id: "user_bob",
    name: "Bob Builder",
    email: "bob@builder.org",
  };
  dbInstance.createUser(userBob);

  const bobLecture: Lecture = {
    id: "lec_bob_1",
    title: "Civil Engineering 101",
    subject: "Civil Engineering",
    date: "2026-11-02",
    duration: 1800,
    status: "ready",
    source: "live",
    createdBy: userBob.id,
    transcript: [],
    chapters: [],
    notes: [],
    attempts: [],
    weakTopics: [],
  };
  dbInstance.saveLecture(bobLecture);

  // Fetch for Alex (custom new user)
  const alexLectures = dbInstance.getLectures(newUser.id);
  const alexHasBobLecture = alexLectures.some((l) => l.id === bobLecture.id);
  const alexHasAlexLecture = alexLectures.some((l) => l.id === customLecture.id);
  const alexHasSampleLecture = alexLectures.some((l) => l.source === "sample");

  assert(!alexHasBobLecture, "User Alex must NOT see Bob's private lecture");
  assert(alexHasAlexLecture, "User Alex must see their own lecture");
  assert(!alexHasSampleLecture, "User Alex must NOT see sample lectures (new user zero-state)");

  // Demo user ("user-student-1") DOES see sample lectures
  const demoLectures = dbInstance.getLectures("user-student-1");
  assert(demoLectures.some((l) => l.source === "sample"), "Demo user must see sample lectures");

  // Fetch for Bob
  const bobLectures = dbInstance.getLectures(userBob.id);
  const bobHasAlexLecture = bobLectures.some((l) => l.id === customLecture.id);
  const bobHasBobLecture = bobLectures.some((l) => l.id === bobLecture.id);
  assert(!bobHasAlexLecture, "User Bob must NOT see Alex's private lecture");
  assert(bobHasBobLecture, "User Bob must see their own lecture");

  // Fetch without userId must return empty array (no data leakage)
  const allLectures = dbInstance.getLectures();
  assert.strictEqual(allLectures.length, 0, "Unspecified userId must return empty array to prevent data leakage");
  console.log("✓ Test D Passed: Lecture isolation strictly preserved per user, demo user retains samples, no unauth leaks.");

  // -------------------------------------------------------------------------
  // Test E: Deletion cascading
  // -------------------------------------------------------------------------
  console.log("\n[Test E] User Deletion and Lecture Cleanup...");
  const deleted = dbInstance.deleteUser(userBob.id);
  assert(deleted, "deleteUser should return true");
  assert.strictEqual(dbInstance.getUserById(userBob.id), undefined, "Deleted user should be gone");
  assert.strictEqual(dbInstance.getLectureById(bobLecture.id), undefined, "Bob's custom lecture should be deleted");
  assert(dbInstance.getLectures("user-student-1").some((l) => l.source === "sample"), "Sample lectures for demo account must NOT be deleted");
  console.log("✓ Test E Passed: User deletion safely cleaned user and their custom lectures without touching samples.");

  // -------------------------------------------------------------------------
  // Test F: Sample reset
  // -------------------------------------------------------------------------
  console.log("\n[Test F] Sample Reset Behavior...");
  // Modify sample lecture
  dbInstance.updateLecture(SAMPLE_LECTURES[0].id, {
    title: "MODIFIED SAMPLE TITLE",
  });
  assert.strictEqual(dbInstance.getLectureById(SAMPLE_LECTURES[0].id)?.title, "MODIFIED SAMPLE TITLE");

  // Reset to sample (demo user)
  dbInstance.resetToSample("user-student-1");

  // Custom lecture (Alex's) should NOT be removed when demo sample is reset
  assert(dbInstance.getLectureById(customLecture.id), "Other user's custom lecture should NOT be removed when demo sample is reset");
  // Sample lecture should be restored to original
  const restoredSample = dbInstance.getLectureById(SAMPLE_LECTURES[0].id);
  assert(restoredSample, "Sample lecture should be restored");
  assert.strictEqual(restoredSample.title, SAMPLE_LECTURES[0].title, "Sample lecture title restored to original");
  // Users should remain completely intact
  assert(dbInstance.getUserById(newUser.id), "User profiles must NOT be touched by resetToSample");
  console.log("✓ Test F Passed: Sample reset cleanly restores original sample lectures for demo user while preserving other users' lectures.");

  // -------------------------------------------------------------------------
  // Test G: Legacy migration from users.json
  // -------------------------------------------------------------------------
  console.log("\n[Test G] Legacy Data Migration from users.json...");
  const migTestDir = path.join(TEST_DIR, "migration_test");
  fs.mkdirSync(migTestDir, { recursive: true });
  const migDbPath = path.join(migTestDir, "mig_edupulse.sqlite");
  const migUsersJson = path.join(migTestDir, "users.json");

  // Create legacy users.json
  const legacyUsers: User[] = [
    {
      id: "legacy_user_1",
      name: "Legacy Scholar",
      fullName: "Legacy Scholar",
      email: "scholar@oxford.edu",
      college: "Oxford",
      preferredLanguage: "English",
      noteStyle: "Detailed",
      difficultyPreference: "Advanced",
      dailyStudyGoal: "2 hr",
      notificationPreferences: {
        quizReminders: true,
        revisionReminders: true,
        studyPlanReminders: false,
        lectureProcessing: true,
        productUpdates: false,
      },
    },
    // Also include an override for sample user 1
    {
      id: SAMPLE_USERS[0].id,
      name: "Customized Sample Student",
      fullName: "Customized Sample Student",
      email: SAMPLE_USERS[0].email,
      college: "MIT",
    },
  ];

  fs.writeFileSync(migUsersJson, JSON.stringify(legacyUsers, null, 2), "utf-8");

  // Start fresh DB with this legacy users.json
  let migDb = new Database(migDbPath, migUsersJson);

  // Check that legacy user was imported
  const importedUser = migDb.getUserById("legacy_user_1");
  assert(importedUser, "Legacy user must be migrated");
  assert.strictEqual(importedUser.name, "Legacy Scholar");
  assert.strictEqual(importedUser.college, "Oxford");

  // Check that sample user 1 was overridden by the legacy profile
  const overriddenSample = migDb.getUserById(SAMPLE_USERS[0].id);
  assert(overriddenSample, "Overridden sample user must exist");
  assert.strictEqual(overriddenSample.name, "Customized Sample Student");
  assert.strictEqual(overriddenSample.college, "MIT");

  // Check that original users.json file is NOT deleted
  assert(fs.existsSync(migUsersJson), "Original users.json file must be kept as backup");

  // Check that migration only runs once:
  // Update the user in SQLite
  migDb.updateUser("legacy_user_1", { name: "Updated in SQLite Directly" });
  migDb.close();

  // Re-open DB
  migDb = new Database(migDbPath, migUsersJson);
  const reloadedUser = migDb.getUserById("legacy_user_1");
  assert.strictEqual(
    reloadedUser?.name,
    "Updated in SQLite Directly",
    "Subsequent launches must NOT re-apply legacy JSON over SQLite updates"
  );
  migDb.close();
  console.log("✓ Test G Passed: Legacy migration safely imports profiles, overrides sample defaults, and runs once.");

  dbInstance.close();
  cleanupTestDir();
  console.log("\n==================================================");
  console.log("  ALL TESTS (A through G) PASSED SUCCESSFULLY!    ");
  console.log("==================================================\n");
}

runTestSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
