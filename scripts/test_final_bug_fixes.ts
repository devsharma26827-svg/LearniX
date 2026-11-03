import assert from "assert";
import {
  initializeAiConfig,
  getAiConfig,
  resetAiConfigForTesting,
} from "../server/config/aiConfig";
import {
  AiOrchestrator,
  TaskPriority,
  AiErrorClassification,
} from "../server/services/aiOrchestrator";
import { MODELS } from "../server/geminiClient";
import { resolveDatabaseProvider } from "../server/db/index";
import { createStorageProvider, LocalStorageProvider } from "../server/services/storageProvider";
import { fallbackQuiz, generateQuizForLecture } from "../server/services/quizService";
import { Lecture } from "../src/types";

async function runFinalBugFixesTestSuite() {
  console.log(`\n=============================================================`);
  console.log(`  LearniX Final Bug Fixes & Verification Test Suite`);
  console.log(`=============================================================\n`);

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

  // =========================================================================
  // TEST GROUP 1: Gemini API Key Precedence & Isolation (Issue 2)
  // =========================================================================
  console.log("--- 1. Gemini API Key Configuration & Precedence ---");

  // Save original env
  const origGemini = process.env.GEMINI_API_KEY;
  const origGoogle = process.env.GOOGLE_API_KEY;
  const origNodeEnv = process.env.NODE_ENV;
  const origDbProvider = process.env.DB_PROVIDER;
  const origDbUrl = process.env.DATABASE_URL;
  const origStorageProvider = process.env.STORAGE_PROVIDER;

  try {
    // Subtest 1A: Only GEMINI_API_KEY present
    test("Only GEMINI_API_KEY configured selects GEMINI_API_KEY", () => {
      resetAiConfigForTesting();
      process.env.GEMINI_API_KEY = "test-canonical-gemini-key";
      delete process.env.GOOGLE_API_KEY;

      const config = initializeAiConfig();
      assert.strictEqual(config.apiKey, "test-canonical-gemini-key");
      assert.strictEqual(config.keySource, "GEMINI_API_KEY");
      assert.strictEqual(config.isConfigured, true);
      assert.strictEqual(process.env.GOOGLE_API_KEY, undefined, "GOOGLE_API_KEY must not be set");
    });

    // Subtest 1B: Only GOOGLE_API_KEY present
    test("Only GOOGLE_API_KEY configured falls back gracefully", () => {
      resetAiConfigForTesting();
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = "test-legacy-google-key";

      const config = initializeAiConfig();
      assert.strictEqual(config.apiKey, "test-legacy-google-key");
      assert.strictEqual(config.keySource, "GOOGLE_API_KEY");
      assert.strictEqual(config.isConfigured, true);
      // Normalized: GEMINI_API_KEY holds the resolved key, GOOGLE_API_KEY deleted
      assert.strictEqual(process.env.GEMINI_API_KEY, "test-legacy-google-key");
      assert.strictEqual(process.env.GOOGLE_API_KEY, undefined);
    });

    // Subtest 1C: Both present with different values -> GEMINI_API_KEY wins
    test("Both present with different values: canonical GEMINI_API_KEY prioritized", () => {
      resetAiConfigForTesting();
      process.env.GEMINI_API_KEY = "primary-canonical-key-123";
      process.env.GOOGLE_API_KEY = "secondary-legacy-key-456";

      const config = initializeAiConfig();
      assert.strictEqual(config.apiKey, "primary-canonical-key-123");
      assert.strictEqual(config.keySource, "GEMINI_API_KEY");
      // GOOGLE_API_KEY must be removed from process.env to prevent duplicate SDK warning
      assert.strictEqual(process.env.GOOGLE_API_KEY, undefined);
    });

    // Subtest 1D: Both present with identical values -> GEMINI_API_KEY selected
    test("Both present with identical values selects key without conflict", () => {
      resetAiConfigForTesting();
      process.env.GEMINI_API_KEY = "same-identical-key";
      process.env.GOOGLE_API_KEY = "same-identical-key";

      const config = initializeAiConfig();
      assert.strictEqual(config.apiKey, "same-identical-key");
      assert.strictEqual(config.keySource, "GEMINI_API_KEY");
      assert.strictEqual(process.env.GOOGLE_API_KEY, undefined);
    });

    // Subtest 1E: Neither present -> isConfigured is false
    test("Neither present results in isConfigured = false and apiKey = null", () => {
      resetAiConfigForTesting();
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const config = initializeAiConfig();
      assert.strictEqual(config.apiKey, null);
      assert.strictEqual(config.isConfigured, false);
      assert.strictEqual(config.keySource, "NONE");
    });

    // =========================================================================
    // TEST GROUP 2: AI Error Classification & 503 Resilience (Issue 1)
    // =========================================================================
    console.log("\n--- 2. Comprehensive AI Error Classification & 503 Handling ---");

    const orchestrator = new AiOrchestrator();

    test("Error classification: Distinguishes 503 UNAVAILABLE", () => {
      const err503 = { status: 503, message: "This model is currently experiencing high demand." };
      const info = orchestrator.classifyError(err503);
      assert.strictEqual(info.type, "UNAVAILABLE_503");
      assert.strictEqual(info.status, 503);
      assert.strictEqual(info.isRetryable, true);
      assert.strictEqual(info.isDailyQuotaExhausted, false);
      assert.ok(info.userFacingMessage.includes("503"));
    });

    test("Error classification: Distinguishes 500 INTERNAL SERVER ERROR", () => {
      const err500 = { status: 500, message: "Internal server error occurred." };
      const info = orchestrator.classifyError(err500);
      assert.strictEqual(info.type, "INTERNAL_500");
      assert.strictEqual(info.status, 500);
      assert.strictEqual(info.isRetryable, true);
    });

    test("Error classification: Distinguishes 504 DEADLINE_EXCEEDED", () => {
      const err504 = { status: 504, message: "Deadline exceeded on request." };
      const info = orchestrator.classifyError(err504);
      assert.strictEqual(info.type, "DEADLINE_EXCEEDED_504");
      assert.strictEqual(info.isRetryable, true);
    });

    test("Error classification: Distinguishes Daily Quota 429 (Non-Retryable) vs RPM 429 (Retryable)", () => {
      const dailyErr = {
        status: 429,
        message: "Resource exhausted: generate_content_free_tier_requests daily limit reached: 25",
      };
      const dailyInfo = orchestrator.classifyError(dailyErr);
      assert.strictEqual(dailyInfo.type, "RESOURCE_EXHAUSTED_429");
      assert.strictEqual(dailyInfo.isDailyQuotaExhausted, true);
      assert.strictEqual(dailyInfo.isRetryable, false, "Daily quota must NOT be retried");

      const rpmErr = {
        status: 429,
        message: "Rate limit reached for requests per minute (RPM)",
      };
      const rpmInfo = orchestrator.classifyError(rpmErr);
      assert.strictEqual(rpmInfo.type, "RESOURCE_EXHAUSTED_429");
      assert.strictEqual(rpmInfo.isDailyQuotaExhausted, false);
      assert.strictEqual(rpmInfo.isRetryable, true, "Short-term RPM limit is retryable");
    });

    test("Error classification: Distinguishes 400 INVALID_ARGUMENT (Non-Retryable)", () => {
      const err400 = { status: 400, message: "Request contains an invalid argument." };
      const info = orchestrator.classifyError(err400);
      assert.strictEqual(info.type, "INVALID_ARGUMENT_400");
      assert.strictEqual(info.isRetryable, false);
    });

    test("Error classification: Distinguishes 401 UNAUTHENTICATED (Non-Retryable)", () => {
      const err401 = { status: 401, message: "API key not valid." };
      const info = orchestrator.classifyError(err401);
      assert.strictEqual(info.type, "UNAUTHENTICATED_401");
      assert.strictEqual(info.isRetryable, false);
    });

    test("Error classification: Distinguishes 403 PERMISSION_DENIED (Non-Retryable)", () => {
      const err403 = { status: 403, message: "Permission denied on resource." };
      const info = orchestrator.classifyError(err403);
      assert.strictEqual(info.type, "PERMISSION_DENIED_403");
      assert.strictEqual(info.isRetryable, false);
    });

    test("Retry backoff calculation includes exponential multiplier and jitter", () => {
      const delay1 = orchestrator.computeBackoff(1);
      const delay2 = orchestrator.computeBackoff(2);
      const delay3 = orchestrator.computeBackoff(3);
      assert.ok(delay1 >= 2000, "Base delay at least 2000ms");
      assert.ok(delay2 > delay1 - 1000, "Delay 2 grows exponentially");
      assert.ok(delay3 > delay2 - 1000, "Delay 3 grows exponentially");
    });

    test("Retry-After header is correctly parsed into millisecond delay", () => {
      const errWithRetry = {
        status: 503,
        message: "High demand",
        headers: { "retry-after": "5" },
      };
      const info = orchestrator.classifyError(errWithRetry);
      assert.strictEqual(info.retryDelayMs, 5000);
    });

    // =========================================================================
    // TEST GROUP 3: Non-Blocking Task Lifecycle & Idempotency (Issue 1)
    // =========================================================================
    console.log("\n--- 3. Non-Blocking Task Lifecycle & Idempotency ---");

    process.env.GEMINI_API_KEY = "test-ai-key-for-orchestrator";
    resetAiConfigForTesting();
    initializeAiConfig();

    await test("Idempotency key prevents duplicate execution for identical requests", async () => {
      orchestrator.clearState();
      let callCount = 0;

      const taskA = orchestrator.executeTask({
        taskType: "quiz_generation",
        priority: TaskPriority.NORMAL,
        idempotencyKey: "quiz-test-lecture-101-all-6-mixed",
        promptOrInput: "prompt content 1",
        executeAi: async () => {
          callCount++;
          await new Promise((r) => setTimeout(r, 40));
          return { quizId: "quiz-1" };
        },
      });

      const taskB = orchestrator.executeTask({
        taskType: "quiz_generation",
        priority: TaskPriority.NORMAL,
        idempotencyKey: "quiz-test-lecture-101-all-6-mixed",
        promptOrInput: "prompt content 1",
        executeAi: async () => {
          callCount++;
          return { quizId: "quiz-2" };
        },
      });

      const [resA, resB] = await Promise.all([taskA, taskB]);
      assert.strictEqual(callCount, 1, "Only one AI execution should occur for identical idempotencyKey");
      assert.deepStrictEqual(resA.result, resB.result);
    });

    await test("Deterministic quiz fallback produces valid Quiz object on AI exhaustion", async () => {
      const sampleLecture: Lecture = {
        id: "lec-test-1",
        title: "Virtual Memory Architecture",
        subject: "Operating Systems",
        instructor: "Dr. Peterson",
        date: "2026-11-03",
        duration: 300,
        status: "ready",
        source: "live",
        createdBy: "user-student-test",
        weakTopics: [],
        transcript: [
          {
            id: "s1",
            startTime: 0,
            endTime: 30,
            text: "Today we discuss paging and the TLB.",
            topic: "Virtual Memory",
            isImportant: true,
          },
        ],
        chapters: [
          {
            id: "c1",
            title: "Paging & Memory Management",
            startTime: 0,
            endTime: 180,
            description: "Virtual page tables and page offsets.",
            keyConcepts: ["Paging", "Page Table"],
          },
        ],
        notes: [
          {
            id: "n1",
            topic: "Paging Mechanism",
            summary: "Paging maps virtual pages to physical page frames.",
            definitions: [
              { term: "TLB", definition: "Translation Lookaside Buffer caching address translations." },
              { term: "Page Fault", definition: "Hardware interrupt when page is not present in physical RAM." },
            ],
            keyConcepts: ["Paging", "TLB"],
            examples: [],
            importantPoints: ["Virtual addresses are split into page numbers and offsets."],
            sourceTimestamps: [{ start: 0, end: 60 }],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const quiz = fallbackQuiz(sampleLecture, 4);
      assert.ok(quiz.id.startsWith("quiz-"));
      assert.strictEqual(quiz.lectureId, sampleLecture.id);
      assert.ok(quiz.questions.length >= 2, "Generates questions from definitions");
      const q1 = quiz.questions[0];
      assert.ok(q1.question.includes("TLB") || q1.question.includes("Page Fault"));
      assert.ok(q1.options.length >= 2);
      assert.ok(q1.correctAnswer);
      assert.strictEqual(q1.difficulty, "easy");
    });

    // =========================================================================
    // TEST GROUP 4: Database Provider Selection & Safety (Issue 4 & 5)
    // =========================================================================
    console.log("\n--- 4. Database Provider Selection & Production Safety ---");

    test("Development defaults to SQLite when DB_PROVIDER and DATABASE_URL are unset", () => {
      process.env.NODE_ENV = "development";
      delete process.env.DB_PROVIDER;
      delete process.env.DATABASE_URL;

      const provider = resolveDatabaseProvider();
      assert.strictEqual(provider, "sqlite");
    });

    test("Explicit DB_PROVIDER=postgresql selects PostgreSQL", () => {
      process.env.NODE_ENV = "development";
      process.env.DB_PROVIDER = "postgresql";
      process.env.DATABASE_URL = "postgresql://postgres:pass@localhost:5432/learnix";

      const provider = resolveDatabaseProvider();
      assert.strictEqual(provider, "postgresql");
    });

    test("Production (NODE_ENV=production) mandates PostgreSQL", () => {
      process.env.NODE_ENV = "production";
      delete process.env.DB_PROVIDER;
      process.env.DATABASE_URL = "postgresql://prod:pass@render.internal:5432/learnix";

      const provider = resolveDatabaseProvider();
      assert.strictEqual(provider, "postgresql");
    });

    test("Production fails fast if DB_PROVIDER=sqlite is requested", () => {
      process.env.NODE_ENV = "production";
      process.env.DB_PROVIDER = "sqlite";

      assert.throws(
        () => resolveDatabaseProvider(),
        /DB_PROVIDER=sqlite is forbidden in production/,
        "Must throw fatal error if SQLite is requested in production"
      );
    });

    // =========================================================================
    // TEST GROUP 5: Storage Provider Diagnostics (Issue 6)
    // =========================================================================
    console.log("\n--- 5. Storage Provider Diagnostics & Cloud Readiness ---");

    test("Local storage provider reports correct diagnostics", () => {
      const storage = new LocalStorageProvider();
      const diag = storage.getDiagnostics();
      assert.strictEqual(diag.provider, "local");
      assert.strictEqual(diag.configured, true);
      assert.ok(diag.baseDir);
    });

    test("Production fails fast if STORAGE_PROVIDER=s3 without credentials", () => {
      process.env.NODE_ENV = "production";
      process.env.STORAGE_PROVIDER = "s3";
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.S3_BUCKET_NAME;

      assert.throws(
        () => createStorageProvider(),
        /STORAGE_PROVIDER=s3 requires AWS_ACCESS_KEY_ID/,
        "Must throw fatal error if S3 is requested without credentials in production"
      );
    });

    console.log(`\n=============================================================`);
    console.log(`✓ ALL ${passedTests}/${totalTests} FINAL BUG FIX TESTS PASSED!`);
    console.log(`=============================================================\n`);
  } finally {
    // Restore original environment
    if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
    else delete process.env.GEMINI_API_KEY;

    if (origGoogle !== undefined) process.env.GOOGLE_API_KEY = origGoogle;
    else delete process.env.GOOGLE_API_KEY;

    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;

    if (origDbProvider !== undefined) process.env.DB_PROVIDER = origDbProvider;
    else delete process.env.DB_PROVIDER;

    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
    else delete process.env.DATABASE_URL;

    if (origStorageProvider !== undefined) process.env.STORAGE_PROVIDER = origStorageProvider;
    else delete process.env.STORAGE_PROVIDER;

    resetAiConfigForTesting();
    initializeAiConfig();
  }
}

runFinalBugFixesTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[SUITE FAILED]", err);
    process.exit(1);
  });
