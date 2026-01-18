@echo off
REM Get Channel ID Script - Interactive helper for Windows
REM Usage: get-channel-id.bat

cls
echo.
echo ========================================
echo   Telegram Channel ID Finder
echo ========================================
echo.

setlocal enabledelayedexpansion

REM Check if argument provided
if "%1"=="" (
    set /p channel="Enter your channel ID or @username: "
) else (
    set channel=%1
)

if "!channel!"=="" (
    echo Error: No channel provided
    exit /b 1
)

echo.
echo Discovering channel ID for: !channel!
echo.
echo Running: node get-channel-id.js !channel!
echo.

node get-channel-id.js !channel!

pause
