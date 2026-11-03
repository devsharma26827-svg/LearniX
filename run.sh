#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "========================================================"
echo "  LearniX - EduPulse AI OS Launcher"
echo "========================================================"
echo ""

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check .env
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "[INFO] Creating .env from .env.example..."
    cp .env.example .env
fi

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo "[INFO] First-time setup: installing dependencies..."
    npm install
fi

export AUTO_OPEN=true
npm run dev
