/**
 * Intelligent AI Error Classifier for LearniX.
 * 
 * Accurately discriminates between:
 * - RPM_LIMIT_EXCEEDED: Short-term requests per minute rate limit.
 * - TPM_LIMIT_EXCEEDED: Short-term tokens per minute rate limit.
 * - DAILY_RPD_EXHAUSTED: Free-tier daily limit reached (e.g. generate_content_free_tier_requests).
 * - BILLING_OR_ACCOUNT_EXHAUSTED: Hard account quota or payment exhaustion.
 * - TEMPORARY_SERVICE_UNAVAILABLE: 503 / 500 / overloaded models.
 * - INVALID_REQUEST: Client error (400 / invalid arguments).
 */

export type AiErrorType =
  | "RPM_LIMIT_EXCEEDED"
  | "TPM_LIMIT_EXCEEDED"
  | "DAILY_RPD_EXHAUSTED"
  | "BILLING_OR_ACCOUNT_EXHAUSTED"
  | "TEMPORARY_SERVICE_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "UNKNOWN_ERROR";

export interface ErrorClassification {
  errorType: AiErrorType;
  isRetryable: boolean;
  isDailyQuotaExhausted: boolean;
  retryDelayMs?: number;
  status: number;
  userMessage: string;
  technicalDetails: string;
}

// Global in-memory cache of daily quota state
let dailyQuotaExhaustedUntil: number | null = null;

export function isDailyQuotaCurrentlyExhausted(): boolean {
  if (!dailyQuotaExhaustedUntil) return false;
  if (Date.now() > dailyQuotaExhaustedUntil) {
    dailyQuotaExhaustedUntil = null;
    return false;
  }
  return true;
}

export function setDailyQuotaExhaustedState(exhausted: boolean, durationMs = 60 * 60 * 1000): void {
  if (exhausted) {
    dailyQuotaExhaustedUntil = Date.now() + durationMs;
  } else {
    dailyQuotaExhaustedUntil = null;
  }
}

export function getDailyQuotaResetTime(): Date | null {
  return dailyQuotaExhaustedUntil ? new Date(dailyQuotaExhaustedUntil) : null;
}

/**
 * Classifies an error thrown during a Gemini API or transcription call.
 */
