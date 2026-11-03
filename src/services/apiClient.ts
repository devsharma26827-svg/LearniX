/**
 * LearniX Centralized API Client
 * Enforces Synchronized Session-Bound CSRF Tokens, Secure HttpOnly Credentials,
 * Automatic Bearer Token Attachment, and Resilient Single-Attempt Token Refresh.
 */

let inMemoryCsrfToken: string | null = null;
let bootstrapPromise: Promise<{ csrfToken: string; demoEnabled: boolean; authenticated: boolean } | null> | null = null;

export function setCsrfToken(token: string | null) {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

/**
 * Bootstraps or refreshes the CSRF security context from /api/auth/csrf.
 */
export async function bootstrapCsrf(
  forceRefresh = false
): Promise<{ csrfToken: string; demoEnabled: boolean; authenticated: boolean } | null> {
  if (inMemoryCsrfToken && !forceRefresh) {
    return { csrfToken: inMemoryCsrfToken, demoEnabled: true, authenticated: false };
  }

  if (bootstrapPromise && !forceRefresh) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    try {
      const res = await fetch("/api/auth/csrf", {
        method: "GET",
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          inMemoryCsrfToken = data.csrfToken;
        }
        return {
          csrfToken: data.csrfToken || "",
          demoEnabled: Boolean(data.demoEnabled),
          authenticated: Boolean(data.authenticated),
        };
      }
    } catch (err) {
      console.warn("[CSRF Client] Failed to bootstrap CSRF context:", err);
    } finally {
      bootstrapPromise = null;
    }
    return null;
  })();

  return bootstrapPromise;
}

/**
 * Universal apiFetch wrapper replacing raw window.fetch across the frontend.
 * Guarantees X-CSRF-Token on all state-mutating requests, credentials: 'include',
 * Bearer fallback authentication, and automated single-attempt retry on expired CSRF tokens.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const headers = new Headers(init.headers || {});

  // 1. Attach Bearer token from localStorage when available
  const storedToken = localStorage.getItem("learnix_token");
  if (storedToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedToken}`);
  }

  // 2. Attach X-CSRF-Token on state-mutating requests
  if (isMutating) {
    if (!inMemoryCsrfToken) {
      const context = await bootstrapCsrf();
      if (context?.csrfToken) {
        inMemoryCsrfToken = context.csrfToken;
      }
    }

    if (inMemoryCsrfToken) {
      headers.set("X-CSRF-Token", inMemoryCsrfToken);
    }
  }

  const effectiveInit: RequestInit = {
    ...init,
    headers,
    credentials: init.credentials || "include",
  };

  let response = await fetch(input, effectiveInit);

  // 3. Inspect response for rotated CSRF token
  const rotatedHeader = response.headers.get("X-CSRF-Token");
  if (rotatedHeader) {
    inMemoryCsrfToken = rotatedHeader;
  }

  // 4. If 403 CSRF_INVALID, refresh token and retry exactly once
  if (response.status === 403 && isMutating) {
    const clone = response.clone();
    try {
      const errJson = await clone.json();
      if (errJson?.error === "CSRF_INVALID") {
        console.warn("[CSRF Client] CSRF token invalid or expired. Refreshing context and retrying once...");
        const refreshed = await bootstrapCsrf(true);
        if (refreshed?.csrfToken) {
          inMemoryCsrfToken = refreshed.csrfToken;
          const retryHeaders = new Headers(init.headers || {});
          if (storedToken && !retryHeaders.has("Authorization")) {
            retryHeaders.set("Authorization", `Bearer ${storedToken}`);
          }
          retryHeaders.set("X-CSRF-Token", refreshed.csrfToken);

          response = await fetch(input, {
            ...init,
            headers: retryHeaders,
            credentials: init.credentials || "include",
          });

          const secondRotated = response.headers.get("X-CSRF-Token");
          if (secondRotated) {
            inMemoryCsrfToken = secondRotated;
          }
        }
      }
    } catch {
      // Non-JSON response, keep original response
    }
  }

  return response;
}
