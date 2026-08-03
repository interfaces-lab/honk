@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude-fast-wrapper.ps1" %*
exit /b %ERRORLEVEL%
