import "./server/env";
import express from "express";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";
import apiRoutes from "./server/routes/api";
import { db } from "./server/db";
import { storageProvider } from "./server/services/storageProvider";

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

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Vite injects inline scripts/styles in dev
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. CORS configuration with credentials and trusted origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

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

  // Vite Middleware in Dev / Static Serving in Prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
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
