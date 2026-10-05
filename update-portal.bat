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
set "SELF=%~f0"
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

set "BRANCH=claude/quirky-lovelace-sv5emz"
set "URL=https://github.com/NonsoSk/Tracking_App/archive/refs/heads/claude/quirky-lovelace-sv5emz.zip"
set "WORK=%TEMP%\iefcl-portal-download"
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"

rem Fetch and unpack the latest code (the steps are in the PowerShell part at the end of this file)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath $env:SELF -Raw; $m = '#PS-' + 'START#'; Invoke-Expression $s.Substring($s.IndexOf($m) + $m.Length)"
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
echo Nothing was changed. Send a screenshot of this window if it keeps happening.
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

rem ===== PowerShell part: everything below is run by PowerShell, never by this batch file =====
#PS-START#
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$zip = Join-Path $env:WORK 'portal.zip'
$prefix = 'Tracking_App-' + ($env:BRANCH -replace '/', '-')

function Get-Downloads {
  if ($env:IEFCL_DOWNLOADS) { return $env:IEFCL_DOWNLOADS }
  try { $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path; if ($p) { return $p } } catch { }
  return (Join-Path $env:USERPROFILE 'Downloads')
}
function Find-Zip([datetime]$since) {
  # Only a finished download: not empty, no browser part-file beside it, and no longer growing
  $dir = Get-Downloads
  $file = Get-ChildItem -LiteralPath $dir -Filter ($prefix + '*.zip') -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $since -and $_.Length -gt 0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { return $null }
  if ((Test-Path -LiteralPath ($file.FullName + '.part')) -or (Get-ChildItem -LiteralPath $dir -Filter '*.crdownload' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddSeconds(-10) })) { return $null }
  $size = $file.Length; Start-Sleep -Seconds 1; $file.Refresh()
  if ($file.Length -ne $size) { return $null }
  return $file
}

try {
  # 1. Direct download. This only works while the repository is public, so a refusal here is expected.
  Write-Host 'Downloading the latest version...'
  $direct = $false
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ([Net.WebRequest]::DefaultWebProxy) { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
    Invoke-WebRequest -UseBasicParsing -Uri $env:URL -OutFile $zip
    $direct = $true
  } catch { }

  if (-not $direct) {
    # 2. The code is private on GitHub, so the browser (where you are signed in) downloads it.
    #    A copy downloaded in the last 30 minutes is used straight away.
    $found = Find-Zip ((Get-Date).AddMinutes(-30))
    if (-not $found) {
      $since = (Get-Date).AddSeconds(-5)
      Write-Host ''
      Write-Host 'The code is private on GitHub, so your browser will download it for you.'
      Write-Host 'If the browser asks, choose Save or Keep. You must be signed in to GitHub there.'
      try { Start-Process $env:URL } catch { Write-Host ('Open this link in your browser: ' + $env:URL) }
      Write-Host 'Waiting for the download to finish (up to 5 minutes)...'
      $deadline = (Get-Date).AddMinutes(5)
      while (-not $found -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2; $found = Find-Zip $since }
      if (-not $found) {
        Write-Host ''
        Write-Host 'The download did not arrive in your Downloads folder.'
        Write-Host 'If the browser showed "404" or "Page not found", sign in to github.com in that browser, then double-click this file again.'
        exit 1
      }
      Start-Sleep -Seconds 2
    }
    Write-Host ('Using ' + $found.Name + ' from your Downloads folder.')
    Copy-Item -LiteralPath $found.FullName -Destination $zip -Force
  }

  Expand-Archive -Path $zip -DestinationPath (Join-Path $env:WORK 'files') -Force
  exit 0
} catch {
  Write-Host ''
  Write-Host ('The download did not work: ' + $_.Exception.Message)
  exit 1
}
