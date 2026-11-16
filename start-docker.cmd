@echo off
rem OmniPost - double-click to build and start the whole project in Docker
rem (database, Redis, API, worker, scheduler and web app). Only Docker Desktop is needed.
rem Stop it with the stop button on "omnipost" in Docker Desktop.
title OmniPost (Docker)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-up.ps1"
if %errorlevel%==0 (
    if defined WEB_PORT (start "" "http://localhost:%WEB_PORT%") else (start "" "http://localhost:4173")
)
echo.
pause
