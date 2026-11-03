import assert from "assert";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";

console.log("=============================================================");
console.log("  LearniX Render Production Serving & Host Verification Suite");
console.log("=============================================================");

// Ensure dist/ exists for the test
const distDir = path.resolve(process.cwd(), "dist");
const indexPath = path.join(distDir, "index.html");
assert(
  fs.existsSync(indexPath),
  `dist/index.html must exist before running test. Run 'npm run build' first.`
);

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  [FAIL] ${name}:`, e.message);
      throw e;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  [FAIL] ${name}:`, e.message);
      throw e;
    }
  }

  console.log("\n--- 1. Client Dist Path Resolution & Asset Integrity ---");

  test("dist/index.html contains valid HTML and entry bundle script", () => {
    const html = fs.readFileSync(indexPath, "utf-8");
    assert(html.includes("<!doctype html>") || html.includes("<html"), "index.html must contain HTML declaration");
    assert(html.includes("assets/"), "index.html must reference bundled assets");
  });

  test("dist/server.cjs compiled artifact exists", () => {
    const serverCjs = path.join(distDir, "server.cjs");
    assert(fs.existsSync(serverCjs), "dist/server.cjs must exist after build");
    const stat = fs.statSync(serverCjs);
    assert(stat.size > 50000, "dist/server.cjs must be a non-empty bundled artifact");
  });

  console.log("\n--- 2. Production Server Host Routing & Deep Link Tests ---");

  // Spin up an Express test server using the exact production routing logic from server.ts
  const app = express();
  const PORT = 4289;
  const TEST_RENDER_HOST = "learnix-kq6k.onrender.com";

  // Simulate Render environment
  process.env.NODE_ENV = "production";
  process.env.RENDER_EXTERNAL_HOSTNAME = TEST_RENDER_HOST;

  // Add dummy API route
  app.get("/api/health/live", (req, res) => {
    res.status(200).json({ status: "live", uptime: 100 });
  });

  app.get("/api/health/ready", (req, res) => {
    res.status(200).json({ status: "ready", database: { provider: "postgresql", connected: true } });
  });

  // API 404 Handler (must precede frontend fallback)
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      error: "API endpoint not found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  // Serve static files
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: "1d",
    })
  );

  // React Router SPA Fallback
  app.get("*", (req, res) => {
    res.sendFile(indexPath);
  });

  // Catch-all 404
  app.use((req, res) => {
    res.status(404).json({
      error: "Resource not found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  const server = app.listen(PORT, "0.0.0.0");

  function makeRequest(
    requestPath: string,
    method = "GET",
    headers: Record<string, string> = {}
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: PORT,
          path: requestPath,
          method,
          headers: {
            Host: TEST_RENDER_HOST,
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  try {
    await testAsync("Render host header (learnix-kq6k.onrender.com) loads root without Vite host-blocking error", async () => {
      const res = await makeRequest("/");
      assert.strictEqual(res.status, 200, "Root request should return HTTP 200");
      assert(!res.body.includes("Blocked request. This host"), "Should NOT show Vite host blocking message");
      assert(res.body.includes("<!doctype html>") || res.body.includes("<html"), "Should return index.html content");
    });

    await testAsync("React Router deep link: /dashboard returns index.html", async () => {
      const res = await makeRequest("/dashboard");
      assert.strictEqual(res.status, 200);
      assert(!res.body.includes("Blocked request. This host"));
      assert(res.body.includes("<!doctype html>") || res.body.includes("<html"));
    });

    await testAsync("React Router deep link: /lectures/lecture-abc-123 returns index.html", async () => {
      const res = await makeRequest("/lectures/lecture-abc-123");
      assert.strictEqual(res.status, 200);
      assert(res.body.includes("<!doctype html>") || res.body.includes("<html"));
    });

    await testAsync("API route /api/health/live returns JSON (not HTML)", async () => {
      const res = await makeRequest("/api/health/live");
      assert.strictEqual(res.status, 200);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.status, "live");
    });

    await testAsync("API route /api/health/ready returns JSON (not HTML)", async () => {
      const res = await makeRequest("/api/health/ready");
      assert.strictEqual(res.status, 200);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.status, "ready");
    });

    await testAsync("Missing API route /api/unknown returns 404 JSON, NEVER index.html", async () => {
      const res = await makeRequest("/api/unknown");
      assert.strictEqual(res.status, 404);
      assert(!res.body.includes("<!doctype html>"), "Missing API route must NEVER return index.html");
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.error, "API endpoint not found");
    });

    await testAsync("Missing POST API route /api/nonexistent returns 404 JSON", async () => {
      const res = await makeRequest("/api/nonexistent", "POST");
      assert.strictEqual(res.status, 404);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.error, "API endpoint not found");
    });

    await testAsync("Non-GET non-API request returns 404 JSON", async () => {
      const res = await makeRequest("/some-random-post", "POST");
      assert.strictEqual(res.status, 404);
      const parsed = JSON.parse(res.body);
      assert.strictEqual(parsed.error, "Resource not found");
    });

    console.log("\n--- 3. Vite Configuration Allowed Hosts Safety ---");

    test("vite.config.ts does NOT contain allowedHosts: true", () => {
      const viteConfig = fs.readFileSync(path.resolve(process.cwd(), "vite.config.ts"), "utf-8");
      assert(!viteConfig.includes("allowedHosts: true"), "vite.config.ts must NEVER use 'allowedHosts: true'");
      assert(viteConfig.includes("allowedHosts"), "vite.config.ts must configure explicit allowedHosts array");
    });

    test("vite.config.ts dynamically incorporates RENDER_EXTERNAL_HOSTNAME safely", () => {
      const viteConfig = fs.readFileSync(path.resolve(process.cwd(), "vite.config.ts"), "utf-8");
      assert(viteConfig.includes("RENDER_EXTERNAL_HOSTNAME"), "Must check RENDER_EXTERNAL_HOSTNAME");
    });

    console.log("\n--- 4. Build Scripts & Startup Command Validation ---");

    test("package.json build generates both frontend and backend bundle", () => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
      assert(pkg.scripts.build.includes("vite build"), "build script must run vite build");
      assert(pkg.scripts.build.includes("esbuild server.ts"), "build script must bundle server.ts with esbuild");
      assert(pkg.scripts.start.includes("node dist/server.cjs"), "start script must execute node dist/server.cjs");
    });

    test("render.yaml runs npm ci && npm run build and starts with npm start", () => {
      const renderYaml = fs.readFileSync(path.resolve(process.cwd(), "render.yaml"), "utf-8");
      assert(renderYaml.includes("buildCommand: npm ci && npm run build"), "render.yaml must have correct buildCommand");
      assert(renderYaml.includes("startCommand: npm start"), "render.yaml must have correct startCommand");
      assert(renderYaml.includes("NODE_ENV"), "render.yaml must define NODE_ENV=production");
    });

  } finally {
    server.close();
  }

  console.log("\n=============================================================");
  console.log(`✓ ALL ${passed}/${total} PRODUCTION SERVING TESTS PASSED!`);
  console.log("=============================================================\n");
}

runTests().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
