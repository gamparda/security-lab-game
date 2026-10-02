$ErrorActionPreference = 'Stop'
$diagnostic = Join-Path (Get-Location) 'test-results/launcher-startup.json'
New-Item -ItemType Directory -Force 'test-results' | Out-Null
Remove-Item $diagnostic -ErrorAction SilentlyContinue
$process = Start-Process -FilePath (Resolve-Path 'dist/SecurityLab.exe') -ArgumentList @('--diagnostics', "`"$diagnostic`"", '--no-browser') -PassThru
try {
  $ready = $false
  $lastError = ''
  for ($i = 0; $i -lt 30; $i++) {
    try {
      if (-not (Test-Path $diagnostic)) { Start-Sleep -Milliseconds 500; continue }
      $startup = Get-Content $diagnostic -Raw | ConvertFrom-Json
      if ($startup.PSObject.Properties.Name -contains 'error') { throw $startup.error }
      $testUrl = $startup.url.Replace('localhost', '127.0.0.1')
      $response = Invoke-WebRequest $testUrl -TimeoutSec 2 -NoProxy -UseBasicParsing
      if ($response.StatusCode -eq 200 -and $startup.windowVisible) {
        $ready = $true
        break
      }
    } catch {
      $lastError = $_.Exception.Message
      if ($i -lt 3) { Write-Output $lastError }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    if (Test-Path $diagnostic) { Get-Content $diagnostic }
    Write-Output $lastError
    Get-Process -Name SecurityLab -ErrorAction SilentlyContinue | Format-List Id,MainWindowTitle
    throw 'Packaged launcher window and local game server did not become ready.'
  }
  Write-Output 'Packaged Windows GUI and local game server started successfully.'
} finally {
  taskkill /PID $process.Id /T /F | Out-Null
}
