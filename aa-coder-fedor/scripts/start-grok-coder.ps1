#requires -Version 5.1
# Windows PowerShell 5.1 launcher. Avoid $env:VAR next to quotes (parser bug).
# On a new PC this script checks what is missing and downloads it (Node, npm packages, Electron, VC++).

$ErrorActionPreference = 'Stop'
$script:Yo = [char]0x0451
$script:AppTitle = 'AA coder f' + $script:Yo + 'dor 3.0'

function Get-EnvVar {
  param([string]$Name)
  return [Environment]::GetEnvironmentVariable($Name)
}

function Set-EnvVar {
  param([string]$Name, [string]$Value)
  if (-not $Name) { return }
  if ($Name -eq 'HOME' -or $Name -eq 'PWD') { return }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

$TempDir = Get-EnvVar -Name 'TEMP'
if (-not $TempDir) { $TempDir = Get-EnvVar -Name 'TMP' }
$FedorHomeEarly = Get-EnvVar -Name 'LOCALAPPDATA'
if (-not $FedorHomeEarly) { $FedorHomeEarly = $TempDir }
if ($FedorHomeEarly) {
  $FedorHomeEarly = Join-Path -Path $FedorHomeEarly -ChildPath 'Fedor2'
  try { New-Item -ItemType Directory -Force -Path $FedorHomeEarly | Out-Null } catch {}
}
$LogRoot = $FedorHomeEarly
if (-not $LogRoot) { $LogRoot = $TempDir }
$LogPath = Join-Path -Path $LogRoot -ChildPath 'fedor2-launch.log'
try { Start-Transcript -Path $LogPath -Force | Out-Null } catch {}

function Test-DesktopHasFedorLauncher {
  param([string]$ProfileDir)
  $names = @('AA Coder Fedor 3.0.lnk', 'AA Coder Fedor 3.0.bat')
  $dirs = New-Object System.Collections.Generic.List[string]
  foreach ($d in @(Get-DesktopCandidateDirs -ProfileDir $ProfileDir)) {
    if ($d -and -not $dirs.Contains($d)) { [void]$dirs.Add($d) }
  }
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    foreach ($n in $names) {
      $p = Join-Path -Path $d -ChildPath $n
      if (Test-Path -LiteralPath $p) { return $true }
    }
  }
  return $false
}

function Pause-Error {
  param([string]$Message)
  Write-Host ''
  Write-Host ('ERROR: ' + $Message) -ForegroundColor Red
  Write-Host ('Log: ' + $LogPath)
  $rootNow = $script:AppRootPath
  $okNow = $null
  if ($rootNow) { $okNow = Join-Path -Path $rootNow -ChildPath '.fedor-install-ok' }
  $profileDir = Get-EnvVar -Name 'USERPROFILE'
  $hasLauncher = $false
  try { $hasLauncher = Test-DesktopHasFedorLauncher -ProfileDir $profileDir } catch {}
  $filesReady = $false
  if ($okNow -and (Test-Path -LiteralPath $okNow)) { $filesReady = $true }
  if ($filesReady) {
    Write-Host '      Files are in place. You can open AA Coder Fedor 3.0 from the Desktop.'
  }
  $errText = [string]$Message
  if (-not $hasLauncher) { $errText = 'Ярлык не создан. ' + $errText }
  try { Set-SetupUi -Pct 100 -Msg 'Установка остановилась' -Sub $errText -Err $errText -Done 1 } catch {}
  Write-Host 'Press Enter to close this window.'
  try { [void](Read-Host) } catch { Start-Sleep -Seconds 20 }
}

function Find-RepoRoot {
  param([string]$Start)
  $cursor = $Start
  $i = 0
  while ($i -lt 8) {
    $pkg = Join-Path -Path $cursor -ChildPath 'package.json'
    if (Test-Path -LiteralPath $pkg) {
      return (Resolve-Path -LiteralPath $cursor).Path
    }
    $parent = Split-Path -Path $cursor -Parent
    if (-not $parent -or $parent -eq $cursor) { break }
    $cursor = $parent
    $i = $i + 1
  }
  return $null
}

function Get-NodeMajor {
  param([string]$VersionText)
  $clean = $VersionText.Trim().TrimStart('v')
  $parts = $clean.Split('.')
  return [int]$parts[0]
}

function Test-ZipFile {
  param([string]$Path, [int]$MinBytes)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt $MinBytes) { return $false }
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $b0 = $fs.ReadByte()
    $b1 = $fs.ReadByte()
    return ($b0 -eq 80 -and $b1 -eq 75)
  } finally {
    $fs.Close()
  }
}

function Expand-ZipSafe {
  param([string]$ZipPath, [string]$Dest)
  if (-not $ZipPath) { throw 'zip path missing' }
  if (-not $Dest) { throw 'zip dest missing' }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    foreach ($entry in $zip.Entries) {
      $name = [string]$entry.FullName
      if (-not $name) { continue }
      $target = Join-Path -Path $Dest -ChildPath $name
      $isDir = $name.EndsWith([string][char]47) -or $name.EndsWith([string][char]92)
      if ($isDir) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        continue
      }
      $dir = Split-Path -Path $target -Parent
      if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  } finally {
    $zip.Dispose()
  }
}

function Save-UrlToFile {
  param(
    [string[]]$Urls,
    [string]$Dest,
    [int]$MinBytes
  )
  $destDir = Split-Path -Path $Dest -Parent
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $sysRoot = Get-EnvVar -Name 'SystemRoot'
  if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
  $curl = Join-Path -Path $sysRoot -ChildPath 'System32\curl.exe'
  foreach ($url in $Urls) {
    if (-not $url) { continue }
    Write-Host ('      download: ' + $url)
    try {
      if (Test-Path -LiteralPath $Dest) {
        Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
      }
      $ok = $false
      if (Test-Path -LiteralPath $curl) {
        $p = Start-Process -FilePath $curl -ArgumentList @('-L','--fail','--retry','3','--retry-delay','2','--connect-timeout','20','--max-time','180','-A','AA-Coder-Fedor-Setup','-o',$Dest,$url) -Wait -PassThru -WindowStyle Hidden
        if ($p.ExitCode -eq 0) { $ok = $true }
      }
      if (-not $ok) {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'AA-Coder-Fedor-Setup')
        $wc.DownloadFile($url, $Dest)
        $ok = $true
      }
      if ($ok -and (Test-Path -LiteralPath $Dest)) {
        $len = (Get-Item -LiteralPath $Dest).Length
        if ($len -ge $MinBytes) {
          Write-Host ('      ok, ' + [int]($len / 1MB) + ' MB')
          return $true
        }
        Write-Host ('      too small: ' + $len + ' bytes')
      }
    } catch {
      Write-Host ('      fail: ' + $_.Exception.Message)
    }
  }
  return $false
}