export function classifyAiError(err: any): ErrorClassification {
  const status = Number(err?.status || err?.statusCode || err?.code || 0);
  const rawMsg = String(err?.message || "").trim();
  const msgLower = rawMsg.toLowerCase();

  // Inspect error details from Google RPC response
  const details = err?.errorDetails || err?.details || [];
  let quotaMetric = "";
  let retryDelayMs: number | undefined;

  if (Array.isArray(details)) {
    for (const d of details) {
      const type = String(d?.["@type"] || "");
      if (type.includes("QuotaFailure")) {
        const violations = d?.violations || [];
        for (const v of violations) {
          if (v?.subject) quotaMetric += ` ${v.subject}`;
          if (v?.description) quotaMetric += ` ${v.description}`;
        }
      }
      if (type.includes("RetryInfo") && d?.retryDelay) {
        const delayStr = String(d.retryDelay).trim();
        const secondsMatch = delayStr.match(/^([\d.]+)s?$/i);
        if (secondsMatch) {
          retryDelayMs = Math.round(parseFloat(secondsMatch[1]) * 1000);
        }
      }
    }
  }

  // Inspect HTTP retry-after header if present
  const headers = err?.headers || err?.response?.headers;
  const retryAfter = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
  if (retryAfter && !retryDelayMs) {
    const parsed = parseFloat(retryAfter);
    if (!isNaN(parsed) && parsed > 0) {
      retryDelayMs = Math.round(parsed * 1000);
    }
  }

  const combinedEvidence = `${rawMsg} ${quotaMetric}`.toLowerCase();

  // 1. Daily Free-Tier Request Limit Exhaustion (RPD)
  if (
    combinedEvidence.includes("generate_content_free_tier_requests") ||
    combinedEvidence.includes("free_tier_requests") ||
    combinedEvidence.includes("daily request limit") ||
    combinedEvidence.includes("per day") ||
    (status === 429 && combinedEvidence.includes("free-tier"))
  ) {
    // Flag quota exhaustion globally to pause doomed requests
    setDailyQuotaExhaustedState(true);

    return {
      errorType: "DAILY_RPD_EXHAUSTED",
      isRetryable: false, // DO NOT retry immediately against daily quota
      isDailyQuotaExhausted: true,
      retryDelayMs,
      status: 429,
      userMessage:
        "Transcription is temporarily paused because the AI provider's daily quota has been reached. Your recording is safe. You can retry transcription later.",
      technicalDetails: `Daily free tier quota exhausted: ${rawMsg}`,
    };
  }

  // 2. Billing or Permanent Account Quota
  if (
    combinedEvidence.includes("billing") ||
    combinedEvidence.includes("credit") ||
    combinedEvidence.includes("quota exceeded for quota group") ||
    combinedEvidence.includes("insufficient_quota")
  ) {
    setDailyQuotaExhaustedState(true);

    return {
      errorType: "BILLING_OR_ACCOUNT_EXHAUSTED",
      isRetryable: false,
      isDailyQuotaExhausted: true,
      retryDelayMs,
      status: 429,
      userMessage:
        "AI transcription service quota has been reached for this account. Your recording is safely saved and can be transcribed later.",
      technicalDetails: `Billing or account quota limit: ${rawMsg}`,
    };
  }

  // 3. Short-term Rate Limiting: Tokens Per Minute (TPM)
  if (combinedEvidence.includes("token") && (status === 429 || combinedEvidence.includes("resource_exhausted"))) {
    return {
      errorType: "TPM_LIMIT_EXCEEDED",
      isRetryable: true,
      isDailyQuotaExhausted: false,
      retryDelayMs: retryDelayMs || 5000,
      status: 429,
      userMessage: "AI request token rate limit reached. Processing will automatically resume shortly.",
      technicalDetails: `TPM limit: ${rawMsg}`,
    };
  }

  // 4. Short-term Rate Limiting: Requests Per Minute (RPM)
  if (
    status === 429 ||
    combinedEvidence.includes("resource_exhausted") ||
    combinedEvidence.includes("rate limit") ||
    combinedEvidence.includes("too many requests")
  ) {
    return {
      errorType: "RPM_LIMIT_EXCEEDED",
      isRetryable: true,
      isDailyQuotaExhausted: false,
      retryDelayMs: retryDelayMs || 3000,
      status: 429,
      userMessage: "Brief AI rate limit encountered. Retrying momentarily.",
      technicalDetails: `RPM limit: ${rawMsg}`,
    };
  }

  // 5. Client Request Error (400 / 401 / 403 / 404 / INVALID_ARGUMENT)
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    combinedEvidence.includes("invalid_argument") ||
    combinedEvidence.includes("api key not valid") ||
    combinedEvidence.includes("permission_denied")
  ) {
    return {
      errorType: "INVALID_REQUEST",
      isRetryable: false,
      isDailyQuotaExhausted: false,
      status: status || 400,
      userMessage: "Audio transcription request was rejected by the service.",
      technicalDetails: `Client error: ${rawMsg}`,
    };
  }

  // 6. Temporary Service Overload (500, 502, 503, 504)
  if (
    (status >= 500 && status <= 599) ||
    combinedEvidence.includes("unavailable") ||
    combinedEvidence.includes("high demand") ||
    combinedEvidence.includes("overloaded") ||
    combinedEvidence.includes("backend error")
  ) {
    return {
      errorType: "TEMPORARY_SERVICE_UNAVAILABLE",
      isRetryable: true,
      isDailyQuotaExhausted: false,
      retryDelayMs: retryDelayMs || 4000,
      status: status || 503,
      userMessage: "AI transcription service is experiencing temporary high demand. Retrying shortly.",
      technicalDetails: `Service unavailable: ${rawMsg}`,
    };
  }

  // 7. Unknown fallback
  return {
    errorType: "UNKNOWN_ERROR",
    isRetryable: false,
    isDailyQuotaExhausted: false,
    status: status || 500,
    userMessage: "An error occurred during transcription processing.",
    technicalDetails: rawMsg || "Unknown error occurred",
  };
}
