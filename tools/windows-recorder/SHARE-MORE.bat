@echo off
rem EquiCare: three more sharing windows (ports 8766-8768), so the Mac can copy
rem four clips at once over a slow Wi-Fi. SHARE-RECORDINGS.bat keeps port 8765.
fltmc >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
for %%P in (8766 8767 8768) do start "EquiCare share %%P" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share2.ps1" -Port %%P
