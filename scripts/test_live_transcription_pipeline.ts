/**
 * Comprehensive Verification Suite for Live Lecture Transcription,
 * Verbatim Speech Capture, Language Fidelity, Evidence-Grounded Smart Notes,
 * and Anti-Hallucination Quiz Engine.
 */

import assert from "assert";
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import { WebSocket } from "ws";
import { db } from "../server/db";
import apiRoutes from "../server/routes/api";
import { liveTranscriptionService, pcmToWav } from "../server/services/liveTranscriptionService";
import { processLectureTranscript, fallbackExtraction } from "../server/services/aiUnderstandingService";
import { generateQuizForLecture, fallbackQuiz } from "../server/services/quizService";
import { Lecture, TranscriptSegment, User } from "../src/types";

let testServer: http.Server;
let testBaseUrl: string;
let testWsUrl: string;
let testUser: User;
let testSessionToken: string;

async function setupTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", apiRoutes);

  testServer = http.createServer(app);

  testServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "", `http://${req.headers.host}`).pathname;
    if (pathname === "/api/live-stream") {
      liveTranscriptionService.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => {
    testServer.listen(0, "127.0.0.1", () => {
      const addr = testServer.address() as any;
      testBaseUrl = `http://127.0.0.1:${addr.port}`;
      testWsUrl = `ws://127.0.0.1:${addr.port}/api/live-stream`;
      resolve();
    });
  });

  // Create clean test user & session
  const userId = `user-pipeline-${Date.now()}`;
  testUser = await (db.createUser as any)({
    id: userId,
    email: `student-${Date.now()}@learnix.edu`,
    name: "Aarav Sharma",
    role: "student",
    status: "active",
  }, "Password123!");

  const sess = await (db.createSession as any)(testUser.id || userId, "TestAgent", "127.0.0.1");
  testSessionToken = sess.token;
}

