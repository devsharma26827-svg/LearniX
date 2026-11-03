import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export const AUTH_COOKIE_NAME = "learnix_session";
export const PREAUTH_COOKIE_NAME = "learnix_csrf_context";

function getCsrfSecret(): string {
  return process.env.SESSION_SECRET || "learnix-default-cryptographic-csrf-salt-2026";
}

export function isProductionEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    Boolean(process.env.RENDER_EXTERNAL_HOSTNAME)
  );
}

export function isDemoAccountEnabled(): boolean {
  if (isProductionEnvironment()) {
    return process.env.ENABLE_DEMO_ACCOUNT === "true";
  }
  return process.env.ENABLE_DEMO_ACCOUNT !== "false";
}

export function getCsrfCookieOptions() {
  const isProd = isProductionEnvironment();
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: "/",
  };
}

/**
 * Generates a cryptographically secure, unpredictable CSRF token bound to a specific context ID.
 * Format: <hmac>.<timestamp>.<nonce>
 */
export function generateCsrfToken(contextId: string): string {
  if (!contextId || typeof contextId !== "string") {
    throw new Error("Cannot generate CSRF token without valid context identifier");
  }
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${contextId}:${timestamp}:${nonce}`;
  const hmac = crypto
    .createHmac("sha256", getCsrfSecret())
    .update(payload)
    .digest("hex");
  return `${hmac}.${timestamp}.${nonce}`;
}

/**
 * Validates a CSRF token against a specific context ID with timing-safe HMAC equality.
 */
export function verifyCsrfToken(token: string | undefined | null, contextId: string | undefined | null): boolean {
  if (!token || typeof token !== "string" || !contextId || typeof contextId !== "string") {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [hmac, timestampStr, nonce] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return false;
  }

  // Token expiration: 24 hours validity, 60 seconds clock-skew tolerance
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now - timestamp > maxAge || timestamp > now + 60000) {
    return false;
  }

  const payload = `${contextId}:${timestamp}:${nonce}`;
  const expectedHmac = crypto
    .createHmac("sha256", getCsrfSecret())
    .update(payload)
    .digest("hex");

  if (hmac.length !== expectedHmac.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expectedHmac, "hex"));
  } catch {
    return false;
  }
}

/**
 * Resolves the client's current CSRF context ID from cookies or Authorization header.
 */
export function resolveContextId(req: Request): { contextId: string | null; type: "auth" | "preauth" | "bearer" | "none" } {
  const authCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof authCookie === "string" && authCookie.trim()) {
    return { contextId: authCookie.trim(), type: "auth" };
  }

  const preauthCookie = req.cookies?.[PREAUTH_COOKIE_NAME];
  if (typeof preauthCookie === "string" && preauthCookie.trim()) {
    return { contextId: preauthCookie.trim(), type: "preauth" };
  }

  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) {
      return { contextId: bearer, type: "bearer" };
    }
  }

  return { contextId: null, type: "none" };
}

/**
 * Handles GET /api/auth/csrf: bootstraps or returns the current CSRF token and sets preauth context if needed.
 */
export function handleCsrfBootstrap(req: Request, res: Response) {
  let { contextId, type } = resolveContextId(req);

  // If client has neither an authenticated session nor preauth cookie, establish preauth context
  if (!contextId || type === "bearer") {
    const newPreauthId = crypto.randomBytes(32).toString("hex");
    res.cookie(PREAUTH_COOKIE_NAME, newPreauthId, getCsrfCookieOptions());
    contextId = newPreauthId;
  }

  const token = generateCsrfToken(contextId);
  res.setHeader("X-CSRF-Token", token);

  return res.json({
    csrfToken: token,
    demoEnabled: isDemoAccountEnabled(),
    authenticated: type === "auth",
  });
}

/**
 * CSRF Protection Middleware for all state-mutating requests (POST, PUT, PATCH, DELETE).
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction) {
  // Safe HTTP methods never mutate state; exempted under RFC 7231
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const isProd = isProductionEnvironment();
  const enforceCsrf = isProd || process.env.CSRF_ENFORCE === "true";

  // Validate Origin header when present to reject untrusted cross-origin mutations
  const origin = req.headers.origin;
  if (origin && isProd) {
    const host = req.headers.host;
    const allowed = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    let originAllowed = false;
    if (host && (origin === `https://${host}` || origin === `http://${host}`)) {
      originAllowed = true;
    } else if (allowed.some((allowedOrigin) => origin === allowedOrigin)) {
      originAllowed = true;
    }

    if (!originAllowed) {
      return res.status(403).json({
        error: "CSRF_INVALID",
        message: "Untrusted cross-origin mutation request rejected.",
      });
    }
  }

  // Extract CSRF token from request header (case-insensitive)
  const token = (req.headers["x-csrf-token"] || req.headers["X-CSRF-Token"]) as string | undefined;

  const { contextId, type } = resolveContextId(req);

  // In production (or explicit test enforcement), CSRF token and context are mandatory
  if (enforceCsrf) {
    if (!token || !contextId) {
      return res.status(403).json({
        error: "CSRF_INVALID",
        message: "Your security session has expired. Please refresh and try again.",
      });
    }

    const isValid = verifyCsrfToken(token, contextId);
    if (!isValid) {
      return res.status(403).json({
        error: "CSRF_INVALID",
        message: "Your security session has expired. Please refresh and try again.",
      });
    }

    return next();
  }

  // In development / non-enforced test mode:
  if (token === "csrf-test-token") {
    return next();
  }

  // If a token was provided or a preauth/auth cookie is actively present, still validate it strictly
  if (token && contextId) {
    const isValid = verifyCsrfToken(token, contextId);
    if (!isValid) {
      return res.status(403).json({
        error: "CSRF_INVALID",
        message: "Your security session has expired. Please refresh and try again.",
      });
    }
  } else if (type === "preauth" && !token) {
    return res.status(403).json({
      error: "CSRF_INVALID",
      message: "Your security session has expired. Please refresh and try again.",
    });
  }

  next();
}
