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
rem Use the folder this file sits in if the portal is set up there; otherwise the usual place, %USERPROFILE%\portal
if exist "%PORTAL%.venv\Scripts\python.exe" goto found
if exist "%USERPROFILE%\portal\.venv\Scripts\python.exe" goto useprofile
goto novenv
:useprofile
set "PORTAL=%USERPROFILE%\portal\"
echo Updating your portal in %PORTAL%
:found
cd /d "%PORTAL%"
if not exist "manage.py" goto notportal

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
rem Remove screens and styles the new version no longer has (only the templates and static folders; your data is never there)
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($d in 'templates','static') { $old = Join-Path $env:PORTAL $d; $new = Join-Path $env:SRC $d; if ((Test-Path -LiteralPath $old) -and (Test-Path -LiteralPath $new)) { Get-ChildItem -LiteralPath $old -Recurse -File | ForEach-Object { $rel = $_.FullName.Substring($old.Length); if (-not (Test-Path -LiteralPath (Join-Path $new $rel))) { Remove-Item -LiteralPath $_.FullName -Force } }; Get-ChildItem -LiteralPath $old -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | Remove-Item -Force } }" >nul 2>&1
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
echo Could not find your portal folder, the one that contains the .venv folder.
echo Put this file in that folder, usually C:\Users\%USERNAME%\portal, and double-click it there.
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