function Set-SetupUi {
  param([int]$Pct, [string]$Msg, [string]$Sub, [string]$Log, [string]$Err, [int]$Done)
  $pctN = 0
  if ($Pct) { $pctN = [int]$Pct }
  $doneBit = '0'
  if ($Done) { $doneBit = '1' }
  $nl = [Environment]::NewLine
  $body = 'PCT=' + $pctN + $nl + 'MSG=' + [string]$Msg + $nl + 'SUB=' + [string]$Sub + $nl + 'LOG=' + [string]$Log + $nl + 'DONE=' + $doneBit + $nl + 'ERR=' + [string]$Err + $nl
  $unicode = New-Object System.Text.UnicodeEncoding $false, $true
  $targets = New-Object System.Collections.Generic.List[string]
  $localApp = Get-EnvVar -Name 'LOCALAPPDATA'
  if ($localApp) { [void]$targets.Add((Join-Path -Path (Join-Path -Path $localApp -ChildPath 'Fedor2') -ChildPath 'fedor2-setup-ui.txt')) }
  $tempDir = Get-EnvVar -Name 'TEMP'
  if (-not $tempDir) { $tempDir = Get-EnvVar -Name 'TMP' }
  if ($tempDir) { [void]$targets.Add((Join-Path -Path $tempDir -ChildPath 'fedor2-setup-ui.txt')) }
  foreach ($ui in $targets) {
    try {
      $dir = Split-Path -Path $ui -Parent
      if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
      [System.IO.File]::WriteAllText($ui, $body, $unicode)
    } catch {}
  }
}

function Get-DesktopCandidateDirs {
  param([string]$ProfileDir)
  $list = New-Object System.Collections.Generic.List[string]
  $add = {
    param([string]$PathValue)
    if ($PathValue -and -not $list.Contains($PathValue)) {
      [void]$list.Add($PathValue)
    }
  }
  & $add ([Environment]::GetFolderPath('Desktop'))
  if ($ProfileDir) {
    & $add (Join-Path -Path $ProfileDir -ChildPath 'Desktop')
    & $add (Join-Path -Path $ProfileDir -ChildPath 'OneDrive\Desktop')
    & $add (Join-Path -Path $ProfileDir -ChildPath 'OneDrive\Рабочий стол')
    & $add (Join-Path -Path $ProfileDir -ChildPath 'Рабочий стол')
  }
  return $list
}

