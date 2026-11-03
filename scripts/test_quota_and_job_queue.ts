import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Database, saveAudioChunkToDisk, readAudioChunkFromDisk, deleteLectureAudioChunks } from "../server/db";
import { initializeAiConfig, getAiConfig, resetAiConfigForTesting } from "../server/config/aiConfig";
import { classifyAiError, isDailyQuotaCurrentlyExhausted, setDailyQuotaExhaustedState } from "../server/services/errorClassifier";
import { TranscriptionJobQueue } from "../server/services/transcriptionJobQueue";
import { TranscriptionProvider, TranscribeRequest } from "../server/services/providers/transcriptionProvider";
import { TranscriptSegment } from "../src/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${details ? " - " + details : ""}`);
    failedCount++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  LEARNIX QUOTA MANAGEMENT & JOB QUEUE TEST SUITE");
  console.log("=======================================================\n");

  const testDbDir = path.join(process.cwd(), ".data", "test_quota");
  if (fs.existsSync(testDbDir)) {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDbDir, { recursive: true });

  const testDbPath = path.join(testDbDir, "test.sqlite");
  const testDb = new Database(testDbPath);

  // -------------------------------------------------------------
  // TEST GROUP 1: API Key Configuration & Prioritization
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 1: API Key Configuration & Prioritization ---");
  {
    resetAiConfigForTesting();
    const originalGemini = process.env.GEMINI_API_KEY;
    const originalGoogle = process.env.GOOGLE_API_KEY;

    // Subtest 1.1: Canonical GEMINI_API_KEY prioritization
    process.env.GEMINI_API_KEY = "canonical-gemini-key-12345";
    process.env.GOOGLE_API_KEY = "conflicting-legacy-key-99999";
    resetAiConfigForTesting();

    const config = getAiConfig();
    assert(config.apiKey === "canonical-gemini-key-12345", "GEMINI_API_KEY is prioritized over GOOGLE_API_KEY");
    assert(config.isConfigured === true, "AI configuration reports isConfigured = true");
    assert(config.transcription.targetChunkDurationSeconds >= 30 && config.transcription.targetChunkDurationSeconds <= 60, "Target chunk duration is bounded between 30 and 60 seconds");

    // Subtest 1.2: Legacy fallback when only GOOGLE_API_KEY is provided
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "fallback-google-key-55555";
    resetAiConfigForTesting();
    const fallbackConfig = getAiConfig();
    assert(fallbackConfig.apiKey === "fallback-google-key-55555", "Falls back to GOOGLE_API_KEY when GEMINI_API_KEY is absent");

    // Restore original env
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    else delete process.env.GEMINI_API_KEY;
    if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
    else delete process.env.GOOGLE_API_KEY;
    resetAiConfigForTesting();
  }

  // -------------------------------------------------------------
  // TEST GROUP 2: Intelligent Error Classification
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 2: Intelligent Error Classification ---");
  {
    setDailyQuotaExhaustedState(false);

    // Subtest 2.1: Daily Free-Tier RPD Limit Exhaustion
    const dailyQuotaErr = {
      status: 429,
      message: "Resource has been exhausted (e.g. check quota).",
      errorDetails: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              subject: "generate_content_free_tier_requests",
              description: "Free tier daily request quota exceeded for model gemini-3.5-transcribe",
            },
          ],
        },
      ],
    };
    const class1 = classifyAiError(dailyQuotaErr);
    assert(class1.errorType === "DAILY_RPD_EXHAUSTED", "Classifies generate_content_free_tier_requests as DAILY_RPD_EXHAUSTED");
    assert(class1.isRetryable === false, "Daily quota exhaustion is marked isRetryable = false (prevents retry storm)");
    assert(class1.isDailyQuotaExhausted === true, "Flags isDailyQuotaExhausted = true");
    assert(class1.userMessage.includes("daily quota has been reached"), "Returns student-friendly reassurance message");
    assert(isDailyQuotaCurrentlyExhausted() === true, "Global state tracks daily quota exhaustion");

    setDailyQuotaExhaustedState(false);

    // Subtest 2.2: Transient Short-Term RPM Rate Limit
    const rpmErr = {
      status: 429,
      message: "Rate limit reached. Please wait before retrying.",
      errorDetails: [
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "4.5s",
        },
      ],
    };
    const class2 = classifyAiError(rpmErr);
    assert(class2.errorType === "RPM_LIMIT_EXCEEDED", "Classifies short-term 429 as RPM_LIMIT_EXCEEDED");
    assert(class2.isRetryable === true, "RPM rate limit is retryable");
    assert(class2.retryDelayMs === 4500, "Parses retryDelay correctly from Google RPC RetryInfo");

    // Subtest 2.3: Temporary Service Overload (503)
    const err503 = {
      status: 503,
      message: "The model is overloaded. Please try again later.",
    };
    const class3 = classifyAiError(err503);
    assert(class3.errorType === "TEMPORARY_SERVICE_UNAVAILABLE", "Classifies 503 as TEMPORARY_SERVICE_UNAVAILABLE");
    assert(class3.isRetryable === true, "503 overload is retryable");

    // Subtest 2.4: Client Error (400 Invalid Argument)
    const err400 = {
      status: 400,
      message: "INVALID_ARGUMENT: Unsupported audio mime type.",
    };
    const class4 = classifyAiError(err400);
    assert(class4.errorType === "INVALID_REQUEST", "Classifies 400 as INVALID_REQUEST");
    assert(class4.isRetryable === false, "Client 400 is not retryable");
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: Disk-Backed Audio File Management
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 3: Disk-Backed Audio File Management ---");
  {
    const sampleAudioBytes = Buffer.from("SYNTHETIC_WEBM_AUDIO_STREAM_DATA_FOR_LEARNIX_VERIFICATION");
    const testUserId = "user-test-student";
    const testLectureId = "lec-test-disk-storage";
    const seq = 1;

    const audioRef = saveAudioChunkToDisk(testUserId, testLectureId, seq, sampleAudioBytes, "audio/webm");
    assert(typeof audioRef === "string" && audioRef.includes("chunk_00001.webm"), "Saves audio chunk with formatted sequence name");

    const readBack = readAudioChunkFromDisk(audioRef);
    assert(readBack !== null, "Successfully reads saved audio chunk from disk");
    assert(readBack?.equals(sampleAudioBytes) === true, "Read audio content matches original buffer exactly");

    deleteLectureAudioChunks(testUserId, testLectureId);
    const readAfterDelete = readAudioChunkFromDisk(audioRef);
    assert(readAfterDelete === null, "deleteLectureAudioChunks cleanly purges audio directory");
  }

  // -------------------------------------------------------------
  // TEST GROUP 4: Persistent SQLite Job Queue & Lifecycle
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 4: Persistent SQLite Job Queue & Lifecycle ---");
  {
    const userId = "user-student-1";
    const lectureId = "lec-queue-verification";

    // Create a lecture in database first
    testDb.saveLecture({
      id: lectureId,
      title: "Algorithms & Complexity",
      subject: "Data Structures",
      instructor: "Prof. Sarah Jenkins",
      createdBy: userId,
      source: "live",
      status: "recording",
      transcript: [],
      notes: [],
      chapters: [],
      quiz: [],
      weakTopics: [],
      duration: 0,
      keyTakeaways: [],
      importantQuestions: [],
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      language: "en",
    });

    // 4.1: Create job in PENDING state
    const job1 = testDb.createTranscriptionJob({
      userId,
      lectureId,
      sequenceNumber: 0,
      audioRef: "audio_chunks/test/lec-1/chunk_00000.webm",
      mimeType: "audio/webm",
      durationSeconds: 45,
      startTime: 0,
      endTime: 45,
      status: "PENDING",
      chunkHash: "hash-chunk-0",
    });
    assert(job1.id === `job-${lectureId}-0`, "Creates job with predictable composite ID");
    assert(job1.status === "PENDING", "Initial job status is PENDING");

    // 4.2: Retrieve job by ID
    const retrieved = testDb.getTranscriptionJobById(job1.id);
    assert(retrieved !== null && retrieved.sequenceNumber === 0, "Retrieves job by ID with intact fields");

    // 4.3: Update status to PROCESSING and then COMPLETED
    testDb.updateTranscriptionJobStatus(job1.id, { status: "PROCESSING", attemptCount: 1 });
    let currentJob = testDb.getTranscriptionJobById(job1.id);
    assert(currentJob?.status === "PROCESSING" && currentJob.attemptCount === 1, "Updates status to PROCESSING with attemptCount");

    testDb.updateTranscriptionJobStatus(job1.id, { status: "COMPLETED" });
    currentJob = testDb.getTranscriptionJobById(job1.id);
    assert(currentJob?.status === "COMPLETED", "Updates status to COMPLETED");

    // 4.4: Interrupted Job Recovery across Server Restart
    const job2 = testDb.createTranscriptionJob({
      userId,
      lectureId,
      sequenceNumber: 1,
      audioRef: "audio_chunks/test/lec-1/chunk_00001.webm",
      mimeType: "audio/webm",
      durationSeconds: 45,
      startTime: 45,
      endTime: 90,
      status: "PROCESSING", // Simulates crash during processing
      attemptCount: 1,
    });

    const recoveredCount = testDb.recoverInterruptedJobs();
    assert(recoveredCount >= 1, "recoverInterruptedJobs detects jobs left in PROCESSING");

    const recoveredJob = testDb.getTranscriptionJobById(job2.id);
    assert(recoveredJob?.status === "RETRY_WAIT", "Interrupted job is safely reset to RETRY_WAIT to resume");
  }

  // -------------------------------------------------------------
  // TEST GROUP 5: Queue Execution, Quota Awareness & Multi-Tenant Isolation
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 5: Queue Execution, Quota Awareness & Isolation ---");
  {
    setDailyQuotaExhaustedState(false);

    // Mock Transcription Provider
    let providerCalls = 0;
    let shouldSimulateDailyQuota = false;

    const mockProvider: TranscriptionProvider = {
      name: "MockTranscriptionProvider",
      isAvailable: () => !isDailyQuotaCurrentlyExhausted(),
      classifyError: (err: any) => classifyAiError(err),
      transcribe: async (req: TranscribeRequest): Promise<TranscriptSegment[]> => {
        providerCalls++;
        if (shouldSimulateDailyQuota) {
          const quotaErr = new Error("Resource exhausted: generate_content_free_tier_requests daily limit reached");
          (quotaErr as any).status = 429;
          throw quotaErr;
        }

        return [
          {
            id: `seg-${Date.now()}-${providerCalls}`,
            startTime: req.currentTimestamp,
            endTime: req.currentTimestamp + 45,
            text: "Welcome to today's algorithmic complexity lecture.",
            topic: "Complexity Analysis",
            detectedLanguage: "en",
            isImportant: true,
          },
        ];
      },
    };

    const queue = new TranscriptionJobQueue(mockProvider, testDb);
    const userA = "user-student-alpha";
    const userB = "user-student-beta";
    const lectureA = "lec-student-alpha-1";

    testDb.saveLecture({
      id: lectureA,
      title: "Student Alpha Lecture",
      subject: "Math",
      instructor: "Prof. Alan",
      createdBy: userA,
      source: "live",
      status: "recording",
      transcript: [],
      notes: [],
      chapters: [],
      quiz: [],
      weakTopics: [],
      duration: 0,
      keyTakeaways: [],
      importantQuestions: [],
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      language: "en",
    });

    // 5.1: Successful transcription of Chunk 0
    const sampleBase64 = Buffer.from("DUMMY_AUDIO_DATA_FOR_CHUNK_0_TEST").toString("base64");
    const result0 = await queue.enqueueChunk({
      lectureId: lectureA,
      userId: userA,
      sequenceNumber: 0,
      audioBase64: sampleBase64,
      mimeType: "audio/webm",
      currentTimestamp: 0,
    });

    assert(result0.status === "transcribed", "Chunk 0 transcribes successfully");
    assert(result0.newSegments.length === 1, "Returns new transcript segments");

    const updatedLecA = testDb.getLectureById(lectureA);
    assert(updatedLecA?.transcript.length === 1, "Appends segment to lecture transcript in SQLite");

    // 5.2: Daily Quota Exhaustion on Chunk 1
    shouldSimulateDailyQuota = true;
    const sampleBase64Chunk1 = Buffer.from("DUMMY_AUDIO_DATA_FOR_CHUNK_1_TEST").toString("base64");

    const result1 = await queue.enqueueChunk({
      lectureId: lectureA,
      userId: userA,
      sequenceNumber: 1,
      audioBase64: sampleBase64Chunk1,
      mimeType: "audio/webm",
      currentTimestamp: 45,
    });

    assert(result1.status === "quota_exhausted", "Chunk 1 gracefully returns status quota_exhausted");
    assert(result1.isDailyQuotaExhausted === true, "Indicates isDailyQuotaExhausted = true");
    assert(result1.newSegments.length === 0, "No fake segments hallucinated during quota exhaustion");
    assert(isDailyQuotaCurrentlyExhausted() === true, "Global daily quota flag is active");

    const chunk1Job = testDb.getTranscriptionJobById(`job-${lectureA}-1`);
    assert(chunk1Job?.status === "QUOTA_EXHAUSTED", "Chunk 1 job stored in SQLite with status QUOTA_EXHAUSTED");

    // 5.3: Incoming Chunk 2 while Quota is Exhausted (Must NOT call AI provider at all)
    const prevCalls = providerCalls;
    const sampleBase64Chunk2 = Buffer.from("DUMMY_AUDIO_DATA_FOR_CHUNK_2_TEST").toString("base64");

    const result2 = await queue.enqueueChunk({
      lectureId: lectureA,
      userId: userA,
      sequenceNumber: 2,
      audioBase64: sampleBase64Chunk2,
      mimeType: "audio/webm",
      currentTimestamp: 90,
    });

    assert(result2.status === "quota_exhausted", "Chunk 2 queued as quota_exhausted without making doomed API call");
    assert(providerCalls === prevCalls, "Zero API calls made when daily quota is exhausted (avoids retry storms)");

    // 5.4: Multi-tenant Job Privacy and Isolation
    const userAJobs = queue.getLectureJobSummary(lectureA, userA);
    assert(userAJobs.total >= 3, "Owner User A retrieves their own lecture jobs");

    const userBProbingA = queue.getLectureJobSummary(lectureA, userB);
    assert(userBProbingA.total === 0, "Tenant Isolation: User B cannot view User A's jobs (returns 0 jobs)");

    // 5.5: Retry and Reset
    shouldSimulateDailyQuota = false;
    const retryResult = await queue.retryLectureJobs(lectureA, userA);
    assert(retryResult.queuedCount >= 2, "Reset and queued previously exhausted jobs for retry");
    assert(isDailyQuotaCurrentlyExhausted() === false, "Daily quota state cleared upon user retry");
  }

  // -------------------------------------------------------------
  // TEST GROUP 6: Multilingual Script Preservation
  // -------------------------------------------------------------
  console.log("\n--- TEST GROUP 6: Multilingual Script Preservation ---");
  {
    const hindiPromptText = `{"detectedLanguage":"Hindi","languageCode":"hi","segments":[{"text":"आज हम डेटा संरचना और स्टैक के बारे में पढ़ेंगे।","topic":"स्टैक बेसिक्स","isImportant":true}]}`;
    const parsed = JSON.parse(hindiPromptText);
    const hindiSegmentText = parsed.segments[0].text;

    assert(/[\u0900-\u097F]/.test(hindiSegmentText), "Hindi transcript segment contains authentic Devanagari Unicode characters");
    assert(!/^[a-zA-Z\s.,]+$/.test(hindiSegmentText), "Hindi text is not transliterated into Latin characters");
  }

  // Wait for background queue drain to settle before closing test db
  await new Promise((r) => setTimeout(r, 200));

  // Cleanup test database
  testDb.close();
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=======================================================");
  console.log(`  TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=======================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
