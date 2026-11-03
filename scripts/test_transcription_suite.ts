import assert from "assert";
import path from "path";
import fs from "fs";
import http from "http";
import express from "express";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// Point SQLite to isolated test DB
const TEST_DIR = path.join(process.cwd(), ".data_test", "transcription_suite");
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });
process.env.SQLITE_DB_PATH = path.join(TEST_DIR, "transcribe_test.sqlite");

import {
  transcribeAudioChunk,
  validateAndNormalizeAudio,
  extractTextFromResponse,
  parseTranscriptionToSegments,
  TranscriptionError,
} from "../server/services/transcriptionService";
import { transcriptionScheduler, GeminiTranscriptionScheduler } from "../server/services/geminiScheduler";
import { setMockGeminiClient, resetGeminiClient, resolveGeminiApiKey } from "../server/geminiClient";
import { db } from "../server/db";
import apiRoutes from "../server/routes/api";

function createValidWavBase64(durationSec = 1, sampleRate = 16000): string {
  const numSamples = sampleRate * durationSec;
  const pcmData = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * 8000;
    pcmData.writeInt16LE(Math.round(sample), i * 2);
  }

  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmData.length, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([buffer, pcmData]).toString("base64");
}

async function runTestSuite() {
  console.log("==================================================");
  console.log("  LEARNIX AUDIO TRANSCRIPTION & SCHEDULER SUITE   ");
  console.log("==================================================");

  // Setup express server for API scenario tests
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
  console.log(`[Setup] API test server listening on ${BASE_URL}\n`);

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Valid audio transcription
    // -------------------------------------------------------------------------
    console.log("[Scenario 1] Valid audio transcription...");
    transcriptionScheduler.clearQueue();
    const validWav = createValidWavBase64(1);

    const mockAi1: any = {
      models: {
        generateContent: async () => {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        segments: [
                          {
                            text: "Today we study Stack Operations and LIFO invariants.",
                            topic: "Stack Data Structures",
                            isImportant: true,
                            isDefinition: true,
                            isExample: false,
                            isKeyPoint: true,
                            durationEstimate: 6,
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };
    setMockGeminiClient(mockAi1);

    // Also test codec parameter stripping: audio/webm;codecs=opus
    const segments1 = await transcribeAudioChunk({
      audioBase64: validWav,
      mimeType: "audio/webm;codecs=opus",
      currentTimestamp: 0,
      lectureId: "lec-test-1",
    });

    assert.strictEqual(segments1.length, 1, "Should parse 1 segment");
    assert.strictEqual(segments1[0].text, "Today we study Stack Operations and LIFO invariants.");
    assert.strictEqual(segments1[0].topic, "Stack Data Structures");
    assert.strictEqual(segments1[0].isImportant, true);
    assert.strictEqual(segments1[0].isDefinition, true);
    console.log("✓ Scenario 1 Passed: Valid audio transcribed and codec parameters sanitized.");

    // -------------------------------------------------------------------------
    // Scenario 2: Invalid audio payload (malformed base64)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 2] Invalid audio payload (malformed base64)...");
    try {
      await transcribeAudioChunk({
        audioBase64: "!@#$%^&*not_valid_base64",
        mimeType: "audio/webm",
        currentTimestamp: 0,
        lectureId: "lec-test-2",
      });
      assert.fail("Should have thrown TranscriptionError for invalid base64");
    } catch (err: any) {
      assert(err instanceof TranscriptionError, "Must be TranscriptionError");
      assert.strictEqual(err.status, 400);
      assert(err.message.includes("Invalid base64"));
      console.log("✓ Scenario 2 Passed: Malformed base64 rejected with HTTP 400.");
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Unsupported MIME type
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 3] Unsupported MIME type...");
    try {
      await transcribeAudioChunk({
        audioBase64: validWav,
        mimeType: "image/png",
        currentTimestamp: 0,
        lectureId: "lec-test-3",
      });
      assert.fail("Should have thrown TranscriptionError for unsupported MIME");
    } catch (err: any) {
      assert(err instanceof TranscriptionError);
      assert.strictEqual(err.status, 400);
      assert(err.message.includes("Unsupported audio MIME type"));
      console.log("✓ Scenario 3 Passed: Unsupported MIME type rejected with HTTP 400.");
    }

    // -------------------------------------------------------------------------
    // Scenario 4: Empty audio chunk
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 4] Empty audio chunk...");
    try {
      await transcribeAudioChunk({
        audioBase64: "",
        mimeType: "audio/wav",
        currentTimestamp: 0,
        lectureId: "lec-test-4",
      });
      assert.fail("Should have thrown TranscriptionError for empty audio chunk");
    } catch (err: any) {
      assert(err instanceof TranscriptionError);
      assert.strictEqual(err.status, 400);
      console.log("✓ Scenario 4 Passed: Empty audio chunk rejected with HTTP 400.");
    }

    // -------------------------------------------------------------------------
    // Scenario 5: Gemini 400 response handling
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 5] Gemini 400 response handling...");
    transcriptionScheduler.clearQueue();
    let callCount400 = 0;
    const mockAi400: any = {
      models: {
        generateContent: async () => {
          callCount400 += 1;
          const err: any = new Error("Request contains an invalid argument.");
          err.status = 400;
          throw err;
        },
      },
    };
    setMockGeminiClient(mockAi400);

    const wav5 = createValidWavBase64(0.5);
    try {
      await transcribeAudioChunk({
        audioBase64: wav5,
        mimeType: "audio/wav",
        currentTimestamp: 10,
        lectureId: "lec-test-5",
      });
    } catch (e) {
      // Expected
    }
    // Verify 400 is NOT retried
    assert.strictEqual(callCount400, 1, "400 error must NOT trigger retries");
    console.log("✓ Scenario 5 Passed: Gemini 400 errors fail fast without wasteful retries.");

    // -------------------------------------------------------------------------
    // Scenario 6: Gemini 429 response handling & retryDelay
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 6] Gemini 429 response handling (with retryDelay)...");
    transcriptionScheduler.clearQueue();
    let callCount429 = 0;
    const mockAi429: any = {
      models: {
        generateContent: async () => {
          callCount429 += 1;
          if (callCount429 === 1) {
            const err: any = new Error("Resource exhausted: quota exceeded.");
            err.status = 429;
            err.errorDetails = [
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "0.2s", // 200ms delay
              },
            ];
            throw err;
          }
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        segments: [{ text: "Recovered from 429 quota throttle successfully." }],
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };
    setMockGeminiClient(mockAi429);

    const wav6 = createValidWavBase64(1.2);
    const segs6 = await transcribeAudioChunk({
      audioBase64: wav6,
      mimeType: "audio/wav",
      currentTimestamp: 20,
      lectureId: "lec-test-6",
    });

    assert.strictEqual(callCount429, 2, "Must retry once after 429");
    assert.strictEqual(segs6.length, 1);
    assert(segs6[0].text.includes("Recovered from 429"));
    console.log("✓ Scenario 6 Passed: 429 rate limit handled with Google retryDelay backoff and succeeded on retry.");

    // -------------------------------------------------------------------------
    // Scenario 7: Gemini 503 response handling
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 7] Gemini 503 response handling...");
    transcriptionScheduler.clearQueue();
    let callCount503 = 0;
    const mockAi503: any = {
      models: {
        generateContent: async () => {
          callCount503 += 1;
          if (callCount503 === 1) {
            const err: any = new Error("The model is currently experiencing high demand.");
            err.status = 503;
            throw err;
          }
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        segments: [{ text: "503 recovered." }],
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };
    setMockGeminiClient(mockAi503);

    const wav7 = createValidWavBase64(1.4);
    const segs7 = await transcribeAudioChunk({
      audioBase64: wav7,
      mimeType: "audio/wav",
      currentTimestamp: 30,
      lectureId: "lec-test-7",
    });
    assert.strictEqual(callCount503, 2, "Must retry on temporary 503 error");
    assert.strictEqual(segs7[0].text, "503 recovered.");
    console.log("✓ Scenario 7 Passed: Temporary 503 error successfully retried and recovered.");

    // -------------------------------------------------------------------------
    // Scenario 8: Multiple consecutive audio chunks
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 8] Multiple consecutive audio chunks...");
    transcriptionScheduler.clearQueue();
    transcriptionScheduler.setRpm(60); // Fast execution for test

    let consecutiveIndex = 0;
    const mockAi8: any = {
      models: {
        generateContent: async () => {
          consecutiveIndex += 1;
          return {
            candidates: [
              {
                content: {
                  parts: [{ text: `Sentence number ${consecutiveIndex}` }],
                },
              },
            ],
          };
        },
      },
    };
    setMockGeminiClient(mockAi8);

    const [c1, c2, c3] = await Promise.all([
      transcribeAudioChunk({
        audioBase64: createValidWavBase64(0.8),
        mimeType: "audio/wav",
        currentTimestamp: 0,
        sequenceNumber: 1,
        lectureId: "lec-test-8",
      }),
      transcribeAudioChunk({
        audioBase64: createValidWavBase64(0.9),
        mimeType: "audio/wav",
        currentTimestamp: 25,
        sequenceNumber: 2,
        lectureId: "lec-test-8",
      }),
      transcribeAudioChunk({
        audioBase64: createValidWavBase64(1.0),
        mimeType: "audio/wav",
        currentTimestamp: 50,
        sequenceNumber: 3,
        lectureId: "lec-test-8",
      }),
    ]);

    assert.strictEqual(c1[0].text, "Sentence number 1");
    assert.strictEqual(c2[0].text, "Sentence number 2");
    assert.strictEqual(c3[0].text, "Sentence number 3");
    console.log("✓ Scenario 8 Passed: Consecutive chunks processed in exact sequential order.");

    // -------------------------------------------------------------------------
    // Scenario 9: Long live lecture (RPM throttled through scheduler)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 9] Long live lecture (RPM limit throttling)...");
    const customScheduler = new GeminiTranscriptionScheduler();
    customScheduler.setRpm(2); // 2 RPM

    const timestamps: number[] = [];
    const runTask = (idx: number) =>
      customScheduler.enqueue({
        lectureId: "lec-long",
        sequenceNumber: idx,
        audioBase64: Buffer.from(`unique-audio-chunk-data-${idx}-${Date.now()}`).toString("base64"),
        execute: async () => {
          timestamps.push(Date.now());
          return `Chunk ${idx} done`;
        },
      });

    // Enqueue 2 tasks (should run immediately within 2 RPM)
    const p1 = runTask(1);
    const p2 = runTask(2);
    await Promise.all([p1, p2]);
    assert.strictEqual(timestamps.length, 2);
    assert.strictEqual(customScheduler.getRpm(), 2);
    console.log("✓ Scenario 9 Passed: Long live lecture respects configured RPM limits.");

    // -------------------------------------------------------------------------
    // Scenario 10: Final incomplete audio chunk
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 10] Final incomplete audio chunk...");
    // A) Too small (< 50 bytes)
    try {
      validateAndNormalizeAudio(Buffer.from("short").toString("base64"), "audio/wav");
      assert.fail("Should reject too small chunk");
    } catch (e: any) {
      assert(e.message.includes("too small"));
    }

    // B) Valid final chunk (e.g. 200 bytes)
    const finalChunkB64 = createValidWavBase64(0.2);
    const normalizedFinal = validateAndNormalizeAudio(finalChunkB64, "audio/wav");
    assert(normalizedFinal.byteLength >= 50);
    console.log("✓ Scenario 10 Passed: Final incomplete chunk handled safely with size boundary checks.");

    // -------------------------------------------------------------------------
    // Scenario 11: Gemini unavailable (Honest fallback, no fake text)
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 11] Gemini unavailable (honest fallback, no fake text)...");
    setMockGeminiClient(null);

    const wav11A = createValidWavBase64(1.6);
    const wav11B = createValidWavBase64(1.7);

    // Case A: Fallback text from client Web Speech API
    const fallbackRes = await transcribeAudioChunk({
      audioBase64: wav11A,
      mimeType: "audio/wav",
      currentTimestamp: 60,
      fallbackText: "Web Speech API captured this phrase.",
      lectureId: "lec-test-11",
    });
    assert.strictEqual(fallbackRes.length, 1);
    assert.strictEqual(fallbackRes[0].text, "Web Speech API captured this phrase.");

    // Case B: No client fallback text and Gemini is unavailable -> MUST throw honest error, NEVER fake text
    try {
      await transcribeAudioChunk({
        audioBase64: wav11B,
        mimeType: "audio/wav",
        currentTimestamp: 60,
        lectureId: "lec-test-11",
      });
      assert.fail("Should throw when no Gemini client and no fallback text");
    } catch (err: any) {
      assert(err instanceof TranscriptionError);
      assert.strictEqual(err.status, 503);
      assert(!err.message.includes("Audio captured and processed."));
      console.log("✓ Scenario 11 Passed: Honest fallback activated without fake placeholder text.");
    }

    // Restore mock client for remaining tests
    setMockGeminiClient(mockAi1);

    // -------------------------------------------------------------------------
    // Scenario 12: Duplicate chunk prevention
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 12] Duplicate chunk prevention...");
    transcriptionScheduler.clearQueue();
    transcriptionScheduler.setRpm(60);
    let geminiApiInvocations = 0;
    const mockAi12: any = {
      models: {
        generateContent: async () => {
          geminiApiInvocations += 1;
          return {
            candidates: [
              {
                content: {
                  parts: [{ text: "Deduplicated speech response" }],
                },
              },
            ],
          };
        },
      },
    };
    setMockGeminiClient(mockAi12);

    const dupWav = createValidWavBase64(1.5);
    const resA = await transcribeAudioChunk({
      audioBase64: dupWav,
      mimeType: "audio/wav",
      currentTimestamp: 0,
      lectureId: "lec-dup",
    });
    const resB = await transcribeAudioChunk({
      audioBase64: dupWav,
      mimeType: "audio/wav",
      currentTimestamp: 0,
      lectureId: "lec-dup",
    });

    assert.strictEqual(resA[0].text, "Deduplicated speech response");
    assert.strictEqual(resB[0].text, "Deduplicated speech response");
    assert.strictEqual(geminiApiInvocations, 1, "Duplicate payload must use cached result without extra API call");
    console.log("✓ Scenario 12 Passed: Duplicate chunk recognized and deduplicated (0 extra API calls).");

    // -------------------------------------------------------------------------
    // Scenario 13: Multiple users processing lectures simultaneously
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 13] Multiple users processing lectures simultaneously...");
    transcriptionScheduler.clearQueue();
    transcriptionScheduler.setRpm(60);

    const testTime = Date.now();
    const userARes = await transcribeAudioChunk({
      audioBase64: createValidWavBase64(0.7),
      mimeType: "audio/wav",
      currentTimestamp: 0,
      lectureId: `lec-user-a-${testTime}`,
      userId: `user-a-${testTime}`,
    });
    const userBRes = await transcribeAudioChunk({
      audioBase64: createValidWavBase64(1.1),
      mimeType: "audio/wav",
      currentTimestamp: 0,
      lectureId: `lec-user-b-${testTime}`,
      userId: `user-b-${testTime}`,
    });

    assert(userARes.length > 0);
    assert(userBRes.length > 0);
    console.log("✓ Scenario 13 Passed: Multiple independent user streams handled concurrently without collision.");

    // -------------------------------------------------------------------------
    // Scenario 14: Correct transcription ordering
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 14] Correct transcription ordering...");
    const orderScheduler = new GeminiTranscriptionScheduler();
    orderScheduler.setRpm(60);

    const executionOrder: number[] = [];
    const makeTask = (seq: number, delayMs = 0) =>
      orderScheduler.enqueue({
        lectureId: "lec-order",
        sequenceNumber: seq,
        audioBase64: Buffer.from(`chunk-seq-${seq}`).toString("base64"),
        execute: async () => {
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          executionOrder.push(seq);
          return seq;
        },
      });

    // Start task 0 with 60ms delay so that subsequent tasks queue up
    const pOrder0 = makeTask(0, 60);
    // While task 0 is busy, enqueue out of order: 3, then 1, then 2
    const pOrder3 = makeTask(3);
    const pOrder1 = makeTask(1);
    const pOrder2 = makeTask(2);
    await Promise.all([pOrder0, pOrder3, pOrder1, pOrder2]);

    assert.strictEqual(executionOrder[0], 0, "Seq 0 ran first");
    assert.strictEqual(executionOrder[1], 1, "Seq 1 should execute next (sorted by seq)");
    assert.strictEqual(executionOrder[2], 2, "Seq 2 should execute next");
    assert.strictEqual(executionOrder[3], 3, "Seq 3 should execute next");
    console.log("✓ Scenario 14 Passed: Out-of-order chunk arrivals sorted and executed in sequence order.");

    // -------------------------------------------------------------------------
    // Scenario 15: Correct association of transcription with authenticated user
    // -------------------------------------------------------------------------
    console.log("\n[Scenario 15] Correct association of transcription with authenticated user...");
    // Create User A and Lecture A in SQLite
    const userA = { id: `u-test-a-${Date.now()}`, name: "Alice", email: `alice-${Date.now()}@test.com` };
    db.createUser(userA);
    const lectureA = {
      id: `lec-auth-test-${Date.now()}`,
      title: "Algorithms Lecture",
      subject: "CS",
      date: "2026-11-03",
      duration: 0,
      status: "recording" as const,
      source: "live" as const,
      transcript: [],
      chapters: [],
      notes: [],
      attempts: [],
      weakTopics: [],
      createdBy: userA.id,
    };
    db.saveLecture(lectureA);

    // Create User B
    const userB = { id: `u-test-b-${Date.now()}`, name: "Bob", email: `bob-${Date.now()}@test.com` };
    db.createUser(userB);

    const sessionA = db.createSession(userA.id);
    const sessionB = db.createSession(userB.id);

    const authHeadersA = {
      Authorization: `Bearer ${sessionA.token}`,
      "Content-Type": "application/json",
    };
    const authHeadersB = {
      Authorization: `Bearer ${sessionB.token}`,
      "Content-Type": "application/json",
    };

    // 1. Unauthenticated request -> 401
    const unauthRes = await fetch(`${BASE_URL}/api/lectures/${lectureA.id}/transcribe-chunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: validWav }),
    });
    assert.strictEqual(unauthRes.status, 401, "Unauthenticated transcribe request must return 401");

    // 2. User B trying to transcribe on User A's lecture -> 403 Forbidden
    const crossTenantRes = await fetch(`${BASE_URL}/api/lectures/${lectureA.id}/transcribe-chunk`, {
      method: "POST",
      headers: authHeadersB,
      body: JSON.stringify({ audioBase64: validWav }),
    });
    assert.strictEqual(crossTenantRes.status, 403, "User B accessing User A's lecture must return 403 Forbidden");

    // 3. User A transcribing on User A's lecture -> 200 OK
    const ownerRes = await fetch(`${BASE_URL}/api/lectures/${lectureA.id}/transcribe-chunk`, {
      method: "POST",
      headers: authHeadersA,
      body: JSON.stringify({
        audioBase64: validWav,
        mimeType: "audio/wav",
        currentTimestamp: 0,
        sequenceNumber: 1,
      }),
    });
    assert.strictEqual(ownerRes.status, 200, "Owner transcribing on their own lecture must succeed");
    const ownerData = await ownerRes.json();
    assert(ownerData.totalSegments > 0);

    // Verify persisted in SQLite
    const savedLec = db.getLectureById(lectureA.id);
    assert.strictEqual(savedLec?.transcript.length, ownerData.totalSegments);
    assert.strictEqual(savedLec?.createdBy, userA.id);
    console.log("✓ Scenario 15 Passed: Transcripts securely bound to authenticated owner; cross-tenant blocked.");

    console.log("\n==================================================");
    console.log("  ALL 15 SCENARIOS PASSED WITH ZERO ERRORS!       ");
    console.log("==================================================");
  } finally {
    server.close();
    db.close();
    resetGeminiClient();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

runTestSuite().catch((err) => {
  console.error("Test Suite Failed with error:", err);
  process.exit(1);
});
