import crypto from "crypto";
import { getGeminiClient, MODELS } from "../geminiClient";
import { getAiConfig } from "../config/aiConfig";

export type TaskType =
  | "generic"
  | "transcription"
  | "ai_understanding"
  | "smart_notes"
  | "chapter_detection"
  | "quiz_generation"
  | "rag_search"
  | "rag_query"
  | "weak_topic_remediation"
  | "weak_topic_drill";

export enum TaskPriority {
  LOW = 1,
  NORMAL = 2,
  MEDIUM = 2,
  HIGH = 3,
  REALTIME = 4,
}

export type OutputSource = "ai_generated" | "cached" | "local_algorithm";

export type AiTaskStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRY_WAIT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AiErrorClassification =
  | "UNAVAILABLE_503"
  | "INTERNAL_500"
  | "RESOURCE_EXHAUSTED_429"
  | "INVALID_ARGUMENT_400"
  | "UNAUTHENTICATED_401"
  | "PERMISSION_DENIED_403"
  | "DEADLINE_EXCEEDED_504"
  | "UNKNOWN_ERROR";

export interface AiErrorInfo {
  type: AiErrorClassification;
  status: number;
  message: string;
  userFacingMessage: string;
  isRetryable: boolean;
  isRateLimited: boolean;
  isDailyQuotaExhausted: boolean;
  retryDelayMs?: number;
}

export interface TaskExecutionResult<T> {
  result: T;
  source: OutputSource;
  modelUsed?: string;
  durationMs: number;
  cached?: boolean;
  taskId?: string;
}

export interface EnqueueTaskOptions<T> {
  taskType: TaskType;
  priority: TaskPriority;
  userId?: string;
  lectureId?: string;
  idempotencyKey?: string;
  sequenceNumber?: number;
  promptOrInput: string;
  preferredModel?: string;
  fallbackModels?: string[];
  executeAi?: (modelName: string) => Promise<T>;
  localFallback?: () => T | Promise<T>;
  allowPendingQueueOnDailyExhaustion?: boolean;
  cacheTtlMs?: number;
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

export interface TaskRecord<T = any> {
  id: string;
  taskType: TaskType;
  status: AiTaskStatus;
  userId?: string;
  lectureId?: string;
  idempotencyKey?: string;
  options: EnqueueTaskOptions<T>;
  attempts: number;
  maxRetries: number;
  lastError?: AiErrorInfo;
  runAt?: number;
  result?: TaskExecutionResult<T>;
  createdAt: number;
  updatedAt: number;
}

interface QueuedTask<T> {
  id: string;
  options: EnqueueTaskOptions<T>;
  cacheKey: string;
  resolve: (value: TaskExecutionResult<T>) => void;
  reject: (reason: any) => void;
  createdAt: number;
  attempts: number;
  status: AiTaskStatus;
  lastError?: AiErrorInfo;
  runAt?: number;
}

interface CacheEntry<T> {
  result: T;
  source: OutputSource;
  modelUsed?: string;
  expiresAt: number;
}

// Known documented text-generation models supported by Google Gemini
const VALID_TEXT_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.5-pro",
  "gemini-1.5-pro",
]);

export class AiOrchestrator {
  private queue: QueuedTask<any>[] = [];
  private pendingQuotaQueue: QueuedTask<any>[] = [];
  private isProcessing = false;
  private inFlightByKey = new Map<string, Promise<TaskExecutionResult<any>>>();
  private completedCache = new Map<string, CacheEntry<any>>();

  // Persistent registry of task records by ID for tracking, inspection, and controlled retry
  private taskRecords = new Map<string, TaskRecord<any>>();

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
    const textRpd = parseInt(process.env.GEMINI_DAILY_RPD || "50", 10);
    const transcribeRpm = parseInt(process.env.GEMINI_TRANSCRIPTION_RPM || "3", 10);
    const transcribeRpd = parseInt(process.env.GEMINI_TRANSCRIPTION_RPD || "50", 10);

