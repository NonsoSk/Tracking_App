@echo off
setlocal
rem Saves every applicant's resume from the website into their folder in the portal, as a PDF.
rem Double-click this file. It can take an hour or more the first time; you can close the window at any
rem time and double-click again later: it carries on where it stopped. Keep the PC connected to the internet.
title Save resumes into the IEFCL Recruitment Portal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
if not exist ".venv\Scripts\python.exe" (
  echo Could not find the .venv folder here. Do the "Quick start" steps in README.md once, then try again.
  pause
  exit /b 1
)
echo.
echo  SAVE RESUMES FROM THE WEBSITE
echo  =============================
echo  Each applicant's resume is downloaded from the link in the applications dump and filed
echo  in their folder as a PDF, so it opens straight on their page in the portal.
echo    - Word files and photos are turned into PDF (Microsoft Word is used if it is installed)
echo    - a resume already in the folder is not added again
echo    - names, contacts and dates of birth are never changed; only empty skills and experience are filled
echo.
echo  You can keep using the portal while this runs.
echo.
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" manage.py fetch_resumes
if errorlevel 1 goto :failed
echo.
echo  Finished for now. The report (which resumes could not be saved, and why) is in the
echo  import-reports folder, which opens now. Links that failed are tried again from the next day.
if exist "import-reports" start "" "import-reports"
pause
exit /b 0

:failed
echo.
echo  Something went wrong. Read the message above. Run this again to carry on.
pause
exit /b 1
