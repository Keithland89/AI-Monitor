<#
AI-Monitor installer {{VERSION}}, started from PowerShell.

Downloads the release zip from GitHub (the installer, the three managed solutions and the app's
build), checks its SHA-256, unpacks it under %LOCALAPPDATA%\AI-Monitor\installer and opens the
installer in your browser. It needs no admin rights and installs nothing system-wide.

  irm https://github.com/Keithland89/AI-Monitor/releases/download/installer-v{{VERSION}}/install.ps1 | iex

Or download this file and run it where your execution policy allows scripts:

  .\install.ps1 [options] [installer command and options]

If your organisation's policy blocks this, don't work around it: run the installer from a clone
of the repo with Node.js (see installer/README.md), or ask your IT team.

Options:
  -ZipPath <file>  Use an ai-monitor-installer.zip you downloaded yourself, for example when a
                   proxy blocks GitHub's download host. It must be the zip from the same release.
  -Proxy <url>     Download through this proxy, signed in as you.
  -Uninstall       Remove the unpacked installer and its command. Your install record in
                   Documents\AI-Monitor stays, and so does everything the installer set up in
                   your tenant: the installer's own uninstall command removes that.
Anything else goes to the installer, for example: status, or install --device-code.
With irm | iex, set $env:AI_MONITOR_ZIP or $env:AI_MONITOR_PROXY instead.