async function runLivePipelineSuite() {
  console.log("\n=============================================================");
  console.log("  LearniX Live Lecture Pipeline Verification Suite");
  console.log("=============================================================\n");

  await setupTestApp();

  // --------------------------------------------------------------------------
  // TEST 1: Master Data Topic Count Enrichment
  // --------------------------------------------------------------------------
  console.log("--- 1. Master Data Syllabus Topics Enrichment ---");
  {
    const subjects = ["subj-dsa", "subj-os", "subj-net", "subj-ai"];
    for (const subjId of subjects) {
      const topics = await (db.getTopics as any)(subjId, true);
      assert.ok(
        topics.length >= 9,
        `Subject ${subjId} must contain at least 9 syllabus topics (found: ${topics.length})`
      );
    }
    console.log("  [PASS] All 4 core curriculum subjects contain 9+ enriched syllabus topics (36+ total).");

    // Test POST /api/academic/topics endpoint
    const newTopicRes = await fetch(`${testBaseUrl}/api/academic/topics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testSessionToken}`,
      },
      body: JSON.stringify({
        subjectId: "subj-os",
        topicName: "Multi-Core Cache Coherence (MESI Protocol)",
        description: "Hardware cache snooping and write-invalidate protocols.",
        sortOrder: 10,
      }),
    });
    assert.strictEqual(newTopicRes.status, 201, "POST /api/academic/topics should succeed");
    const createdTopic = await newTopicRes.json();
    assert.strictEqual(createdTopic.topicName, "Multi-Core Cache Coherence (MESI Protocol)");
    console.log("  [PASS] Dynamic topic creation endpoint successfully adds authorized topics.");
  }

  // --------------------------------------------------------------------------
  // TEST 2: PCM Audio Buffer Conversion to WAV
  // --------------------------------------------------------------------------
  console.log("\n--- 2. PCM 16kHz to WAV Buffer Architecture ---");
  {
    // 16000 samples = 1 second of 16-bit mono PCM = 32000 bytes
    const dummyPcm = Buffer.alloc(32000);
    for (let i = 0; i < dummyPcm.length; i += 2) {
      dummyPcm.writeInt16LE(Math.sin(i / 10) * 10000, i);
    }

    const wav = pcmToWav(dummyPcm, 16000, 1, 16);
    assert.strictEqual(wav.length, 32000 + 44, "WAV buffer must be exactly PCM bytes + 44-byte header");
    assert.strictEqual(wav.toString("ascii", 0, 4), "RIFF");
    assert.strictEqual(wav.toString("ascii", 8, 12), "WAVE");
    assert.strictEqual(wav.toString("ascii", 12, 16), "fmt ");
    assert.strictEqual(wav.readUInt32LE(24), 16000, "Sample rate must be 16000 Hz");
    assert.strictEqual(wav.readUInt16LE(22), 1, "Channels must be 1 (mono)");
    assert.strictEqual(wav.readUInt16LE(34), 16, "Bits per sample must be 16");
    console.log("  [PASS] 16kHz signed 16-bit PCM correctly converted to standard RIFF/WAVE header.");
  }

  // --------------------------------------------------------------------------
  // TEST 3: WebSocket Live Stream Connection & Authentication
  // --------------------------------------------------------------------------
  console.log("\n--- 3. WebSocket Live Stream Connection & Session Lifecycle ---");
  {
    const lecture = await (db.saveLecture as any)({
      id: `lec-ws-${Date.now()}`,
      title: "Operating Systems Lecture 1",
      subject: "Operating Systems",
      createdBy: testUser.id,
      status: "recording",
      transcript: [],
      notes: [],
      chapters: [],
      weakTopics: [],
    });

    const wsUrl = `${testWsUrl}?token=${testSessionToken}&lectureId=${lecture.id}&language=en`;
    const ws = new WebSocket(wsUrl);

    const events: any[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {});
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        events.push(msg);
        if (msg.type === "session_started") {
          resolve();
        }
      });
      ws.on("error", reject);
    });

    assert.ok(events.some((e) => e.type === "session_started"), "Must receive session_started event");
    const startedEvent = events.find((e) => e.type === "session_started");
    assert.strictEqual(startedEvent.lectureId, lecture.id);
    assert.ok(startedEvent.recordingSessionId.startsWith("rec-"));

    // Send binary 16kHz PCM audio
    const pcmChunk = Buffer.alloc(16000); // 0.5s of audio
    ws.send(pcmChunk);

    // Send end_session control message
    ws.send(JSON.stringify({ type: "end_session" }));

    await new Promise<void>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "session_finalized") {
          events.push(msg);
          resolve();
        }
      });
    });

    const finalizedEvent = events.find((e) => e.type === "session_finalized");
    assert.ok(finalizedEvent, "Must receive session_finalized event");
    assert.strictEqual(finalizedEvent.lectureId, lecture.id);

    ws.close();

    // Verify DB update
    const updated = await (db.getLectureById as any)(lecture.id, testUser.id);
    assert.strictEqual(updated.status, "completed", "Lecture status must be updated to completed");
    console.log("  [PASS] WebSocket live stream establishes authenticated session, receives PCM frames, and completes cleanly.");
  }

  // --------------------------------------------------------------------------
  // TEST 4: Evidence-Grounded Smart Notes with sourceSegmentIds
  // --------------------------------------------------------------------------
  console.log("\n--- 4. Evidence-Grounded Smart Notes & Anti-Hallucination ---");
  {
    const segments: TranscriptSegment[] = [
      {
        id: "seg-101",
        startTime: 0,
        endTime: 45,
        text: "The translation lookaside buffer or TLB is a high-speed associative hardware cache that speeds up virtual-to-physical address translation.",
        topic: "TLB Overview",
        isDefinition: true,
        isImportant: true,
      },
      {
        id: "seg-102",
        startTime: 45,
        endTime: 90,
        text: "When a page table lookup hits in the TLB, the translation completes in a single CPU clock cycle without accessing main memory.",
        topic: "TLB Hit Latency",
        isImportant: true,
      },
    ];

    const result = fallbackExtraction("Virtual Memory & TLB", "Operating Systems", segments);
    assert.strictEqual(result.notes.length, 1, "Must generate exactly 1 note section for short focused lecture");
    const note = result.notes[0];
    assert.ok(note.sourceSegmentIds, "Note section must include sourceSegmentIds");
    assert.ok(note.sourceSegmentIds.includes("seg-101"), "Note section must cite seg-101");
    assert.ok(note.sourceSegmentIds.includes("seg-102"), "Note section must cite seg-102");
    assert.strictEqual(note.confidence, "supported");
    assert.ok(result.summary.includes("Virtual Memory & TLB"), "Summary must ground in lecture title");
    console.log("  [PASS] Smart notes strictly cite verified sourceSegmentIds without outside invention.");
  }

  // --------------------------------------------------------------------------
  // TEST 5: Multilingual Fidelity (Hindi, Hinglish, English)
  // --------------------------------------------------------------------------
  console.log("\n--- 5. Multilingual Language Fidelity ---");
  {
    // Hindi lecture in Devanagari script
    const hindiSegments: TranscriptSegment[] = [
      {
        id: "seg-hi-1",
        startTime: 0,
        endTime: 30,
        text: "आज हम ऑपरेटिंग सिस्टम में वर्चुअल मेमोरी और पेजिंग के सिद्धांत को समझेंगे।",
        topic: "वर्चुअल मेमोरी",
        isImportant: true,
      },
      {
        id: "seg-hi-2",
        startTime: 30,
        endTime: 60,
        text: "पेज फॉल्ट तब होता है जब मांगी गई मेमोरी पेज मुख्य रैम में मौजूद नहीं होती।",
        topic: "पेज फॉल्ट",
        isDefinition: true,
      },
    ];

    const hindiResult = fallbackExtraction("ऑपरेटिंग सिस्टम", "Computer Science", hindiSegments);
    assert.ok(hindiResult.notes[0].summary.includes("वर्चुअल मेमोरी"), "Hindi note summary must preserve Devanagari script");
    assert.ok(hindiResult.notes[0].summary.includes("पेज फॉल्ट"), "Hindi definitions must preserve Devanagari script");

    // Hinglish lecture
    const hinglishSegments: TranscriptSegment[] = [
      {
        id: "seg-hng-1",
        startTime: 0,
        endTime: 30,
        text: "Aap log dhyaan dijiye, binary search tree me left child hamesha parent se chhota hota hai.",
        topic: "BST Rule",
        isImportant: true,
      },
      {
        id: "seg-hng-2",
        startTime: 30,
        endTime: 60,
        text: "Right child hamesha parent value se bada hoga, yehi BST ka primary invariant hai.",
        topic: "BST Invariant",
        isDefinition: true,
      },
    ];

    const hinglishResult = fallbackExtraction("Binary Search Trees", "DSA", hinglishSegments);
    assert.ok(hinglishResult.notes[0].summary.includes("hamesha"), "Hinglish speech must preserve Hinglish text without forced translation");
    console.log("  [PASS] Language fidelity strictly preserved (Hindi in Devanagari, Hinglish in Latin, English in English).");
  }

  // --------------------------------------------------------------------------
  // TEST 6: Honest Insufficient Content Reporting in Quiz Engine
  // --------------------------------------------------------------------------
  console.log("\n--- 6. Evidence-Based Quiz Engine & Insufficient Content Honesty ---");
  {
    // Very brief lecture (1 statement, no definitions)
    const sparseLecture: Lecture = {
      id: "lec-sparse",
      title: "Brief Intro",
      subject: "Operating Systems",
      instructor: "Dr. Peterson",
      date: "2026-11-03",
      duration: 15,
      status: "completed",
      source: "live",
      createdBy: testUser.id,
      weakTopics: [],
      transcript: [
        {
          id: "seg-brief",
          startTime: 0,
          endTime: 10,
          text: "Hello everyone, welcome to today's short lecture announcement.",
        },
      ],
      chapters: [],
      notes: [],
    };

    const sparseQuiz = fallbackQuiz(sparseLecture, 4);
    assert.strictEqual(sparseQuiz.status, "insufficient_content", "Quiz must report insufficient_content for brief lectures");
    assert.strictEqual(sparseQuiz.questions.length, 0, "No questions should be hallucinated when content is insufficient");
    assert.ok(sparseQuiz.message && sparseQuiz.message.includes("Insufficient lecture discourse"), "Must provide honest academic reason");

    // Substantive lecture (4 segments)
    const richLecture: Lecture = {
      ...sparseLecture,
      id: "lec-rich",
      transcript: [
        {
          id: "seg-d1",
          startTime: 0,
          endTime: 30,
          text: "A semaphore is a synchronization variable that can only be accessed through wait and signal operations.",
          topic: "Semaphores",
          isDefinition: true,
        },
        {
          id: "seg-d2",
          startTime: 30,
          endTime: 60,
          text: "The wait operation decrements the semaphore counter, blocking if the counter is less than zero.",
          topic: "Wait Operation",
        },
        {
          id: "seg-d3",
          startTime: 60,
          endTime: 90,
          text: "The signal operation increments the semaphore counter, waking up one waiting process.",
          topic: "Signal Operation",
        },
      ],
      notes: [
        {
          id: "n-1",
          topic: "Semaphores",
          summary: "Synchronization primitives with wait and signal operations.",
          sourceSegmentIds: ["seg-d1", "seg-d2", "seg-d3"],
          definitions: [
            {
              term: "Semaphore",
              definition: "A synchronization variable accessed through atomic wait and signal operations.",
            },
          ],
          keyConcepts: ["Semaphores", "Wait", "Signal"],
          proceduresOrSteps: [],
          examples: [],
          formulas: [],
          importantPoints: [],
          sourceTimestamps: [{ start: 0, end: 90 }],
        },
      ],
    };

    const richQuiz = fallbackQuiz(richLecture, 3);
    assert.strictEqual(richQuiz.status, "ready", "Quiz must be ready when substantive discourse is available");
    assert.ok(richQuiz.questions.length >= 2, "Must formulate questions from verified discourse");
    for (const q of richQuiz.questions) {
      assert.ok(q.sourceSegmentIds && q.sourceSegmentIds.length > 0, "Every question must cite sourceSegmentIds");
      assert.ok(
        q.sourceSegmentIds.some((id) => ["seg-d1", "seg-d2", "seg-d3"].includes(id)),
        "Cited segment IDs must be real IDs from lecture transcript"
      );
    }
    console.log("  [PASS] Quiz engine honestly reports insufficient_content when speech is brief, and generates strictly cited questions for substantive lectures.");
  }

  // --------------------------------------------------------------------------
  // TEST 7: Full Transcript Coverage (No Truncation)
  // --------------------------------------------------------------------------
  console.log("\n--- 7. Comprehensive Full Timeline Coverage (No Truncation) ---");
  {
    const manySegments: TranscriptSegment[] = Array.from({ length: 50 }, (_, i) => ({
      id: `seg-timeline-${i + 1}`,
      startTime: i * 60,
      endTime: (i + 1) * 60,
      text: `Lecture discourse segment ${i + 1} explaining detailed computing architecture concepts.`,
      topic: `Topic Section ${Math.floor(i / 10) + 1}`,
      isImportant: i % 5 === 0,
    }));

    const result = fallbackExtraction("Computer Architecture 401", "Computer Systems", manySegments);
    assert.ok(result.chapters.length >= 4, "Long lecture must be grouped into multiple timeline chapters");
    const lastChapter = result.chapters[result.chapters.length - 1];
    assert.strictEqual(
      lastChapter.endTime,
      manySegments[manySegments.length - 1].endTime,
      "Final chapter must cover the entire duration of the lecture without truncation"
    );
    console.log("  [PASS] Full lecture timeline coverage verified across 50 segments without truncation.");
  }

  // Teardown
  await new Promise<void>((resolve) => testServer.close(() => resolve()));

  console.log("\n=============================================================");
  console.log("✓ ALL 7/7 LIVE TRANSCRIPTION PIPELINE TESTS PASSED!");
  console.log("=============================================================\n");
}

runLivePipelineSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test Suite Failed with error:", err);
    process.exit(1);
  });
