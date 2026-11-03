import assert from "assert";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";

const TEST_DIR = path.join(process.cwd(), ".data_test_auth_prod");
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const TEST_DB = path.join(TEST_DIR, "auth_prod.sqlite");
process.env.SQLITE_DB_PATH = TEST_DB;
process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_ACCOUNT = "true";

async function runAuthProductionSuite() {
  console.log("==================================================");
  console.log("  LEARNIX PRODUCTION AUTHENTICATION & SECURITY   ");
  console.log("==================================================");

  const { db } = await import("../server/db");
  const { default: apiRouter } = await import("../server/routes/api");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number; address: string };
  const BASE_URL = `http://127.0.0.1:${address.port}`;
  console.log(`[Setup] Production auth test server running at ${BASE_URL}`);

  try {
    // -------------------------------------------------------------------------
    // Test 1: User Registration with Strong Password
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] User registration with password hashing...");
    const regEmail = "jane.student@learnix.edu";
    const regPassword = "SecurePassword@2026";

    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Student",
        email: regEmail,
        password: regPassword,
        college: "Harvard University",
        course: "Computer Science",
      }),
    });

    assert.strictEqual(regRes.status, 201, "Registration must return 201 Created");
    const regData = (await regRes.json()) as any;
    assert(regData.user, "Registration response must include user");
    assert.strictEqual(regData.user.email, regEmail);
    assert(!regData.user.passwordHash, "Response MUST NEVER leak passwordHash");
    assert(regData.token, "Registration must return an active session token");

    // Check Set-Cookie header
    const cookieHeader = regRes.headers.get("set-cookie");
    assert(cookieHeader, "Registration must set session cookie");
    assert(cookieHeader.includes("learnix_session="), "Cookie must be learnix_session");
    assert(cookieHeader.toLowerCase().includes("httponly"), "Cookie must have HttpOnly attribute");

    // Verify stored in SQLite with bcrypt hash
    const authRecord = db.getUserAuthByEmail(regEmail);
    assert(authRecord, "User must exist in SQLite database");
    assert(authRecord.password_hash.startsWith("$2"), "Password must be bcrypt hashed ($2a/$2b)");
    assert(authRecord.password_hash !== regPassword, "Plaintext password must never be stored");
    console.log("✓ Test 1 Passed: Registration created user with bcrypt hash and HttpOnly session.");

    // -------------------------------------------------------------------------
    // Test 2: Duplicate Email Rejection (409 Conflict)
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Duplicate email registration prevention...");
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Imposter",
        email: regEmail,
        password: "AnotherPassword123!",
      }),
    });
    assert.strictEqual(dupRes.status, 409, "Duplicate email registration must return 409 Conflict");
    console.log("✓ Test 2 Passed: Duplicate email registration blocked with HTTP 409.");

    // -------------------------------------------------------------------------
    // Test 3: Password Validation Rules
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Password complexity and validation rules...");
    const shortPassRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Weak Pass",
        email: "weak@learnix.edu",
        password: "short",
      }),
    });
    assert.strictEqual(shortPassRes.status, 400, "Short password (< 8 chars) must return 400");
    console.log("✓ Test 3 Passed: Password length rules strictly enforced (< 8 chars rejected).");

    // -------------------------------------------------------------------------
    // Test 4: Login with Incorrect Password (401)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Login rejection on wrong password...");
    const wrongLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        password: "WrongPassword999!",
      }),
    });
    assert.strictEqual(wrongLoginRes.status, 401, "Invalid password must return 401 Unauthorized");
    console.log("✓ Test 4 Passed: Wrong password rejected with HTTP 401.");

    // -------------------------------------------------------------------------
    // Test 5: Login with Correct Password
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Successful login with valid password...");
    const validLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        password: regPassword,
      }),
    });
    assert.strictEqual(validLoginRes.status, 200, "Valid login must return 200 OK");
    const loginData = (await validLoginRes.json()) as any;
    assert(loginData.token, "Login must return session token");
    const sessionToken = loginData.token;

    // Verify session stored in SQLite sessions table
    const validatedUser = db.validateSession(sessionToken);
    assert(validatedUser, "Session token must resolve to valid user in database");
    assert.strictEqual(validatedUser.email, regEmail);
    console.log("✓ Test 5 Passed: Login succeeded, returned genuine session token stored in SQLite.");

    // -------------------------------------------------------------------------
    // Test 6: Authenticated /api/me via Bearer Token & Cookie
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] /api/me identity verification via session token...");
    const meResBearer = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(meResBearer.status, 200, "Bearer token must access /api/me");
    const meDataBearer = (await meResBearer.json()) as any;
    assert.strictEqual(meDataBearer.user.email, regEmail);

    const meResCookie = await fetch(`${BASE_URL}/api/me`, {
      headers: { Cookie: `learnix_session=${sessionToken}` },
    });
    assert.strictEqual(meResCookie.status, 200, "Cookie must access /api/me");
    const meDataCookie = (await meResCookie.json()) as any;
    assert.strictEqual(meDataCookie.user.email, regEmail);
    console.log("✓ Test 6 Passed: /api/me verifies identity via both Bearer header and HttpOnly cookie.");

    // -------------------------------------------------------------------------
    // Test 7: Logout and Session Revocation
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Logout and session invalidation...");
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(logoutRes.status, 200, "Logout must return 200 OK");

    // After logout, same session token must be rejected with 401
    const postLogoutMe = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(postLogoutMe.status, 401, "Revoked session token must return 401 Unauthorized");
    console.log("✓ Test 7 Passed: Logout revoked session in SQLite; subsequent requests rejected with 401.");

    // -------------------------------------------------------------------------
    // Test 8: Password Reset Flow
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] Password reset request and consumption...");
    const forgotRes = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: regEmail }),
    });
    assert.strictEqual(forgotRes.status, 200);
    const forgotData = (await forgotRes.json()) as any;
    const resetToken = forgotData.debugToken;
    assert(resetToken, "Debug reset token must be provided in test environment");

    const newPassword = "BrandNewPassword2026!";
    const resetRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: resetToken,
        newPassword,
      }),
    });
    assert.strictEqual(resetRes.status, 200, "Reset password must return 200 OK");

    // Login with new password
    const newLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        password: newPassword,
      }),
    });
    assert.strictEqual(newLoginRes.status, 200, "Login with updated password must succeed");

    // Login with old password must now fail
    const oldLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: regEmail,
        password: regPassword,
      }),
    });
    assert.strictEqual(oldLoginRes.status, 401, "Old password must be invalidated");
    console.log("✓ Test 8 Passed: Password reset token consumed, updated hash, old password invalidated.");

    // -------------------------------------------------------------------------
    // Test 9: Brute-Force Rate Limiting
    // -------------------------------------------------------------------------
    console.log("\n[Test 9] Brute force protection on login attempts...");
    const bruteEmail = "brute.target@learnix.edu";
    // Register target user
    await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Target", email: bruteEmail, password: "TargetPassword123!" }),
    });

    // Make multiple failed attempts
    let wasRateLimited = false;
    for (let i = 0; i < 7; i++) {
      const failRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: bruteEmail, password: "WrongGuess" }),
      });
      if (failRes.status === 429) {
        wasRateLimited = true;
        break;
      }
    }
    assert(wasRateLimited, "Repeated failed login attempts must trigger HTTP 429 Too Many Requests");
    console.log("✓ Test 9 Passed: Rate limiting triggers HTTP 429 after repeated invalid credentials.");

    console.log("\n==================================================");
    console.log("  ALL PRODUCTION AUTHENTICATION TESTS PASSED!     ");
    console.log("==================================================");
  } finally {
    server.close();
    db.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

runAuthProductionSuite().catch((err) => {
  console.error("Auth Production Test Suite Failed:", err);
  process.exit(1);
});
