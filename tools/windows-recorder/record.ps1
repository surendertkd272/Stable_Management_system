# EquiCare recorder for a Windows laptop left at the stable with the camera on
# its cable, when the Mac cannot be there and there is no network to the Mac.
# Started by START-RECORDING.bat (as administrator). It:
#   1. finds the laptop's wired port and gives it 192.168.50.10 (camera: .113)
#   2. checks the camera answers
#   3. keeps the laptop awake on mains power, lid closed = do nothing
#   4. asks for the camera password once (typed, never saved) and checks it
#      with ONE login - a wrong password stops here, it is not retried, since
#      failed logins count towards the camera's lockout
#   5. records the camera's streams the way the Mac's recorder does (copied,
#      not re-encoded; 10-minute clips named by local start time), so the Mac
#      can analyse them afterwards:
#        C:\EquiCare-recordings\thermal\     /media/live/202  (analysis)
#        C:\EquiCare-recordings\visible\     /media/live/102  (analysis)
#        C:\EquiCare-recordings\colour-hd\   /media/live/101  (to show; only
#                                            with 60 GB free or more)
#      and restarts a stream that stops (camera restart, cable knock).
# ffmpeg runs with -loglevel quiet: its error lines would carry the camera
# address with the password in it, and nothing here writes the password down.
# ASCII only: Windows PowerShell 5.1 reads a file without a BOM as ANSI.

$ErrorActionPreference = 'Continue'
$Camera = '192.168.50.113'
$Laptop = '192.168.50.10'
$User = 'admin'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Ffmpeg = Join-Path $Here 'ffmpeg.exe'
$Out = 'C:\EquiCare-recordings'
$Streams = [ordered]@{ 'thermal' = '/media/live/202'; 'visible' = '/media/live/102'; 'colour-hd' = '/media/live/101' }
$HdNeedsGB = 60

$Host.UI.RawUI.WindowTitle = 'EquiCare recorder'

# A click inside a console window pauses it ("Select" mode) until a key is
# pressed. Turn that off for this window so a click cannot stall the recorder.
try {
  Add-Type -Name Con -Namespace EquiCare -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr h, uint m);
'@
  $h = [EquiCare.Con]::GetStdHandle(-10); $m = [uint32]0
  if ([EquiCare.Con]::GetConsoleMode($h, [ref]$m)) { [void][EquiCare.Con]::SetConsoleMode($h, (($m -band (-bnot 0x40)) -bor 0x80)) }
} catch { }

function Say([string]$t) { Write-Host "  $t" }
function Stop-Here([string]$t) {
  Write-Host ''
  foreach ($line in $t -split "`n") { Write-Host "  $line" -ForegroundColor Yellow }
  Write-Host ''
  Write-Host '  What this laptop sees (send a photo of this window):'
  Get-NetAdapter -ErrorAction SilentlyContinue | Format-Table Name, Status, MediaType -AutoSize | Out-Host
  Read-Host '  Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host '  EquiCare recorder' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $Ffmpeg)) { Stop-Here "ffmpeg.exe is missing. Keep it in the same folder as this file:`n$Here" }

Say '1/5  Finding the wired network port...'
$wired = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
  Where-Object { $_.MediaType -eq '802.3' -and $_.PhysicalMediaType -notmatch 'Bluetooth|802\.11' })
$up = @($wired | Where-Object { $_.Status -eq 'Up' })
if ($wired.Count -eq 0) { Stop-Here "Windows sees no wired network port on this laptop.`nPlug in the USB network adapter, and the camera's cable into it." }
if ($up.Count -eq 0) { Stop-Here ("The wired port '" + $wired[0].Name + "' sees no cable.`nCheck the cable is pushed in firmly at both ends, and the camera has power.") }
$nic = $up[0]
Say ("     Found '" + $nic.Name + "', with a cable in.")

Say "2/5  Giving it the address $Laptop..."
$has = Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $Laptop }
if (-not $has) {
  Set-NetIPInterface -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -Dhcp Disabled -ErrorAction SilentlyContinue
  Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
  New-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -IPAddress $Laptop -PrefixLength 24 -ErrorAction SilentlyContinue | Out-Null
  Start-Sleep -Seconds 5
}

Say '3/5  Is the camera answering?'
$ok = Test-Connection -ComputerName $Camera -Count 2 -Quiet -ErrorAction SilentlyContinue
if (-not $ok) {
  # Some cameras ignore ping; the video port answering counts too.
  $t = New-Object System.Net.Sockets.TcpClient
  try { $ok = $t.ConnectAsync($Camera, 554).Wait(4000) } catch { $ok = $false } finally { $t.Close() }
}
if (-not $ok) { Stop-Here "The camera did not answer at $Camera.`nIf it was only just powered on, wait a minute and start again." }
Say '     Yes, the camera answers.'

