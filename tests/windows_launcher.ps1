$ErrorActionPreference = 'Stop'
$isolated = Join-Path ([IO.Path]::GetTempPath()) ('Security Lab 테스트 ' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $isolated | Out-Null
$expectedVersion = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$exe = Join-Path $isolated ('SecurityLab-v' + $expectedVersion + '-Windows-x64.exe')
Copy-Item (Resolve-Path 'dist/SecurityLab.exe') $exe
$first = $null
$second = $null
$originalGameUrl = $env:GAME_URL

function Start-IsolatedGame($diagnostic) {
  return (Start-Process -FilePath $exe -WorkingDirectory $isolated -ArgumentList @('--diagnostics', "`"$diagnostic`"", '--no-browser') -PassThru)
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
  if ($startup.version -ne $expectedVersion) { throw 'Executable version mismatch' }
  if ((Test-Path (Join-Path $isolated 'src')) -or (Test-Path (Join-Path $isolated 'index.html'))) { throw 'Game source found next to executable' }
  foreach ($name in $startup.assets.PSObject.Properties.Name) {
    $response = Invoke-WebRequest ($startup.url.Replace('localhost', '127.0.0.1') + '/' + $name) -TimeoutSec 5 -NoProxy -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "Asset failed: $name" }
  }
  $secondDiagnostic = Join-Path $isolated 'second-startup.json'
  $second = Start-IsolatedGame $secondDiagnostic
  $other = Wait-ForGame $secondDiagnostic
  if ($other.url -eq $startup.url) { throw 'Two launchers shared the same port' }
  taskkill /PID $second.Id /T /F | Out-Null
  $second = $null
  $env:GAME_URL = $startup.url
  npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Standalone launcher browser tests failed' }
  Write-Output 'Standalone EXE assets, separate instance ports, and browser game verified.'
} finally {
  $env:GAME_URL = $originalGameUrl
  foreach ($process in @($second, $first)) {
    if ($null -ne $process) { taskkill /PID $process.Id /T /F | Out-Null }
  }
  Remove-Item $isolated -Recurse -Force -ErrorAction SilentlyContinue
}
