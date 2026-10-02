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
rem Opens the browser only once the portal is answering (waits up to 2 minutes).
start "" powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 120; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8000); $c.Close(); break } catch { Start-Sleep -Seconds 1 } }; Start-Process 'http://127.0.0.1:8000/'"
echo.
echo Starting the portal. Your browser opens at http://127.0.0.1:8000/ as soon as it is ready.
echo Keep this window open while you use the portal; close it to stop.
".venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000
pause
