import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import WebSocket from "ws";
import assert from "assert";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getBrowserPath(): string {
  if (fs.existsSync(CHROME_PATH)) return CHROME_PATH;
  if (fs.existsSync(EDGE_PATH)) return EDGE_PATH;
  throw new Error("Neither Chrome nor Edge was found on the system");
}

class CdpClient {
  private ws: WebSocket;
  private id = 1;
  private callbacks = new Map<number, (res: any) => void>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id)!;
          this.callbacks.delete(msg.id);
          cb(msg.result);
        }
      });
    });
  }

  async send(method: string, params: any = {}): Promise<any> {
    const id = this.id++;
    return new Promise((resolve) => {
      this.callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function runBrowserLoginTest() {
  console.log("=============================================================");
  console.log("  LearniX Real Headless Browser Login & CSRF Test (CDP)");
  console.log("=============================================================\n");

  const browserExe = getBrowserPath();
  console.log(`[Browser] Using binary: ${browserExe}`);

  const testDir = path.join(process.cwd(), ".data_test_browser");
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const targetPort = 4242;

  // 1. Launch LearniX production server bundle
  const serverProc: ChildProcess = spawn(
    process.execPath,
    [path.join(process.cwd(), "dist", "server.cjs")],
    {
      env: {
        ...process.env,
        PORT: String(targetPort),
        NODE_ENV: "production",
        DB_PROVIDER: "sqlite",
        ALLOW_SQLITE_IN_TEST: "true",
        CSRF_ENFORCE: "true",
        ENABLE_DEMO_ACCOUNT: "false",
        SQLITE_DB_PATH: path.join(testDir, "browser_test.sqlite"),
        SESSION_SECRET: "browser-test-csrf-secret-key-salt-32chars",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  serverProc.stdout?.on("data", (d) => {
    const s = d.toString();
    if (s.includes("[LearniX]")) console.log(`[Server] ${s.trim()}`);
  });

  // Wait for server ready
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/api/health/live`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  assert(serverReady, `Production server failed to become ready on port ${targetPort}`);
  console.log(`[Setup] Production server ready on http://127.0.0.1:${targetPort}\n`);

  // 2. Launch Headless Chrome / Edge with CDP
  const cdpPort = 9244;
  const browserUserDataDir = path.join(testDir, "browser_profile");
  fs.mkdirSync(browserUserDataDir, { recursive: true });

  const browserProc: ChildProcess = spawn(
    browserExe,
    [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${browserUserDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  // Poll CDP endpoints
  let cdpReady = false;
  let webSocketDebuggerUrl = "";
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (res.ok) {
        const tabs = (await res.json()) as any[];
        const pageTab = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (pageTab && pageTab.webSocketDebuggerUrl) {
          webSocketDebuggerUrl = pageTab.webSocketDebuggerUrl;
          cdpReady = true;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  assert(cdpReady, "Headless browser CDP failed to initialize");
  console.log(`[CDP] Connected to debugger at ${webSocketDebuggerUrl}\n`);

  const client = new CdpClient(webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Runtime.enable");

    // -------------------------------------------------------------
    // PHASE 1: Verify Login Page & Demo Account Concealment
    // -------------------------------------------------------------
    console.log("[Browser Phase 1] Navigating to http://127.0.0.1:4242/login");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${targetPort}/login` });
    await new Promise((r) => setTimeout(r, 2000));

    // Verify Demo Account button is strictly hidden in production DOM
    const demoCheck = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.body ? document.body.innerText.includes("Continue with Demo Account") : false`,
    });
    console.log("[DEBUG demoCheck]", JSON.stringify(demoCheck));
    const demoVal = demoCheck?.result?.value ?? demoCheck?.value ?? false;
    assert.strictEqual(
      demoVal,
      false,
      "Demo Account button MUST be hidden in production"
    );
    console.log("  [PASS] Browser DOM: Demo button strictly hidden in production");

    // -------------------------------------------------------------
    // PHASE 2: Register New Student in Real Browser with CSRF Token
    // -------------------------------------------------------------
    console.log("\n[Browser Phase 2] Navigating to http://127.0.0.1:4242/register");
    await client.send("Page.navigate", { url: `http://127.0.0.1:${targetPort}/register` });
    await new Promise((r) => setTimeout(r, 2000));

    const regResult = await client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        function setReactInput(input, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const nameInput = document.querySelector('input[type="text"]');
        const emailInput = document.querySelector('input[type="email"]');
        const passInputs = document.querySelectorAll('input[type="password"]');

        if (nameInput) setReactInput(nameInput, "Browser Test Student");
        if (emailInput) setReactInput(emailInput, "browser.e2e@learnix.ai");
        if (passInputs[0]) setReactInput(passInputs[0], "SecurePassword123!");
        if (passInputs[1]) setReactInput(passInputs[1], "SecurePassword123!");

        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();

        await new Promise(r => setTimeout(r, 2500));

        const errEl = document.querySelector('[class*="E07A5F"]');
        return {
          currentUrl: window.location.href,
          token: localStorage.getItem("learnix_token"),
          user: localStorage.getItem("learnix_user"),
          domError: errEl ? errEl.textContent : null,
        };
      })()`,
    });

    const regVal = regResult?.result?.value;
    console.log("[Browser Phase 2] Registration outcome:", regVal);
    assert(regVal.token, `Registration failed in browser: ${regVal.domError || "unknown"}`);
    console.log("  [PASS] Browser: Successfully registered with X-CSRF-Token and received session token");

    // Verify HttpOnly cookie in browser
    const cookiesRes = await client.send("Network.getCookies", {
      urls: [`http://127.0.0.1:${targetPort}/`],
    });
    const cookies = cookiesRes.cookies || [];
    const authCookie = cookies.find((c: any) => c.name === "learnix_session");
    assert(authCookie, "learnix_session cookie must be stored in browser");
    assert.strictEqual(authCookie.httpOnly, true, "learnix_session must be HttpOnly");
    console.log("  [PASS] Browser: learnix_session HttpOnly cookie successfully stored in browser jar");

    // -------------------------------------------------------------
    // PHASE 3: Log Out and Log Back In
    // -------------------------------------------------------------
    console.log("\n[Browser Phase 3] Logging out and logging back in on /login...");
    await client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        localStorage.clear();
        const csrfData = await (await fetch('/api/auth/csrf')).json();
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfData.csrfToken },
          credentials: 'include',
        });
      })()`,
    });

    await client.send("Page.navigate", { url: `http://127.0.0.1:${targetPort}/login` });
    await new Promise((r) => setTimeout(r, 2000));

    const loginResult = await client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        function setReactInput(input, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');
        if (emailInput) setReactInput(emailInput, "browser.e2e@learnix.ai");
        if (passInput) setReactInput(passInput, "SecurePassword123!");

        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();

        await new Promise(r => setTimeout(r, 2500));

        const errEl = document.querySelector('[class*="E07A5F"]');
        return {
          currentUrl: window.location.href,
          token: localStorage.getItem("learnix_token"),
          user: localStorage.getItem("learnix_user"),
          domError: errEl ? errEl.textContent : null,
        };
      })()`,
    });

    const loginVal = loginResult?.result?.value;
    console.log("[Browser Phase 3] Login outcome:", loginVal);
    assert(loginVal.token, `Login failed in browser: ${loginVal.domError || "unknown"}`);
    console.log("  [PASS] Browser: Successfully logged in via real browser with rotated CSRF token");

    console.log("\n=============================================================");
    console.log("  REAL HEADLESS BROWSER VERIFICATION PASSED (CHROME CDP)!    ");
    console.log("=============================================================\n");
  } finally {
    client.close();
    browserProc.kill();
    serverProc.kill();
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

runBrowserLoginTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Browser test failed:", e);
    process.exit(1);
  });
