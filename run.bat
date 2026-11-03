@echo off
setlocal EnableDelayedExpansion
title LearniX - EduPulse AI OS

:: Navigate to script directory
cd /d "%~dp0"

echo ========================================================
echo   LearniX - EduPulse AI OS Launcher
echo ========================================================
echo.

:: 1. Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not found in PATH!
    echo Please download and install Node.js [v18 or newer] from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. Check for .env / .env.local
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Creating .env from .env.example...
        copy .env.example .env >nul
    )
)

:: 3. Check for node_modules and install if missing
if not exist "node_modules\" (
    echo [INFO] First-time setup detected. Installing dependencies...
    echo This may take a minute, please wait...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Please check your internet connection.
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: 4. Detect Port
set PORT=4242
if exist ".env.local" (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env.local") do (
        if "%%A"=="PORT" set PORT=%%B
    )
) else if exist ".env" (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
        if "%%A"=="PORT" set PORT=%%B
    )
)
set PORT=%PORT:"=%
set PORT=%PORT: =%
if "%PORT%"=="" set PORT=4242

echo [INFO] Launching server on unique port: %PORT%
echo [INFO] Your default web browser will open automatically at:
echo        http://localhost:%PORT%
echo.
echo Press Ctrl+C in this window anytime to stop the server.
echo ========================================================
echo.

:: Enable auto-opening in server.ts
set AUTO_OPEN=true

:: Run the app
call npm run dev

if %errorlevel% neq 0 (
    echo.
    echo [INFO] Server stopped.
    pause
)
