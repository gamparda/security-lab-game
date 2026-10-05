$ErrorActionPreference = 'Stop'
$isolated = Join-Path ([IO.Path]::GetTempPath()) ('Security Lab 테스트 ' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $isolated | Out-Null
$expectedVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$exe = Join-Path $isolated ('SecurityLab-v' + $expectedVersion + '-Windows-x64.exe')
Copy-Item (Resolve-Path 'dist/SecurityLab.exe') $exe
$first = $null
$second = $null
$conflict = $null
$originalGameUrl = $env:GAME_URL
$stateDir = Join-Path $isolated 'settings'
New-Item -ItemType Directory -Force $stateDir | Out-Null
$blocker = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5173)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SecurityLabWindow {
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr handle);
}
'@

function Start-IsolatedGame($diagnostic) {
  return (Start-Process -FilePath $exe -WorkingDirectory $isolated -ArgumentList @('--diagnostics', "`"$diagnostic`"", '--no-browser', '--state-dir', "`"$stateDir`"") -PassThru)
}

function Wait-ForGame($diagnostic) {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $diagnostic) {
      try { $startup = Get-Content -LiteralPath $diagnostic -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 200; continue }
      if ($startup.PSObject.Properties.Name -contains 'error') { throw ($startup | ConvertTo-Json -Depth 5) }
      if ($startup.assetsReady -and $startup.windowVisible -and $startup.bundled) {
        if (-not $startup.requiredAssetsReady -or -not $startup.sceneAssetsReady) { throw 'Required or optional 3D assets missing from standalone build' }
        if ($startup.assets.PSObject.Properties.Value -contains $false) { throw 'Bundled asset missing' }
        return $startup
      }
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'Standalone game startup timed out'
}

function Assert-VisibleGameWindow($startup) {
  $owner = Get-Process -Id $startup.pid -ErrorAction Stop
  $owner.Refresh()
  if ($owner.MainWindowHandle -eq [IntPtr]::Zero -or -not [SecurityLabWindow]::IsWindowVisible($owner.MainWindowHandle) -or [SecurityLabWindow]::IsIconic($owner.MainWindowHandle)) {
    throw 'Standalone launcher has no visible, restored native window'
  }
  if ($owner.MainWindowTitle -ne ('Security Lab v' + $expectedVersion)) { throw 'Unexpected standalone launcher window title' }
}

try {
  try { $blocker.Start() }
  catch {
    # A pre-existing listener is also foreign to this isolated state directory.
    if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) { throw }
    $blocker = $null
  }
  $diagnostic = Join-Path $isolated 'startup.json'
  $first = Start-IsolatedGame $diagnostic
  $startup = Wait-ForGame $diagnostic
  if (-not $startup.portChanged -or $startup.url -eq 'http://localhost:5173') { throw 'Foreign port was reused or change was not reported' }
  if ($null -ne $blocker) { $blocker.Stop() }
  if ($startup.version -ne $expectedVersion) { throw 'Executable version mismatch' }
  Assert-VisibleGameWindow $startup
  foreach ($source in @('src', 'assets', 'vendor', 'node_modules', 'index.html', 'package.json')) {
    if (Test-Path -LiteralPath (Join-Path $isolated $source)) { throw "Game source found next to executable: $source" }
  }
  if ($startup.assets.PSObject.Properties.Name -notcontains 'assets/models/security_lab.glb') { throw 'Bundled model was not included in startup asset verification' }
  foreach ($name in @('index.html','src/scene3d.js','assets/models/security_lab.glb','assets/environment/city-sunset.png')) {
    $response = Invoke-WebRequest ($startup.url.Replace('localhost', '127.0.0.1') + '/' + $name) -Method Head -TimeoutSec 5 -NoProxy -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "Asset failed: $name" }
    if ($name -eq 'assets/models/security_lab.glb' -and ($response.Headers['Content-Type'] -notlike 'model/gltf-binary*' -or [long]$response.Headers['Content-Length'][0] -lt 1000000)) { throw 'Bundled GLB model response is incomplete or has the wrong MIME type' }
  }
  $secondDiagnostic = Join-Path $isolated 'second-startup.json'
  $second = Start-IsolatedGame $secondDiagnostic
  $other = Wait-ForGame $secondDiagnostic
  if ($other.url -ne $startup.url -or -not $other.reused -or $other.pid -ne $startup.pid) { throw 'Second launcher did not reuse the owned instance' }
  if (-not $second.WaitForExit(10000)) { throw 'Second launcher did not exit after reuse' }
  $second = $null
  Assert-VisibleGameWindow $startup
  $conflictDiagnostic = Join-Path $isolated 'conflict-startup.json'
  $versionProbe = (Resolve-Path 'tests/windows_version_probe.py').Path
  $conflict = Start-Process -WindowStyle Hidden -FilePath (Get-Command python).Source -WorkingDirectory $isolated -ArgumentList @("`"$versionProbe`"", '--diagnostics', "`"$conflictDiagnostic`"", '--no-browser', '--state-dir', "`"$stateDir`"") -PassThru
  $deadline = (Get-Date).AddSeconds(20)
  $blocked = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $conflictDiagnostic) {
      try { $blocked = Get-Content -LiteralPath $conflictDiagnostic -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 200; continue }
      break
    }
    Start-Sleep -Milliseconds 200
  }
  if ($null -eq $blocked -or $blocked.error -notlike '*종료*' -or $blocked.PSObject.Properties.Name -contains 'url') { throw 'Different launcher version was not blocked' }
  taskkill /PID $conflict.Id /T /F | Out-Null
  $conflict = $null
  $env:GAME_URL = $startup.url
  # One bundled scene startup, then a short physical play smoke.
  npx playwright test chrome-smoke.spec.js
  if ($LASTEXITCODE -ne 0) { throw 'Standalone Windows Chrome smoke failed' }
  $savedPort = (Get-Content -LiteralPath (Join-Path $stateDir 'settings.json') -Raw | ConvertFrom-Json).port
  if ($startup.url -ne ('http://localhost:' + $savedPort)) { throw 'Last port was not retained' }
  taskkill /PID $first.Id /T /F | Out-Null
  $first = $null
  $restartDiagnostic = Join-Path $isolated 'restart-startup.json'
  $first = Start-IsolatedGame $restartDiagnostic
  $restarted = Wait-ForGame $restartDiagnostic
  if ($restarted.url -ne $startup.url -or $restarted.portChanged -or $restarted.reused) { throw 'Restart did not retain its original game address' }
  Assert-VisibleGameWindow $restarted
  Write-Output 'Source-free EXE, native launcher, assets, port fallback, single instance, version conflict, restart address and one Chrome 3D smoke verified.'
} finally {
  if ($null -ne $blocker) { $blocker.Stop() }
  $env:GAME_URL = $originalGameUrl
  foreach ($process in @($conflict, $second, $first)) {
    if ($null -ne $process) { taskkill /PID $process.Id /T /F | Out-Null }
  }
  $checked = [IO.Path]::GetFullPath($isolated)
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $checked.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $checked -Leaf) -notlike 'Security Lab 테스트 *') { throw 'Unsafe cleanup target' }
  Remove-Item -LiteralPath $checked -Recurse -Force -ErrorAction SilentlyContinue
}
