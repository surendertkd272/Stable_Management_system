@echo off
rem EquiCare recorder: double-click, click Yes when Windows asks.
rem Runs record.ps1 (next to this file) as administrator; ffmpeg.exe must be here too.
fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0record.ps1"
