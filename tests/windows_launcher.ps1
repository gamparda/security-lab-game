$ErrorActionPreference = 'Stop'
$diagnostic = Join-Path (Get-Location) 'test-results/launcher-startup.json'
New-Item -ItemType Directory -Force 'test-results' | Out-Null
Remove-Item $diagnostic -ErrorAction SilentlyContinue
$process = Start-Process -FilePath (Resolve-Path 'dist/SecurityLab.exe') -ArgumentList @('--diagnostics', "`"$diagnostic`"", '--no-browser') -PassThru
try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      if (-not (Test-Path $diagnostic)) { Start-Sleep -Milliseconds 500; continue }
      $startup = Get-Content $diagnostic -Raw | ConvertFrom-Json
      if ($startup.error) { throw $startup.error }
      $response = Invoke-WebRequest $startup.url -TimeoutSec 1
      if ($response.StatusCode -eq 200 -and $startup.windowVisible) {
        $ready = $true
        break
      }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    if (Test-Path $diagnostic) { Get-Content $diagnostic }
    Get-Process -Name SecurityLab -ErrorAction SilentlyContinue | Format-List Id,MainWindowTitle
    throw 'Packaged launcher window and local game server did not become ready.'
  }
  Write-Output 'Packaged Windows GUI and local game server started successfully.'
} finally {
  taskkill /PID $process.Id /T /F | Out-Null
}
