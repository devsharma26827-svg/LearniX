import dotenv from "dotenv";
import path from "path";

// 1. Load default .env file
dotenv.config();

// 2. Load optional .env.local with override for local developer overrides
dotenv.config({ path: ".env.local", override: true });

// 3. Production Environment & Cloud Detection:
// - Explicit NODE_ENV === 'production'
// - Render cloud platform environment (RENDER=true or RENDER_EXTERNAL_HOSTNAME present)
// - Running from compiled bundle (dist/server.cjs)
const isCompiledBundle = typeof __filename !== "undefined" && (
  __filename.endsWith("server.cjs") ||
  __filename.includes("dist" + path.sep + "server.cjs") ||
  __filename.includes("/dist/") ||
  __filename.includes("\\dist\\")
);

const isRenderCloud = process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_HOSTNAME);

if (isCompiledBundle || isRenderCloud) {
  process.env.NODE_ENV = "production";
} else if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

// 4. Eagerly initialize and harmonize AI configuration so process.env is normalized
// before any other service or client evaluates.
import { initializeAiConfig } from "./config/aiConfig";
initializeAiConfig();

