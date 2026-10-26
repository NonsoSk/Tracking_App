@echo off
setlocal
rem Links your recruitment workbooks so the portal refreshes itself whenever they are saved in Excel.
rem Double-click this file, or drag any number of Excel files onto it. Run it again later to add more files:
rem the files already linked stay linked.
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
echo  each time one is saved, the portal loads the changes a few minutes later.
echo    - new rows are added, rows you edit are updated, nothing is duplicated
echo    - nothing you did in the portal is undone, and rows deleted in Excel stay in the portal
echo.
echo  Pick the files where the team keeps working on them (for example a synced OneDrive or
echo  SharePoint folder), not a copy in Downloads. Close the portal window before you continue.
echo.
set FILES=
set COUNT=0
:args
if "%~1"=="" goto :first
set FILES=%FILES% "%~1"
set /a COUNT+=1
shift
goto :args

:first
if %COUNT% GTR 0 goto :link
call :pick ONE "Choose a recruitment workbook (for example the Recruitment Master workbook)"
if not defined ONE goto :cancelled
set FILES="%ONE%"
set COUNT=1
echo    1. "%ONE%"

:more
set "ANSWER="
set /p "ANSWER= Add another workbook (for example the CV file)? Type Y and press Enter, or just press Enter to finish: "
if /i not "%ANSWER%"=="Y" goto :link
call :pick ONE "Choose the next workbook"
if not defined ONE goto :more
set FILES=%FILES% "%ONE%"
set /a COUNT+=1
echo    %COUNT%. "%ONE%"
goto :more

:link
echo.
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" manage.py sync_workbooks --link %FILES%
if errorlevel 1 goto :failed
echo.
echo  Linked. From now on start-portal.bat also opens a small "Excel link" window that checks
echo  the files every few minutes. Keep it open (minimised) while you use the portal.
echo  You can see each file and when it was last loaded in the portal under Excel link.
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
