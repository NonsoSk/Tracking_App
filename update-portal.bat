@echo off
setlocal
rem Updates the IEFCL Recruitment Portal to the latest version, then starts it.
rem Double-click this file. Your database, settings (.env), uploaded files and Python environment are kept.

rem The update replaces this file too, so run from a temporary copy.
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\iefcl-portal-update.bat" >nul
  call "%TEMP%\iefcl-portal-update.bat" --run "%~dp0"
  exit /b
)

set "PORTAL=%~2"
title Update IEFCL Recruitment Portal
cd /d "%PORTAL%"
if not exist "manage.py" goto notportal
if not exist ".venv\Scripts\python.exe" goto novenv

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if not errorlevel 1 goto running

set "URL=https://github.com/NonsoSk/Tracking_App/archive/refs/heads/claude/quirky-lovelace-sv5emz.zip"
set "WORK=%TEMP%\iefcl-portal-download"
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"

echo Downloading the latest version...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; if ([Net.WebRequest]::DefaultWebProxy) { [Net.WebRequest]::DefaultWebProxy.Credentials=[Net.CredentialCache]::DefaultNetworkCredentials }; $zip=Join-Path $env:WORK 'portal.zip'; Invoke-WebRequest -UseBasicParsing -Uri $env:URL -OutFile $zip; Expand-Archive -Path $zip -DestinationPath (Join-Path $env:WORK 'files') -Force"
if errorlevel 1 goto downloadfail

set "SRC="
for /d %%D in ("%WORK%\files\*") do set "SRC=%%D"
if not defined SRC goto badzip
if not exist "%SRC%\manage.py" goto badzip

echo Copying the new code. Your database, settings, uploads and Python environment are kept...
robocopy "%SRC%" "%PORTAL%." /E /XD .venv media /XF db.sqlite3 .env /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copyfail
rmdir /s /q "%WORK%"

echo Checking Python packages...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 echo Some packages could not be installed. The portal may still work; if not, send a screenshot of this window.

echo.
echo Updated. Starting the portal...
call "%PORTAL%start-portal.bat"
exit /b 0

:notportal
echo This file must sit in the portal folder, next to manage.py.
pause
exit /b 1

:novenv
echo Set up the portal once first: follow "Quick start" in README.md, then run this again.
pause
exit /b 1

:running
echo The portal is still running. Close its black window first, then double-click this file again.
pause
exit /b 1

:downloadfail
echo The download did not work. Check your internet connection, then try again. Nothing was changed.
pause
exit /b 1

:badzip
echo The download did not look right. Nothing was changed. Please try again later.
pause
exit /b 1

:copyfail
echo Copying the new files failed. Make sure no file in the portal folder is open, then try again.
pause
exit /b 1
