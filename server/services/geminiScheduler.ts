import crypto from "crypto";
import { aiOrchestrator } from "./aiOrchestrator";
import { MODELS } from "../geminiClient";

export interface ScheduledTask<T> {
  id: string;
  lectureId: string;
  userId?: string;
  sequenceNumber: number;
  chunkHash: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  createdAt: number;
  retries: number;
}

export class GeminiTranscriptionScheduler {
  private queue: ScheduledTask<any>[] = [];
  private isProcessing = false;
  private executionTimestamps: number[] = [];
  private inFlightByHash = new Map<string, Promise<any>>();
  private completedCache = new Map<string, { result: any; expiresAt: number }>();

  // Configuration
  private rpm: number;
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;

  constructor() {
    this.rpm = parseInt(process.env.GEMINI_TRANSCRIPTION_RPM || "3", 10);
    this.maxRetries = parseInt(process.env.GEMINI_TRANSCRIPTION_MAX_RETRIES || "3", 10);
    this.baseDelayMs = parseInt(process.env.GEMINI_TRANSCRIPTION_BASE_DELAY_MS || "2000", 10);
    this.maxDelayMs = parseInt(process.env.GEMINI_TRANSCRIPTION_MAX_DELAY_MS || "30000", 10);
  }

  public setRpm(rpm: number) {
    this.rpm = Math.max(1, rpm);
    try {
      const state = aiOrchestrator.getModelState(MODELS.TRANSCRIBE);
      if (state) state.rpmLimit = this.rpm;
    } catch {}
  }

  public getRpm(): number {
    return this.rpm;
  }

  public setMaxRetries(retries: number) {
    this.maxRetries = Math.max(0, retries);
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public clearQueue() {
    this.queue = [];
    this.inFlightByHash.clear();
    this.completedCache.clear();
    this.executionTimestamps = [];
    try {
      aiOrchestrator.clearState();
    } catch {}
  }

  /**
   * Generates a stable SHA-256 hash of the audio base64 payload to prevent duplicate processing.
   */
  public hashAudio(audioBase64: string): string {
    return crypto.createHash("sha256").update(audioBase64).digest("hex");
  }

  /**
   * Enqueues an audio transcription task with deduplication and sequential scheduling.
   */
  public enqueue<T>(options: {
    lectureId: string;
    userId?: string;
    sequenceNumber?: number;
    audioBase64: string;
    execute: () => Promise<T>;
  }): Promise<T> {
    const chunkHash = this.hashAudio(options.audioBase64);

    // 1. Check completed cache (deduplication)
    const cached = this.completedCache.get(chunkHash);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`[TRANSCRIPTION] Duplicate chunk detected (hash: ${chunkHash.substring(0, 8)}), returning cached result`);
      return Promise.resolve(cached.result);
    }

    // 2. Check in-flight requests (prevent simultaneous duplicate execution)
    const inFlight = this.inFlightByHash.get(chunkHash);
    if (inFlight) {
      console.log(`[TRANSCRIPTION] In-flight chunk detected (hash: ${chunkHash.substring(0, 8)}), joining active request`);
      return inFlight;
    }

    console.log(`[TRANSCRIPTION] Request queued (lecture: ${options.lectureId}, seq: ${options.sequenceNumber ?? 0})`);

