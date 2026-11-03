import crypto from "crypto";
import { getGeminiClient, MODELS } from "../geminiClient";

export enum TaskPriority {
  LOW = 0,      // Background enrichment, optional recommendations, weak topic extra drills
  NORMAL = 1,   // Quiz generation, flashcards, RAG Q&A
  MEDIUM = 2,   // Lecture summaries, notes generation, AI understanding
  HIGH = 3,     // Live lecture audio transcription, critical content ingestion
}

export type TaskType =
  | "transcription"
  | "ai_understanding"
  | "quiz_generation"
  | "rag_query"
  | "weak_topic_drill"
  | "generic";

export type OutputSource = "ai_generated" | "cached" | "local_algorithm" | "pending";

export interface TaskExecutionResult<T> {
  result: T;
  source: OutputSource;
  modelUsed?: string;
  durationMs: number;
  cached?: boolean;
}

export interface EnqueueTaskOptions<T> {
  taskType: TaskType;
  priority: TaskPriority;
  userId?: string;
  lectureId?: string;
  sequenceNumber?: number;
  promptOrInput: string;
  preferredModel?: string;
  fallbackModels?: string[];
  executeAi?: (modelName: string) => Promise<T>;
  localFallback?: () => T | Promise<T>;
  allowPendingQueueOnDailyExhaustion?: boolean;
  cacheTtlMs?: number;
}

export interface ModelQuotaConfig {
  name: string;
  rpmLimit: number;
  rpdLimit: number;
}

export interface ModelRuntimeState {
  name: string;
  rpmLimit: number;
  rpdLimit: number;
  executionTimestamps: number[]; // within 60s
  dailyRequestCount: number;
  isDailyQuotaExhausted: boolean;
  dailyQuotaResetAt: number;
  lastDailyExhaustedReason?: string;
}

interface QueuedTask<T> {
  id: string;
  options: EnqueueTaskOptions<T>;
  cacheKey: string;
  resolve: (value: TaskExecutionResult<T>) => void;
  reject: (reason: any) => void;
  createdAt: number;
  retries: number;
}

interface CacheEntry<T> {
  result: T;
  source: OutputSource;
  modelUsed?: string;
  expiresAt: number;
}

export class AiOrchestrator {
  private queue: QueuedTask<any>[] = [];
  private pendingQuotaQueue: QueuedTask<any>[] = [];
  private isProcessing = false;
  private inFlightByKey = new Map<string, Promise<TaskExecutionResult<any>>>();
  private completedCache = new Map<string, CacheEntry<any>>();

  // Runtime model state tracker
  private modelStates = new Map<string, ModelRuntimeState>();

  // Global metrics
  private totalAiRequests = 0;
  private totalCachedRequests = 0;
  private totalFallbackRequests = 0;
  private totalFailedRequests = 0;
  private activeRequestsCount = 0;

  // Defaults
  private maxRetries = 3;
  private baseDelayMs = 2000;
  private maxDelayMs = 30000;

  constructor() {
    this.initModelConfigs();
  }

  private initModelConfigs() {
    const textRpm = parseInt(process.env.GEMINI_TEXT_RPM || "15", 10);
    const textRpd = parseInt(process.env.GEMINI_DAILY_RPD || "20", 10);
    const transcribeRpm = parseInt(process.env.GEMINI_TRANSCRIPTION_RPM || "3", 10);
    const transcribeRpd = parseInt(process.env.GEMINI_TRANSCRIPTION_RPD || "50", 10);

    this.registerModel({
      name: MODELS.TEXT,
      rpmLimit: textRpm,
      rpdLimit: textRpd,
    });

    this.registerModel({
      name: MODELS.TRANSCRIBE,
      rpmLimit: transcribeRpm,
      rpdLimit: transcribeRpd,
    });

    // Fallback text models if configured
    if (process.env.GEMINI_FALLBACK_TEXT_MODEL) {
      this.registerModel({
        name: process.env.GEMINI_FALLBACK_TEXT_MODEL,
        rpmLimit: textRpm,
        rpdLimit: textRpd,
      });
    }
  }

  public registerModel(config: ModelQuotaConfig) {
    if (!this.modelStates.has(config.name)) {
      this.modelStates.set(config.name, {
        name: config.name,
        rpmLimit: config.rpmLimit,
        rpdLimit: config.rpdLimit,
        executionTimestamps: [],
        dailyRequestCount: 0,
        isDailyQuotaExhausted: false,
        dailyQuotaResetAt: this.getNextUtcMidnight(),
      });
    } else {
      const state = this.modelStates.get(config.name)!;
      state.rpmLimit = config.rpmLimit;
      state.rpdLimit = config.rpdLimit;
    }
  }