It needs Node.js 22.13 or later on the PATH. Deploying the app needs Node.js 24.11 or later.
Works in Windows PowerShell 5.1 and PowerShell 7. The release build fills in {{VERSION}} and
{{SHA256}}.
#>
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $Version = '{{VERSION}}'
  $Sha256 = '{{SHA256}}'
  $ZipName = 'ai-monitor-installer.zip'
  $ZipUrl = "https://github.com/Keithland89/AI-Monitor/releases/download/installer-v$Version/$ZipName"
  $Again = "irm https://github.com/Keithland89/AI-Monitor/releases/download/installer-v$Version/install.ps1 | iex"
  $Releases = 'https://github.com/Keithland89/AI-Monitor/releases?q=installer-v'

  # Launcher options; the rest go to the installer as typed.
  $ZipPath = if ($env:AI_MONITOR_ZIP) { $env:AI_MONITOR_ZIP } else { $env:AGENT_INVENTORY_ZIP }
  $Proxy = if ($env:AI_MONITOR_PROXY) { $env:AI_MONITOR_PROXY } else { $env:AGENT_INVENTORY_PROXY }
  $Uninstall = $false
  $Forward = @()
  for ($i = 0; $i -lt $args.Count; $i++) {
    $a = [string]$args[$i]
    if ($a -eq '-ZipPath' -and $i + 1 -lt $args.Count) { $i++; $ZipPath = [string]$args[$i] }
    elseif ($a -eq '-Proxy' -and $i + 1 -lt $args.Count) { $i++; $Proxy = [string]$args[$i] }
    elseif ($a -eq '-Uninstall') { $Uninstall = $true }
    else { $Forward += $a }
  }

  if ($env:OS -ne 'Windows_NT') { throw 'This launcher runs on Windows. Elsewhere, run the installer from a clone of the repo with Node.js: see installer/README.md.' }
  $FullLanguage = $ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage'
  $InvHome = Join-Path $env:LOCALAPPDATA 'AI-Monitor'
  $Base = Join-Path $InvHome 'installer'
  $Root = Join-Path $Base $Version
  $Shim = Join-Path $InvHome 'ai-monitor-install.cmd'
  $Marker = '.unpacked'
  $Tar = Join-Path $env:SystemRoot 'System32\tar.exe'

  if ($Uninstall) {
    if (-not (Test-Path -LiteralPath $Base)) { Write-Host 'Nothing to remove.'; return }
    Remove-Item -LiteralPath $Base -Recurse -Force
    Remove-Item -LiteralPath $Shim -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $Base. Your install record in Documents\AI-Monitor is still there, and so is the app's work folder in $InvHome\app."
    return
  }

  # Node.js on the PATH: 22.13 or later runs the installer; 24.11 or later deploys the app.
  $nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $nodeCmd) { throw 'The installer needs Node.js 22.13 or later (24.11 or later to deploy the app). Install the LTS version from nodejs.org or your Company Portal, then run this again.' }
  $node = $nodeCmd.Source
  $nodeVersion = ([string](& $node --version)).Trim()
  if ($nodeVersion -notmatch '^v(\d+)\.(\d+)\.') { throw "Couldn't read the version of $node." }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) { throw "$node is Node.js $nodeVersion. The installer needs 22.13 or later. Install the LTS version, then run this again." }
  $appReady = $major -gt 24 -or ($major -eq 24 -and $minor -ge 11)
  $npm = Join-Path (Split-Path $node) 'npm.cmd'
  if (-not (Test-Path -LiteralPath $npm)) { $npm = 'npm' }

  function Invoke-Npm([string]$Dir, [string]$What) {
    Push-Location -LiteralPath $Dir
    try {
      & $npm ci --omit=dev --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { throw "npm ci for $What failed with exit code $LASTEXITCODE. If a proxy blocks the npm registry, set npm's proxy or registry and run this again." }
    } finally { Pop-Location }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Root $Marker))) {
    New-Item -ItemType Directory -Path $Base -Force | Out-Null
    $zip = $ZipPath
    $downloaded = $false
    if ($zip) {
      if (-not (Test-Path -LiteralPath $zip)) { throw "Can't find $zip." }
      $zip = (Resolve-Path -LiteralPath $zip).Path
    } else {
      $zip = Join-Path $Base "$Version.zip.partial-$PID"
      $downloaded = $true
      Write-Host "Downloading the AI-Monitor installer $Version..."
      if ($FullLanguage) {
        # Windows PowerShell 5.1 may not offer TLS 1.2 by default, and doesn't sign in to the system proxy.
        try {
          [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
          if ([Net.WebRequest]::DefaultWebProxy) { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
        } catch { }
      }
      $request = @{ Uri = $ZipUrl; OutFile = $zip; UseBasicParsing = $true }
      if ($Proxy) { $request.Proxy = $Proxy; $request.ProxyUseDefaultCredentials = $true }
      try {
        Invoke-WebRequest @request
      } catch {
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode } catch { }
        if ($status -eq 404) { throw "Release installer-v$Version is no longer available. Get the current installer from $Releases." }
        throw "Couldn't download $ZipUrl ($($_.Exception.Message)). If a proxy blocks it, download $ZipName from the release in a browser and run this again with -ZipPath, or set `$env:AI_MONITOR_ZIP to its path."
      }
    }

    # Get-FileHash fails in Windows PowerShell 5.1's Constrained Language Mode; certutil ships with Windows.
    $actual = $null
    try { $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256 -ErrorAction Stop).Hash } catch { }
    if (-not $actual) {
      $lines = @(& (Join-Path $env:SystemRoot 'System32\certutil.exe') -hashfile $zip SHA256)
      if ($LASTEXITCODE -eq 0 -and $lines.Count -ge 2) { $actual = ([string]$lines[1]) -replace '\s', '' }
    }
    if (-not $actual) { throw "Couldn't work out the SHA-256 of $zip." }
    $actual = $actual.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) {
      if ($downloaded) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
      throw "$zip isn't the AI-Monitor installer $Version (its SHA-256 is $actual, not $Sha256). Download $ZipName from release installer-v$Version again."
    }

    Write-Host 'Unpacking it...'
    $partial = "$Root.partial-$PID"
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Recurse -Force }
    New-Item -ItemType Directory -Path $partial -Force | Out-Null
    try {
      if (Test-Path -LiteralPath $Tar) {
        & $Tar -x -f $zip -C $partial
        if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE." }
      } else {
        Expand-Archive -LiteralPath $zip -DestinationPath $partial -Force
      }
      foreach ($need in @('installer\package.json', 'solution')) {
        if (-not (Test-Path -LiteralPath (Join-Path $partial $need))) { throw "The zip has no $need." }
      }
      Write-Host "Installing the installer's packages..."
      if (-not (Test-Path -LiteralPath (Join-Path $partial 'installer\node_modules'))) { Invoke-Npm (Join-Path $partial 'installer') 'the installer' }
      $cliDir = Join-Path $partial 'installer\managed-cli'
      if ($appReady -and -not (Test-Path -LiteralPath (Join-Path $cliDir 'node_modules'))) { Invoke-Npm $cliDir 'the managed apps CLI' }
      Set-Content -LiteralPath (Join-Path $partial $Marker) -Value (Get-Date -Format o) -Encoding Ascii
      if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
      # Antivirus may still be scanning the files just unpacked, which blocks the move for a few seconds.
      for ($try = 1; ; $try++) {
        try { Rename-Item -LiteralPath $partial -NewName $Version; break } catch {
          if ($try -ge 10) { throw }
          Start-Sleep -Seconds 2
        }
      }
    } catch {
      Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
      throw "Couldn't unpack the installer: $($_.Exception.Message)"
    } finally {
      if ($downloaded) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
    }
  }

  # A Node.js upgraded since the first run: the managed apps CLI's packages come now.
  $cliDir = Join-Path $Root 'installer\managed-cli'
  if ($appReady -and -not (Test-Path -LiteralPath (Join-Path $cliDir 'node_modules'))) { Invoke-Npm $cliDir 'the managed apps CLI' }
  if (-not $appReady) { Write-Warning "Node.js $nodeVersion runs the installer, but deploying the app needs 24.11 or later. The installer says when it gets there." }

  # Remove other versions.
  foreach ($dir in @(Get-ChildItem -LiteralPath $Base -Directory -ErrorAction SilentlyContinue)) {
    if ($dir.Name -eq $Version) { continue }
    if ($dir.Name -like '*.partial-*' -and $dir.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddHours(-1)) { continue }
    Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }

  # The install record lives here, so every version of the installer finds it.
  $Docs = $null
  if ($FullLanguage) { try { $Docs = [Environment]::GetFolderPath('MyDocuments') } catch { } }
  if (-not $Docs) { $Docs = Join-Path $env:USERPROFILE 'Documents' }
  $Work = Join-Path $Docs 'AI-Monitor'
  # Installs from before the renames keep their record in the old folder until the new one exists.
  if (-not (Test-Path -LiteralPath $Work)) {
    foreach ($old in 'Agent Monitor', 'Copilot Inventory') {
      $Legacy = Join-Path $Docs $old
      if (Test-Path -LiteralPath (Join-Path $Legacy 'agent-inventory-install.json')) { $Work = $Legacy; break }
    }
  }
  New-Item -ItemType Directory -Path $Work -Force | Out-Null

  $script = Join-Path $Root 'installer\bin\ai-monitor-install.js'
  # A command for later, such as "ai-monitor-install.cmd status", that runs this version.
  $AgainCmd = $Again -replace '\|', '^|'
  Set-Content -LiteralPath $Shim -Encoding Ascii -Value @(
    '@echo off'
    'rem Runs the AI-Monitor installer that install.ps1 unpacked. install.ps1 writes this file.'
    'setlocal'
    "set `"INV_SCRIPT=$script`""
    'if not exist "%INV_SCRIPT%" ('
    "  echo This copy of the AI-Monitor installer has been removed or replaced. In PowerShell, run: $AgainCmd"
    '  exit /b 1'
    ')'
    'set "AI_MONITOR_LAUNCHER=pwsh"'
    'set "AI_MONITOR_SHIM=%~f0"'
    "cd /d `"$Work`""
    'if "%~1"=="" (node "%INV_SCRIPT%" --ui) else (node "%INV_SCRIPT%" %*)'
  )

  if (-not $Forward.Count) { $Forward = @('--ui') }
  $saved = @{ Launcher = $env:AI_MONITOR_LAUNCHER; Shim = $env:AI_MONITOR_SHIM }
  Push-Location -LiteralPath $Work
  try {
    $env:AI_MONITOR_LAUNCHER = 'pwsh'
    $env:AI_MONITOR_SHIM = $Shim
    & $node $script @Forward
    $global:LASTEXITCODE = $LASTEXITCODE
  } finally {
    Pop-Location
    $env:AI_MONITOR_LAUNCHER = $saved.Launcher
    $env:AI_MONITOR_SHIM = $saved.Shim
  }
} @args
if ($MyInvocation.MyCommand.Path -and $LASTEXITCODE) { exit $LASTEXITCODE }
