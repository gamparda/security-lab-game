$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath (Resolve-Path 'dist/SecurityLab.exe') -PassThru
try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $response = Invoke-WebRequest 'http://localhost:5173' -TimeoutSec 1
      $window = Get-Process -Name SecurityLab -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Security Lab' }
      if ($response.StatusCode -eq 200 -and $window) {
        $ready = $true
        break
      }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Packaged launcher window and local game server did not become ready.' }
  Write-Output 'Packaged Windows GUI and local game server started successfully.'
} finally {
  taskkill /PID $process.Id /T /F | Out-Null
}