  public getModelState(modelName: string): ModelRuntimeState {
    this.checkAndResetDailyQuotas();
    let state = this.modelStates.get(modelName);
    if (!state) {
      this.registerModel({
        name: modelName,
        rpmLimit: 15,
        rpdLimit: 20,
      });
      state = this.modelStates.get(modelName)!;
    }
    return state;
  }

  public setModelDailyExhausted(modelName: string, resetDelayMs?: number, reason?: string) {
    const state = this.getModelState(modelName);
    state.isDailyQuotaExhausted = true;
    state.lastDailyExhaustedReason = reason || "Daily quota limit reached (429 RESOURCE_EXHAUSTED)";
    if (resetDelayMs && resetDelayMs > 0) {
      state.dailyQuotaResetAt = Date.now() + resetDelayMs;
    } else {
      state.dailyQuotaResetAt = Math.max(state.dailyQuotaResetAt, this.getNextUtcMidnight());
    }
    console.warn(
      `[AI-ORCHESTRATOR] Model ${modelName} marked DAILY EXHAUSTED. Reset in ${Math.round(
        (state.dailyQuotaResetAt - Date.now()) / 1000
      )}s. Reason: ${state.lastDailyExhaustedReason}`
    );
  }

  public resetModelQuotas(modelName?: string) {
    const now = Date.now();
    if (modelName) {
      const state = this.modelStates.get(modelName);
      if (state) {
        state.isDailyQuotaExhausted = false;
        state.dailyRequestCount = 0;
        state.executionTimestamps = [];
        state.dailyQuotaResetAt = this.getNextUtcMidnight();
        state.lastDailyExhaustedReason = undefined;
      }
    } else {
      for (const state of this.modelStates.values()) {
        state.isDailyQuotaExhausted = false;
        state.dailyRequestCount = 0;
        state.executionTimestamps = [];
        state.dailyQuotaResetAt = this.getNextUtcMidnight();
        state.lastDailyExhaustedReason = undefined;
      }
    }
    this.drainPendingQuotaQueue();
  }

  public checkAndResetDailyQuotas() {
    const now = Date.now();
    let hadReset = false;
    for (const state of this.modelStates.values()) {
      if (now >= state.dailyQuotaResetAt) {
        state.isDailyQuotaExhausted = false;
        state.dailyRequestCount = 0;
        state.executionTimestamps = [];
        state.dailyQuotaResetAt = this.getNextUtcMidnight();
        state.lastDailyExhaustedReason = undefined;
        hadReset = true;
        console.log(`[AI-ORCHESTRATOR] Daily quota auto-reset executed for model ${state.name}`);
      }
    }
    if (hadReset) {
      this.drainPendingQuotaQueue();
    }
  }

