@echo off
rem EquiCare: pass the stall camera on this laptop's cable on to the EquiCare Mac
rem over Tailscale, so the Mac's Live page, temperatures and analysis reach it.
rem
rem   Double-click this file and click Yes when Windows asks.
rem   To take it all out again: run it from an admin Command Prompt with "undo".
rem
rem It gives the laptop's wired port the address 192.168.50.10 (the camera is
rem 192.168.50.113), then passes the camera's video (RTSP 554) on at port 8554
rem and its web API (80) at 8080. Only the Mac's Tailscale address may use them;
rem the camera still asks for its password. Nothing here stores or asks for it.

set CAMERA=192.168.50.113
set LAPTOP=192.168.50.10
set MAC=100.109.6.122

rem Not an administrator yet: ask Windows (the "allow changes?" box) and run again.
rem fltmc, not "net session", which also fails for administrators when the
rem Server service is off.
fltmc >nul 2>&1
if errorlevel 1 (
  echo  Asking Windows for permission - click Yes in the box that appears.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if errorlevel 1 (
    echo.
    echo  Windows did not give permission. Run the file again and click Yes.
    echo.
    pause
  )
  exit /b
)

netsh interface portproxy delete v4tov4 listenport=8554 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=8080 listenaddress=0.0.0.0 >nul 2>&1
netsh advfirewall firewall delete rule name="EquiCare camera" >nul 2>&1
if /i "%~1"=="undo" goto undo

echo.
echo  Please don't click inside this window - that pauses it.
echo.
echo  1/5  Finding this laptop's wired network port...
rem "netsh interface show interface" lines: Admin State, State, Type, Interface Name.
rem Wired ports are "Ethernet", "Ethernet 2"...; the leading space skips "vEthernet".
set WIRED=
set SEEN=
for /f "tokens=1,2,3,*" %%a in ('netsh interface show interface ^| findstr /c:" Ethernet"') do (
  set "SEEN=%%d"
  if /i "%%b"=="Connected" set "WIRED=%%d"
)
if not defined WIRED (
  if defined SEEN (
    echo       The wired port "%SEEN%" sees no cable.
    echo       Check the cable is pushed in firmly at both ends, and the camera has power.
  ) else (
    echo       Windows sees no wired network port on this laptop.
    echo       Plug in the USB network adapter, and the camera's cable into it.
  )
  goto fail
)
echo       Found "%WIRED%", with a cable in.

echo  2/5  Giving it the address %LAPTOP%...
netsh interface ipv4 set address name="%WIRED%" static %LAPTOP% 255.255.255.0 >nul 2>&1
ping -n 5 127.0.0.1 >nul

echo  3/5  Is the camera answering?
rem Ping first; some cameras ignore ping, so its web page counts too.
set UP=
ping -n 2 %CAMERA% | find "TTL=" >nul && set UP=1
if not defined UP curl.exe -s -m 5 -o nul http://%CAMERA%/ >nul 2>&1 && set UP=1
if not defined UP (
  echo       The camera did not answer at %CAMERA%.
  echo       If it was only just powered on, wait a minute and run this file again.
  goto fail
)
echo       Yes, the camera answers.

echo  4/5  Passing the camera on to the Mac (%MAC%) only...
sc config iphlpsvc start= auto >nul
net start iphlpsvc >nul 2>&1
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8554 connectaddress=%CAMERA% connectport=554
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8080 connectaddress=%CAMERA% connectport=80
netsh advfirewall firewall add rule name="EquiCare camera" dir=in action=allow protocol=TCP localport=8554,8080 remoteip=%MAC% >nul

echo  5/5  Keeping the laptop awake on mains power (lid closed = do nothing)...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT

echo.
netsh interface portproxy show v4tov4
echo  All done. You should see 8554 and 8080 in the list above.
echo  Keep the laptop plugged in to power. You can close this window.
echo.
pause
exit /b 0

:fail
echo.
echo  What this laptop sees (send a photo of this window):
netsh interface show interface
echo.
pause
exit /b 1

:undo
for /f "tokens=1,2,3,*" %%a in ('netsh interface show interface ^| findstr /c:" Ethernet"') do (
  netsh interface ipv4 show address name="%%d" | find "%LAPTOP%" >nul && netsh interface ipv4 set address name="%%d" source=dhcp >nul
)
echo.
echo  Removed: the camera is no longer passed on, and the wired port is back to automatic.
echo.
pause
exit /b 0
