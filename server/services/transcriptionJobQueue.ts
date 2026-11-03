import crypto from "crypto";
import {
  db,
  Database,
  readAudioChunkFromDisk,
  saveAudioChunkToDisk,
  TranscriptionJob,
  TranscriptionJobStatus,
} from "../db";
import { TranscriptSegment } from "../../src/types";
import { getAiConfig } from "../config/aiConfig";
import {
  classifyAiError,
  ErrorClassification,
  isDailyQuotaCurrentlyExhausted,
  setDailyQuotaExhaustedState,
} from "./errorClassifier";
import {
  defaultTranscriptionProvider,
  TranscriptionProvider,
} from "./providers/transcriptionProvider";

export interface EnqueueChunkParams {
  lectureId: string;
  userId: string;
  sequenceNumber: number;
  audioBase64: string;
  mimeType: string;
  currentTimestamp: number;
  language?: string;
}

export interface ChunkProcessResult {
  jobId: string;
  status: "transcribed" | "queued" | "quota_exhausted" | "duplicate" | "failed";
  newSegments: TranscriptSegment[];
  pendingCount: number;
  message?: string;
  isDailyQuotaExhausted?: boolean;
}

export class TranscriptionJobQueue {
  private isProcessing = false;
  private provider: TranscriptionProvider = defaultTranscriptionProvider;
  private database: Database = db;
  private inFlightByJobId = new Map<string, Promise<ChunkProcessResult>>();
  private recentExecutionTimestamps: number[] = [];

  constructor(provider?: TranscriptionProvider, customDb?: Database) {
    if (provider) {
      this.provider = provider;
    }
    if (customDb) {
      this.database = customDb;
    }
  }

  public setProvider(provider: TranscriptionProvider) {
    this.provider = provider;
  }

  public setDatabase(customDb: Database) {
    this.database = customDb;
  }

  /**
   * Enqueues an audio chunk:
   * 1. Saves raw audio to disk in .data/audio_chunks/{userId}/{lectureId}/
   * 2. Persists job in SQLite transcription_jobs table
   * 3. If daily quota is active, marks as QUOTA_EXHAUSTED and preserves audio safely
   * 4. Otherwise, attempts immediate execution or enqueues for sequential processing
   */
  public async enqueueChunk(params: EnqueueChunkParams): Promise<ChunkProcessResult> {
    const {
      lectureId,
      userId,
      sequenceNumber,
      audioBase64,
      mimeType,
      currentTimestamp,
      language = "auto",
    } = params;

    // 1. Compute hash of the audio payload for deduplication
    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, "").trim();
    const chunkHash = crypto.createHash("sha256").update(cleanBase64).digest("hex");
    const audioBuffer = Buffer.from(cleanBase64, "base64");
    const durationEstimate = Math.max(5, Math.round(audioBuffer.length / 16000));

    // 2. Persist audio chunk to disk immediately
    const audioRef = saveAudioChunkToDisk(userId, lectureId, sequenceNumber, audioBuffer, mimeType);

    // 3. Register or get existing job in SQLite
    const existingJob = this.database.getTranscriptionJobById(`job-${lectureId}-${sequenceNumber}`);
    if (existingJob && existingJob.status === "COMPLETED") {
      const pendingCount = this.database.getPendingJobCountForLecture(lectureId, userId);
      return {
        jobId: existingJob.id,
        status: "duplicate",
        newSegments: [],
        pendingCount,
        message: "Audio chunk already processed and transcribed.",
      };
    }

    const job = this.database.createTranscriptionJob({
      id: `job-${lectureId}-${sequenceNumber}`,
      userId,
      lectureId,
      sequenceNumber,
      audioRef,
      mimeType,
      durationSeconds: durationEstimate,
      startTime: currentTimestamp,
      endTime: currentTimestamp + durationEstimate,
      status: isDailyQuotaCurrentlyExhausted() ? "QUOTA_EXHAUSTED" : "PENDING",
      chunkHash,
    });

    // 4. Check if daily quota is currently exhausted
    if (isDailyQuotaCurrentlyExhausted()) {
      this.database.updateTranscriptionJobStatus(job.id, {
        status: "QUOTA_EXHAUSTED",
        lastErrorCode: "DAILY_RPD_EXHAUSTED",
        lastErrorMessage: "Gemini daily free-tier request limit reached.",
      });

      const pendingCount = this.database.getPendingJobCountForLecture(lectureId, userId);
      return {
        jobId: job.id,
        status: "quota_exhausted",
        newSegments: [],
        pendingCount,
        isDailyQuotaExhausted: true,
        message:
          "Transcription is temporarily paused because the AI provider's daily quota has been reached. Your recording is safe. You can retry transcription later.",
      };
    }