  public getNextUtcMidnight(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0
      )
    );
    return next.getTime();
  }

  /**
   * Generates a tenant-isolated cache key combining userId, lectureId, taskType, and content hash.
   */
  public generateCacheKey(options: {
    userId?: string;
    lectureId?: string;
    taskType: TaskType;
    promptOrInput: string;
  }): string {
    const userPart = options.userId?.trim() || "global";
    const lecturePart = options.lectureId?.trim() || "global";
    const inputHash = crypto
      .createHash("sha256")
      .update(options.promptOrInput)
      .digest("hex")
      .substring(0, 24);
    return `${userPart}:${lecturePart}:${options.taskType}:${inputHash}`;
  }

  /**
   * Main entry point to schedule and execute an AI task.
   */
  public async executeTask<T>(options: EnqueueTaskOptions<T>): Promise<TaskExecutionResult<T>> {
    const cacheKey = this.generateCacheKey({
      userId: options.userId,
      lectureId: options.lectureId,
      taskType: options.taskType,
      promptOrInput: options.promptOrInput,
    });

    const ttl = options.cacheTtlMs || 15 * 60 * 1000;

    // 1. Check completed cache
    const cached = this.completedCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.totalCachedRequests++;
      console.log(
        `[AI-ORCHESTRATOR] Cache hit for ${options.taskType} (user: ${options.userId || "anon"}, key: ${cacheKey.substring(0, 16)}...)`
      );
      return {
        result: cached.result,
        source: "cached",
        modelUsed: cached.modelUsed,
        durationMs: 0,
        cached: true,
      };
    }

    // 2. Check in-flight identical request
    const inFlight = this.inFlightByKey.get(cacheKey);
    if (inFlight) {
      console.log(
        `[AI-ORCHESTRATOR] In-flight request joined for ${options.taskType} (key: ${cacheKey.substring(0, 16)}...)`
      );
      return inFlight;
    }

    // 3. Fast-path check: If no AI execution provided or no Gemini client exists, trigger fallback
    const aiClient = getGeminiClient();
    if (!aiClient || !options.executeAi) {
      if (options.localFallback) {
        console.log(
          `[AI-ORCHESTRATOR] No active AI client or executor for ${options.taskType}; invoking local fallback`
        );
        this.totalFallbackRequests++;
        const startTime = Date.now();
        const fallbackRes = await options.localFallback();
        return {
          result: fallbackRes,
          source: "local_algorithm",
          durationMs: Date.now() - startTime,
        };
      }
      throw new Error(`AI client unavailable and no local fallback defined for ${options.taskType}`);
    }

    // 4. Enqueue task for priority processing
    const taskPromise = new Promise<TaskExecutionResult<T>>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: `ai-task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        options,
        cacheKey,
        resolve: (val) => {
          if (val.source !== "local_algorithm" || val.cached) {
            this.completedCache.set(cacheKey, {
              result: val.result,
              source: val.source,
              modelUsed: val.modelUsed,
              expiresAt: Date.now() + ttl,
            });
          }
          this.inFlightByKey.delete(cacheKey);
          resolve(val);
        },
        reject: (err) => {
          this.inFlightByKey.delete(cacheKey);
          reject(err);
        },
        createdAt: Date.now(),
        retries: 0,
      };

      this.insertTaskSorted(task);
      this.processQueue();
    });

    this.inFlightByKey.set(cacheKey, taskPromise);
    return taskPromise;
  }

  private insertTaskSorted<T>(task: QueuedTask<T>) {
    // Insert ordered by priority (descending), then sequence/creation time (ascending)
    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const current = this.queue[i];
      if (task.options.priority > current.options.priority) {
        insertIdx = i;
        break;
      }
      if (task.options.priority === current.options.priority) {
        const taskSeq = task.options.sequenceNumber ?? task.createdAt;
        const currSeq = current.options.sequenceNumber ?? current.createdAt;
        if (taskSeq < currSeq) {
          insertIdx = i;
          break;
        }
      }
    }
    this.queue.splice(insertIdx, 0, task);
    console.log(
      `[AI-ORCHESTRATOR] Task queued: ${task.options.taskType} (priority: ${TaskPriority[task.options.priority]}, queueLen: ${this.queue.length})`
    );
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      this.checkAndResetDailyQuotas();
      const task = this.queue[0];
      const modelName = task.options.preferredModel || (task.options.taskType === "transcription" ? MODELS.TRANSCRIBE : MODELS.TEXT);
      const modelState = this.getModelState(modelName);

      // Check if daily quota is exhausted for preferred model
      if (modelState.isDailyQuotaExhausted || modelState.dailyRequestCount >= modelState.rpdLimit) {
        console.warn(
          `[AI-ORCHESTRATOR] Primary model ${modelName} daily quota exhausted (${modelState.dailyRequestCount}/${modelState.rpdLimit} RPD). Evaluating fallback options.`
        );

        // Try candidate alternate models
        let alternateSuccess = false;
        const candidateAlternates = task.options.fallbackModels || [];

        for (const altModel of candidateAlternates) {
          const altState = this.getModelState(altModel);
          if (!altState.isDailyQuotaExhausted && altState.dailyRequestCount < altState.rpdLimit) {
            console.log(`[AI-ORCHESTRATOR] Attempting alternate model: ${altModel}`);
            try {
              this.queue.shift();
              this.activeRequestsCount++;
              const startTime = Date.now();
              const result = await task.options.executeAi!(altModel);
              this.activeRequestsCount--;
              this.totalAiRequests++;
              altState.dailyRequestCount++;
              altState.executionTimestamps.push(Date.now());
              task.resolve({
                result,
                source: "ai_generated",
                modelUsed: altModel,
                durationMs: Date.now() - startTime,
              });
              alternateSuccess = true;
              break;
            } catch (altErr) {
              this.activeRequestsCount--;
              console.warn(`[AI-ORCHESTRATOR] Alternate model ${altModel} failed:`, altErr);
            }
          }
        }

        if (alternateSuccess) {
          continue;
        }

        // If requested to park in pending queue until daily reset
        if (task.options.allowPendingQueueOnDailyExhaustion) {
          this.queue.shift();
          this.pendingQuotaQueue.push(task);
          console.log(`[AI-ORCHESTRATOR] Task ${task.id} moved to pending queue for daily reset`);
          continue;
        }

        // Otherwise execute local fallback
        if (task.options.localFallback) {
          this.queue.shift();
          console.log(
            `[AI-ORCHESTRATOR] Daily quota exhausted on all models; executing local algorithm fallback for ${task.options.taskType}`
          );
          this.totalFallbackRequests++;
          const startTime = Date.now();
          try {
            const fallbackResult = await task.options.localFallback();
            task.resolve({
              result: fallbackResult,
              source: "local_algorithm",
              durationMs: Date.now() - startTime,
            });
          } catch (fbErr) {
            this.totalFailedRequests++;
            task.reject(fbErr);
          }
          continue;
        }
      }

      // Check RPM sliding window
      const now = Date.now();
      modelState.executionTimestamps = modelState.executionTimestamps.filter((t) => now - t < 60000);

      if (modelState.executionTimestamps.length >= modelState.rpmLimit) {
        const oldest = modelState.executionTimestamps[0];
        const waitMs = Math.max(100, 60000 - (now - oldest) + 50);
        console.log(
          `[AI-ORCHESTRATOR] Rate limit reached for ${modelName} (${modelState.executionTimestamps.length}/${modelState.rpmLimit} RPM). Throttling for ${waitMs}ms`
        );
        await this.sleep(waitMs);
        continue;
      }

      // Execute task
      this.queue.shift();
      this.activeRequestsCount++;
      const startTime = Date.now();

      try {
        modelState.executionTimestamps.push(Date.now());
        modelState.dailyRequestCount++;

        const result = await task.options.executeAi!(modelName);
        this.activeRequestsCount--;
        this.totalAiRequests++;

        console.log(
          `[AI-ORCHESTRATOR] Task succeeded: ${task.options.taskType} (model: ${modelName}, duration: ${Date.now() - startTime}ms)`
        );

        task.resolve({
          result,
          source: "ai_generated",
          modelUsed: modelName,
          durationMs: Date.now() - startTime,
        });
      } catch (err: any) {
        this.activeRequestsCount--;
        const errInfo = this.classifyError(err);

        // Daily quota exhausted detection
        if (errInfo.isDailyQuotaExhausted) {
          this.setModelDailyExhausted(modelName, errInfo.retryDelayMs, err?.message);

          // Route to local fallback immediately
          if (task.options.localFallback) {
            console.log(
              `[AI-ORCHESTRATOR] Daily quota 429 encountered; falling back to local algorithm for ${task.options.taskType}`
            );
            this.totalFallbackRequests++;
            try {
              const fallbackResult = await task.options.localFallback();
              task.resolve({
                result: fallbackResult,
                source: "local_algorithm",
                durationMs: Date.now() - startTime,
              });
            } catch (fbErr) {
              this.totalFailedRequests++;
              task.reject(fbErr);
            }
            continue;
          }
        }

        // Retryable temporary error (RPM or 5xx)
        if (errInfo.isRetryable && !errInfo.isDailyQuotaExhausted && task.retries < this.maxRetries) {
          task.retries += 1;
          const delayMs = this.computeBackoff(task.retries, errInfo.retryDelayMs);
          console.warn(
            `[AI-ORCHESTRATOR] Retrying task ${task.id} (attempt ${task.retries}/${this.maxRetries}) after ${delayMs}ms due to ${errInfo.status}: ${err?.message}`
          );
          this.queue.unshift(task);
          await this.sleep(delayMs);
        } else {
          // Permanent failure or exhausted retries
          if (task.options.localFallback) {
            console.warn(
              `[AI-ORCHESTRATOR] Task ${task.id} failed (${err?.message}); triggering local fallback`
            );
            this.totalFallbackRequests++;
            try {
              const fallbackResult = await task.options.localFallback();
              task.resolve({
                result: fallbackResult,
                source: "local_algorithm",
                durationMs: Date.now() - startTime,
              });
            } catch (fbErr) {
              this.totalFailedRequests++;
              task.reject(fbErr);
            }
          } else {
            this.totalFailedRequests++;
            console.error(`[AI-ORCHESTRATOR] Task ${task.id} failed without fallback:`, err?.message || err);
            task.reject(err);
          }
        }
      }
    }

    this.isProcessing = false;
  }

  private drainPendingQuotaQueue() {
    if (this.pendingQuotaQueue.length === 0) return;
    console.log(`[AI-ORCHESTRATOR] Draining ${this.pendingQuotaQueue.length} tasks from pending quota queue`);
    const tasks = [...this.pendingQuotaQueue];
    this.pendingQuotaQueue = [];
    for (const t of tasks) {
      this.insertTaskSorted(t);
    }
    this.processQueue();
  }

  public classifyError(err: any): {
    status: number;
    isRateLimited: boolean;
    isDailyQuotaExhausted: boolean;
    isRetryable: boolean;
    retryDelayMs?: number;
  } {
    const status = Number(err?.status || err?.statusCode || err?.code || 0);
    const msg = String(err?.message || "").toLowerCase();

    const is429 = status === 429 || msg.includes("resource_exhausted") || msg.includes("429");
    const isDaily =
      is429 &&
      (msg.includes("quota") ||
        msg.includes("per day") ||
        msg.includes("daily") ||
        msg.includes("limit: 20") ||
        msg.includes("free_tier"));
    const is5xx =
      (status >= 500 && status <= 599) ||
      msg.includes("unavailable") ||
      msg.includes("high demand") ||
      msg.includes("internal");
    const is400 = status === 400 || status === 401 || status === 403 || status === 404 || msg.includes("invalid_argument");

    let retryDelayMs: number | undefined;

    // Google RPC RetryInfo
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

    // HTTP Retry-After header
    const headers = err?.headers || err?.response?.headers;
    const retryAfter = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
    if (retryAfter && !retryDelayMs) {
      const parsedSec = parseFloat(retryAfter);
      if (!isNaN(parsedSec)) {
        retryDelayMs = Math.round(parsedSec * 1000);
      }
    }

    return {
      status: status || (is429 ? 429 : is5xx ? 503 : 500),
      isRateLimited: is429,
      isDailyQuotaExhausted: isDaily,
      isRetryable: (is429 || is5xx) && !is400 && !isDaily,
      retryDelayMs,
    };
  }

  private computeBackoff(retryCount: number, serverDelayMs?: number): number {
    if (serverDelayMs && serverDelayMs > 0) {
      return serverDelayMs + Math.floor(Math.random() * 500);
    }
    const exponential = this.baseDelayMs * Math.pow(2, retryCount - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(this.maxDelayMs, exponential + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clears in-memory caches and queues (useful for testing).
   */
  public clearState() {
    this.queue = [];
    this.pendingQuotaQueue = [];
    this.inFlightByKey.clear();
    this.completedCache.clear();
    this.resetModelQuotas();
    this.totalAiRequests = 0;
    this.totalCachedRequests = 0;
    this.totalFallbackRequests = 0;
    this.totalFailedRequests = 0;
    this.activeRequestsCount = 0;
  }

  /**
   * Generates a complete AI Usage & Orchestration report for dashboard / monitoring.
   */
  public getUsageReport() {
    this.checkAndResetDailyQuotas();
    const now = Date.now();

    const modelReports: Record<string, any> = {};
    let anyDailyExhausted = false;

    for (const [name, state] of this.modelStates.entries()) {
      state.executionTimestamps = state.executionTimestamps.filter((t) => now - t < 60000);
      const remainingRpd = Math.max(0, state.rpdLimit - state.dailyRequestCount);
      const secondsUntilReset = Math.max(0, Math.round((state.dailyQuotaResetAt - now) / 1000));

      if (state.isDailyQuotaExhausted) {
        anyDailyExhausted = true;
      }

      modelReports[name] = {
        name,
        rpdUsed: state.dailyRequestCount,
        rpdLimit: state.rpdLimit,
        rpdRemaining: remainingRpd,
        rpmCurrent: state.executionTimestamps.length,
        rpmLimit: state.rpmLimit,
        isDailyQuotaExhausted: state.isDailyQuotaExhausted,
        dailyResetAt: new Date(state.dailyQuotaResetAt).toISOString(),
        secondsUntilReset,
        status: state.isDailyQuotaExhausted
          ? "daily_exhausted"
          : state.executionTimestamps.length >= state.rpmLimit
          ? "rate_limited"
          : "available",
        reason: state.lastDailyExhaustedReason,
      };
    }

    return {
      provider: "google-gemini",
      activeModels: Array.from(this.modelStates.keys()),
      metrics: {
        totalAiRequests: this.totalAiRequests,
        totalCachedRequests: this.totalCachedRequests,
        totalFallbackRequests: this.totalFallbackRequests,
        totalFailedRequests: this.totalFailedRequests,
        pendingTasksCount: this.pendingQuotaQueue.length,
        queuedTasksCount: this.queue.length,
        activeRequests: this.activeRequestsCount,
      },
      models: modelReports,
      circuitBreakerActive: anyDailyExhausted,
      lastUpdated: new Date().toISOString(),
    };
  }
}

// Global shared AI Orchestrator singleton
export const aiOrchestrator = new AiOrchestrator();
