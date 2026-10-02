@echo off
rem Starts the IEFCL Recruitment Portal on this PC and opens it in your browser.
rem Double-click this file. Keep this window open while you use the portal; close it to stop.
title IEFCL Recruitment Portal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Could not find the .venv folder here. Do the "Quick start" steps in README.md once, then try again.
  pause
  exit /b 1
)
echo Updating the database after any code changes...
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 (
  pause
  exit /b 1
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:8000/'"
echo.
echo The portal is running at http://127.0.0.1:8000/  (close this window to stop it)
".venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000
pause
