import assert from "assert";
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import { db } from "../server/db";
import apiRoutes from "../server/routes/api";

interface WizardState {
  currentStep: "TEACHER" | "SUBJECT" | "TOPIC" | "LANGUAGE" | "TITLE";
  selectedTeacherId: string;
  selectedSubjectId: string;
  selectedTopicIds: string[];
  selectedLanguage: string;
  title: string;
  consentChecked: boolean;
  history: string[];
}

function createInitialWizardState(): WizardState {
  return {
    currentStep: "TEACHER",
    selectedTeacherId: "",
    selectedSubjectId: "",
    selectedTopicIds: [],
    selectedLanguage: "auto",
    title: "",
    consentChecked: false,
    history: ["TEACHER"],
  };
}

function wizardSelectTeacher(state: WizardState, teacherId: string): WizardState {
  // Cascading reset if teacher changes
  const isDifferent = state.selectedTeacherId !== teacherId;
  return {
    ...state,
    selectedTeacherId: teacherId,
    selectedSubjectId: isDifferent ? "" : state.selectedSubjectId,
    selectedTopicIds: isDifferent ? [] : state.selectedTopicIds,
  };
}

function wizardSelectSubject(state: WizardState, subjectId: string, subjectName: string): WizardState {
  // Cascading reset if subject changes
  const isDifferent = state.selectedSubjectId !== subjectId;
  return {
    ...state,
    selectedSubjectId: subjectId,
    selectedTopicIds: isDifferent ? [] : state.selectedTopicIds,
    title: !state.title || state.title.endsWith("Lecture") ? `${subjectName} Lecture` : state.title,
  };
}

function wizardToggleTopic(state: WizardState, topicId: string, topicName: string): WizardState {
  const exists = state.selectedTopicIds.includes(topicId);
  const next = exists
    ? state.selectedTopicIds.filter((id) => id !== topicId)
    : [...state.selectedTopicIds, topicId];
  return {
    ...state,
    selectedTopicIds: next,
    title: !exists && (!state.title || state.title.endsWith("Lecture")) ? topicName : state.title,
  };
}

function wizardNext(state: WizardState): WizardState {
  switch (state.currentStep) {
    case "TEACHER":
      if (!state.selectedTeacherId) throw new Error("Validation Error: Teacher is required to proceed.");
      return { ...state, currentStep: "SUBJECT", history: [...state.history, "SUBJECT"] };
    case "SUBJECT":
      if (!state.selectedSubjectId) throw new Error("Validation Error: Subject is required to proceed.");
      return { ...state, currentStep: "TOPIC", history: [...state.history, "TOPIC"] };
    case "TOPIC":
      // Topic selection is optional; advancing from TOPIC to LANGUAGE must NEVER be blocked!
      return { ...state, currentStep: "LANGUAGE", history: [...state.history, "LANGUAGE"] };
    case "LANGUAGE":
      if (!state.selectedLanguage) throw new Error("Validation Error: Language is required to proceed.");
      return { ...state, currentStep: "TITLE", history: [...state.history, "TITLE"] };
    case "TITLE":
      return state;
  }
}

function wizardBack(state: WizardState): WizardState {
  switch (state.currentStep) {
    case "TEACHER":
      return state;
    case "SUBJECT":
      return { ...state, currentStep: "TEACHER", history: [...state.history, "TEACHER"] };
    case "TOPIC":
      return { ...state, currentStep: "SUBJECT", history: [...state.history, "SUBJECT"] };
    case "LANGUAGE":
      return { ...state, currentStep: "TOPIC", history: [...state.history, "TOPIC"] };
    case "TITLE":
      return { ...state, currentStep: "LANGUAGE", history: [...state.history, "LANGUAGE"] };
  }
}

