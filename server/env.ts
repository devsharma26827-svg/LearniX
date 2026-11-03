import dotenv from "dotenv";

// 1. Load default .env file
dotenv.config();

// 2. Load optional .env.local with override for local developer overrides
dotenv.config({ path: ".env.local", override: true });

// 3. Eagerly initialize and harmonize AI configuration so process.env is normalized
// before any other service or client evaluates.
import { initializeAiConfig } from "./config/aiConfig";
initializeAiConfig();
