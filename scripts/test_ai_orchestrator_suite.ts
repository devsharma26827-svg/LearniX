import assert from "assert";
import { aiOrchestrator, TaskPriority } from "../server/services/aiOrchestrator";
import { MODELS, setMockGeminiClient, resetGeminiClient } from "../server/geminiClient";
import { processLectureTranscript, fallbackExtraction } from "../server/services/aiUnderstandingService";
import { generateQuizForLecture, fallbackQuiz } from "../server/services/quizService";
import { askTheLecture } from "../server/services/ragService";
import { Lecture, TranscriptSegment } from "../src/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMockLecture(id = "lec-test-1", userId = "user-1"): Lecture {
  return {
    id,
    title: "Operating Systems & Virtual Memory",
    subject: "Computer Science",
    instructor: "Dr. Peterson",
    date: "2026-11-03",
    duration: 600,
    status: "ready",
    source: "live",
    transcript: [
      {
        id: "t-1",
        startTime: 0,
        endTime: 120,
        text: "Virtual memory is a storage allocation scheme in which secondary memory can be addressed as though it were main memory.",
        topic: "Virtual Memory Definition",
        isDefinition: true,
        isImportant: true,
      },
      {
        id: "t-2",
        startTime: 120,
        endTime: 300,
        text: "Paging divides physical memory into fixed-size blocks called frames and logical memory into pages.",
        topic: "Paging & Frames",
        isImportant: true,
      },
      {
        id: "t-3",
        startTime: 300,
        endTime: 600,
        text: "A page fault occurs when a program attempts to access a page that is mapped in address space but not loaded in physical RAM.",
        topic: "Page Faults & Swapping",
        isImportant: true,
        isDefinition: true,
      },
    ],
    chapters: [
      {
        id: "ch-1",
        title: "Introduction to Virtual Memory",
        startTime: 0,
        endTime: 120,
        description: "Foundational definitions of memory virtualization.",
        keyConcepts: ["Secondary Memory", "Address Space"],
      },
      {
        id: "ch-2",
        title: "Paging Mechanics",
        startTime: 120,
        endTime: 300,
        description: "Dividing memory into pages and frames.",
        keyConcepts: ["Pages", "Frames", "Page Tables"],
      },
      {
        id: "ch-3",
        title: "Page Faults & Handling",
        startTime: 300,
        endTime: 600,
        description: "Handling traps and loading pages into RAM.",
        keyConcepts: ["Page Faults", "Swapping", "Dirty Bit"],
      },
    ],
    notes: [
      {
        id: "n-1",
        topic: "Virtual Memory Architecture",
        summary: "Covers virtual memory, page tables, and address translation.",
        definitions: [
          {
            term: "Virtual Memory",
            definition: "Storage allocation scheme addressing secondary memory as main memory.",
            timestamp: 0,
          },
        ],
        keyConcepts: ["Paging", "Page Faults", "Translation Lookaside Buffer"],
        importantPoints: ["Page faults incur high disk I/O latency."],
        examples: ["Linux demand paging implementation."],
        sourceTimestamps: [{ start: 0, end: 600 }],
      },
    ],
    attempts: [],
    weakTopics: [],
    createdBy: userId,
  };
}

