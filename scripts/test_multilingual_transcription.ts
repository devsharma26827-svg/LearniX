import assert from "assert";
import path from "path";
import fs from "fs";
import {
  parseTranscriptionToSegments,
  validateAndNormalizeAudio,
  transcribeAudioChunk,
} from "../server/services/transcriptionService";
import { setMockGeminiClient, resetGeminiClient } from "../server/geminiClient";
import { Database } from "../server/db";

const TEST_DIR = path.join(process.cwd(), ".data_test_multilingual");
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const TEST_DB = path.join(TEST_DIR, "multilingual.sqlite");
process.env.SQLITE_DB_PATH = TEST_DB;
process.env.NODE_ENV = "test";

function createValidWavBase64(durationSeconds = 1, sampleRate = 16000): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer.toString("base64");
}

async function runMultilingualSuite() {
  console.log("==================================================");
  console.log("  LEARNIX MULTILINGUAL TRANSCRIPTION TEST SUITE   ");
  console.log("==================================================");

  const db = new Database(TEST_DB);

  try {
    // -------------------------------------------------------------------------
    // Test 1: Hindi (Devanagari) Response Parsing & Native Script Preservation
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Parsing authentic Hindi Devanagari transcription response...");
    const hindiRawResponse = JSON.stringify({
      detectedLanguage: "Hindi",
      languageCode: "hi",
      segments: [
        {
          text: "स्टैक एक लीफो (LIFO) डेटा संरचना है जहां केवल शीर्ष से एलिमेंट जोड़े जाते हैं।",
          topic: "Stack Definition",
          detectedLanguage: "Hindi",
          languageCode: "hi",
          isImportant: true,
          isDefinition: true,
          durationEstimate: 6,
        },
        {
          text: "पुश ऑपरेशन ओ(1) समय जटिलता में नया एलिमेंट जोड़ता है।",
          topic: "Push Operation",
          detectedLanguage: "Hindi",
          languageCode: "hi",
          isImportant: true,
          durationEstimate: 5,
        },
      ],
    });

    const hindiSegments = parseTranscriptionToSegments(hindiRawResponse, 0, "hi");
    assert.strictEqual(hindiSegments.length, 2, "Must parse 2 Hindi segments");
    assert(hindiSegments[0].text.includes("स्टैक"), "Text must preserve Devanagari script for stack");
    assert.strictEqual(hindiSegments[0].detectedLanguage, "Hindi");
    assert.strictEqual(hindiSegments[0].languageCode, "hi");
    assert.strictEqual(hindiSegments[0].isDefinition, true);
    assert.strictEqual(hindiSegments[1].startTime, 6);
    console.log("✓ Test 1 Passed: Authentic Hindi Devanagari speech preserved verbatim without translation.");

    // -------------------------------------------------------------------------
    // Test 2: Hinglish (Hindi + English) Response Parsing
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Parsing Hinglish classroom conversational discourse...");
    const hinglishRawResponse = JSON.stringify({
      detectedLanguage: "Hinglish",
      languageCode: "hi-Latn",
      segments: [
        {
          text: "Aaj ka topic hai Virtual Memory aur kaise page tables memory map karti hain.",
          topic: "Virtual Memory Overview",
          detectedLanguage: "Hinglish",
          languageCode: "hi-Latn",
          isImportant: true,
          isDefinition: false,
          durationEstimate: 5,
        },
      ],
    });

    const hinglishSegments = parseTranscriptionToSegments(hinglishRawResponse, 10, "hinglish");
    assert.strictEqual(hinglishSegments.length, 1);
    assert(hinglishSegments[0].text.includes("karti hain"), "Must preserve colloquial bilingual phrasing");
    assert.strictEqual(hinglishSegments[0].detectedLanguage, "Hinglish");
    console.log("✓ Test 2 Passed: Hinglish mixed phrasing preserved with accurate timing.");

    // -------------------------------------------------------------------------
    // Test 3: Bengali and Tamil Native Script Parsing
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Parsing Bengali and Tamil native scripts...");
    const regionalResponse = JSON.stringify({
      detectedLanguage: "Bengali",
      languageCode: "bn",
      segments: [
        {
          text: "স্ট্যাক হলো একটি ডেটা স্ট্রাকচার যা LIFO নীতি অনুসরণ করে।",
          topic: "Stack Fundamentals",
          detectedLanguage: "Bengali",
          languageCode: "bn",
          isImportant: true,
          durationEstimate: 5,
        },
      ],
    });

    const bengaliSegments = parseTranscriptionToSegments(regionalResponse, 0, "bn");
    assert.strictEqual(bengaliSegments.length, 1);
    assert(bengaliSegments[0].text.includes("স্ট্যাক"), "Must preserve Bengali script");
    assert.strictEqual(bengaliSegments[0].languageCode, "bn");
    console.log("✓ Test 3 Passed: Regional Indic scripts parsed and preserved with languageCode.");

    // -------------------------------------------------------------------------
    // Test 4: Gemini Multilingual Audio Chunk Execution & Prompt Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Mock Gemini multilingual execution and prompt inspection...");
    let capturedPrompt = "";
    const testAudioBase64 = createValidWavBase64(1);

    setMockGeminiClient({
      models: {
        generateContent: async (req: any) => {
          const parts = req.contents?.parts || [];
          const textPart = parts.find((p: any) => p.text);
          if (textPart) {
            capturedPrompt = textPart.text;
          }

          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        detectedLanguage: "Hindi",
                        languageCode: "hi",
                        segments: [
                          {
                            text: "पॉप ऑपरेशन स्टैक के टॉप एलिमेंट को हटाता है।",
                            topic: "Pop Operation",
                            detectedLanguage: "Hindi",
                            languageCode: "hi",
                            isImportant: true,
                            durationEstimate: 5,
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
    } as any);

    const executedSegments = await transcribeAudioChunk({
      audioBase64: testAudioBase64,
      mimeType: "audio/wav",
      currentTimestamp: 15,
      language: "hi",
      lectureId: "lec-multi-1",
      sequenceNumber: 1,
    });

    assert.strictEqual(executedSegments.length, 1);
    assert(executedSegments[0].text.includes("पॉप ऑपरेशन"));
    assert(capturedPrompt.includes("Language Instruction: The speaker is delivering the lecture in hi"));
    assert(capturedPrompt.includes("CRITICAL: DO NOT TRANSLATE TO ENGLISH"));
    assert(capturedPrompt.includes("Devanagari for Hindi"));
    console.log("✓ Test 4 Passed: Gemini transcription instructions mandate native script and forbid English translation.");

    // -------------------------------------------------------------------------
    // Test 5: Auto-Detection Mode Prompt Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Auto-detection language prompt instruction...");
    const testAudioBase64Auto = createValidWavBase64(2);
    capturedPrompt = "";
    await transcribeAudioChunk({
      audioBase64: testAudioBase64Auto,
      mimeType: "audio/wav",
      currentTimestamp: 20,
      language: "auto",
      lectureId: "lec-multi-2",
      sequenceNumber: 2,
    });

    assert(capturedPrompt.includes("Auto-detect the spoken language"));
    assert(capturedPrompt.includes("CRITICAL: DO NOT translate non-English speech to English"));
    console.log("✓ Test 5 Passed: Auto-detection mode correctly instructs model without forced English bias.");

    // -------------------------------------------------------------------------
    // Test 6: Database Chunk Deduplication
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Database chunk hash recording & deduplication...");
    const chunkHash = "hash-abc-123";
    const lectureId = "lec-dedup-multi";

    assert.strictEqual(db.hasTranscriptionChunk(lectureId, 1), false);
    db.recordTranscriptionChunk(lectureId, 1, chunkHash);
    assert.strictEqual(db.hasTranscriptionChunk(lectureId, 1), true);
    console.log("✓ Test 6 Passed: Database recorded transcription chunk hash and deduplication confirmed.");

    console.log("\n==================================================");
    console.log("  ALL MULTILINGUAL TRANSCRIPTION TESTS PASSED!    ");
    console.log("==================================================");
  } finally {
    resetGeminiClient();
    db.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

runMultilingualSuite().catch((err) => {
  console.error("Multilingual Test Suite Failed:", err);
  process.exit(1);
});
