import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { db } from "../db";
import { getGeminiClient, MODELS } from "../geminiClient";
import { transcribeAudioChunk } from "./transcriptionService";
import { storageProvider } from "./storageProvider";
import { Lecture, TranscriptSegment, User } from "../../src/types";

/**
 * Creates a valid 44-byte WAV header for mono 16-bit PCM audio.
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate = 16000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

interface LiveSessionContext {
  userId: string;
  lectureId: string;
  recordingSessionId: string;
  language: string;
  sequenceNumber: number;
  currentAudioTime: number;
  lastSegmentEndTime: number;
  allPcmChunks: Buffer[];
  fallbackBuffer: Buffer;
  isLiveConnected: boolean;
  isFinalized: boolean;
  geminiSession?: any;
  clientWs: WebSocket;
  saveQueue: Promise<void>;
}

export class LiveTranscriptionService {
  private wss: WebSocketServer;
  private activeSessions = new Map<string, LiveSessionContext>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });
  }

  /**
   * HTTP upgrade handler mounted in server.ts
   */
  public handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  private async authenticate(request: IncomingMessage): Promise<User | null> {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      let token = url.searchParams.get("token") || "";

      // Also check Authorization header
      if (!token && request.headers.authorization?.startsWith("Bearer ")) {
        token = request.headers.authorization.slice(7).trim();
      }

      // Also check Cookie header
      if (!token && request.headers.cookie) {
        const cookies = request.headers.cookie.split(";").reduce((acc, pair) => {
          const [k, v] = pair.trim().split("=");
          if (k && v) acc[k] = decodeURIComponent(v);
          return acc;
        }, {} as Record<string, string>);
        token = cookies["learnix_session"] || "";
      }

      if (!token) return null;

      const authResult = await (db.validateSession as any)(token);
      if (!authResult) return null;
      return authResult.user || authResult;
    } catch (e) {
      console.error("[LiveTranscriptionService] Auth error:", e);
      return null;
    }
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const lectureId = url.searchParams.get("lectureId");
    const requestedLanguage = url.searchParams.get("language") || "auto";

    const user = await this.authenticate(req);
    if (!user) {
      ws.send(JSON.stringify({ type: "error", error: "Unauthorized student session." }));
      ws.close(4401, "Unauthorized");
      return;
    }

    if (!lectureId) {
      ws.send(JSON.stringify({ type: "error", error: "lectureId parameter is required." }));
      ws.close(4400, "Missing lectureId");
      return;
    }

    let lecture = await (db.getLectureById as any)(lectureId, user.id);
    if (!lecture) {
      ws.send(JSON.stringify({ type: "error", error: "Lecture not found." }));
      ws.close(4404, "Lecture not found");
      return;
    }

    if (lecture.createdBy !== user.id) {
      ws.send(JSON.stringify({ type: "error", error: "Forbidden: Lecture does not belong to you." }));
      ws.close(4403, "Forbidden");
      return;
    }

    const sessionId = `rec-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const session: LiveSessionContext = {
      userId: user.id,
      lectureId,
      recordingSessionId: sessionId,
      language: requestedLanguage,
      sequenceNumber: lecture.transcript?.length || 0,
      currentAudioTime: lecture.duration || 0,
      lastSegmentEndTime: lecture.duration || 0,
      allPcmChunks: [],
      fallbackBuffer: Buffer.alloc(0),
      isLiveConnected: false,
      isFinalized: false,
      clientWs: ws,
      saveQueue: Promise.resolve(),
    };

    this.activeSessions.set(sessionId, session);

    // Setup incoming messages immediately so no packets are dropped
    ws.on("message", async (data: any, isBinary: boolean) => {
      try {
        if (isBinary) {
          const pcmChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          await this.handlePcmAudio(session, pcmChunk);
        } else {
          const text = data.toString();
          let json: any;
          try {
            json = JSON.parse(text);
          } catch {
            return;
          }

          if (json.type === "audio_chunk") {
            const rawBase64 = json.data || "";
            const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, "");
            const buf = Buffer.from(cleanBase64, "base64");
            if (json.mimeType && json.mimeType.includes("webm")) {
              await this.handleWebmAudioChunk(session, rawBase64, json.mimeType);
            } else {
              await this.handlePcmAudio(session, buf);
            }
          } else if (json.type === "end_session") {
            await this.finalizeSession(session);
          } else if (json.type === "ping") {
            this.send(ws, { type: "pong", timestamp: Date.now() });
          }
        }
      } catch (err: any) {
        console.error("[LiveTranscriptionService] Message handling error:", err);
      }
    });

    ws.on("close", async () => {
      if (!session.isFinalized) {
        await this.finalizeSession(session);
      }
      this.activeSessions.delete(sessionId);
    });

    ws.on("error", (err) => {
      console.warn("[LiveTranscriptionService] Socket error:", err.message);
    });

    // Send connection established confirmation
    this.send(ws, {
      type: "session_started",
      recordingSessionId: sessionId,
      lectureId,
      language: requestedLanguage,
      existingSegmentsCount: lecture.transcript?.length || 0,
    });

    // Attempt Gemini Live connect non-blocking in background
    this.initGeminiLive(session).catch((err) => {
      console.warn("[LiveTranscriptionService] Background Live connect failed:", err?.message || err);
      session.isLiveConnected = false;
    });
  }

  private async initGeminiLive(session: LiveSessionContext): Promise<void> {
    const ai = getGeminiClient();
    if (!ai || typeof ai.live?.connect !== "function") {
      console.info("[LiveTranscriptionService] Gemini client unavailable. Using resilient low-latency fallback.");
      session.isLiveConnected = false;
      this.send(session.clientWs, {
        type: "status",
        status: "fallback_active",
        provider: "resilient_chunked",
      });
      return;
    }

    try {
      const liveModel = process.env.GEMINI_LIVE_TRANSCRIBE_MODEL || "gemini-3.5-transcribe-live";
      const connectPromise = ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: ["text" as any],
          inputAudioTranscription: { mode: "verbatim" as any },
        },
        callbacks: {
          onopen: () => {
            session.isLiveConnected = true;
            this.send(session.clientWs, {
              type: "status",
              status: "live_connected",
              provider: liveModel,
            });
          },
          onmessage: (msg: any) => {
            // Live Interim speech hypothesis
            if (msg.serverContent?.interimInputTranscription?.text) {
              const interimText = msg.serverContent.interimInputTranscription.text;
              this.send(session.clientWs, {
                type: "interim_transcript",
                text: interimText,
              });
            }

            // Finalized speech segment
            if (msg.serverContent?.inputTranscription?.text) {
              const text = msg.serverContent.inputTranscription.text.trim();
              if (text) {
                this.persistFinalSegment(session, text, liveModel);
              }
            }
          },
          onerror: (err: any) => {
            console.warn("[LiveTranscriptionService] Gemini Live API error:", err?.message || err);
            session.isLiveConnected = false;
            this.send(session.clientWs, {
              type: "status",
              status: "fallback_active",
              reason: err?.message || "Live API error",
            });
          },
          onclose: () => {
            session.isLiveConnected = false;
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini Live connection timed out")), 2500)
      );

      const liveSession = await Promise.race([connectPromise, timeoutPromise]);
      session.geminiSession = liveSession;
    } catch (err: any) {
      console.warn("[LiveTranscriptionService] Live API connect failed:", err?.message || err);
      session.isLiveConnected = false;
      this.send(session.clientWs, {
        type: "status",
        status: "fallback_active",
        reason: err?.message || "Live connect failed",
      });
    }
  }

  private async handlePcmAudio(session: LiveSessionContext, pcmBuffer: Buffer): Promise<void> {
    if (!pcmBuffer || pcmBuffer.length === 0) return;

    // Track audio
    session.allPcmChunks.push(pcmBuffer);
    const chunkDurationSec = pcmBuffer.length / (16000 * 2);
    session.currentAudioTime += chunkDurationSec;

    // Stream directly to Gemini Live API if connected
    if (session.isLiveConnected && session.geminiSession) {
      try {
        session.geminiSession.sendRealtimeInput({
          audio: {
            data: pcmBuffer.toString("base64"),
            mimeType: "audio/pcm;rate=16000",
          },
        });
        return;
      } catch (err: any) {
        console.warn("[LiveTranscriptionService] Error streaming to Live API, switching to fallback:", err?.message);
        session.isLiveConnected = false;
      }
    }

    // Resilient Fallback Mode:
    // Buffer PCM frames and transcribe verbatim every 5-6 seconds of audio (~160,000 bytes)
    session.fallbackBuffer = Buffer.concat([session.fallbackBuffer, pcmBuffer]);

    if (session.fallbackBuffer.length >= 160000) {
      const bufferToProcess = session.fallbackBuffer;
      session.fallbackBuffer = Buffer.alloc(0);
      await this.processFallbackChunk(session, bufferToProcess);
    }
  }

  private async handleWebmAudioChunk(
    session: LiveSessionContext,
    rawBase64: string,
    mimeType: string
  ): Promise<void> {
    try {
      const segments = await transcribeAudioChunk({
        audioBase64: rawBase64,
        mimeType,
        currentTimestamp: session.currentAudioTime,
        lectureId: session.lectureId,
        userId: session.userId,
        sequenceNumber: session.sequenceNumber,
        language: session.language,
      });

      for (const seg of segments) {
        await this.persistFinalSegment(session, seg.text, "gemini-fallback-transcribe");
      }
    } catch (e: any) {
      console.warn("[LiveTranscriptionService] WebM chunk transcription error:", e?.message || e);
    }
  }

  private async processFallbackChunk(session: LiveSessionContext, pcmBuffer: Buffer): Promise<void> {
    try {
      const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16);
      const audioBase64 = wavBuffer.toString("base64");

      const segments = await transcribeAudioChunk({
        audioBase64,
        mimeType: "audio/wav",
        currentTimestamp: session.lastSegmentEndTime,
        lectureId: session.lectureId,
        userId: session.userId,
        sequenceNumber: session.sequenceNumber,
        language: session.language,
      });

      for (const seg of segments) {
        if (seg.text && seg.text.trim()) {
          await this.persistFinalSegment(session, seg.text.trim(), "gemini-chunked-verbatim");
        }
      }
    } catch (err: any) {
      console.warn("[LiveTranscriptionService] Fallback chunk error:", err?.message || err);
    }
  }

  private persistFinalSegment(session: LiveSessionContext, text: string, provider: string): void {
    const startTime = Math.round(session.lastSegmentEndTime * 100) / 100;
    const endTime = Math.max(startTime + 1, Math.round(session.currentAudioTime * 100) / 100);
    session.lastSegmentEndTime = endTime;

    const segment: TranscriptSegment = {
      id: `seg-${Date.now()}-${session.sequenceNumber++}`,
      userId: session.userId,
      lectureId: session.lectureId,
      recordingSessionId: session.recordingSessionId,
      sequenceNumber: session.sequenceNumber,
      startTime,
      endTime,
      text,
      isFinal: true,
      confidence: 0.95,
      language: session.language,
      transcriptionProvider: provider,
      createdAt: new Date().toISOString(),
    };

    // Sequential DB persistence
    session.saveQueue = session.saveQueue.then(async () => {
      try {
        const lecture = await (db.getLectureById as any)(session.lectureId, session.userId);
        if (lecture) {
          if (!lecture.transcript) lecture.transcript = [];
          // Deduplicate against existing transcripts
          const exists = lecture.transcript.some(
            (s) => s.text.trim().toLowerCase() === text.toLowerCase()
          );
          if (!exists) {
            lecture.transcript.push(segment);
            lecture.duration = Math.max(lecture.duration || 0, endTime);
            await (db.saveLecture as any)(lecture);
          }
        }
      } catch (err) {
        console.error("[LiveTranscriptionService] Failed to save segment to DB:", err);
      }
    });

    // Notify client UI immediately
    this.send(session.clientWs, {
      type: "final_transcript",
      segment,
    });
  }

  private async finalizeSession(session: LiveSessionContext): Promise<void> {
    if (session.isFinalized) return;
    session.isFinalized = true;

    try {
      // 1. Flush any remaining fallback buffer
      if (session.fallbackBuffer && session.fallbackBuffer.length > 3200) {
        const remainingPcm = session.fallbackBuffer;
        session.fallbackBuffer = Buffer.alloc(0);
        await this.processFallbackChunk(session, remainingPcm);
      }

      // 2. Wait for pending DB writes to complete
      await session.saveQueue;

      // 3. Close live session if active
      if (session.geminiSession) {
        try {
          if (typeof session.geminiSession.close === "function") {
            session.geminiSession.close();
          }
        } catch {}
      }

      // 4. Archive full audio if chunks captured
      let audioUrl = "";
      if (session.allPcmChunks.length > 0) {
        const fullPcm = Buffer.concat(session.allPcmChunks);
        const fullWav = pcmToWav(fullPcm, 16000, 1, 16);
        const storageKey = `audio/${session.userId}/${session.lectureId}/${session.recordingSessionId}.wav`;
        try {
          await storageProvider.putObject(storageKey, fullWav, "audio/wav");
          audioUrl = await storageProvider.getUrl(storageKey);
        } catch (storageErr) {
          console.warn("[LiveTranscriptionService] Failed to archive audio to storageProvider:", storageErr);
        }
      }

      // 5. Update lecture status in database
      const lecture = await (db.getLectureById as any)(session.lectureId, session.userId);
      if (lecture) {
        lecture.status = "completed";
        if (audioUrl) {
          lecture.audioUrl = audioUrl;
        }
        await (db.saveLecture as any)(lecture);
      }

      // 6. Notify client that session is finalized
      this.send(session.clientWs, {
        type: "session_finalized",
        lectureId: session.lectureId,
        recordingSessionId: session.recordingSessionId,
        totalSegments: lecture?.transcript?.length || 0,
        duration: lecture?.duration || session.currentAudioTime,
        audioUrl,
      });
    } catch (err) {
      console.error("[LiveTranscriptionService] Finalize error:", err);
    }
  }

  private send(ws: WebSocket, payload: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err: any) {
        console.warn("[LiveTranscriptionService] WS send error:", err.message);
      }
    }
  }
}

export const liveTranscriptionService = new LiveTranscriptionService();
