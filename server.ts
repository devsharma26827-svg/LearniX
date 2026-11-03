import "./server/env";
import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { exec } from "child_process";
import apiRoutes from "./server/routes/api";
import { db } from "./server/db";
import { storageProvider } from "./server/services/storageProvider";
import { liveTranscriptionService } from "./server/services/liveTranscriptionService";

/**
 * Robust Client Dist Path Resolver
 * Accurately locates index.html whether running through:
 * 1. tsx server.ts (from repository root)
 * 2. node dist/server.cjs (bundled production binary inside dist/)
 * 3. Render cloud container deployment
 */
function resolveClientDist(): string {
  const candidates = [
    path.resolve(__dirname),
    path.resolve(__dirname, "..", "dist"),
    path.resolve(process.cwd(), "dist"),
    path.resolve(process.cwd()),
  ];

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, "index.html");
    if (fs.existsSync(indexPath)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "dist");
}

function openBrowser(url: string) {
  const startCmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(startCmd, (err) => {
    if (err) {
      console.log(`Could not automatically open browser: ${err.message}`);
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 4242;

  // Cloud & Reverse Proxy trust configuration (Render, Heroku, AWS ALB)
  app.set("trust proxy", 1);

  // Robust Production Detection:
  // True if:
  // 1. NODE_ENV === 'production'
  // 2. Render cloud platform environment (RENDER=true or RENDER_EXTERNAL_HOSTNAME)
  // 3. Executing from compiled production bundle (server.cjs / dist)
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    Boolean(process.env.RENDER_EXTERNAL_HOSTNAME) ||
    (typeof __filename !== "undefined" && (
      __filename.endsWith("server.cjs") ||
      __filename.includes("dist" + path.sep + "server.cjs") ||
      __filename.includes("/dist/") ||
      __filename.includes("\\dist\\")
    ));

  if (isProduction) {
    process.env.NODE_ENV = "production";
  }

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Vite injects inline scripts/styles in dev; safe SPA defaults
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. CORS configuration with credentials and trusted origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME.trim();
    allowedOrigins.push(`https://${renderHost}`);
    allowedOrigins.push(`http://${renderHost}`);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
          callback(null, true);
        } else {
          callback(new Error("Blocked by CORS policy"));
        }
      },
      credentials: true,
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API Health Checks (Liveness, Readiness, General)
  app.get("/api/health/live", (req, res) => {
    res.status(200).json({ status: "live", uptime: process.uptime() });
  });

  app.get("/api/health/ready", async (req, res) => {
    try {
      const dbHealth = await db.checkHealth();
      const storageDiag = storageProvider.getDiagnostics();
      const isReady = dbHealth.status === "healthy" && dbHealth.connected;
      const responsePayload = {
        status: isReady ? "ready" : "not_ready",
        database: {
          provider: dbHealth.provider,
          connected: dbHealth.connected,
          migrationVersion: dbHealth.migrationVersion,
          latencyMs: dbHealth.latencyMs,
        },
        storage: {
          provider: storageDiag.provider,
          configured: storageDiag.configured,
        },
      };
      return res.status(isReady ? 200 : 503).json(responsePayload);
    } catch (e: any) {
      return res.status(503).json({ status: "not_ready", error: e?.message || "Health check failed" });
    }
  });

  app.get("/api/health", async (req, res) => {
    const dbHealth = await db.checkHealth().catch(() => ({ status: "unhealthy", engine: "unknown", latencyMs: -1 }));
    res.json({
      status: dbHealth.status === "healthy" ? "ok" : "degraded",
      appName: "LearniX",
      tagline: "TURN EVERY LECTURE INTO INTELLIGENS",
      time: new Date().toISOString(),
      port: PORT,
      database: dbHealth,
      geminiKeyConfigured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      demoEnabled: process.env.ENABLE_DEMO_ACCOUNT === "true" || process.env.NODE_ENV !== "production",
    });
  });

  // API Routes
  app.use("/api", apiRoutes);

  // Catch-all for undefined /api routes: return JSON 404, never index.html
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      error: "API endpoint not found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  // Frontend Integration: Development (dynamic Vite dev middleware) vs Production (compiled static assets)
  if (!isProduction) {
    console.log("[LearniX] Starting in DEVELOPMENT mode with Vite dev middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const clientDist = resolveClientDist();
    const indexPath = path.join(clientDist, "index.html");

    if (fs.existsSync(indexPath)) {
      console.log(`[LearniX] Production mode active. Serving static frontend assets from: ${clientDist}`);
    } else {
      console.error(
        `[LearniX FATAL] Production frontend build not found at: ${clientDist}\n` +
        `Please ensure 'npm run build' was executed before starting the server in production.`
      );
    }

    // 1. Serve static files (assets, images, scripts) with caching
    app.use(
      express.static(clientDist, {
        index: false, // Prevent serving index.html on directory matches; let SPA fallback handle it
        maxAge: "1d",
      })
    );

    // 2. React Router SPA Fallback: All GET requests return index.html
    app.get("*", (req, res) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(500).send("Frontend build missing. Please run 'npm run build'.");
      }
    });

    // 3. Catch-all for non-GET non-API requests that didn't match any route
    app.use((req, res) => {
      res.status(404).json({
        error: "Resource not found",
        method: req.method,
        path: req.originalUrl,
      });
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://0.0.0.0:${PORT}`;
    console.log(`\n==================================================`);
    console.log(`  LearniX (EduPulse AI OS)`);
    console.log(`  App running successfully on unique port ${PORT}!`);
    console.log(`  - Local:   ${localUrl}`);
    console.log(`  - Network: ${networkUrl}`);
    console.log(`==================================================\n`);

    const shouldAutoOpen = process.env.AUTO_OPEN === "true" || process.argv.includes("--open");
    if (shouldAutoOpen) {
      console.log(`[Auto-Launcher] Opening browser at ${localUrl} ...\n`);
      openBrowser(localUrl);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    try {
      const pathname = new URL(request.url || "", `http://${request.headers.host || "localhost"}`).pathname;
      if (pathname === "/api/live-stream" || pathname === "/ws/live-stream") {
        liveTranscriptionService.handleUpgrade(request, socket, head);
      }
    } catch (e) {
      console.error("[WebSocket Upgrade Error]", e);
    }
  });

  const gracefulShutdown = () => {
    console.log("\n[LearniX] Shutting down gracefully...");
    server.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

startServer();