    const promise = new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = {
        id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        lectureId: options.lectureId,
        userId: options.userId,
        sequenceNumber: options.sequenceNumber ?? Date.now(),
        chunkHash,
        execute: options.execute,
        resolve: (val) => {
          // Cache completed result for 5 minutes
          this.completedCache.set(chunkHash, {
            result: val,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
          this.inFlightByHash.delete(chunkHash);
          resolve(val);
        },
        reject: (err) => {
          this.inFlightByHash.delete(chunkHash);
          reject(err);
        },
        createdAt: Date.now(),
        retries: 0,
      };

      // Maintain chronological order by sequenceNumber within lecture
      let insertIdx = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (
          this.queue[i].lectureId === task.lectureId &&
          this.queue[i].sequenceNumber > task.sequenceNumber
        ) {
          insertIdx = i;
          break;
        }
      }
      this.queue.splice(insertIdx, 0, task);
      this.processQueue();
    });

    this.inFlightByHash.set(chunkHash, promise);
    return promise;
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];

      // Rate limit check: purge timestamps older than 60s
      const now = Date.now();
      this.executionTimestamps = this.executionTimestamps.filter((t) => now - t < 60000);

      if (this.executionTimestamps.length >= this.rpm) {
        const oldest = this.executionTimestamps[0];
        const waitMs = Math.max(100, 60000 - (now - oldest) + 50);
        console.log(`[TRANSCRIPTION] Rate limit window saturated (${this.executionTimestamps.length}/${this.rpm} RPM). Throttling for ${waitMs}ms`);
        await this.sleep(waitMs);
        continue;
      }

      // Dequeue task to execute
      this.queue.shift();
      console.log(`[TRANSCRIPTION] Processing chunk (lecture: ${task.lectureId}, seq: ${task.sequenceNumber})`);

      try {
        this.executionTimestamps.push(Date.now());
        const result = await task.execute();
        console.log(`[TRANSCRIPTION] Gemini request successful`);
        try {
          const state = aiOrchestrator.getModelState(MODELS.TRANSCRIBE);
          state.dailyRequestCount++;
          state.executionTimestamps.push(Date.now());
        } catch {}
        task.resolve(result);
      } catch (err: any) {
        const errorInfo = this.classifyError(err);

        if (errorInfo.isRateLimited) {
          console.warn(`[TRANSCRIPTION] Rate limit reached (429 RESOURCE_EXHAUSTED)`);
        }

        if (errorInfo.isRetryable && task.retries < this.maxRetries) {
          task.retries += 1;
          const delayMs = this.computeBackoffDelay(task.retries, errorInfo.retryDelayMs);
          console.warn(
            `[TRANSCRIPTION] Retrying after delay (attempt ${task.retries} of ${this.maxRetries}, waiting ${delayMs}ms)`
          );

          // Re-insert at the front of the queue
          this.queue.unshift(task);
          await this.sleep(delayMs);
        } else {
          console.error(`[TRANSCRIPTION] Transcription failed: ${err?.message || err}`);
          task.reject(err);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Classifies an error to determine whether it is retryable (429 or 5xx)
   * or a permanent client error (400, 401, 403, 404).
   */
  public classifyError(err: any): {
    isRateLimited: boolean;
    isRetryable: boolean;
    retryDelayMs?: number;
    status: number;
  } {
    const status = Number(err?.status || err?.statusCode || err?.code || 0);
    const msg = String(err?.message || "").toLowerCase();

    const is429 = status === 429 || msg.includes("resource_exhausted") || msg.includes("429") || msg.includes("quota");
    const is5xx = status >= 500 && status <= 599 || msg.includes("unavailable") || msg.includes("high demand") || msg.includes("internal");
    const isNonRetryable = status === 400 || status === 401 || status === 403 || status === 404 || msg.includes("invalid_argument");

    let retryDelayMs: number | undefined;

    // 1. Check Google RPC RetryInfo
    const errorDetails = err?.errorDetails || err?.details;
    if (Array.isArray(errorDetails)) {
      const retryInfo = errorDetails.find((d: any) => d?.["@type"]?.includes("RetryInfo"));
      if (retryInfo?.retryDelay) {
        const delayStr = String(retryInfo.retryDelay).trim();
        const secondsMatch = delayStr.match(/^([\d.]+)s?$/i);
        if (secondsMatch) {
          retryDelayMs = Math.round(parseFloat(secondsMatch[1]) * 1000);
        }
      }
    }

    // 2. Check retry-after header
    const headers = err?.headers || err?.response?.headers;
    const retryAfter = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
    if (retryAfter && !retryDelayMs) {
      const parsedSec = parseFloat(retryAfter);
      if (!isNaN(parsedSec)) {
        retryDelayMs = Math.round(parsedSec * 1000);
      }
    }

    const isRetryable = (is429 || is5xx) && !isNonRetryable;

    return {
      isRateLimited: is429,
      isRetryable,
      retryDelayMs,
      status: status || (is429 ? 429 : is5xx ? 503 : 500),
    };
  }

  /**
   * Computes backoff delay with exponential scaling and random jitter.
   */
  private computeBackoffDelay(retryCount: number, serverDelayMs?: number): number {
    if (serverDelayMs && serverDelayMs > 0) {
      // Add slight jitter to server-suggested delay
      return serverDelayMs + Math.floor(Math.random() * 500);
    }
    const exponential = this.baseDelayMs * Math.pow(2, retryCount - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(this.maxDelayMs, exponential + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Global shared transcription scheduler instance
export const transcriptionScheduler = new GeminiTranscriptionScheduler();
