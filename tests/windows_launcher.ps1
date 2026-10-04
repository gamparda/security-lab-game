$ErrorActionPreference = 'Stop'
$isolated = Join-Path ([IO.Path]::GetTempPath()) ('Security Lab 테스트 ' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $isolated | Out-Null
$expectedVersion = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$exe = Join-Path $isolated ('SecurityLab-v' + $expectedVersion + '-Windows-x64.exe')
Copy-Item (Resolve-Path 'dist/SecurityLab.exe') $exe
$first = $null
$second = $null
$originalGameUrl = $env:GAME_URL
$stateDir = Join-Path $isolated 'settings'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$blocker = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5173)
$blocker.Start()

function Start-IsolatedGame($diagnostic) {
  return (Start-Process -FilePath $exe -WorkingDirectory $isolated -ArgumentList @('--diagnostics', "`"$diagnostic`"", '--no-browser', '--state-dir', "`"$stateDir`"") -PassThru)
}

function Wait-ForGame($diagnostic) {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $diagnostic) {
      try { $startup = Get-Content $diagnostic -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 200; continue }
      if ($startup.PSObject.Properties.Name -contains 'error') { throw ($startup | ConvertTo-Json -Depth 5) }
      if ($startup.assetsReady -and $startup.windowVisible -and $startup.bundled) {
        if ($startup.assets.PSObject.Properties.Value -contains $false) { throw 'Bundled asset missing' }
        return $startup
      }
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'Standalone game startup timed out'
}

try {
  $diagnostic = Join-Path $isolated 'startup.json'
  $first = Start-IsolatedGame $diagnostic
  $startup = Wait-ForGame $diagnostic
  if (-not $startup.portChanged -or $startup.url -eq 'http://localhost:5173') { throw 'Foreign port was reused or change was not reported' }
  $blocker.Stop()
  if ($startup.version -ne $expectedVersion) { throw 'Executable version mismatch' }
  if ((Test-Path (Join-Path $isolated 'src')) -or (Test-Path (Join-Path $isolated 'index.html'))) { throw 'Game source found next to executable' }
  foreach ($name in $startup.assets.PSObject.Properties.Name) {
    $response = Invoke-WebRequest ($startup.url.Replace('localhost', '127.0.0.1') + '/' + $name) -TimeoutSec 5 -NoProxy -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "Asset failed: $name" }
  }
  $secondDiagnostic = Join-Path $isolated 'second-startup.json'
  $second = Start-IsolatedGame $secondDiagnostic
  $other = Wait-ForGame $secondDiagnostic
  if ($other.url -ne $startup.url -or -not $other.reused -or $other.pid -ne $startup.pid) { throw 'Second launcher did not reuse the owned instance' }
  if (-not $second.WaitForExit(10000)) { throw 'Second launcher did not exit after reuse' }
  $second = $null
  $env:GAME_URL = $startup.url
  npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Standalone launcher browser tests failed' }
  $savedPort = (Get-Content (Join-Path $stateDir 'settings.json') -Raw | ConvertFrom-Json).port
  if ($startup.url -ne ('http://localhost:' + $savedPort)) { throw 'Last port was not retained' }
  Write-Output 'Standalone EXE assets, single instance, foreign port fallback, saved port, and browser game verified.'
} finally {
  $blocker.Stop()
  $env:GAME_URL = $originalGameUrl
  foreach ($process in @($second, $first)) {
    if ($null -ne $process) { taskkill /PID $process.Id /T /F | Out-Null }
  }
  Remove-Item $isolated -Recurse -Force -ErrorAction SilentlyContinue
}