Say '4/5  Keeping the laptop awake on mains power (lid closed = do nothing)...'
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg /setactive SCHEME_CURRENT

Say '5/5  The camera password'
Write-Host ''
$sec = Read-Host '     Type the camera password and press Enter (it is not saved)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if (-not $pw) { Stop-Here 'No password was typed. Start again and type the camera password.' }
$Cred = [uri]::EscapeDataString($User) + ':' + [uri]::EscapeDataString($pw)

function Url([string]$path) { "rtsp://$Cred@${Camera}:554$path" }
function Hide([string]$s) { $s.Replace($Cred, "$User`:***").Replace($pw, '***') }

# One short read of a stream: 'ok', 'password' (the camera refused it), or the
# reason, with the password taken out.
function Check-Stream([string]$path) {
  $o = & $Ffmpeg -nostdin -hide_banner -loglevel error -rtsp_transport tcp -timeout 8000000 -i (Url $path) -map 0:v:0 -c copy -t 2 -f null - 2>&1 | Out-String
  if ($o -match '401|[Uu]nauthori') { return 'password' }
  if ($LASTEXITCODE -ne 0) { return (Hide $o).Trim() }
  return 'ok'
}

Say '     Checking it with the camera (one try)...'
$why = Check-Stream $Streams['thermal']
if ($why -eq 'password') {
  Stop-Here "The camera did not accept that password.`nClose this window and start again, typing it carefully.`nDon't keep trying: the camera locks after several wrong passwords."
}
if ($why -ne 'ok') { Stop-Here ("The camera answered but its video did not start:`n" + $why) }
Say '     Password accepted.'

$freeGB = [math]::Floor((Get-PSDrive -Name C).Free / 1GB)
$active = @('thermal', 'visible')
if ($freeGB -ge $HdNeedsGB) { $active += 'colour-hd' }
else { Say "     Only $freeGB GB free on C: - recording thermal and colour, not the HD colour." }

foreach ($n in $active) { New-Item -ItemType Directory -Force -Path (Join-Path $Out $n) | Out-Null }

$procs = @{}
function Start-Rec([string]$n) {
  $pattern = Join-Path (Join-Path $Out $n) '%Y-%m-%dT%H-%M-%S.mp4'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Ffmpeg
  $psi.Arguments = '-nostdin -hide_banner -loglevel quiet -rtsp_transport tcp -timeout 8000000 ' +
    '-i "' + (Url $Streams[$n]) + '" -map 0:v:0 -c:v copy -tag:v hvc1 -an ' +
    '-f segment -segment_time 600 -segment_atclocktime 1 -reset_timestamps 1 -strftime 1 ' +
    '-segment_format mp4 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof ' +
    '"' + $pattern + '"'
  # Same console as this window: closing it or Ctrl+C stops ffmpeg too, and
  # Ctrl+C lets it finish the clip it is writing.
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $false
  $procs[$n] = [System.Diagnostics.Process]::Start($psi)
}

# A leftover recorder from an earlier start would hold the camera's streams.
Get-Process -Name ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Ffmpeg } | Stop-Process -Force -ErrorAction SilentlyContinue

foreach ($n in $active) { Start-Rec $n }

Write-Host ''
Write-Host '  RECORDING. Keep this window open and the laptop on its charger.' -ForegroundColor Green
Write-Host "  Saving to $Out"
Write-Host '  To stop: press Ctrl+C in this window, or close it.'
Write-Host ''

try {
  while ($true) {
    Start-Sleep -Seconds 30
    $parts = @()
    foreach ($n in $active) {
      $p = $procs[$n]
      if ($p.HasExited) {
        $why = Check-Stream $Streams[$n]
        if ($why -eq 'password') {
          foreach ($q in $procs.Values) { if (-not $q.HasExited) { $q.Kill() } }
          Stop-Here "The camera stopped accepting the password, so recording has stopped.`n(Was the password changed?) Start again with the current one."
        }
        Start-Rec $n
        $parts += "$n restarted"
        continue
      }
      $f = Get-ChildItem -Path (Join-Path $Out $n) -Filter *.mp4 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
      if ($f -and ((Get-Date) - $f.LastWriteTime).TotalSeconds -lt 90) { $parts += ("$n OK") }
      else { $parts += ("$n waiting") }
    }
    $freeGB = [math]::Floor((Get-PSDrive -Name C).Free / 1GB)
    Write-Host ("  " + (Get-Date -Format 'HH:mm') + "  " + ($parts -join ' | ') + "  | $freeGB GB free")
    if ($freeGB -lt 5) {
      foreach ($q in $procs.Values) { if (-not $q.HasExited) { $q.Kill() } }
      Stop-Here 'The disk is nearly full, so recording has stopped. What was recorded is kept.'
    }
  }
} finally {
  foreach ($q in $procs.Values) { if ($q -and -not $q.HasExited) { $q.Kill() } }
}