    // 5. Check if another in-flight promise already exists for this job
    const inFlight = this.inFlightByJobId.get(job.id);
    if (inFlight) {
      return inFlight;
    }

    // 6. Process chunk
    const executionPromise = this.processSingleJob(job, cleanBase64, language).finally(() => {
      this.inFlightByJobId.delete(job.id);
    });

    this.inFlightByJobId.set(job.id, executionPromise);
    return executionPromise;
  }

  /**
   * Executes a single transcription job through the provider and updates SQLite lecture transcript.
   */
  public async processSingleJob(
    job: TranscriptionJob,
    inlineBase64?: string,
    language = "auto"
  ): Promise<ChunkProcessResult> {
    const config = getAiConfig();
    const lecture = this.database.getLectureById(job.lectureId);

    // Mark job as PROCESSING
    this.database.updateTranscriptionJobStatus(job.id, {
      status: "PROCESSING",
      attemptCount: job.attemptCount + 1,
    });

    try {
      // Respect RPM limit
      await this.enforceRpmLimit(config.transcription.rpmLimit);

      // Get audio base64 from disk if not provided inline
      let audioBase64 = inlineBase64;
      if (!audioBase64) {
        const diskBuffer = readAudioChunkFromDisk(job.audioRef);
        if (!diskBuffer) {
          throw new Error(`Audio chunk file could not be read from disk: ${job.audioRef}`);
        }
        audioBase64 = diskBuffer.toString("base64");
      }

      // Existing context from previous 3 segments if lecture exists
      const existingContext = lecture
        ? lecture.transcript.slice(-3).map((s) => s.text).join(" ")
        : "";

      // Execute provider transcription
      this.recentExecutionTimestamps.push(Date.now());
      const segments = await this.provider.transcribe({
        audioBase64,
        mimeType: job.mimeType,
        currentTimestamp: job.startTime,
        existingContext,
        language: language !== "auto" ? language : lecture?.language || "auto",
      });

      // Canonical transcript insertion with strict deduplication
      const existingTexts = new Set(
        lecture ? lecture.transcript.map((s) => s.text.trim().toLowerCase()) : []
      );
      const filteredSegments = segments.filter(
        (s) => s.text.trim() && !existingTexts.has(s.text.trim().toLowerCase())
      );

      if (lecture && filteredSegments.length > 0) {
        lecture.transcript.push(...filteredSegments);
        const maxEnd = Math.max(...filteredSegments.map((s) => s.endTime));
        lecture.duration = Math.max(lecture.duration, maxEnd);
        this.database.saveLecture(lecture);
      }

      // Mark job as COMPLETED
      this.database.updateTranscriptionJobStatus(job.id, {
        status: "COMPLETED",
        lastErrorCode: null,
        lastErrorMessage: null,
      });

      const pendingCount = this.database.getPendingJobCountForLecture(job.lectureId, job.userId);
      return {
        jobId: job.id,
        status: filteredSegments.length > 0 ? "transcribed" : "queued",
        newSegments: filteredSegments,
        pendingCount,
      };
    } catch (err: any) {
      const errorInfo: ErrorClassification = this.provider.classifyError(err);
      console.warn(`[TRANSCRIPTION-QUEUE] Job ${job.id} failed:`, errorInfo.technicalDetails);

      if (errorInfo.isDailyQuotaExhausted) {
        // Daily quota exhausted: update state and pause retrying
        setDailyQuotaExhaustedState(true);
        this.database.updateTranscriptionJobStatus(job.id, {
          status: "QUOTA_EXHAUSTED",
          lastErrorCode: errorInfo.errorType,
          lastErrorMessage: errorInfo.technicalDetails,
        });

        const pendingCount = this.database.getPendingJobCountForLecture(job.lectureId, job.userId);
        return {
          jobId: job.id,
          status: "quota_exhausted",
          newSegments: [],
          pendingCount,
          isDailyQuotaExhausted: true,
          message: errorInfo.userMessage,
        };
      }

      if (errorInfo.isRetryable && job.attemptCount < config.transcription.maxRetries) {
        // Transient error: schedule backoff
        const delayMs = errorInfo.retryDelayMs || config.transcription.baseDelayMs * Math.pow(2, job.attemptCount);
        const nextRetryAt = Date.now() + Math.min(config.transcription.maxDelayMs, delayMs);

        this.database.updateTranscriptionJobStatus(job.id, {
          status: "RETRY_WAIT",
          nextRetryAt,
          lastErrorCode: errorInfo.errorType,
          lastErrorMessage: errorInfo.technicalDetails,
        });

        const pendingCount = this.database.getPendingJobCountForLecture(job.lectureId, job.userId);
        return {
          jobId: job.id,
          status: "queued",
          newSegments: [],
          pendingCount,
          message: errorInfo.userMessage,
        };
      }

      // Permanent client or maximum retries failure
      this.database.updateTranscriptionJobStatus(job.id, {
        status: "FAILED",
        lastErrorCode: errorInfo.errorType,
        lastErrorMessage: errorInfo.technicalDetails,
      });

      const pendingCount = this.database.getPendingJobCountForLecture(job.lectureId, job.userId);
      return {
        jobId: job.id,
        status: "failed",
        newSegments: [],
        pendingCount,
        message: errorInfo.userMessage,
      };
    }
  }

  /**
   * Resets all failed or quota-exhausted jobs for a lecture back to PENDING and kicks off background processing.
   */
  public async retryLectureJobs(lectureId: string, userId: string): Promise<{ queuedCount: number; message: string }> {
    // If daily quota was manually cleared by admin / user retry, reset flag
    setDailyQuotaExhaustedState(false);

    const queuedCount = this.database.resetJobsForLecture(lectureId, userId);
    console.log(`[TRANSCRIPTION-QUEUE] Reset ${queuedCount} jobs for lecture ${lectureId}`);

    // Trigger queue processing asynchronously
    this.drainPendingQueue().catch((err) => {
      console.error("[TRANSCRIPTION-QUEUE] Drain error:", err);
    });

    return {
      queuedCount,
      message:
        queuedCount > 0
          ? `Queued ${queuedCount} audio segments for transcription retry.`
          : "No pending or failed audio segments to retry.",
    };
  }

  /**
   * Drains pending jobs across lectures sequentially respecting RPM limits.
   */
  public async drainPendingQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        if (isDailyQuotaCurrentlyExhausted()) {
          console.log("[TRANSCRIPTION-QUEUE] Daily quota exhausted. Pausing queue drain.");
          break;
        }

        const pendingJobs = this.database.getPendingTranscriptionJobs(5);
        if (pendingJobs.length === 0) break;

        for (const job of pendingJobs) {
          if (isDailyQuotaCurrentlyExhausted()) break;
          await this.processSingleJob(job);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Returns a status report of transcription jobs for a lecture.
   */
  public getLectureJobSummary(lectureId: string, userId: string) {
    const jobs = this.database.getTranscriptionJobsByLecture(lectureId, userId);
    const summary = {
      total: jobs.length,
      completed: jobs.filter((j) => j.status === "COMPLETED").length,
      pending: jobs.filter((j) => j.status === "PENDING" || j.status === "RETRY_WAIT").length,
      processing: jobs.filter((j) => j.status === "PROCESSING").length,
      quotaExhausted: jobs.filter((j) => j.status === "QUOTA_EXHAUSTED").length,
      failed: jobs.filter((j) => j.status === "FAILED").length,
      isDailyQuotaExhausted: isDailyQuotaCurrentlyExhausted(),
      jobs: jobs.map((j) => ({
        id: j.id,
        sequenceNumber: j.sequenceNumber,
        status: j.status,
        durationSeconds: j.durationSeconds,
        startTime: j.startTime,
        endTime: j.endTime,
        attemptCount: j.attemptCount,
        lastErrorCode: j.lastErrorCode,
        lastErrorMessage: j.lastErrorMessage,
        updatedAt: j.updatedAt,
      })),
    };
    return summary;
  }

  private async enforceRpmLimit(rpmLimit: number): Promise<void> {
    const now = Date.now();
    this.recentExecutionTimestamps = this.recentExecutionTimestamps.filter((t) => now - t < 60000);

    if (this.recentExecutionTimestamps.length >= rpmLimit) {
      const oldest = this.recentExecutionTimestamps[0];
      const waitMs = Math.max(100, 60000 - (now - oldest) + 50);
      console.log(`[TRANSCRIPTION-QUEUE] RPM limit reached (${this.recentExecutionTimestamps.length}/${rpmLimit}). Waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export const transcriptionJobQueue = new TranscriptionJobQueue();
