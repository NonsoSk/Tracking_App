@echo off
setlocal
rem Loads your two recruitment workbooks into the portal, replacing everything in it (demo data included).
rem Double-click this file, or drag both Excel files onto it.
title Load recruitment workbooks into the IEFCL Recruitment Portal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
if not exist ".venv\Scripts\python.exe" (
  echo Could not find the .venv folder here. Do the "Quick start" steps in README.md once, then try again.
  pause
  exit /b 1
)
echo.
echo  LOAD YOUR RECRUITMENT WORKBOOKS
echo  ===============================
echo  This puts the records from your two workbooks into the portal:
echo    1. the CV file (CV Dump sheet)
echo    2. the Recruitment Master workbook (requisitions, interview records, CBT results, staff list)
echo.
echo  Everything now in the portal is removed first, including all demo data and demo sign-ins,
echo  so the portal holds only the records in these two workbooks. A backup copy is made first.
echo.
echo  Close the portal window (start-portal) before you continue.
echo.
set "FILE1=%~1"
set "FILE2=%~2"
if not defined FILE1 call :pick FILE1 "Choose the CV file (CV Dump)"
if not defined FILE1 goto :cancelled
if not defined FILE2 call :pick FILE2 "Now choose the Recruitment Master workbook"
if not defined FILE2 goto :cancelled
echo  Files:
echo    %FILE1%
echo    %FILE2%
echo.
set "ANSWER="
set /p "ANSWER= Type YES and press Enter to replace everything in the portal with these workbooks: "
if /i not "%ANSWER%"=="YES" goto :cancelled

for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"`) do set "STAMP=%%T"
if exist "db.sqlite3" (
  if not exist "backups" mkdir "backups"
  copy /y "db.sqlite3" "backups\db-before-import-%STAMP%.sqlite3" >nul
  if errorlevel 1 (
    echo Could not make a backup of db.sqlite3. Is the portal still running? Close it and try again.
    pause
    exit /b 1
  )
  echo  Backup saved: backups\db-before-import-%STAMP%.sqlite3
)
echo.
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" manage.py import_workbooks "%FILE1%" "%FILE2%" --replace
if errorlevel 1 goto :failed
echo.
echo  Done. Start the portal with start-portal.bat and sign in with your own account.
echo  The import report (values that could not be used, shared contacts, merged duplicates)
echo  is in the import-reports folder, which opens now.
if exist "import-reports" start "" "import-reports"
pause
exit /b 0

:failed
echo.
echo  The import did not finish, so nothing was changed. Read the message above.
echo  Your previous database is also saved in the backups folder.
pause
exit /b 1

:cancelled
echo.
echo  Cancelled. Nothing was changed.
pause
exit /b 1

:pick
set "%~1="
for /f "usebackq delims=" %%F in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = '%~2'; $d.Filter = 'Excel workbooks (*.xlsx)|*.xlsx'; $d.InitialDirectory = [Environment]::GetFolderPath('MyDocuments'); if ($d.ShowDialog($o) -eq 'OK') { $d.FileName }"`) do set "%~1=%%F"
exit /b 0
