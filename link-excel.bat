@echo off
setlocal
rem Links your recruitment workbooks so the portal refreshes itself whenever you save them in Excel.
rem Double-click this file, or drag the Excel files onto it. Run it again to link different files.
title Link Excel workbooks to the IEFCL Recruitment Portal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
if not exist ".venv\Scripts\python.exe" (
  echo Could not find the .venv folder here. Do the "Quick start" steps in README.md once, then try again.
  pause
  exit /b 1
)
echo.
echo  LINK YOUR EXCEL WORKBOOKS
echo  =========================
echo  While the team still works in Excel, the portal can follow your workbooks:
echo  each time you save one, the portal loads the changes a few minutes later.
echo    - new rows are added, rows you edit are updated, nothing is duplicated
echo    - nothing you did in the portal is undone, and rows deleted in Excel stay in the portal
echo.
echo  Use the files where you keep working on them (for example your OneDrive or shared folder),
echo  not a copy in Downloads.
echo.
set "FILE1=%~1"
set "FILE2=%~2"
if not defined FILE1 call :pick FILE1 "Choose the Recruitment Master workbook"
if not defined FILE1 goto :cancelled
if not defined FILE2 (
  set "ANSWER="
  set /p "ANSWER= Also follow the CV file (CV Dump)? Type Y and press Enter, or just press Enter to skip: "
)
if not defined FILE2 if /i "%ANSWER%"=="Y" call :pick FILE2 "Choose the CV file (CV Dump)"
echo.
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 goto :failed
if defined FILE2 (
  ".venv\Scripts\python.exe" manage.py sync_workbooks --link "%FILE1%" "%FILE2%"
) else (
  ".venv\Scripts\python.exe" manage.py sync_workbooks --link "%FILE1%"
)
if errorlevel 1 goto :failed
echo.
echo  Linked. From now on start-portal.bat also opens a small "Excel link" window that checks
echo  the files every few minutes. Keep it open (minimised) while you use the portal.
echo  You can see the state in the portal under Excel link.
pause
exit /b 0

:failed
echo.
echo  The files were not linked. Read the message above.
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