function Install-Launchers {
  param(
    [string]$AppRoot,
    [string]$WorkspacePath,
    [string]$ProfileDir,
    [string]$NodeBin
  )
  $starter = Join-Path -Path $AppRoot -ChildPath 'start-grok-coder.cmd'
  $homeDir = Join-Path -Path $ProfileDir -ChildPath 'Fedor2'
  New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $WorkspacePath | Out-Null

  $utf8 = New-Object System.Text.UTF8Encoding $false
  $homeBat = Join-Path -Path $homeDir -ChildPath 'AA Coder Fedor 3.0.bat'
  $localApp = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
  $electronExe = Join-Path -Path $AppRoot -ChildPath 'node_modules\electron\dist\electron.exe'
  $electronMain = Join-Path -Path $AppRoot -ChildPath 'electron\main.cjs'
  $okStamp = Join-Path -Path $AppRoot -ChildPath '.fedor-install-ok'
  $portableNode = Join-Path -Path $localApp -ChildPath 'Fedor2\node\node-v22.19.0-win-x64\node.exe'
  $nodeLine = 'rem GROK_NODE from this PC'
  if ($NodeBin) {
    $nodeLine = 'set "GROK_NODE=' + $NodeBin + '"'
  } elseif (Test-Path -LiteralPath $portableNode) {
    $nodeLine = 'set "GROK_NODE=' + $portableNode + '"'
  }

  $guide = @(
    'AA Coder Fedor 3.0',
    '==========',
    '',
    'Писать внизу окна. Ctrl+V вставляет текст.',
    '',
    ('ФАЙЛЫ: ' + $WorkspacePath),
    '',
    'КАК ОТКРЫТЬ СНОВА: ярлык на рабочем столе  AA Coder Fedor 3.0',
    ('Или: ' + $homeBat),
    '',
    ('ПРОГРАММА: ' + $AppRoot),
    ''
  ) -join [Environment]::NewLine
  [System.IO.File]::WriteAllText((Join-Path -Path $homeDir -ChildPath 'KUDA-PISAT.txt'), $guide, $utf8)

  $batBody = @(
    '@echo off',
    'setlocal EnableExtensions',
    'title AA Coder Fedor 3.0',
    ('cd /d "' + $AppRoot + '"'),
    $nodeLine,
    'set "GROK_PORT=43223"',
    'set "GROK_DESKTOP=1"',
    ('if exist "' + $okStamp + '" if exist "' + $electronExe + '" if exist "' + $electronMain + '" ('),
    ('  start "" /D "' + $AppRoot + '" "' + $electronExe + '" .'),
    '  exit /b 0',
    ')',
    'echo Missing pieces on this PC. Downloading what is needed...',
    ('if exist "' + $starter + '" ('),
    ('  call "' + $starter + '"'),
    '  exit /b %ERRORLEVEL%',
    ')',
    'echo AA Coder Fedor not found.',
    'pause'
  ) -join [Environment]::NewLine
  $deskDirs = Get-DesktopCandidateDirs -ProfileDir $ProfileDir
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { $desk = Join-Path -Path $ProfileDir -ChildPath 'Desktop' }
  $profileDesk = Join-Path -Path $ProfileDir -ChildPath 'Desktop'
  foreach ($must in @($desk, $profileDesk)) {
    if ($must -and -not (Test-Path -LiteralPath $must)) {
      try { New-Item -ItemType Directory -Force -Path $must | Out-Null } catch {}
    }
  }
  $junkNames = @(
    'AA Coder Fedor 4.bat',
    'Coder 4.bat',
    'AA Coder Fedor 4.cmd',
    'AA Coder Fedor 4.lnk',
    'Coder 4.lnk'
  )
  foreach ($d in $deskDirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    foreach ($n in $junkNames) {
      $old = Join-Path -Path $d -ChildPath $n
      if (Test-Path -LiteralPath $old) {
        try { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }

  [System.IO.File]::WriteAllText($homeBat, $batBody + [Environment]::NewLine, $utf8)
  try { Unblock-File -Path $homeBat -ErrorAction SilentlyContinue } catch {}

  $shortcutName = 'AA Coder Fedor 3.0.lnk'
  $startMenu = [Environment]::GetFolderPath('StartMenu')
  $programs = Join-Path -Path $startMenu -ChildPath 'Programs'
  try { New-Item -ItemType Directory -Force -Path $programs | Out-Null } catch {}
  $writeDirs = New-Object System.Collections.Generic.List[string]
  foreach ($d in $deskDirs) {
    if ($d -and -not $writeDirs.Contains($d)) { [void]$writeDirs.Add($d) }
  }
  if ($programs -and -not $writeDirs.Contains($programs)) { [void]$writeDirs.Add($programs) }

  function Test-FedorLnkIsCmd {
    param([string]$PathValue)
    if (-not (Test-Path -LiteralPath $PathValue)) { return $false }
    try {
      $bytes = [System.IO.File]::ReadAllBytes($PathValue)
      $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
      $uni = [System.Text.Encoding]::Unicode.GetString($bytes)
      if ($ascii -match 'cmd\.exe' -or $uni -match 'cmd\.exe') { return $true }
    } catch {}
    try {
      $WshCheck = New-Object -ComObject WScript.Shell
      $cur = $WshCheck.CreateShortcut($PathValue)
      $target = [string]$cur.TargetPath
      if ($target -match '(?i)cmd\.exe') { return $true }
    } catch {}
    return $false
  }
  function Test-FedorLnkOk {
    param([string]$PathValue)
    if (-not (Test-Path -LiteralPath $PathValue)) { return $false }
    if (Test-FedorLnkIsCmd -PathValue $PathValue) { return $false }
    try {
      $WshCheck = New-Object -ComObject WScript.Shell
      $cur = $WshCheck.CreateShortcut($PathValue)
      $target = [string]$cur.TargetPath
      if (-not $target) { return $false }
      if ($target -match '(?i)cmd\.exe') { return $false }
      if ($electronExe -and ($target -like '*electron.exe')) { return $true }
      if ($starter -and ($target -like '*start-grok-coder.cmd')) { return $true }
      if ($homeBat -and ($target -like '*AA Coder Fedor 3.0.bat')) { return $true }
    } catch {}
    return $false
  }
  $written = 0
  try {
    $Wsh = New-Object -ComObject WScript.Shell
    foreach ($d in $writeDirs) {
      if (-not $d) { continue }
      if (-not (Test-Path -LiteralPath $d)) { continue }
      $lnkPath = Join-Path -Path $d -ChildPath $shortcutName
      try {
        $s = $Wsh.CreateShortcut($lnkPath)
        if ((Test-ElectronExe -PathValue $electronExe) -and (Test-Path -LiteralPath $okStamp) -and (Test-Path -LiteralPath $electronMain)) {
          $s.TargetPath = $electronExe
          $s.Arguments = '.'
        } elseif (Test-Path -LiteralPath $starter) {
          $s.TargetPath = $starter
          $s.Arguments = ''
        } else {
          $s.TargetPath = $homeBat
          $s.Arguments = ''
        }
        $s.WorkingDirectory = $AppRoot
        $s.WindowStyle = 1
        $s.Description = 'AA Coder Fedor 3.0'
        if (Test-ElectronExe -PathValue $electronExe) { $s.IconLocation = ($electronExe + ',0') }
        $s.Save()
        try { Unblock-File -Path $lnkPath -ErrorAction SilentlyContinue } catch {}
        if (Test-FedorLnkOk -PathValue $lnkPath) {
          $written = $written + 1
          $siblingBat = Join-Path -Path $d -ChildPath 'AA Coder Fedor 3.0.bat'
          if (Test-Path -LiteralPath $siblingBat) {
            try { Remove-Item -LiteralPath $siblingBat -Force -ErrorAction SilentlyContinue } catch {}
          }
        } else {
          try { Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue } catch {}
        }
      } catch {}
    }
  } catch {
    Write-Host ('      shortcut COM: ' + $_.Exception.Message)
  }
  foreach ($d in $writeDirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $lnkPath = Join-Path -Path $d -ChildPath $shortcutName
    if ((Test-Path -LiteralPath $lnkPath) -and (Test-FedorLnkOk -PathValue $lnkPath)) { continue }
    if (Test-Path -LiteralPath $lnkPath) {
      try { Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue } catch {}
    }
    try {
      $fallback = Join-Path -Path $d -ChildPath 'AA Coder Fedor 3.0.bat'
      [System.IO.File]::WriteAllText($fallback, $batBody + [Environment]::NewLine, $utf8)
      try { Unblock-File -Path $fallback -ErrorAction SilentlyContinue } catch {}
      $written = $written + 1
    } catch {}
  }
  Write-Host ('      Desktop shortcut: AA Coder Fedor 3.0  (' + $written + ')')
  if ($written -lt 1) {
    throw 'Не получилось создать ярлык на рабочем столе. На столе должен появиться файл AA Coder Fedor 3.0'
  }

  $deskForLog = $desk
  if (-not $deskForLog) { $deskForLog = $profileDesk }
  $deskLnk = Join-Path -Path $deskForLog -ChildPath $shortcutName
  $deskBatUn = Join-Path -Path $deskForLog -ChildPath 'AA Coder Fedor 3.0.bat'
  $menuLnk = Join-Path -Path $programs -ChildPath $shortcutName
  $unPath = Join-Path -Path $AppRoot -ChildPath 'uninstall-aa-coder-fedor.cmd'
  $unLines = @(
    '@echo off',
    'chcp 65001 >nul',
    'title Uninstall AA Coder Fedor 3.0',
    'echo Removing AA Coder Fedor 3.0...',
    ('if exist "' + $AppRoot + '" rmdir /s /q "' + $AppRoot + '"'),
    ('if exist "' + $homeBat + '" del /q "' + $homeBat + '"'),
    ('if exist "' + $deskLnk + '" del /q "' + $deskLnk + '"'),
    ('if exist "' + $deskBatUn + '" del /q "' + $deskBatUn + '"'),
    ('if exist "' + $menuLnk + '" del /q "' + $menuLnk + '"'),
    'echo Done. Project files in Fedor2\workspace were kept.',
    'pause'
  )
  try {
    [System.IO.File]::WriteAllText($unPath, (($unLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
  } catch {}
}

function Get-PortableNode {
  param([string]$AppData, [string]$NodeVersion)
  $portableDir = Join-Path -Path $AppData -ChildPath ('node\node-' + $NodeVersion + '-win-x64')
  $portableExe = Join-Path -Path $portableDir -ChildPath 'node.exe'
  if (Test-Path -LiteralPath $portableExe) { return $portableExe }
  return $null
}

function Install-PortableNode {
  param([string]$AppData, [string]$NodeVersion)
  $seed = Get-EnvVar -Name 'FEDOR_SEED_NODE'
  if ($seed -and (Test-Path -LiteralPath $seed)) {
    $seedExe = $seed
    if (-not $seed.ToLower().EndsWith('node.exe')) {
      $seedExe = Join-Path -Path $seed -ChildPath 'node.exe'
    }
    if (Test-Path -LiteralPath $seedExe) {
      $portableDir = Join-Path -Path $AppData -ChildPath ('node\node-' + $NodeVersion + '-win-x64')
      $portableExe = Join-Path -Path $portableDir -ChildPath 'node.exe'
      if (-not (Test-Path -LiteralPath $portableExe)) {
        Write-Host '      using Node.js already cached on this PC'
        $seedRoot = Split-Path -Path $seedExe -Parent
        New-Item -ItemType Directory -Force -Path (Split-Path -Path $portableDir -Parent) | Out-Null
        Copy-Item -LiteralPath $seedRoot -Destination $portableDir -Recurse -Force
      }
      if (Test-Path -LiteralPath $portableExe) { return $portableExe }
    }
  }
  $zipName = 'node-' + $NodeVersion + '-win-x64.zip'
  $zipPath = Join-Path -Path $AppData -ChildPath $zipName
  $urls = @(
    ('https://nodejs.org/dist/' + $NodeVersion + '/' + $zipName),
    ('https://npmmirror.com/mirrors/node/' + $NodeVersion + '/' + $zipName),
    ('https://cdn.npmmirror.com/binaries/node/' + $NodeVersion + '/' + $zipName),
    ('https://unofficial-builds.nodejs.org/download/release/' + $NodeVersion + '/' + $zipName)
  )
  Write-Host ('[need] Node.js ' + $NodeVersion + ' — downloading (~30 MB, once)...')
  Set-SetupUi -Pct 76 -Msg 'Качаю Node.js' -Sub 'Один раз, около 30 МБ'
  New-Item -ItemType Directory -Force -Path $AppData | Out-Null
  if (-not (Save-UrlToFile -Urls $urls -Dest $zipPath -MinBytes 1000000)) {
    throw 'Could not download Node.js. Check internet / antivirus. Log: ' + $LogPath
  }
  if (-not (Test-ZipFile -Path $zipPath -MinBytes 1000000)) {
    throw 'Node.js zip is damaged. Delete it and run setup again.'
  }
  $nodeRoot = Join-Path -Path $AppData -ChildPath 'node'
  New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null
  Write-Host '      extracting Node.js...'
  Expand-ZipSafe -ZipPath $zipPath -Dest $nodeRoot
  $portableExe = Get-PortableNode -AppData $AppData -NodeVersion $NodeVersion
  if (-not $portableExe) {
    throw 'Could not extract Node.js.'
  }
  return $portableExe
}

function Seed-NpmPackages {
  param([string]$Root)
  $nextPkg = Join-Path -Path $Root -ChildPath 'node_modules\next'
  if (Test-Path -LiteralPath $nextPkg) { return $true }
  $seed = Get-EnvVar -Name 'FEDOR_SEED_MODULES'
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($seed) { [void]$candidates.Add($seed) }
  $localApp = Get-EnvVar -Name 'LOCALAPPDATA'
  if ($localApp) {
    $fedorRoot = Join-Path -Path $localApp -ChildPath 'Fedor2'
    if (Test-Path -LiteralPath $fedorRoot) {
      Get-ChildItem -LiteralPath $fedorRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        [void]$candidates.Add((Join-Path -Path $_.FullName -ChildPath 'node_modules'))
      }
    }
  }
  foreach ($src in $candidates) {
    if (-not $src) { continue }
    $srcNext = Join-Path -Path $src -ChildPath 'next'
    if (-not (Test-Path -LiteralPath $srcNext)) { continue }
    if ($src -eq (Join-Path -Path $Root -ChildPath 'node_modules')) { continue }
    Write-Host ('      reusing npm packages already on this PC: ' + $src)
    $dest = Join-Path -Path $Root -ChildPath 'node_modules'
    try {
      Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
      if (Test-Path -LiteralPath $nextPkg) { return $true }
    } catch {
      Write-Host ('      seed copy failed: ' + $_.Exception.Message)
    }
  }
  return $false
}

function Test-AppAlreadyReady {
  param([string]$Root, [bool]$NodeOk)
  if (-not $NodeOk) { return $false }
  if (-not (Test-EditionMatches -Root $Root)) { return $false }
  $nextJs = Join-Path -Path $Root -ChildPath 'node_modules\next\dist\bin\next'
  $electronExe = Join-Path -Path $Root -ChildPath 'node_modules\electron\dist\electron.exe'
  $buildId = Join-Path -Path $Root -ChildPath '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $nextJs)) { return $false }
  if (-not (Test-ElectronExe -PathValue $electronExe)) { return $false }
  if (-not (Test-Path -LiteralPath $buildId)) { return $false }
  return $true
}

function Write-NpmRc {
  param([string]$Root)
  $rc = Join-Path -Path $Root -ChildPath '.npmrc'
  $body = @(
    'ignore-scripts=false',
    'fund=false',
    'audit=false',
    'progress=false'
  ) -join [Environment]::NewLine
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($rc, $body + [Environment]::NewLine, $utf8)
}

function Repair-NativeBins {
  param([string]$Root, [string]$NodeExe, [string]$NpmCmd)
  Set-EnvVar -Name 'npm_config_ignore_scripts' -Value 'false'
  try { & $NpmCmd config set ignore-scripts false --location project | Out-Null } catch {}
  try { & $NpmCmd install-scripts approve electron 2>$null | Out-Null } catch {}
  try { & $NpmCmd install-scripts approve esbuild 2>$null | Out-Null } catch {}
  try { & $NpmCmd install-scripts approve unrs-resolver 2>$null | Out-Null } catch {}
  $scripts = @(
    'node_modules\electron\install.js',
    'node_modules\esbuild\install.js',
    'node_modules\unrs-resolver\postinstall.js'
  )
  foreach ($rel in $scripts) {
    $full = Join-Path -Path $Root -ChildPath $rel
    if (-not (Test-Path -LiteralPath $full)) { continue }
    Write-Host ('      running ' + $rel)
    try {
      & $NodeExe $full
    } catch {
      Write-Host ('      ' + $rel + ': ' + $_.Exception.Message)
    }
  }
  try { & $NpmCmd rebuild esbuild unrs-resolver electron --ignore-scripts=false | Out-Null } catch {}
}

function Test-ElectronExe {
  param([string]$PathValue)
  if (-not $PathValue) { return $false }
  if (-not (Test-Path -LiteralPath $PathValue)) { return $false }
  try {
    $len = (Get-Item -LiteralPath $PathValue).Length
    return ($len -gt 5000000)
  } catch {
    return $false
  }
}

function Get-PackedSku {
  param([string]$Root)
  if (-not $Root) { return 'paid' }
  foreach ($rel in @('.fedor-sku', '.next\FEDOR_SKU', '.fedor-install-ok')) {
    $stamp = Join-Path -Path $Root -ChildPath $rel
    if (Test-Path -LiteralPath $stamp) {
      $raw = ([IO.File]::ReadAllText($stamp)).Trim().ToLower()
      if ($raw -eq 'free' -or $raw -eq 'paid') { return $raw }
    }
  }
  return 'paid'
}

function Get-NextSku {
  param([string]$Root)
  $stamp = Join-Path -Path $Root -ChildPath '.next\FEDOR_SKU'
  if (Test-Path -LiteralPath $stamp) {
    $raw = ([IO.File]::ReadAllText($stamp)).Trim().ToLower()
    if ($raw -eq 'free' -or $raw -eq 'paid') { return $raw }
  }
  return ''
}

function Test-EditionMatches {
  param([string]$Root)
  $sku = Get-PackedSku -Root $Root
  $nextSku = Get-NextSku -Root $Root
  return ($sku -and $nextSku -and ($sku -eq $nextSku))
}

function Write-InstallOkStamp {
  param([string]$Root)
  if (-not $Root) { return }
  $sku = Get-PackedSku -Root $Root
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path -Path $Root -ChildPath '.fedor-sku'), ($sku + [Environment]::NewLine), $utf8)
  [IO.File]::WriteAllText((Join-Path -Path $Root -ChildPath '.fedor-install-ok'), ($sku + [Environment]::NewLine), $utf8)
  $nextDir = Join-Path -Path $Root -ChildPath '.next'
  if (Test-Path -LiteralPath $nextDir) {
    [IO.File]::WriteAllText((Join-Path -Path $nextDir -ChildPath 'FEDOR_SKU'), ($sku + [Environment]::NewLine), $utf8)
  }
}

function Remove-InstallLaunchers {
  param([string]$ProfileDir)
  $shortcutName = 'AA Coder Fedor 3.0.lnk'
  $batName = 'AA Coder Fedor 3.0.bat'
  $dirs = New-Object System.Collections.Generic.List[string]
  foreach ($d in @(Get-DesktopCandidateDirs -ProfileDir $ProfileDir)) {
    if ($d -and -not $dirs.Contains($d)) { [void]$dirs.Add($d) }
  }
  $startMenu = [Environment]::GetFolderPath('StartMenu')
  if ($startMenu) {
    $programs = Join-Path -Path $startMenu -ChildPath 'Programs'
    if (-not $dirs.Contains($programs)) { [void]$dirs.Add($programs) }
  }
  if ($ProfileDir) {
    $profileHome = Join-Path -Path $ProfileDir -ChildPath 'Fedor2'
    if (-not $dirs.Contains($profileHome)) { [void]$dirs.Add($profileHome) }
  }
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    foreach ($n in @($shortcutName, $batName)) {
      $p = Join-Path -Path $d -ChildPath $n
      if (Test-Path -LiteralPath $p) {
        try { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }
}

function Install-NpmPackages {
  param([string]$Root, [string]$NodeExe, [string]$NpmCmd)
  Write-NpmRc -Root $Root
  Set-EnvVar -Name 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD' -Value '1'
  Set-EnvVar -Name 'ELECTRON_MIRROR' -Value 'https://npmmirror.com/mirrors/electron/'
  Set-EnvVar -Name 'npm_config_fund' -Value 'false'
  Set-EnvVar -Name 'npm_config_audit' -Value 'false'
  Set-EnvVar -Name 'npm_config_progress' -Value 'false'
  Set-EnvVar -Name 'npm_config_fetch_retries' -Value '5'
  Set-EnvVar -Name 'npm_config_ignore_scripts' -Value 'false'
  $nextPkg = Join-Path -Path $Root -ChildPath 'node_modules\next'
  if (-not (Test-Path -LiteralPath $nextPkg)) {
    [void](Seed-NpmPackages -Root $Root)
  }
  if (-not (Test-Path -LiteralPath $nextPkg)) {
    Write-Host '[need] npm packages — installing (runtime only, no extra tools)...'
    Set-SetupUi -Pct 82 -Msg 'Ставлю пакеты' -Sub 'Только то, без чего кодер не стартует.'
    $registries = @(
      'https://registry.npmjs.org/',
      'https://registry.npmmirror.com/'
    )
    $ok = $false
    foreach ($reg in $registries) {
      Write-Host ('      npm registry: ' + $reg)
      try {
        & $NpmCmd install --omit=dev --no-fund --no-audit --ignore-scripts=false --registry $reg
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $nextPkg)) {
          $ok = $true
          break
        }
      } catch {
        Write-Host ('      npm fail: ' + $_.Exception.Message)
      }
    }
    if (-not $ok) {
      throw 'npm install failed on every registry. Check internet. Log: ' + $LogPath
    }
  } else {
    Write-Host '[ok] npm packages already on this PC'
  }
  $electronProbeNow = Join-Path -Path $Root -ChildPath 'node_modules\electron\dist\electron.exe'
  if (Test-ElectronExe -PathValue $electronProbeNow) {
    Write-Host '[ok] native binaries already on this PC — skip rebuild'
    return
  }
  Write-Host '[fix] native binaries (npm 11 blocks electron/esbuild scripts)...'
  Repair-NativeBins -Root $Root -NodeExe $NodeExe -NpmCmd $NpmCmd
}

function Install-ElectronBinary {
  param([string]$Root, [string]$NodeExe)
  $electronExe = Join-Path -Path $Root -ChildPath 'node_modules\electron\dist\electron.exe'
  if (Test-ElectronExe -PathValue $electronExe) {
    Write-Host '[ok] Electron already on this PC'
    return $electronExe
  }
  if (Test-Path -LiteralPath $electronExe) {
    Write-Host '      electron.exe is a stub (npm skipped install.js) — downloading the real window'
    try { Remove-Item -LiteralPath $electronExe -Force -ErrorAction SilentlyContinue } catch {}
  }
  Write-Host '[need] Electron window — downloading...'
  Set-SetupUi -Pct 90 -Msg 'Качаю окно программы' -Sub 'Electron, один раз'
  Set-EnvVar -Name 'ELECTRON_MIRROR' -Value 'https://npmmirror.com/mirrors/electron/'
  $electronInstall = Join-Path -Path $Root -ChildPath 'node_modules\electron\install.js'
  if (Test-Path -LiteralPath $electronInstall) {
    try {
      & $NodeExe $electronInstall
    } catch {
      Write-Host ('      electron install.js: ' + $_.Exception.Message)
    }
  }
  if (Test-Path -LiteralPath $electronExe) { return $electronExe }

  $ver = '37.2.4'
  $zipName = 'electron-v' + $ver + '-win32-x64.zip'
  $zipPath = Join-Path -Path $Root -ChildPath $zipName
  $urls = @(
    ('https://npmmirror.com/mirrors/electron/' + $ver + '/' + $zipName),
    ('https://cdn.npmmirror.com/binaries/electron/v' + $ver + '/' + $zipName),
    ('https://github.com/electron/electron/releases/download/v' + $ver + '/' + $zipName)
  )
  if (-not (Save-UrlToFile -Urls $urls -Dest $zipPath -MinBytes 1000000)) {
    throw 'Could not download Electron. Check internet. Log: ' + $LogPath
  }
  $dist = Join-Path -Path $Root -ChildPath 'node_modules\electron\dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  Expand-ZipSafe -ZipPath $zipPath -Dest $dist
  if (-not (Test-Path -LiteralPath $electronExe)) {
    throw 'Electron zip extracted but electron.exe is missing.'
  }
  return $electronExe
}

function Install-VCRedistIfMissing {
  $sysRoot = Get-EnvVar -Name 'SystemRoot'
  if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
  $dll = Join-Path -Path $sysRoot -ChildPath 'System32\vcruntime140.dll'
  if (Test-Path -LiteralPath $dll) {
    Write-Host '[ok] Visual C++ runtime present'
    return
  }
  Write-Host '[need] Visual C++ runtime — downloading...'
  Set-SetupUi -Pct 78 -Msg 'Качаю Visual C++' -Sub 'Библиотека Windows, один раз'
  $tmp = Get-EnvVar -Name 'TEMP'
  $exe = Join-Path -Path $tmp -ChildPath 'vc_redist.x64.exe'
  $urls = @(
    'https://aka.ms/vs/17/release/vc_redist.x64.exe',
    'https://aka.ms/vs/16/release/vc_redist.x64.exe'
  )
  if (-not (Save-UrlToFile -Urls $urls -Dest $exe -MinBytes 1000000)) {
    Write-Host '      VC++ download failed (continuing; Electron may still start)'
    return
  }
  try {
    $p = Start-Process -FilePath $exe -ArgumentList @('/install','/quiet','/norestart') -Wait -PassThru -WindowStyle Hidden
    Write-Host ('      VC++ installer exit ' + $p.ExitCode)
  } catch {
    Write-Host ('      VC++ install: ' + $_.Exception.Message)
  }
}

function Write-Check {
  param([string]$Name, [bool]$Ok, [string]$Note)
  $mark = 'net '
  if ($Ok) { $mark = 'est ' }
  $line = '      [' + $mark + '] ' + $Name
  if ($Note) { $line = $line + ' — ' + $Note }
  Write-Host $line
}

function Test-Internet {
  $urls = @(
    'https://nodejs.org',
    'https://registry.npmjs.org/',
    'https://npmmirror.com/'
  )
  foreach ($url in $urls) {
    try {
      $probe = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
      if ($probe.StatusCode -ge 200) { return $true }
    } catch {}
  }
  return $false
}

function Find-GitExe {
  $cmd = Get-Command -Name 'git.exe' -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $localApp = Get-EnvVar -Name 'LOCALAPPDATA'
  $portable = Join-Path -Path $localApp -ChildPath 'Fedor2\git\cmd\git.exe'
  if (Test-Path -LiteralPath $portable) { return $portable }
  $pf = Get-EnvVar -Name 'ProgramFiles'
  $pf86 = Get-EnvVar -Name 'ProgramFiles(x86)'
  foreach ($root in @($pf, $pf86)) {
    if (-not $root) { continue }
    $hit = Join-Path -Path $root -ChildPath 'Git\cmd\git.exe'
    if (Test-Path -LiteralPath $hit) { return $hit }
  }
  return $null
}

function Install-PortableGit {
  param([string]$AppData)
  $gitExe = Join-Path -Path $AppData -ChildPath 'git\cmd\git.exe'
  if (Test-Path -LiteralPath $gitExe) { return $gitExe }
  Write-Host '[need] Git — downloading MinGit (~15 MB, once)...'
  Set-SetupUi -Pct 80 -Msg 'Качаю Git' -Sub 'Нужен для GitHub на этом ПК'
  $zipPath = Join-Path -Path $AppData -ChildPath 'MinGit.zip'
  $urls = @(
    'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/MinGit-2.47.1-64-bit.zip',
    'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/MinGit-2.45.2-64-bit.zip'
  )
  New-Item -ItemType Directory -Force -Path $AppData | Out-Null
  if (-not (Save-UrlToFile -Urls $urls -Dest $zipPath -MinBytes 1000000)) {
    Write-Host '      Git download failed. GitHub in the app will ask you to install git later.'
    return $null
  }
  $gitRoot = Join-Path -Path $AppData -ChildPath 'git'
  New-Item -ItemType Directory -Force -Path $gitRoot | Out-Null
  Expand-ZipSafe -ZipPath $zipPath -Dest $gitRoot
  if (Test-Path -LiteralPath $gitExe) { return $gitExe }
  $nested = Get-ChildItem -LiteralPath $gitRoot -Filter 'git.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nested) { return $nested.FullName }
  Write-Host '      Git zip extracted but git.exe missing'
  return $null
}

function Find-BrowserExe {
  $local = Get-EnvVar -Name 'LOCALAPPDATA'
  $pf = Get-EnvVar -Name 'ProgramFiles'
  $pf86 = Get-EnvVar -Name 'ProgramFiles(x86)'
  $cands = @(
    (Join-Path -Path $pf86 -ChildPath 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path -Path $pf -ChildPath 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path -Path $local -ChildPath 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path -Path $pf -ChildPath 'Google\Chrome\Application\chrome.exe'),
    (Join-Path -Path $pf86 -ChildPath 'Google\Chrome\Application\chrome.exe'),
    (Join-Path -Path $local -ChildPath 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($item in $cands) {
    if ($item -and (Test-Path -LiteralPath $item)) { return $item }
  }
  return $null
}

function Install-ChromeIfMissing {
  $have = Find-BrowserExe
  if ($have) { return $have }
  Write-Host '[need] Edge/Chrome missing — downloading Chrome...'
  Set-SetupUi -Pct 81 -Msg 'Качаю Chrome' -Sub 'Живой браузер для MAX и сайта'
  $tmp = Get-EnvVar -Name 'TEMP'
  $exe = Join-Path -Path $tmp -ChildPath 'chrome_installer.exe'
  $urls = @(
    'https://dl.google.com/chrome/install/latest/chrome_installer.exe'
  )
  if (-not (Save-UrlToFile -Urls $urls -Dest $exe -MinBytes 500000)) {
    Write-Host '      Chrome download failed. Install Edge or Chrome, then open the coder again.'
    return $null
  }
  try {
    $p = Start-Process -FilePath $exe -ArgumentList @('/silent','/install') -Wait -PassThru -WindowStyle Hidden
    Write-Host ('      Chrome installer exit ' + $p.ExitCode)
  } catch {
    Write-Host ('      Chrome install: ' + $_.Exception.Message)
  }
  return (Find-BrowserExe)
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  } catch {}
  $ProgressPreference = 'SilentlyContinue'

  $NodeVersion = 'v22.19.0'
  $Port = 43223
  $IdeUrl = 'http://127.0.0.1:43223'
  $LocalApp = Get-EnvVar -Name 'LOCALAPPDATA'
  $UserProfile = Get-EnvVar -Name 'USERPROFILE'
  $AppData = Join-Path -Path $LocalApp -ChildPath 'Fedor2'

  Write-Host ''
  Write-Host '=============================================='
  Write-Host ('  ' + $script:AppTitle)
  Write-Host '  Checking this PC and downloading what is missing.'
  Write-Host '  Keep this window open until the app starts.'
  Write-Host '=============================================='
  Write-Host ''

  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'Need 64-bit Windows 10 or newer.'
  }
  $osVer = [Environment]::OSVersion.Version
  if ($osVer.Major -lt 10) {
    throw 'Need Windows 10 or newer.'
  }

  $Root = Find-RepoRoot -Start $PSScriptRoot
  if (-not $Root) { $Root = Find-RepoRoot -Start (Get-Location).Path }
  if (-not $Root) {
    throw 'package.json not found. Run AA-Coder-Fedor-3.0-Setup.bat (full file), not a shortcut to an empty folder.'
  }
  $script:AppRootPath = $Root
  Write-Host ('[1/8] App folder: ' + $Root)

  $sysRoot = Get-EnvVar -Name 'SystemRoot'
  if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
  $vcDll = Join-Path -Path $sysRoot -ChildPath 'System32\vcruntime140.dll'
  $nextPkg = Join-Path -Path $Root -ChildPath 'node_modules\next'
  $electronProbe = Join-Path -Path $Root -ChildPath 'node_modules\electron\dist\electron.exe'
  $gitNow = Find-GitExe
  $browserNow = Find-BrowserExe
  $systemNode = Get-Command -Name 'node.exe' -ErrorAction SilentlyContinue
  $nodeReady = $false
  if ($systemNode) {
    try {
      $ver = & $systemNode.Source -v
      if ((Get-NodeMajor -VersionText $ver) -ge 18) {
        $nodeReady = $true
      } else {
        Write-Host ('      Node.js ' + $ver + ' is too old — will use portable Node 22')
      }
    } catch {}
  }
  if (-not $nodeReady) {
    if (Get-PortableNode -AppData $AppData -NodeVersion $NodeVersion) { $nodeReady = $true }
  }

  Write-Host '[2/8] What is already on this PC (missing items will be downloaded):'
  Set-SetupUi -Pct 70 -Msg 'Смотрю, чего нет на этом ПК' -Sub 'Node, пакеты, окно, VC++'
  Write-Check -Name 'Windows 10 64-bit' -Ok $true -Note 'ok'
  Write-Check -Name 'Internet' -Ok (Test-Internet) -Note 'nuzhen chtoby dochachat biblioteki'
  Write-Check -Name 'Node.js 18+' -Ok $nodeReady -Note $(if ($nodeReady) { 'uzhe est' } else { 'skachayu portable' })
  Write-Check -Name 'npm packages (Next, Electron)' -Ok (Test-Path -LiteralPath $nextPkg) -Note $(if (Test-Path -LiteralPath $nextPkg) { 'uzhe est' } else { 'npm install' })
  Write-Check -Name 'Electron window' -Ok (Test-ElectronExe -PathValue $electronProbe) -Note $(if (Test-ElectronExe -PathValue $electronProbe) { 'uzhe est' } else { 'skachayu binary' })
  Write-Check -Name 'Visual C++ runtime' -Ok (Test-Path -LiteralPath $vcDll) -Note $(if (Test-Path -LiteralPath $vcDll) { 'uzhe est' } else { 'skachayu vc_redist' })
  Write-Check -Name 'Git' -Ok ([bool]$gitNow) -Note $(if ($gitNow) { $gitNow } else { 'ne nuzhen dlya starta' })
  Write-Check -Name 'Edge or Chrome' -Ok ([bool]$browserNow) -Note $(if ($browserNow) { $browserNow } else { 'ne nuzhen dlya starta' })

  $needNet = -not $nodeReady -or -not (Test-Path -LiteralPath $nextPkg) -or -not (Test-ElectronExe -PathValue $electronProbe)
  if ($needNet -and -not (Test-Internet)) {
    throw 'No internet, and this PC is missing Node / packages / Electron window. Git and browser are not required to start. Connect internet and run AA-Coder-Fedor-3.0-Setup.bat again.'
  }

  $workspace = Get-EnvVar -Name 'GROK_WORKSPACE'
  if (-not $workspace) {
    $workspace = Join-Path -Path $UserProfile -ChildPath 'Fedor2\workspace'
    Set-EnvVar -Name 'GROK_WORKSPACE' -Value $workspace
  }
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  Write-Host '[3/8] Checking edition (paid/free) — shortcut only after success'
  Set-SetupUi -Pct 72 -Msg 'Проверяю версию' -Sub 'Ярлык появится только когда установка закончится'
  $sku = Get-PackedSku -Root $Root
  $utf8Sku = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path -Path $Root -ChildPath '.fedor-sku'), ($sku + [Environment]::NewLine), $utf8Sku)
  if (-not (Test-EditionMatches -Root $Root)) {
    $nextSku = Get-NextSku -Root $Root
    Write-Host ('      leftover UI ' + $nextSku + ' vs packed ' + $sku + ' — continue, do not stop setup')
  }

  Write-Host '[4/8] Downloading whatever is missing...'
  Set-SetupUi -Pct 74 -Msg 'Докачиваю библиотеки' -Sub 'Node, npm, Electron'
  $nodeExe = $null
  $nodePrefix = $null
  $nodeSource = 'portable'

  $systemNode = Get-Command -Name 'node.exe' -ErrorAction SilentlyContinue
  if ($systemNode) {
    try {
      $ver = & $systemNode.Source -v
      if ((Get-NodeMajor -VersionText $ver) -ge 18) {
        $nodeExe = $systemNode.Source
        $nodePrefix = Split-Path -Path $nodeExe -Parent
        $nodeSource = 'system'
        Write-Host ('      Node.js: ' + $ver + ' (already installed)')
      } else {
        Write-Host ('      Node.js ' + $ver + ' is too old — portable Node 22')
      }
    } catch {}
  }
  if (-not $nodeExe) {
    $portableExe = Get-PortableNode -AppData $AppData -NodeVersion $NodeVersion
    if ($portableExe) {
      $nodeExe = $portableExe
      $nodePrefix = Split-Path -Path $nodeExe -Parent
      Write-Host '      Node.js: portable copy already on this PC'
    }
  }
  if (-not $nodeExe) {
    $nodeExe = Install-PortableNode -AppData $AppData -NodeVersion $NodeVersion
    $nodePrefix = Split-Path -Path $nodeExe -Parent
    $nodeSource = 'portable'
  }

  $gitExe = Find-GitExe
  if ($gitExe) {
    Write-Host ('      Git: ' + $gitExe)
  } else {
    Write-Host '      Git: skip (not required to start the coder)'
  }
  $browserExe = Find-BrowserExe
  if ($browserExe) {
    Write-Host ('      Browser: ' + $browserExe)
  } else {
    Write-Host '      Browser: skip (not required to start the coder)'
  }

  $pathNow = Get-EnvVar -Name 'Path'
  $pathBits = @()
  if ($nodePrefix) { $pathBits += $nodePrefix }
  if ($gitExe) {
    $gitDir = Split-Path -Path $gitExe -Parent
    $pathBits += $gitDir
  }
  $pathBits += $pathNow
  Set-EnvVar -Name 'Path' -Value ($pathBits -join ';')
  $npmCmd = Join-Path -Path $nodePrefix -ChildPath 'npm.cmd'
  if (-not (Test-Path -LiteralPath $npmCmd)) {
    $npmCmd = 'npm.cmd'
  }
  Write-Host ('      using Node: ' + $nodeExe + ' (' + $nodeSource + ')')

  Set-Location -LiteralPath $Root
  try {
    Unblock-File -Path (Join-Path -Path $Root -ChildPath 'start-grok-coder.cmd') -ErrorAction SilentlyContinue
    Unblock-File -Path (Join-Path -Path $Root -ChildPath 'scripts\start-grok-coder.ps1') -ErrorAction SilentlyContinue
  } catch {}

  $bakedKey = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY')
  if (-not $bakedKey) { $bakedKey = [Environment]::GetEnvironmentVariable('GROK_API_KEY') }
  if (-not $bakedKey) { $bakedKey = '__FEDOR_DEEPSEEK_KEY__' }
  $envLocal = Join-Path -Path $Root -ChildPath '.env.local'
  $baked = @(
    ('DEEPSEEK_API_KEY=' + $bakedKey),
    ('GROK_API_KEY=' + $bakedKey),
    'GROK_PROVIDER=deepseek',
    'GROK_BASE_URL=https://api.deepseek.com/v1',
    'GROK_MODEL=deepseek-chat',
    'FAST_MODEL=deepseek-chat',
    'FEDOR_HUB_ADMIN_KEY=fedor-uchet',
    ('FEDOR_HUB_DIR=' + (Join-Path -Path $LocalApp -ChildPath 'Fedor2\hub')),
    ('GROK_WORKSPACE=' + $workspace)
  )
  $needWrite = $true
  if (Test-Path -LiteralPath $envLocal) {
    $now = [IO.File]::ReadAllText($envLocal)
    if ($now -match 'DEEPSEEK_API_KEY=\S+' -or $now -match 'GROK_API_KEY=\S+') { $needWrite = $false }
  }
  if ($needWrite) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($envLocal, (($baked -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
  } elseif (Test-Path -LiteralPath $envLocal) {
    $nowEnv = [IO.File]::ReadAllText($envLocal)
    if ($nowEnv -notmatch 'FEDOR_HUB_DIR=') {
      $utf8 = New-Object System.Text.UTF8Encoding $false
      $hubLine = 'FEDOR_HUB_DIR=' + (Join-Path -Path $LocalApp -ChildPath 'Fedor2\hub')
      [IO.File]::WriteAllText($envLocal, ($nowEnv.TrimEnd() + [Environment]::NewLine + $hubLine + [Environment]::NewLine), $utf8)
    }
  }
  if ($bakedKey -and ($bakedKey -ne '__FEDOR_DEEPSEEK_KEY__')) {
    Set-EnvVar -Name 'DEEPSEEK_API_KEY' -Value $bakedKey
    Set-EnvVar -Name 'GROK_API_KEY' -Value $bakedKey
  }
  Set-EnvVar -Name 'GROK_PROVIDER' -Value 'deepseek'
  Set-EnvVar -Name 'GROK_BASE_URL' -Value 'https://api.deepseek.com/v1'
  Write-Host '[5/8] Keys: .env.local ready'

  Set-EnvVar -Name 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD' -Value '1'
  $alreadyReady = Test-AppAlreadyReady -Root $Root -NodeOk $true
  if ($alreadyReady) {
    Write-Host '[6/8] This PC already has Node, packages, and the window — skip downloads'
  } else {
    Write-Host '[6/8] npm packages + native binaries (esbuild, Electron)...'
    Install-NpmPackages -Root $Root -NodeExe $nodeExe -NpmCmd $npmCmd
  }

  $nextJs = Join-Path -Path $Root -ChildPath 'node_modules\next\dist\bin\next'
  if (-not (Test-Path -LiteralPath $nextJs)) {
    throw 'Next.js missing after npm install'
  }

  $guard = Join-Path -Path $Root -ChildPath 'coder-v2\src\guard.cjs'
  if (-not (Test-Path -LiteralPath $guard)) {
    throw 'Не найден предохранитель: coder-v2\src\guard.cjs (кодер без guard не запускаем)'
  }
  Write-Host '[6b/8] Guard selftest...'
  $guardOut = & $nodeExe $guard selftest 2>&1
  $guardExit = $LASTEXITCODE
  Write-Host ('      ' + [string]$guardOut)
  if ($guardExit -ne 0) {
    Write-Host ('      guard selftest warning (код ' + $guardExit + '): ' + [string]$guardOut)
  }

  $agentDir = Join-Path -Path $workspace -ChildPath '.agent'
  $bundledPack = Join-Path -Path $Root -ChildPath '.agent'
  $bundledAgent = Join-Path -Path $Root -ChildPath 'coder-v2\src\agent'
  New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
  foreach ($name in @('goal-brain.mjs', 'loop-guard.mjs', 'loop-guard.json', 'resume-goal.mjs', 'check.bat', 'check-guard.bat')) {
    $src = $null
    $packSrc = Join-Path -Path $bundledPack -ChildPath $name
    $kitSrc = Join-Path -Path $bundledAgent -ChildPath $name
    if (Test-Path -LiteralPath $packSrc) { $src = $packSrc }
    elseif (Test-Path -LiteralPath $kitSrc) { $src = $kitSrc }
    if ($src) {
      $dst = Join-Path -Path $agentDir -ChildPath $name
      Copy-Item -LiteralPath $src -Destination $dst -Force
      Write-Host ('      goal-brain: ' + $name)
    }
  }

  Set-EnvVar -Name 'GROK_NODE' -Value $nodeExe
  Set-EnvVar -Name 'GROK_PORT' -Value ([string]$Port)
  Set-EnvVar -Name 'GROK_DESKTOP' -Value '1'
  $ngpNow = Get-EnvVar -Name 'FEDOR_NGP'
  $ngpLow = ''
  if ($ngpNow) { $ngpLow = ([string]$ngpNow).Trim().ToLower() }
  if ($ngpLow -ne '0' -and $ngpLow -ne 'false' -and $ngpLow -ne 'off' -and $ngpLow -ne 'no') {
    Set-EnvVar -Name 'FEDOR_NGP' -Value '1'
  }
  $skuNow = 'paid'
  try { $skuNow = Get-PackedSku -Root $Root } catch { $skuNow = 'paid' }
  if ($skuNow -ne 'free') { $skuNow = 'paid' }
  Set-EnvVar -Name 'FEDOR_SKU' -Value $skuNow
  Set-EnvVar -Name 'FEDOR_APP_ROOT' -Value $Root
  if ($skuNow -eq 'free') { Set-EnvVar -Name 'FEDOR_FREE' -Value '1' }
  $hubDir = ''
  $laHub = Get-EnvVar -Name 'LOCALAPPDATA'
  if ($laHub) { $hubDir = Join-Path -Path $laHub -ChildPath 'Fedor2\hub' }
  if (-not $hubDir) { $hubDir = Join-Path -Path $UserProfile -ChildPath 'AppData\Local\Fedor2\hub' }
  Set-EnvVar -Name 'FEDOR_HUB_DIR' -Value $hubDir
  Set-EnvVar -Name 'FEDOR_HUB_ADMIN_KEY' -Value 'fedor-uchet'

  Write-Host '[7/8] Visual C++ + Electron window...'
  if (-not $alreadyReady) {
    Install-VCRedistIfMissing
  } else {
    Write-Host '      VC++ / Electron already present'
  }
  $electronExe = Install-ElectronBinary -Root $Root -NodeExe $nodeExe
  $electronMain = Join-Path -Path $Root -ChildPath 'electron\main.cjs'

  $skipLaunch = Get-EnvVar -Name 'FEDOR_SKIP_LAUNCH'
  if ($skipLaunch -eq '1') {
    Write-InstallOkStamp -Root $Root
    Install-Launchers -AppRoot $Root -WorkspacePath $workspace -ProfileDir $UserProfile -NodeBin $nodeExe
    Write-Host '[8/8] FEDOR_SKIP_LAUNCH=1 — install finished without opening the window'
    Set-SetupUi -Pct 100 -Msg 'Готово' -Sub 'На рабочем столе ярлык: AA Coder Fedor 3.0' -Done 1
    try { Stop-Transcript | Out-Null } catch {}
    exit 0
  }

  if ((Test-Path -LiteralPath $electronExe) -and (Test-Path -LiteralPath $electronMain)) {
    Write-Host ('[8/8] Opening ' + $script:AppTitle + '...')
    Write-Host '      Type at the BOTTOM. Ctrl+C / Ctrl+V work.'
    Write-Host '      Open again: Desktop shortcut  AA Coder Fedor 3.0'
    Write-InstallOkStamp -Root $Root
    Install-Launchers -AppRoot $Root -WorkspacePath $workspace -ProfileDir $UserProfile -NodeBin $nodeExe
    Set-SetupUi -Pct 96 -Msg 'Запускаю кодер' -Sub 'Дальше один ярлык на рабочем столе'
    $appProc = Start-Process -FilePath $electronExe -ArgumentList @('.') -WorkingDirectory $Root -PassThru
    if (-not $appProc) { throw 'Failed to start Electron' }
    Start-Sleep -Seconds 3
    if ($appProc.HasExited) {
      Write-Host ('      window closed quickly (code ' + $appProc.ExitCode + '). Open the Desktop shortcut.')
    }
    $up = $false
    $n = 0
    while ($n -lt 40) {
      $n = $n + 1
      try {
        $probe = Invoke-WebRequest -UseBasicParsing -Uri ($IdeUrl + '/') -TimeoutSec 2
        if ($probe.StatusCode -ge 200) { $up = $true; break }
      } catch {}
      if ($appProc.HasExited) {
        Write-Host ('      window closed before the page was ready. Open the Desktop shortcut.')
        break
      }
      Start-Sleep -Seconds 2
    }
    if (-not $up) {
      Write-Host ('WARNING: window is open but http://127.0.0.1:' + $Port + ' is not ready yet.')
      Write-Host ('      Wait on the splash. If it stays black, open %TEMP%\fedor2-next.log')
    }
    Write-Host 'READY: desktop window started.'
    Write-Host 'You MAY close this console. Close the Coder window to quit.'
    Set-SetupUi -Pct 100 -Msg 'Готово' -Sub 'На рабочем столе ярлык: AA Coder Fedor 3.0' -Done 1
    Start-Sleep -Seconds 4
    try { Stop-Transcript | Out-Null } catch {}
    exit 0
  }

  Write-Host '[8/8] Electron missing, starting local UI without desktop wrapper...'
  $already = $false
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -Uri ($IdeUrl + '/') -TimeoutSec 3
    if ($probe.StatusCode -eq 200) { $already = $true }
  } catch {}
  if ($already) {
    Write-Host ('Already running at ' + $IdeUrl)
    Write-Host 'Open Coder from the desktop shortcut if you have one.'
    try { [void](Read-Host 'Press Enter to close this window') } catch { Start-Sleep -Seconds 12 }
    try { Stop-Transcript | Out-Null } catch {}
    exit 0
  }

  $buildId = Join-Path -Path $Root -ChildPath '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildId)) {
    throw 'Packed build missing (.next). Run AA-Coder-Fedor-3.0-Setup.bat again (full file).'
  }
  Write-Host ('Starting packed coder at ' + $IdeUrl)
  Write-Host 'Window MUST stay open in this fallback mode.'
  & $nodeExe $nextJs start --port $Port --hostname 127.0.0.1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw ('Server exited with code ' + $code + '. See messages above.')
  }
} catch {
  Pause-Error $_.Exception.Message
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

try { Stop-Transcript | Out-Null } catch {}
Write-Host 'Stopped.'
try { [void](Read-Host 'Press Enter to close') } catch { Start-Sleep -Seconds 8 }
exit 0
