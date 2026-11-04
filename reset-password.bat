@echo off
setlocal
rem Shows the portal's sign-in accounts and sets a new password for one.
rem If there is no account yet, it creates your HR Admin account instead.
title Reset a password - IEFCL Recruitment Portal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
if not exist ".venv\Scripts\python.exe" (
  echo Could not find the .venv folder here. Do the "Quick start" steps in README.md once, then try again.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" manage.py migrate --noinput >nul
".venv\Scripts\python.exe" manage.py reset_password
echo.
pause