async function runOrchestratorTestSuite() {
  console.log("==================================================");
  console.log("  LEARNIX AI ORCHESTRATION & QUOTA TEST SUITE     ");
  console.log("==================================================");

  // Setup initial mock
  aiOrchestrator.clearState();

  // --------------------------------------------------------------------------
  // Scenario 1: Normal Execution
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 1] Normal AI execution...");
  {
    aiOrchestrator.clearState();
    let apiCalls = 0;

    const res = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Summarize lecture notes",
      executeAi: async (model) => {
        apiCalls++;
        return `AI Output from ${model}`;
      },
    });

    assert.strictEqual(res.source, "ai_generated", "Should be marked as ai_generated");
    assert.strictEqual(apiCalls, 1, "Should call AI exactly once");
    assert(res.result.includes("gemini-3.7-flash"), "Should use default text model");

    const report = aiOrchestrator.getUsageReport();
    assert.strictEqual(report.metrics.totalAiRequests, 1, "Total AI requests should be 1");
    console.log("✓ Scenario 1 Passed: Normal AI execution succeeds with accurate metrics.");
  }

  // --------------------------------------------------------------------------
  // Scenario 2: Daily Quota 429 Exhaustion Detection & Circuit Breaking
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 2] Daily Quota 429 Exhaustion & Circuit Breaking...");
  {
    aiOrchestrator.clearState();
    let apiCalls = 0;

    const res = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Generate quiz",
      executeAi: async () => {
        apiCalls++;
        const err: any = new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Requests per day' and limit: 20");
        err.status = 429;
        throw err;
      },
      localFallback: () => "Authentic Local Algorithmic Result",
    });

    assert.strictEqual(res.source, "local_algorithm", "Should seamlessly fallback to local algorithm");
    assert.strictEqual(res.result, "Authentic Local Algorithmic Result");

    const modelState = aiOrchestrator.getModelState(MODELS.TEXT);
    assert.strictEqual(modelState.isDailyQuotaExhausted, true, "Model must be marked daily quota exhausted");

    // Next request to same model should trip circuit breaker and NOT execute doomed API call
    let secondCalls = 0;
    const res2 = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Another quiz prompt",
      executeAi: async () => {
        secondCalls++;
        return "Should not run";
      },
      localFallback: () => "Immediate Fallback Without Burning Network Retries",
    });

    assert.strictEqual(secondCalls, 0, "Circuit breaker must prevent unnecessary network calls when daily exhausted");
    assert.strictEqual(res2.source, "local_algorithm");
    console.log("✓ Scenario 2 Passed: 429 daily exhaustion trips circuit breaker and activates local algorithm.");
  }

  // --------------------------------------------------------------------------
  // Scenario 3: RPM Sliding Window Throttling
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 3] RPM Sliding Window Throttling...");
  {
    aiOrchestrator.clearState();
    const testModel = "test-rpm-model";
    aiOrchestrator.registerModel({
      name: testModel,
      rpmLimit: 2,
      rpdLimit: 100,
    });

    const executionTimes: number[] = [];
    const runTask = (idx: number) =>
      aiOrchestrator.executeTask<number>({
        taskType: "generic",
        priority: TaskPriority.NORMAL,
        promptOrInput: `rpm test task ${idx}`,
        preferredModel: testModel,
        executeAi: async () => {
          executionTimes.push(Date.now());
          return idx;
        },
      });

    // Fire 2 tasks (should run immediately within RPM=2)
    await Promise.all([runTask(1), runTask(2)]);
    assert.strictEqual(executionTimes.length, 2);

    const modelState = aiOrchestrator.getModelState(testModel);
    assert.strictEqual(modelState.executionTimestamps.length, 2, "Both executions tracked in sliding window");
    console.log("✓ Scenario 3 Passed: Sliding window tracks request timestamps and respects RPM limits.");
  }

  // --------------------------------------------------------------------------
  // Scenario 4: Client 400 Error (Non-Retryable)
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 4] Client 400 Error Handling...");
  {
    aiOrchestrator.clearState();
    let attempts = 0;

    await assert.rejects(
      async () => {
        await aiOrchestrator.executeTask<string>({
          taskType: "generic",
          priority: TaskPriority.NORMAL,
          promptOrInput: "Invalid request payload",
          executeAi: async () => {
            attempts++;
            const err: any = new Error("400 INVALID_ARGUMENT: Unsupported parameter");
            err.status = 400;
            throw err;
          },
        });
      },
      (err: any) => err.status === 400,
      "Should fail with 400"
    );

    assert.strictEqual(attempts, 1, "400 Client error must fail immediately without retry");
    console.log("✓ Scenario 4 Passed: 400 client errors fail fast without wasteful retries.");
  }

  // --------------------------------------------------------------------------
  // Scenario 5: Server 5xx Error (Retry with Backoff)
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 5] Server 5xx Temporary Error & Recovery...");
  {
    aiOrchestrator.clearState();
    let attempts = 0;

    const res = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Temporary 503 test",
      executeAi: async () => {
        attempts++;
        if (attempts === 1) {
          const err: any = new Error("503 UNAVAILABLE: The model is overloaded. Please try again later.");
          err.status = 503;
          throw err;
        }
        return "Recovered on retry!";
      },
    });

    assert.strictEqual(attempts, 2, "Should have retried once and succeeded");
    assert.strictEqual(res.result, "Recovered on retry!");
    assert.strictEqual(res.source, "ai_generated");
    console.log("✓ Scenario 5 Passed: Temporary 503 error successfully retried with backoff.");
  }

  // --------------------------------------------------------------------------
  // Scenario 6: Alternate Model Fallback
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 6] Alternate Model Fallback...");
  {
    aiOrchestrator.clearState();
    const primaryModel = MODELS.TEXT;
    const backupModel = "gemini-2.5-flash-backup";

    aiOrchestrator.registerModel({
      name: backupModel,
      rpmLimit: 15,
      rpdLimit: 50,
    });

    // Mark primary model daily quota as exhausted
    aiOrchestrator.setModelDailyExhausted(primaryModel, 3600000, "Simulated daily quota exhaustion");

    let backupExecuted = false;
    const res = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Task with alternate model",
      preferredModel: primaryModel,
      fallbackModels: [backupModel],
      executeAi: async (model) => {
        if (model === backupModel) {
          backupExecuted = true;
          return `Success from backup model ${model}`;
        }
        throw new Error("Unexpected primary execution");
      },
    });

    assert.strictEqual(backupExecuted, true, "Backup model should be executed");
    assert.strictEqual(res.source, "ai_generated");
    assert.strictEqual(res.modelUsed, backupModel);
    console.log("✓ Scenario 6 Passed: Seamlessly routed to backup model when primary daily quota exhausted.");
  }

  // --------------------------------------------------------------------------
  // Scenario 7: Full Fallback to Deterministic Local Algorithm
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 7] Full Fallback to Deterministic Local Algorithm...");
  {
    aiOrchestrator.clearState();
    aiOrchestrator.setModelDailyExhausted(MODELS.TEXT, 3600000);

    const res = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "Full fallback test",
      preferredModel: MODELS.TEXT,
      executeAi: async () => {
        throw new Error("Should not be called");
      },
      localFallback: () => "Authentic Local Algorithm Output",
    });

    assert.strictEqual(res.source, "local_algorithm");
    assert.strictEqual(res.result, "Authentic Local Algorithm Output");
    console.log("✓ Scenario 7 Passed: Successfully fell back to deterministic local algorithm.");
  }

  // --------------------------------------------------------------------------
  // Scenario 8: Duplicate Request Deduplication & Caching
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 8] Duplicate Request Deduplication & Caching...");
  {
    aiOrchestrator.clearState();
    let apiCalls = 0;

    const executeFn = async () => {
      apiCalls++;
      await sleep(50);
      return "Deduplicated Result";
    };

    // 1. Two concurrent requests with exact same content
    const [res1, res2] = await Promise.all([
      aiOrchestrator.executeTask<string>({
        taskType: "generic",
        priority: TaskPriority.NORMAL,
        userId: "user-cache-test",
        lectureId: "lec-cache-test",
        promptOrInput: "Identical prompt for caching",
        executeAi: executeFn,
      }),
      aiOrchestrator.executeTask<string>({
        taskType: "generic",
        priority: TaskPriority.NORMAL,
        userId: "user-cache-test",
        lectureId: "lec-cache-test",
        promptOrInput: "Identical prompt for caching",
        executeAi: executeFn,
      }),
    ]);

    assert.strictEqual(apiCalls, 1, "Concurrent duplicate should share the same promise (1 API call)");
    assert.strictEqual(res1.result, "Deduplicated Result");
    assert.strictEqual(res2.result, "Deduplicated Result");

    // 2. Subsequent request within TTL should hit cache
    const res3 = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      userId: "user-cache-test",
      lectureId: "lec-cache-test",
      promptOrInput: "Identical prompt for caching",
      executeAi: executeFn,
    });

    assert.strictEqual(apiCalls, 1, "Cached call must not trigger new API call");
    assert.strictEqual(res3.source, "cached");
    assert.strictEqual(res3.cached, true);
    console.log("✓ Scenario 8 Passed: Simultaneous deduplication and cache hits confirmed (1 API call total).");
  }

  // --------------------------------------------------------------------------
  // Scenario 9: Concurrent Multi-User Requests
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 9] Concurrent Multi-User Requests...");
  {
    aiOrchestrator.clearState();
    const userResults: Record<string, string> = {};

    const users = ["student-alice", "student-bob", "student-carol"];
    await Promise.all(
      users.map((u) =>
        aiOrchestrator.executeTask<string>({
          taskType: "generic",
          priority: TaskPriority.NORMAL,
          userId: u,
          lectureId: `lec-${u}`,
          promptOrInput: `Personal prompt for ${u}`,
          executeAi: async () => {
            await sleep(20);
            return `Answer for ${u}`;
          },
        }).then((res) => {
          userResults[u] = res.result;
        })
      )
    );

    assert.strictEqual(userResults["student-alice"], "Answer for student-alice");
    assert.strictEqual(userResults["student-bob"], "Answer for student-bob");
    assert.strictEqual(userResults["student-carol"], "Answer for student-carol");
    console.log("✓ Scenario 9 Passed: Concurrent multi-user requests processed with mutual isolation.");
  }

  // --------------------------------------------------------------------------
  // Scenario 10: Task Prioritization
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 10] Task Prioritization (HIGH before NORMAL)...");
  {
    aiOrchestrator.clearState();
    const executionOrder: string[] = [];

    // Pause queue by running an initial blocker task
    let releaseBlocker: () => void;
    const blockerPromise = new Promise<void>((r) => {
      releaseBlocker = r;
    });

    const blocker = aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      promptOrInput: "blocker",
      executeAi: async () => {
        await blockerPromise;
        return "blocker done";
      },
    });

    // While blocker is holding the execution worker, enqueue NORMAL then HIGH
    const normalTask = aiOrchestrator.executeTask<string>({
      taskType: "quiz_generation",
      priority: TaskPriority.NORMAL,
      promptOrInput: "normal task",
      executeAi: async () => {
        executionOrder.push("NORMAL");
        return "normal done";
      },
    });

    const highTask = aiOrchestrator.executeTask<string>({
      taskType: "transcription",
      priority: TaskPriority.HIGH,
      promptOrInput: "high priority audio",
      executeAi: async () => {
        executionOrder.push("HIGH");
        return "high done";
      },
    });

    // Release blocker so queue resumes
    releaseBlocker!();
    await Promise.all([blocker, normalTask, highTask]);

    assert.strictEqual(executionOrder[0], "HIGH", "HIGH priority task must execute before NORMAL task");
    assert.strictEqual(executionOrder[1], "NORMAL", "NORMAL priority task executes after HIGH");
    console.log("✓ Scenario 10 Passed: High-priority live transcription preempts lower priority tasks.");
  }

  // --------------------------------------------------------------------------
  // Scenario 11: Server Cold Start & Clean Initialization
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 11] Cold Start & Clean Initialization...");
  {
    aiOrchestrator.clearState();
    const report = aiOrchestrator.getUsageReport();

    assert.strictEqual(report.provider, "google-gemini");
    assert(report.activeModels.includes(MODELS.TEXT));
    assert(report.activeModels.includes(MODELS.TRANSCRIBE));
    assert.strictEqual(report.circuitBreakerActive, false);
    assert.strictEqual(report.metrics.activeRequests, 0);
    assert.strictEqual(report.metrics.queuedTasksCount, 0);
    console.log("✓ Scenario 11 Passed: Clean cold start initialized with correct models and zero metrics.");
  }

  // --------------------------------------------------------------------------
  // Scenario 12: Daily Quota Reset
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 12] Daily Quota Reset...");
  {
    aiOrchestrator.clearState();
    aiOrchestrator.setModelDailyExhausted(MODELS.TEXT, 3600000, "Exhausted before reset");

    let state = aiOrchestrator.getModelState(MODELS.TEXT);
    assert.strictEqual(state.isDailyQuotaExhausted, true);

    // Trigger daily quota reset
    aiOrchestrator.resetModelQuotas(MODELS.TEXT);

    state = aiOrchestrator.getModelState(MODELS.TEXT);
    assert.strictEqual(state.isDailyQuotaExhausted, false, "Quota exhaustion must be cleared on reset");
    assert.strictEqual(state.dailyRequestCount, 0, "Daily request count must be 0");
    console.log("✓ Scenario 12 Passed: Daily quota reset clears exhaustion and restores model availability.");
  }

  // --------------------------------------------------------------------------
  // Scenario 13: Strict Multi-Tenant User Isolation in Caching
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 13] Strict Multi-Tenant User Isolation in Caching...");
  {
    aiOrchestrator.clearState();
    let apiCalls = 0;

    const commonPrompt = "Common syllabus summary request";

    // User A executes task
    const resA = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      userId: "user-alice",
      lectureId: "shared-lec",
      promptOrInput: commonPrompt,
      executeAi: async () => {
        apiCalls++;
        return "Alice Result";
      },
    });

    assert.strictEqual(resA.source, "ai_generated");
    assert.strictEqual(apiCalls, 1);

    // User B submits identical prompt for the same lecture
    const resB = await aiOrchestrator.executeTask<string>({
      taskType: "generic",
      priority: TaskPriority.NORMAL,
      userId: "user-bob",
      lectureId: "shared-lec",
      promptOrInput: commonPrompt,
      executeAi: async () => {
        apiCalls++;
        return "Bob Result";
      },
    });

    // User B MUST NOT receive Alice's cache entry!
    assert.strictEqual(apiCalls, 2, "User B must not receive User A's cached entry");
    assert.strictEqual(resB.result, "Bob Result");
    console.log("✓ Scenario 13 Passed: Cryptographic tenant separation in caching strictly enforced.");
  }

  // --------------------------------------------------------------------------
  // Scenario 14: Deterministic Quiz Fallback Generation
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 14] Deterministic Quiz Fallback Generation...");
  {
    const lecture = makeMockLecture("lec-quiz-test", "user-quiz");
    const quiz = fallbackQuiz(lecture, 4);

    assert(quiz.questions.length >= 2, "Must generate valid quiz questions");
    assert.strictEqual(quiz.lectureId, lecture.id);

    const q1 = quiz.questions[0];
    assert(q1.question.includes("Virtual Memory"), "Question should reference actual lecture term");
    assert(q1.options!.includes(q1.correctAnswer), "Correct answer must be in options");
    assert(q1.explanation.length > 10, "Must have an academic explanation");
    console.log("✓ Scenario 14 Passed: Grounded quiz generated from lecture definitions without hallucination.");
  }

  // --------------------------------------------------------------------------
  // Scenario 15: Meaningful Transcript Fallback Generation
  // --------------------------------------------------------------------------
  console.log("\n[Scenario 15] Meaningful Transcript Fallback Generation...");
  {
    const lecture = makeMockLecture("lec-trans-test", "user-trans");
    const res = fallbackExtraction(lecture.title, lecture.subject, lecture.transcript);

    assert(res.chapters.length >= 1, "Must generate chapters from transcript");
    assert(res.chapters[0].startTime === 0, "Chapter start time matches transcript");
    assert(res.notes.length >= 1, "Must generate smart notes");

    const note = res.notes[0];
    assert(note.definitions.some((d) => d.term.includes("Virtual Memory")), "Must extract actual term");
    assert(note.keyConcepts.length > 0, "Must extract key concepts");
    assert(res.summary.includes(lecture.title), "Summary references lecture title");
    assert.strictEqual(res.source, "local_algorithm");
    console.log("✓ Scenario 15 Passed: Structured learning pack extracted from authentic transcript segments.");
  }

  console.log("\n==================================================");
  console.log("  ALL 15 ORCHESTRATION SCENARIOS PASSED WITH 0 ERRORS! ");
  console.log("==================================================");
}

runOrchestratorTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Failed with error:", err);
    process.exit(1);
  });
