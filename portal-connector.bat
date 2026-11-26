@echo off
rem Sends new and changed files from folders on this PC to the recruitment portal (see tools\portal_connector.py).
rem Keep this window open (it can stay minimised). The first run asks for the portal address and the PC's key.
title Portal connector - IEFCL Recruitment Portal
cd /d "%~dp0"
set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe
if exist "tools\portal_connector.py" (%PY% tools\portal_connector.py %*) else (%PY% portal_connector.py %*)
pause