async function runLiveWizardTestSuite() {
  console.log(`\n=============================================================`);
  console.log(`  LearniX Live Lecture Wizard 5-Step Verification Suite`);
  console.log(`=============================================================\n`);

  // Spin up test server for backend master data API calls
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", apiRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let totalTests = 0;
  let passedTests = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        return res
          .then(() => {
            passedTests++;
            console.log(`  [PASS] ${name}`);
          })
          .catch((err) => {
            console.error(`  [FAIL] ${name}:`, err.message || err);
            throw err;
          });
      } else {
        passedTests++;
        console.log(`  [PASS] ${name}`);
      }
    } catch (err: any) {
      console.error(`  [FAIL] ${name}:`, err.message || err);
      throw err;
    }
  }

  try {
    // Register and authenticate a student for API checks
    const studentEmail = `student.wizard.${Date.now()}@university.edu`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dev Sharma",
        email: studentEmail,
        password: "SecureStudentPassword123!",
      }),
    });
    const regData = await regRes.json();
    const token = regData.token;
    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-csrf-token": "csrf-test-token",
    };

    console.log("--- 1. Backend Master Data Hierarchy Verification ---");

    // 1. Fetch Teachers
    let teachers: any[] = [];
    await test("Backend: Query verified master faculty list", async () => {
      const res = await fetch(`${baseUrl}/api/academic/teachers`, { headers: authHeaders });
      assert.strictEqual(res.status, 200);
      teachers = await res.json();
      assert.ok(teachers.length >= 4, "Must return at least 4 faculty instructors");
      assert.ok(teachers.some((t) => t.id === "teacher-jenkins"));
    });

    // 2. Fetch Subjects strictly assigned to selected Teacher
    let subjects: any[] = [];
    await test("Backend: Query courses strictly assigned to teacher-jenkins", async () => {
      const res = await fetch(`${baseUrl}/api/academic/subjects?teacherId=teacher-jenkins`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      subjects = await res.json();
      assert.ok(subjects.length > 0, "Teacher Jenkins must have assigned courses");
      assert.ok(subjects.some((s) => s.id === "subj-dsa"));
    });

    // 3. Fetch Topics for DSA
    let dsaTopics: any[] = [];
    await test("Backend: Query ordered syllabus topics for subj-dsa", async () => {
      const res = await fetch(`${baseUrl}/api/academic/topics?subjectId=subj-dsa`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      dsaTopics = await res.json();
      assert.ok(dsaTopics.length >= 4, "Must return at least 4 syllabus topics for DSA");
      assert.ok(dsaTopics[0].topicName || dsaTopics[0].name);
    });

    // 4. Empty Topics response handling
    await test("Backend: Empty topics handled safely with empty array (HTTP 200)", async () => {
      // Query a subject without pre-seeded topics
      const res = await fetch(`${baseUrl}/api/academic/topics?subjectId=subj-non-existent`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      const empty = await res.json();
      assert.deepStrictEqual(empty, []);
    });

    console.log("\n--- 2. Wizard 5-Step State Machine Progression & Navigation ---");

    let wizard = createInitialWizardState();

    // 5. Initial State: Teacher step
    test("Initial wizard state starts at Step 1 (TEACHER)", () => {
      assert.strictEqual(wizard.currentStep, "TEACHER");
      assert.strictEqual(wizard.selectedTeacherId, "");
    });

    // 6. Block Next from Teacher if none selected
    test("Step 1 validation: Cannot proceed to Step 2 without selecting a teacher", () => {
      assert.throws(
        () => wizardNext(wizard),
        /Teacher is required to proceed/,
        "Must throw validation error if teacherId is empty"
      );
    });

    // 7. Select Teacher and Proceed to Subject
    test("Step 1 -> Step 2: Select teacher and advance to SUBJECT", () => {
      wizard = wizardSelectTeacher(wizard, "teacher-jenkins");
      wizard = wizardNext(wizard);
      assert.strictEqual(wizard.currentStep, "SUBJECT");
      assert.strictEqual(wizard.selectedTeacherId, "teacher-jenkins");
    });

    // 8. Block Next from Subject if none selected
    test("Step 2 validation: Cannot proceed to Step 3 without selecting a subject", () => {
      assert.throws(
        () => wizardNext(wizard),
        /Subject is required to proceed/,
        "Must throw validation error if subjectId is empty"
      );
    });

    // 9. Select Subject and Proceed to Topics
    test("Step 2 -> Step 3: Select subject and advance to TOPIC", () => {
      wizard = wizardSelectSubject(wizard, "subj-dsa", "Data Structures & Algorithms");
      wizard = wizardNext(wizard);
      assert.strictEqual(wizard.currentStep, "TOPIC");
      assert.strictEqual(wizard.selectedSubjectId, "subj-dsa");
      assert.ok(wizard.title.includes("Data Structures & Algorithms"));
    });

    // 10. Single Topic Selection
    test("Step 3: Single topic selection updates selectedTopicIds and title", () => {
      wizard = wizardToggleTopic(wizard, "top-dsa-1", "Stack Basics & LIFO Architecture");
      assert.deepStrictEqual(wizard.selectedTopicIds, ["top-dsa-1"]);
      assert.strictEqual(wizard.title, "Stack Basics & LIFO Architecture");
    });

    // 11. Multiple Topic Selection
    test("Step 3: Multiple topic selection accumulates topic IDs", () => {
      wizard = wizardToggleTopic(wizard, "top-dsa-2", "Push & Pop Operations");
      assert.strictEqual(wizard.selectedTopicIds.length, 2);
      assert.ok(wizard.selectedTopicIds.includes("top-dsa-1"));
      assert.ok(wizard.selectedTopicIds.includes("top-dsa-2"));
    });

    // 12. Topic Deselection
    test("Step 3: Clicking an active topic toggles it off", () => {
      wizard = wizardToggleTopic(wizard, "top-dsa-2", "Push & Pop Operations");
      assert.strictEqual(wizard.selectedTopicIds.length, 1);
      assert.deepStrictEqual(wizard.selectedTopicIds, ["top-dsa-1"]);
    });

    // 13. Step 3 (Topic) -> Step 4 (Language) Progression
    test("Step 3 -> Step 4: Advancing to LANGUAGE succeeds seamlessly", () => {
      wizard = wizardNext(wizard);
      assert.strictEqual(wizard.currentStep, "LANGUAGE", "Wizard must advance from TOPIC to LANGUAGE");
      assert.strictEqual(wizard.selectedLanguage, "auto");
    });

    // 14. Step 3 with 0 Topics (Skip Topics) -> Step 4 (Language)
    test("Step 3 -> Step 4 with 0 topics selected (Skip Topics) succeeds without blocking", () => {
      let emptyTopicWizard = createInitialWizardState();
      emptyTopicWizard = wizardSelectTeacher(emptyTopicWizard, "teacher-jenkins");
      emptyTopicWizard = wizardNext(emptyTopicWizard);
      emptyTopicWizard = wizardSelectSubject(emptyTopicWizard, "subj-dsa", "DSA");
      emptyTopicWizard = wizardNext(emptyTopicWizard);

      assert.strictEqual(emptyTopicWizard.currentStep, "TOPIC");
      assert.strictEqual(emptyTopicWizard.selectedTopicIds.length, 0);

      // Must advance smoothly to LANGUAGE without error
      emptyTopicWizard = wizardNext(emptyTopicWizard);
      assert.strictEqual(emptyTopicWizard.currentStep, "LANGUAGE");
    });

    // 15. Select Spoken Language
    test("Step 4: Select Hindi/Devanagari language and advance to Step 5 (TITLE)", () => {
      wizard.selectedLanguage = "hi";
      wizard = wizardNext(wizard);
      assert.strictEqual(wizard.currentStep, "TITLE");
      assert.strictEqual(wizard.selectedLanguage, "hi");
    });

    // 16. Back Navigation preserves all selected values
    test("Back navigation from Step 5 to Step 1 preserves selected values without data loss", () => {
      assert.strictEqual(wizard.currentStep, "TITLE");

      // Back to LANGUAGE
      wizard = wizardBack(wizard);
      assert.strictEqual(wizard.currentStep, "LANGUAGE");
      assert.strictEqual(wizard.selectedLanguage, "hi", "Language selection must be preserved");

      // Back to TOPIC
      wizard = wizardBack(wizard);
      assert.strictEqual(wizard.currentStep, "TOPIC");
      assert.deepStrictEqual(wizard.selectedTopicIds, ["top-dsa-1"], "Topic selection must be preserved");

      // Back to SUBJECT
      wizard = wizardBack(wizard);
      assert.strictEqual(wizard.currentStep, "SUBJECT");
      assert.strictEqual(wizard.selectedSubjectId, "subj-dsa", "Subject selection must be preserved");

      // Back to TEACHER
      wizard = wizardBack(wizard);
      assert.strictEqual(wizard.currentStep, "TEACHER");
      assert.strictEqual(wizard.selectedTeacherId, "teacher-jenkins", "Teacher selection must be preserved");

      // Re-advance to TITLE smoothly
      wizard = wizardNext(wizard); // -> SUBJECT
      wizard = wizardNext(wizard); // -> TOPIC
      wizard = wizardNext(wizard); // -> LANGUAGE
      wizard = wizardNext(wizard); // -> TITLE
      assert.strictEqual(wizard.currentStep, "TITLE");
      assert.strictEqual(wizard.selectedLanguage, "hi");
      assert.deepStrictEqual(wizard.selectedTopicIds, ["top-dsa-1"]);
    });

    // 17. Cascading Reset: Changing Teacher clears Subject and Topics
    test("Cascading reset: Changing teacher clears dependent subject and topics", () => {
      let testCascade = createInitialWizardState();
      testCascade = wizardSelectTeacher(testCascade, "teacher-jenkins");
      testCascade = wizardSelectSubject(testCascade, "subj-dsa", "DSA");
      testCascade = wizardToggleTopic(testCascade, "top-dsa-1", "Stack");

      assert.strictEqual(testCascade.selectedSubjectId, "subj-dsa");
      assert.strictEqual(testCascade.selectedTopicIds.length, 1);

      // Change teacher to Dr. Peterson
      testCascade = wizardSelectTeacher(testCascade, "teacher-peterson");
      assert.strictEqual(testCascade.selectedTeacherId, "teacher-peterson");
      assert.strictEqual(testCascade.selectedSubjectId, "", "Subject must reset on teacher change");
      assert.deepStrictEqual(testCascade.selectedTopicIds, [], "Topics must reset on teacher change");
    });

    // 18. Cascading Reset: Changing Subject clears Topics
    test("Cascading reset: Changing subject clears previous topics", () => {
      let testCascade = createInitialWizardState();
      testCascade = wizardSelectTeacher(testCascade, "teacher-jenkins");
      testCascade = wizardSelectSubject(testCascade, "subj-dsa", "DSA");
      testCascade = wizardToggleTopic(testCascade, "top-dsa-1", "Stack");
      assert.strictEqual(testCascade.selectedTopicIds.length, 1);

      // Change subject to Operating Systems
      testCascade = wizardSelectSubject(testCascade, "subj-os", "OS");
      assert.strictEqual(testCascade.selectedSubjectId, "subj-os");
      assert.deepStrictEqual(testCascade.selectedTopicIds, [], "Topics must reset on subject change");
    });

    console.log("\n--- 3. Final Lecture Submission Validation (Backend End-to-End) ---");

    // 19. Final Submission succeeds with complete valid cascade
    await test("Backend: Final lecture creation succeeds with verified master data (HTTP 201)", async () => {
      // First enroll student so subject is authorized
      const insts = db.getInstitutions(true);
      const terms = db.getAcademicTerms(insts[0].id, true);
      const progs = db.getAcademicPrograms(insts[0].id, undefined, true);

      db.enrollStudentInSubjects(
        regData.user.id,
        insts[0].id,
        terms[0].id,
        progs[0].id,
        "Semester 5",
        ["subj-dsa", "subj-os"]
      );

      const res = await fetch(`${baseUrl}/api/lectures`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Advanced Stack Implementations",
          subject: "Data Structures & Algorithms",
          instructor: "Prof. Sarah Jenkins",
          teacherId: "teacher-jenkins",
          subjectId: "subj-dsa",
          topicIds: ["top-dsa-1"],
          language: "hi",
        }),
      });

      assert.strictEqual(res.status, 201, "Lecture creation must succeed with HTTP 201");
      const data = await res.json();
      assert.ok(data.id.startsWith("lecture-"));
      assert.strictEqual(data.teacherId, "teacher-jenkins");
      assert.strictEqual(data.subjectId, "subj-dsa");
      assert.deepStrictEqual(data.topicIds, ["top-dsa-1"]);
      assert.strictEqual(data.language, "hi");
    });

    console.log(`\n=============================================================`);
    console.log(`✓ ALL ${passedTests}/${totalTests} LIVE WIZARD VERIFICATION TESTS PASSED!`);
    console.log(`=============================================================\n`);
  } finally {
    server.close();
  }
}

runLiveWizardTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[SUITE FAILED]", err);
    process.exit(1);
  });