    this.registerModel({
      name: MODELS.TEXT,
      rpmLimit: textRpm,
      rpdLimit: textRpd,
    });

    if (MODELS.FALLBACK_TEXT && MODELS.FALLBACK_TEXT !== MODELS.TEXT) {
      this.registerModel({
        name: MODELS.FALLBACK_TEXT,
        rpmLimit: textRpm,
        rpdLimit: textRpd,
      });
    }

    this.registerModel({
      name: MODELS.TRANSCRIBE,
      rpmLimit: transcribeRpm,
      rpdLimit: transcribeRpd,
    });
  }

  public registerModel(config: { name: string; rpmLimit: number; rpdLimit: number }) {
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
    }
  }

  public getModelState(modelName: string): ModelRuntimeState {
    let state = this.modelStates.get(modelName);
    if (!state) {
      this.registerModel({
        name: modelName,
        rpmLimit: 15,
        rpdLimit: 50,
      });
      state = this.modelStates.get(modelName)!;
    }
    return state;
  }

  public setModelDailyExhausted(modelName: string, retryDelayMs?: number, reason?: string) {
    const state = this.getModelState(modelName);
    state.isDailyQuotaExhausted = true;
    state.lastDailyExhaustedReason = reason || "Daily request quota exhausted";
    if (retryDelayMs && retryDelayMs > 0) {
      state.dailyQuotaResetAt = Date.now() + retryDelayMs;
    } else {
      state.dailyQuotaResetAt = this.getNextUtcMidnight();
    }
    console.warn(
      `[AI-ORCHESTRATOR] Model ${modelName} marked DAILY QUOTA EXHAUSTED until ${new Date(
        state.dailyQuotaResetAt
      ).toISOString()}. Reason: ${state.lastDailyExhaustedReason}`
    );
  }

  public resetModelQuotas(targetModel?: string) {
    const nextMidnight = this.getNextUtcMidnight();
    for (const [name, state] of this.modelStates.entries()) {
      if (targetModel && name !== targetModel) continue;
      state.isDailyQuotaExhausted = false;
      state.dailyRequestCount = 0;
      state.executionTimestamps = [];
      state.dailyQuotaResetAt = nextMidnight;
      state.lastDailyExhaustedReason = undefined;
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
    idempotencyKey?: string;
  }): string {
    if (options.idempotencyKey) {
      return `idem:${options.idempotencyKey}`;
    }
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
   * Retrieves a task record by ID.
   */
  public getTaskRecord(taskId: string): TaskRecord | undefined {
    return this.taskRecords.get(taskId);
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
      idempotencyKey: options.idempotencyKey,
    });

    const ttl = options.cacheTtlMs || 15 * 60 * 1000;

    // 1. Check completed cache
    const cached = this.completedCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.totalCachedRequests++;
      console.log(
        `[AI-ORCHESTRATOR] Cache hit for ${options.taskType} (key: ${cacheKey.substring(0, 24)}...)`
      );
      return {
        result: cached.result,
        source: "cached",
        modelUsed: cached.modelUsed,
        durationMs: 0,
        cached: true,
      };
    }

    // 2. Check in-flight identical request (prevents duplicate execution)
    const inFlight = this.inFlightByKey.get(cacheKey);
    if (inFlight) {
      console.log(
        `[AI-ORCHESTRATOR] In-flight request joined for ${options.taskType} (key: ${cacheKey.substring(0, 24)}...)`
      );
      return inFlight;
    }

    // 3. Fast-path check: If no AI execution provided, trigger fallback
    if (!options.executeAi) {
      if (options.localFallback) {
        console.log(
          `[AI-ORCHESTRATOR] No active AI executor for ${options.taskType}; invoking local fallback`
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
      throw new Error(`AI executor unavailable and no local fallback defined for ${options.taskType}`);
    }

    // 4. Enqueue task for priority processing
    const taskId = `ai-task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const taskRecord: TaskRecord<T> = {
      id: taskId,
      taskType: options.taskType,
      status: "PENDING",
      userId: options.userId,
      lectureId: options.lectureId,
      idempotencyKey: options.idempotencyKey,
      options,
      attempts: 0,
      maxRetries: this.maxRetries,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.taskRecords.set(taskId, taskRecord);

    const taskPromise = new Promise<TaskExecutionResult<T>>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: taskId,
        options,
        cacheKey,
        resolve: (val) => {
          taskRecord.status = "COMPLETED";
          taskRecord.result = val;
          taskRecord.updatedAt = Date.now();

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
          taskRecord.status = "FAILED";
          taskRecord.updatedAt = Date.now();
          this.inFlightByKey.delete(cacheKey);
          reject(err);
        },
        createdAt: Date.now(),
        attempts: 0,
        status: "PENDING",
      };

      this.insertTaskSorted(task);
      this.processQueue();
    });

    this.inFlightByKey.set(cacheKey, taskPromise);
    return taskPromise;
  }

  private insertTaskSorted<T>(task: QueuedTask<T>) {
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
      `[AI-ORCHESTRATOR] Task queued: ${task.options.taskType} (id: ${task.id}, priority: ${TaskPriority[task.options.priority]}, queueLen: ${this.queue.length})`
    );
  }

  /**
   * Main processing loop.
   * Crucially: 503 retry delays on one task DO NOT sleep the main loop.
   * Tasks in RETRY_WAIT are re-scheduled asynchronously, allowing other tasks to process immediately.
   */
  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      this.checkAndResetDailyQuotas();
      const now = Date.now();

      // Find first task ready to run (runAt is undefined or <= now)
      const readyIdx = this.queue.findIndex((t) => !t.runAt || t.runAt <= now);
      if (readyIdx === -1) {
        // All remaining tasks are currently in scheduled backoff
        break;
      }

      const task = this.queue.splice(readyIdx, 1)[0];
      task.status = "PROCESSING";

      const record = this.taskRecords.get(task.id);
      if (record) {
        record.status = "PROCESSING";
        record.attempts = task.attempts + 1;
        record.updatedAt = Date.now();
      }

      const modelName =
        task.options.preferredModel ||
        (task.options.taskType === "transcription" ? MODELS.TRANSCRIBE : MODELS.TEXT);
      const modelState = this.getModelState(modelName);

      // Check daily quota exhaustion on preferred model
      if (modelState.isDailyQuotaExhausted || modelState.dailyRequestCount >= modelState.rpdLimit) {
        console.warn(
          `[AI-ORCHESTRATOR] Primary model ${modelName} daily quota exhausted. Evaluating compatible fallbacks.`
        );

        let alternateSuccess = false;
        const candidateAlternates = this.filterCompatibleFallbacks(
          task.options.taskType,
          task.options.fallbackModels || []
        );

        for (const altModel of candidateAlternates) {
          const altState = this.getModelState(altModel);
          if (!altState.isDailyQuotaExhausted && altState.dailyRequestCount < altState.rpdLimit) {
            console.log(`[AI-ORCHESTRATOR] Attempting compatible fallback model: ${altModel}`);
            try {
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
                taskId: task.id,
              });
              alternateSuccess = true;
              break;
            } catch (altErr) {
              this.activeRequestsCount--;
              console.warn(`[AI-ORCHESTRATOR] Fallback model ${altModel} failed:`, altErr);
            }
          }
        }

        if (alternateSuccess) {
          continue;
        }

        // Park task if requested
        if (task.options.allowPendingQueueOnDailyExhaustion) {
          task.status = "RETRY_WAIT";
          this.pendingQuotaQueue.push(task);
          if (record) {
            record.status = "RETRY_WAIT";
            record.updatedAt = Date.now();
          }
          console.log(`[AI-ORCHESTRATOR] Task ${task.id} parked for daily reset`);
          continue;
        }

        // Trigger local algorithm fallback if available
        if (task.options.localFallback) {
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
              taskId: task.id,
            });
          } catch (fbErr) {
            this.totalFailedRequests++;
            task.reject(fbErr);
          }
          continue;
        }
      }

      // Check RPM limit sliding window
      modelState.executionTimestamps = modelState.executionTimestamps.filter((t) => now - t < 60000);
      if (modelState.executionTimestamps.length >= modelState.rpmLimit) {
        const oldest = modelState.executionTimestamps[0];
        const waitMs = Math.max(100, 60000 - (now - oldest) + 50);
        console.log(
          `[AI-ORCHESTRATOR] RPM limit for ${modelName} (${modelState.executionTimestamps.length}/${modelState.rpmLimit}). Throttling task ${task.id} for ${waitMs}ms`
        );
        task.status = "RETRY_WAIT";
        task.runAt = Date.now() + waitMs;
        this.queue.push(task);

        // Schedule resumption without locking this.isProcessing
        setTimeout(() => {
          this.processQueue();
        }, waitMs);
        break;
      }

      // Execute AI task
      this.activeRequestsCount++;
      const startTime = Date.now();

      try {
        modelState.executionTimestamps.push(Date.now());
        modelState.dailyRequestCount++;

        const result = await task.options.executeAi!(modelName);
        this.activeRequestsCount--;
        this.totalAiRequests++;

        console.log(
          `[AI-ORCHESTRATOR] Task succeeded: ${task.options.taskType} (id: ${task.id}, model: ${modelName}, duration: ${Date.now() - startTime}ms)`
        );

        task.resolve({
          result,
          source: "ai_generated",
          modelUsed: modelName,
          durationMs: Date.now() - startTime,
          taskId: task.id,
        });
      } catch (err: any) {
        this.activeRequestsCount--;
        const errInfo = this.classifyError(err);
        task.lastError = errInfo;
        if (record) {
          record.lastError = errInfo;
          record.updatedAt = Date.now();
        }

        console.warn(
          `[AI-ORCHESTRATOR] Task ${task.id} error [${errInfo.type} / HTTP ${errInfo.status}]: ${errInfo.message}`
        );

        // 1. Daily Quota 429
        if (errInfo.isDailyQuotaExhausted) {
          this.setModelDailyExhausted(modelName, errInfo.retryDelayMs, err?.message);
          if (task.options.localFallback) {
            console.log(
              `[AI-ORCHESTRATOR] Daily quota exhausted; invoking local fallback for ${task.options.taskType}`
            );
            this.totalFallbackRequests++;
            try {
              const fallbackResult = await task.options.localFallback();
              task.resolve({
                result: fallbackResult,
                source: "local_algorithm",
                durationMs: Date.now() - startTime,
                taskId: task.id,
              });
            } catch (fbErr) {
              this.totalFailedRequests++;
              task.reject(fbErr);
            }
            continue;
          }
        }

        // 2. Retryable Transient Error (503 UNAVAILABLE, 504 DEADLINE_EXCEEDED, 500 INTERNAL, transient 429 RPM)
        if (errInfo.isRetryable && !errInfo.isDailyQuotaExhausted && task.attempts < this.maxRetries) {
          task.attempts += 1;
          const delayMs = this.computeBackoff(task.attempts, errInfo.retryDelayMs);
          task.status = "RETRY_WAIT";
          task.runAt = Date.now() + delayMs;

          if (record) {
            record.status = "RETRY_WAIT";
            record.attempts = task.attempts;
            record.runAt = task.runAt;
            record.updatedAt = Date.now();
          }

          console.warn(
            `[AI-ORCHESTRATOR] Scheduling non-blocking retry for task ${task.id} (attempt ${task.attempts}/${this.maxRetries}) after ${delayMs}ms due to ${errInfo.type}`
          );

          // Re-queue task with scheduled runAt
          this.queue.push(task);

          // Asynchronously wake up queue after backoff without blocking other tasks
          setTimeout(() => {
            this.processQueue();
          }, delayMs);
        } else {
          // 3. Retries Exhausted or Non-Retryable Error (400, 401, 403)
          if (task.options.localFallback) {
            console.warn(
              `[AI-ORCHESTRATOR] Retries exhausted for task ${task.id} (${errInfo.type}); invoking local fallback`
            );
            this.totalFallbackRequests++;
            try {
              const fallbackResult = await task.options.localFallback();
              task.resolve({
                result: fallbackResult,
                source: "local_algorithm",
                durationMs: Date.now() - startTime,
                taskId: task.id,
              });
            } catch (fbErr) {
              this.totalFailedRequests++;
              task.reject(fbErr);
            }
          } else {
            this.totalFailedRequests++;
            task.status = "FAILED";
            if (record) {
              record.status = "FAILED";
              record.updatedAt = Date.now();
            }
            console.error(
              `[AI-ORCHESTRATOR] Task ${task.id} failed permanently without fallback: [${errInfo.type}] ${errInfo.message}`
            );
            task.reject(err);
          }
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Filters and validates fallback models to guarantee task-compatibility.
   * Never routes text/quiz tasks to transcription or embedding models.
   */
  private filterCompatibleFallbacks(taskType: TaskType, candidateModels: string[]): string[] {
    const isTextTask = taskType === "quiz_generation" || taskType === "smart_notes" || taskType === "ai_understanding";
    return candidateModels.filter((m) => {
      if (!m || typeof m !== "string") return false;
      if (isTextTask) {
        return VALID_TEXT_MODELS.has(m) || m.includes("flash") || m.includes("pro");
      }
      return true;
    });
  }

  private drainPendingQuotaQueue() {
    if (this.pendingQuotaQueue.length === 0) return;
    console.log(
      `[AI-ORCHESTRATOR] Draining ${this.pendingQuotaQueue.length} quota-pending tasks back to active queue`
    );
    while (this.pendingQuotaQueue.length > 0) {
      const task = this.pendingQuotaQueue.shift()!;
      task.status = "PENDING";
      task.runAt = undefined;
      this.insertTaskSorted(task);
    }
    this.processQueue();
  }

  /**
   * Thorough error classifier distinguishing 503, 500, 429, 400, 401, 403, 504.
   */
  public classifyError(err: any): AiErrorInfo {
    const status = Number(err?.status || err?.statusCode || err?.code || 0);
    const rawMsg = String(err?.message || "").toLowerCase();

    // 1. 503 UNAVAILABLE
    const is503 =
      status === 503 ||
      rawMsg.includes("503") ||
      rawMsg.includes("unavailable") ||
      rawMsg.includes("high demand") ||
      rawMsg.includes("model is overloaded");

    // 2. 504 DEADLINE_EXCEEDED
    const is504 =
      status === 504 ||
      rawMsg.includes("504") ||
      rawMsg.includes("deadline exceeded") ||
      rawMsg.includes("timed out") ||
      rawMsg.includes("timeout");

    // 3. 429 RESOURCE_EXHAUSTED
    const is429 = status === 429 || rawMsg.includes("resource_exhausted") || rawMsg.includes("429");
    const isDaily =
      is429 &&
      (rawMsg.includes("quota") ||
        rawMsg.includes("per day") ||
        rawMsg.includes("daily") ||
        rawMsg.includes("limit: 20") ||
        rawMsg.includes("limit: 25") ||
        rawMsg.includes("generate_content_free_tier_requests") ||
        rawMsg.includes("free_tier"));

    // 4. 400 INVALID_ARGUMENT
    const is400 =
      status === 400 ||
      rawMsg.includes("invalid_argument") ||
      rawMsg.includes("invalid argument") ||
      rawMsg.includes("bad request");

    // 5. 401 UNAUTHENTICATED
    const is401 =
      status === 401 ||
      rawMsg.includes("unauthenticated") ||
      rawMsg.includes("api key not valid") ||
      rawMsg.includes("invalid api key");

    // 6. 403 PERMISSION_DENIED
    const is403 =
      status === 403 ||
      rawMsg.includes("permission_denied") ||
      rawMsg.includes("permission denied") ||
      rawMsg.includes("forbidden");

    // 7. 500 INTERNAL SERVER ERROR
    const is500 =
      (status >= 500 && status <= 599 && !is503 && !is504) ||
      rawMsg.includes("internal server error") ||
      rawMsg.includes("internal error");

    // Extract retry delay from Google RPC RetryInfo
    let retryDelayMs: number | undefined;
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

    // Extract HTTP Retry-After header
    const headers = err?.headers || err?.response?.headers;
    const retryAfter = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
    if (retryAfter && !retryDelayMs) {
      const parsedSec = parseFloat(retryAfter);
      if (!isNaN(parsedSec)) {
        retryDelayMs = Math.round(parsedSec * 1000);
      }
    }

    if (is503) {
      return {
        type: "UNAVAILABLE_503",
        status: 503,
        message: err?.message || "Model is currently experiencing high demand.",
        userFacingMessage:
          "The AI model is currently experiencing high demand (503). Retrying automatically with backoff...",
        isRetryable: true,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
        retryDelayMs,
      };
    }

    if (is504) {
      return {
        type: "DEADLINE_EXCEEDED_504",
        status: 504,
        message: err?.message || "Deadline exceeded.",
        userFacingMessage: "AI request timed out (504). Retrying automatically...",
        isRetryable: true,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
        retryDelayMs,
      };
    }

    if (is429) {
      return {
        type: "RESOURCE_EXHAUSTED_429",
        status: 429,
        message: err?.message || "Resource exhausted / Rate limit reached.",
        userFacingMessage: isDaily
          ? "Daily free-tier AI quota reached for today. Your content has been safely preserved."
          : "AI rate limit reached. Retrying automatically in a few moments...",
        isRetryable: !isDaily,
        isRateLimited: true,
        isDailyQuotaExhausted: isDaily,
        retryDelayMs,
      };
    }

    if (is400) {
      return {
        type: "INVALID_ARGUMENT_400",
        status: 400,
        message: err?.message || "Invalid argument in AI request.",
        userFacingMessage: "Request contains an invalid argument or unsupported parameters.",
        isRetryable: false,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
      };
    }

    if (is401) {
      return {
        type: "UNAUTHENTICATED_401",
        status: 401,
        message: err?.message || "Unauthenticated AI request.",
        userFacingMessage: "AI authentication failed. Please verify configured API credentials.",
        isRetryable: false,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
      };
    }

    if (is403) {
      return {
        type: "PERMISSION_DENIED_403",
        status: 403,
        message: err?.message || "Permission denied for AI model.",
        userFacingMessage: "Permission denied for this model or operation.",
        isRetryable: false,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
      };
    }

    if (is500) {
      return {
        type: "INTERNAL_500",
        status: status || 500,
        message: err?.message || "Internal server error from AI service.",
        userFacingMessage: "Temporary internal AI server issue (500). Retrying...",
        isRetryable: true,
        isRateLimited: false,
        isDailyQuotaExhausted: false,
        retryDelayMs,
      };
    }

    return {
      type: "UNKNOWN_ERROR",
      status: status || 500,
      message: err?.message || "Unknown error during AI execution.",
      userFacingMessage: "An unexpected error occurred during AI processing.",
      isRetryable: false,
      isRateLimited: false,
      isDailyQuotaExhausted: false,
      retryDelayMs,
    };
  }

  public computeBackoff(retryCount: number, serverDelayMs?: number): number {
    if (serverDelayMs && serverDelayMs > 0) {
      return serverDelayMs + Math.floor(Math.random() * 500);
    }
    const exponential = this.baseDelayMs * Math.pow(2, retryCount - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(this.maxDelayMs, exponential + jitter);
  }

  /**
   * Clears in-memory caches, queues, and task records (useful for test suites).
   */
  public clearState() {
    this.queue = [];
    this.pendingQuotaQueue = [];
    this.inFlightByKey.clear();
    this.completedCache.clear();
    this.taskRecords.clear();
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
