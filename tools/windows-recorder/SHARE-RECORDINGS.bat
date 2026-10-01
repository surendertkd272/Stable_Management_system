@echo off
rem EquiCare: share the recordings with the Mac (stop the recorder first).
rem Double-click, click Yes when Windows asks. Close the window when the Mac is done.
fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share.ps1"
