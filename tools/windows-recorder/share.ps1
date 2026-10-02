# EquiCare: let the Mac copy this laptop's recordings over Tailscale
# (tools/fetch_recordings.py on the Mac). Started by SHARE-RECORDINGS.bat as
# administrator. Read-only, C:\EquiCare-recordings only (clip names only, no
# other path), and only for the Mac's Tailscale address: a firewall rule that
# lives as long as this window. Ctrl+C or closing the window stops it.
# ASCII only: Windows PowerShell 5.1 reads a file without a BOM as ANSI.

param([int]$Port = 8765)
$ErrorActionPreference = 'Continue'
$Root = 'C:\EquiCare-recordings'
$Mac = '100.109.6.122'
$Rule = "EquiCare recordings share $Port"
$Clip = '^(thermal|visible|colour-hd)/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.mp4$'

$Host.UI.RawUI.WindowTitle = "EquiCare - sharing recordings with the Mac (port $Port)"
try {
  Add-Type -Name Con -Namespace EquiCare -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr h, uint m);
'@
  $h = [EquiCare.Con]::GetStdHandle(-10); $m = [uint32]0
  if ([EquiCare.Con]::GetConsoleMode($h, [ref]$m)) { [void][EquiCare.Con]::SetConsoleMode($h, (($m -band (-bnot 0x40)) -bor 0x80)) }
} catch { }

Write-Host ''
if (-not (Test-Path $Root)) {
  Write-Host "  There is no $Root on this laptop - nothing was recorded here." -ForegroundColor Yellow
  Read-Host '  Press Enter to close'
  exit 1
}
$n = @(Get-ChildItem -Path $Root -Recurse -Filter *.mp4 -ErrorAction SilentlyContinue).Count
$gb = [math]::Round(((Get-ChildItem -Path $Root -Recurse -Filter *.mp4 -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1GB, 1)
if (Get-Process -Name ffmpeg -ErrorAction SilentlyContinue) {
  Write-Host '  The recorder is still running. Stop it first (Ctrl+C in its window), then start this again.' -ForegroundColor Yellow
  Read-Host '  Press Enter to close'
  exit 1
}

& netsh advfirewall firewall delete rule name="$Rule" | Out-Null
& netsh advfirewall firewall add rule name="$Rule" dir=in action=allow protocol=TCP localport=$Port remoteip=$Mac | Out-Null
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://+:$Port/")
try { $l.Start() } catch {
  Write-Host "  Could not start sharing: $($_.Exception.Message)" -ForegroundColor Yellow
  & netsh advfirewall firewall delete rule name="$Rule" | Out-Null
  Read-Host '  Press Enter to close'
  exit 1
}

Write-Host "  SHARING $n clips ($gb GB) with the Mac." -ForegroundColor Green
Write-Host '  Leave this window open, and the laptop on the same Wi-Fi as the Mac,'
Write-Host '  until the Mac says it has copied everything. Then close this window.'
Write-Host ''

try {
  while ($l.IsListening) {
    $ar = $l.BeginGetContext($null, $null)
    while (-not $ar.AsyncWaitHandle.WaitOne(500)) { }
    $ctx = $l.EndGetContext($ar)
    $res = $ctx.Response
    try {
      $p = [uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($p -eq 'list') {
        $items = @(foreach ($d in 'thermal', 'visible', 'colour-hd') {
          Get-ChildItem -Path (Join-Path $Root $d) -Filter *.mp4 -ErrorAction SilentlyContinue |
            ForEach-Object { [pscustomobject]@{ path = "$d/$($_.Name)"; size = $_.Length } }
        })
        $json = if ($items.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $items -Compress }
        $body = [Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = 'application/json'
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
      } elseif ($p -match $Clip) {
        $f = Join-Path $Root ($p -replace '/', '\')
        $fs = [IO.File]::Open($f, 'Open', 'Read', 'ReadWrite')
        try {
          $res.ContentType = 'video/mp4'
          $res.ContentLength64 = $fs.Length
          $fs.CopyTo($res.OutputStream)
        } finally { $fs.Close() }
        Write-Host ("  " + (Get-Date -Format 'HH:mm') + "  sent $p")
      } else {
        $res.StatusCode = 404
      }
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  $l.Stop()
  & netsh advfirewall firewall delete rule name="$Rule" | Out-Null
}
