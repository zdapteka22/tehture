#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$TempDir = [Environment]::GetEnvironmentVariable('TEMP')
$LogPath = Join-Path -Path $TempDir -ChildPath 'fedor2-launch.log'
try { Start-Transcript -Path $LogPath -Force | Out-Null } catch {}
try {
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$ProgressPreference = 'SilentlyContinue'

$Yo = [char]0x0451
$AppTitle = 'AA coder f' + $Yo + 'dor 3.0'
Write-Host ''
Write-Host '=============================================='
Write-Host ('  ' + $AppTitle)
Write-Host '  Checking this PC and downloading what is missing.'
Write-Host '  Keep this window open until the desktop app starts.'
Write-Host '=============================================='

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Need 64-bit Windows 10 or newer.' }
$osVer = [Environment]::OSVersion.Version
if ($osVer.Major -lt 10) { throw 'Need Windows 10 or newer.' }

$ZipUrl = ''
$LocalApp = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
$UserProfile = [Environment]::GetEnvironmentVariable('USERPROFILE')
$SetupDir = [Environment]::GetEnvironmentVariable('GROK_SETUP_DIR')
$ReadyZip = [Environment]::GetEnvironmentVariable('GROK_READY_ZIP')
$HomeDir = Join-Path -Path $LocalApp -ChildPath 'Fedor2'
$AppRoot = Join-Path -Path $LocalApp -ChildPath 'AA Coder Fedor 3.0'
$ZipPath = Join-Path -Path $HomeDir -ChildPath 'grok-coder.zip'
$EnvBody = @'
GROK_API_KEY=__FEDOR_DEEPSEEK_KEY__
DEEPSEEK_API_KEY=__FEDOR_DEEPSEEK_KEY__
GROK_PROVIDER=deepseek
GROK_BASE_URL=https://api.deepseek.com/v1
GROK_MODEL=deepseek-chat
FAST_MODEL=deepseek-chat
FEDOR_HUB_ADMIN_KEY=fedor-uchet
'@
$UiFile = Join-Path -Path $TempDir -ChildPath 'fedor2-setup-ui.txt'
$HtaPath = Join-Path -Path $TempDir -ChildPath 'fedor2-setup.hta'
$FromBootstrap = [Environment]::GetEnvironmentVariable('GROK_FROM_BOOTSTRAP')

function Set-SetupUi {
  param([int]$Pct, [string]$Msg, [string]$Sub, [string]$Log, [string]$Err, [int]$Done)
  $pctN = 0
  if ($Pct) { $pctN = [int]$Pct }
  $doneBit = '0'
  if ($Done) { $doneBit = '1' }
  $nl = [Environment]::NewLine
  $errText = [string]$Err
  $subText = [string]$Sub
  if ($errText -and -not $subText) { $subText = $errText }
  $logText = [string]$Log
  if ($errText -and -not $logText) { $logText = $errText }
  $body = 'PCT=' + $pctN + $nl + 'MSG=' + [string]$Msg + $nl + 'SUB=' + $subText + $nl + 'LOG=' + $logText + $nl + 'DONE=' + $doneBit + $nl + 'ERR=' + $errText + $nl
  $unicode = New-Object System.Text.UnicodeEncoding $false, $true
  try { [System.IO.File]::WriteAllText($UiFile, $body, $unicode) } catch {}
}

function Format-ErrorText {
  param($Rec)
  $chunks = New-Object System.Collections.Generic.List[string]
  $bag = New-Object System.Collections.Generic.List[string]
  try { if ($Rec -and $Rec.Exception) { [void]$bag.Add([string]$Rec.Exception.Message) } } catch {}
  try { if ($Rec -and $Rec.InvocationInfo) { [void]$bag.Add([string]$Rec.InvocationInfo.PositionMessage) } } catch {}
  try { if ($Rec -and $Rec.InvocationInfo) { [void]$bag.Add([string]$Rec.InvocationInfo.Line) } } catch {}
  try { if ($Rec -and $Rec.Exception) { [void]$bag.Add([string]$Rec.Exception) } } catch {}
  try { if ($Rec) { [void]$bag.Add([string]$Rec) } } catch {}
  foreach ($t in $bag) {
    if (-not $t) { continue }
    $one = [regex]::Replace([string]$t, '[\r\n]+', ' | ')
    $one = $one.Trim()
    if (-not $one) { continue }
    if (-not $chunks.Contains($one)) { [void]$chunks.Add($one) }
  }
  if ($chunks.Count -lt 1) { return 'Setup failed with no message' }
  return ($chunks -join ' || ')
}

function Start-SetupUi {
  Set-SetupUi -Pct 4 -Msg 'Ставлю кодер' -Sub 'Идет установка. Проценты пойдут вверх.'
  $htaReady = [Environment]::GetEnvironmentVariable('GROK_HTA_READY')
  if ($htaReady -eq '1') { return }
  if ($FromBootstrap -eq '1') { return }
  try {
    $sysRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
    if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
    $mshta = Join-Path -Path $sysRoot -ChildPath 'System32\mshta.exe'
    if ((Test-Path -LiteralPath $mshta) -and (Test-Path -LiteralPath $HtaPath)) {
      Start-Process -FilePath $mshta -ArgumentList ('"' + $HtaPath + '"')
    }
  } catch {}
}

Start-SetupUi


function Test-ZipOk {
  param([string]$Path, [int]$MinBytes)
  if (-not $Path) { return $false }
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt $MinBytes) { return $false }
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    return ($fs.ReadByte() -eq 80 -and $fs.ReadByte() -eq 75)
  } finally { $fs.Close() }
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
  param([string[]]$Urls, [string]$Dest, [int]$MinBytes)
  $destDir = Split-Path -Path $Dest -Parent
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $sysRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
  if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
  $curl = Join-Path -Path $sysRoot -ChildPath 'System32\curl.exe'
  foreach ($url in $Urls) {
    if (-not $url) { continue }
    Write-Host ('      download: ' + $url)
    try {
      if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
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
      if ($ok -and (Test-ZipOk -Path $Dest -MinBytes $MinBytes)) {
        Write-Host ('      ok, ' + (Get-Item -LiteralPath $Dest).Length + ' bytes')
        return $true
      }
    } catch {
      Write-Host ('      fail: ' + $_.Exception.Message)
    }
  }
  return $false
}

function Test-CoderBusy {
  param([string]$Root)
  if (-not $Root) { return $false }
  foreach ($name in @('electron', 'node')) {
    foreach ($p in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
      $pathNow = ''
      try { $pathNow = [string]$p.Path } catch { $pathNow = '' }
      if (-not $pathNow) {
        try { $pathNow = [string]$p.MainModule.FileName } catch { $pathNow = '' }
      }
      if ($pathNow -and ($pathNow.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        return $true
      }
    }
  }
  return $false
}

function Clear-AppFolder {
  param([string]$Root)
  if (-not $Root) { return $true }
  if (-not (Test-Path -LiteralPath $Root)) { return $true }
  $n = 0
  while ($n -lt 4) {
    $n = $n + 1
    if (Test-CoderBusy -Root $Root) {
      $skipAsk = [Environment]::GetEnvironmentVariable('FEDOR_SKIP_LAUNCH')
      if ($skipAsk -eq '1') {
        Write-Host '      previous Coder still running — will install next to it'
        break
      }
      Write-Host ''
      Write-Host 'The Coder window is still open. Close it with the X (the app window, not this black console).'
      Write-Host 'Then press Enter here to continue setup.'
      try { [void](Read-Host) } catch { Start-Sleep -Seconds 8 }
    }
    try {
      Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction Stop
      if (-not (Test-Path -LiteralPath $Root)) { return $true }
    } catch {
      Write-Host ('      folder in use: ' + $_.Exception.Message)
      Start-Sleep -Seconds 2
    }
  }
  return $false
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

function Get-InstallLauncherDirs {
  $list = New-Object System.Collections.Generic.List[string]
  $add = {
    param([string]$PathValue)
    if ($PathValue -and -not $list.Contains($PathValue)) { [void]$list.Add($PathValue) }
  }
  & $add ([Environment]::GetFolderPath('Desktop'))
  & $add (Join-Path -Path $UserProfile -ChildPath 'Desktop')
  & $add (Join-Path -Path $UserProfile -ChildPath 'OneDrive\Desktop')
  & $add (Join-Path -Path $UserProfile -ChildPath 'OneDrive\Рабочий стол')
  & $add (Join-Path -Path $UserProfile -ChildPath 'Рабочий стол')
  return $list
}

function Remove-InstallLaunchers {
  $shortcutName = 'AA Coder Fedor 3.0.lnk'
  $batName = 'AA Coder Fedor 3.0.bat'
  $dirs = Get-InstallLauncherDirs
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

function Get-PackedSku {
  param([string]$Root)
  if (-not $Root) { return 'paid' }
  $stamp = Join-Path -Path $Root -ChildPath '.fedor-sku'
  if (Test-Path -LiteralPath $stamp) {
    $raw = ([IO.File]::ReadAllText($stamp)).Trim().ToLower()
    if ($raw -eq 'free' -or $raw -eq 'paid') { return $raw }
  }
  $brand = Join-Path -Path $Root -ChildPath 'lib\brand.ts'
  if (Test-Path -LiteralPath $brand) {
    $txt = [IO.File]::ReadAllText($brand)
    if ($txt -match 'IS_FREE_EDITION\s*=\s*true') { return 'free' }
    if ($txt -match 'IS_FREE_EDITION\s*=\s*false') { return 'paid' }
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

function Sync-PackedEdition {
  param([string]$Root, [string]$ZipPath)
  $okFile = Join-Path -Path $Root -ChildPath '.fedor-install-ok'
  try { Remove-Item -LiteralPath $okFile -Force -ErrorAction SilentlyContinue } catch {}
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $sku = Get-PackedSku -Root $Root
  [IO.File]::WriteAllText((Join-Path -Path $Root -ChildPath '.fedor-sku'), ($sku + [Environment]::NewLine), $utf8)
  $nextSku = Get-NextSku -Root $Root
  if ($nextSku -ne $sku) {
    Write-Host ('      leftover UI from another edition (' + $nextSku + ') — unpacking ' + $sku)
    $nextDir = Join-Path -Path $Root -ChildPath '.next'
    try { Remove-Item -LiteralPath $nextDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    if ($ZipPath -and (Test-Path -LiteralPath $ZipPath)) {
      try { Expand-ZipSafe -ZipPath $ZipPath -Dest $Root } catch {
        Write-Host ('      unpack leftover: ' + $_.Exception.Message)
      }
    }
    $sku = Get-PackedSku -Root $Root
    [IO.File]::WriteAllText((Join-Path -Path $Root -ChildPath '.fedor-sku'), ($sku + [Environment]::NewLine), $utf8)
  }
}

function Write-InstallLaunchers {
  param([string]$NodeBin)
  if (-not $NodeBin) {
    $seedNode = Join-Path -Path $HomeDir -ChildPath 'node\node-v22.19.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $seedNode) { $NodeBin = $seedNode }
  }
  $starter = Join-Path -Path $AppRoot -ChildPath 'start-grok-coder.cmd'
  $electronExe = Join-Path -Path $AppRoot -ChildPath 'node_modules\electron\dist\electron.exe'
  $electronMain = Join-Path -Path $AppRoot -ChildPath 'electron\main.cjs'
  $okStamp = Join-Path -Path $AppRoot -ChildPath '.fedor-install-ok'
  $profileHome = Join-Path -Path $UserProfile -ChildPath 'Fedor2'
  New-Item -ItemType Directory -Force -Path $profileHome | Out-Null
  $nl = [Environment]::NewLine
  $nodeLine = 'rem GROK_NODE from this PC'
  if ($NodeBin) { $nodeLine = 'set "GROK_NODE=' + $NodeBin + '"' }
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
  ) -join $nl
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $nl = [Environment]::NewLine
  $homeBat = Join-Path -Path $profileHome -ChildPath 'AA Coder Fedor 3.0.bat'

  $dirs = New-Object System.Collections.Generic.List[string]
  $add = {
    param([string]$PathValue)
    if ($PathValue -and -not $dirs.Contains($PathValue)) {
      [void]$dirs.Add($PathValue)
    }
  }
  & $add ([Environment]::GetFolderPath('Desktop'))
  & $add (Join-Path -Path $UserProfile -ChildPath 'Desktop')
  & $add (Join-Path -Path $UserProfile -ChildPath 'OneDrive\Desktop')
  & $add (Join-Path -Path $UserProfile -ChildPath 'OneDrive\Рабочий стол')
  & $add (Join-Path -Path $UserProfile -ChildPath 'Рабочий стол')

  $junk = @(
    'AA Coder Fedor 4.bat',
    'Coder 4.bat',
    'AA Coder Fedor 4.cmd',
    'AA Coder Fedor 4.lnk',
    'Coder 4.lnk'
  )
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    foreach ($n in $junk) {
      $old = Join-Path -Path $d -ChildPath $n
      if (Test-Path -LiteralPath $old) {
        try { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }

  $homeBat = Join-Path -Path $profileHome -ChildPath 'AA Coder Fedor 3.0.bat'
  [System.IO.File]::WriteAllText($homeBat, $batBody + $nl, $utf8)

  $shortcutName = 'AA Coder Fedor 3.0.lnk'
  $userDesk = [Environment]::GetFolderPath('Desktop')
  if (-not $userDesk) { $userDesk = Join-Path -Path $UserProfile -ChildPath 'Desktop' }
  if ($userDesk -and -not (Test-Path -LiteralPath $userDesk)) {
    try { New-Item -ItemType Directory -Force -Path $userDesk | Out-Null } catch {}
  }
  $profileDesk = Join-Path -Path $UserProfile -ChildPath 'Desktop'
  if ($profileDesk -and -not (Test-Path -LiteralPath $profileDesk)) {
    try { New-Item -ItemType Directory -Force -Path $profileDesk | Out-Null } catch {}
  }
  $startMenu = [Environment]::GetFolderPath('StartMenu')
  $programs = Join-Path -Path $startMenu -ChildPath 'Programs'
  try { New-Item -ItemType Directory -Force -Path $programs | Out-Null } catch {}
  if ($programs) { & $add $programs }

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
    foreach ($d in $dirs) {
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

  foreach ($d in $dirs) {
    if (-not $d) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $lnkPath = Join-Path -Path $d -ChildPath $shortcutName
    if ((Test-Path -LiteralPath $lnkPath) -and (Test-FedorLnkOk -PathValue $lnkPath)) { continue }
    if (Test-Path -LiteralPath $lnkPath) {
      try { Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue } catch {}
    }
    try {
      $fallback = Join-Path -Path $d -ChildPath 'AA Coder Fedor 3.0.bat'
      [System.IO.File]::WriteAllText($fallback, $batBody + $nl, $utf8)
      try { Unblock-File -Path $fallback -ErrorAction SilentlyContinue } catch {}
      $written = $written + 1
    } catch {}
  }

  Write-Host ('      Desktop shortcut: AA Coder Fedor 3.0  (' + $written + ')')
  if ($written -lt 1) {
    throw 'Не получилось создать ярлык на рабочем столе. На столе должен появиться файл AA Coder Fedor 3.0'
  }

  $deskLnk = Join-Path -Path $userDesk -ChildPath $shortcutName
  $deskBatUn = Join-Path -Path $userDesk -ChildPath 'AA Coder Fedor 3.0.bat'
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
    'echo Done. Project files in Fedor2workspace were kept.',
    'pause'
  )
  try {
    [System.IO.File]::WriteAllText($unPath, (($unLines -join $nl) + $nl), $utf8)
  } catch {}
}

Write-Host '[1/5] Checking this PC...'
Set-SetupUi -Pct 8 -Msg 'Проверяю Windows' -Sub 'Ярлык появится только когда установка закончится'
try { Remove-InstallLaunchers } catch {}
Write-Host ('      Windows ' + $osVer + ' 64-bit')
Write-Host ('      Install folder: ' + $AppRoot)
New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

$gotZip = $false
if (Test-ZipOk -Path $ReadyZip -MinBytes 10000) {
  Write-Host '[2/5] App packed inside this installer (no zip download)...'
  Set-SetupUi -Pct 18 -Msg 'Программа уже внутри установщика' -Sub 'Распаковываю файлы'
  Copy-Item -LiteralPath $ReadyZip -Destination $ZipPath -Force
  $gotZip = $true
}

if (-not $gotZip -and $SetupDir) {
  $candidates = @(
    (Join-Path -Path $SetupDir -ChildPath 'grok-coder-windows.zip'),
    (Join-Path -Path $SetupDir -ChildPath 'grok-coder.zip'),
    (Join-Path -Path $SetupDir -ChildPath 'AA-Coder-Fedor-Install.zip')
  )
  foreach ($c in $candidates) {
    if (Test-ZipOk -Path $c -MinBytes 10000) {
      Write-Host ('[2/5] Local zip next to Setup (USB / folder): ' + $c)
      Copy-Item -LiteralPath $c -Destination $ZipPath -Force
      $gotZip = $true
      break
    }
  }
}

if (-not $gotZip) {
  Write-Host '[2/5] Packed zip missing or damaged — downloading app...'
  Set-SetupUi -Pct 20 -Msg 'Скачиваю программу' -Sub 'Маленький файл запускает полный установщик'
  $urls = New-Object System.Collections.Generic.List[string]
  if ($ZipUrl) { [void]$urls.Add($ZipUrl) }
  if (-not (Save-UrlToFile -Urls $urls.ToArray() -Dest $ZipPath -MinBytes 10000)) {
    throw 'No app zip. Double-click AA-Coder-Fedor.bat again (needs internet), or copy grok-coder-windows.zip next to it.'
  }
  $gotZip = $true
}

if (-not (Test-ZipOk -Path $ZipPath -MinBytes 10000)) {
  throw 'App zip is damaged. Copy the full installer file again, or copy grok-coder-windows.zip onto a USB next to Setup.bat.'
}

if (Test-Path -LiteralPath $AppRoot) {
  Write-Host '[3/5] Updating the copy on this PC...'
  Set-SetupUi -Pct 36 -Msg 'Обновляю программу' -Sub 'Если окно кодера открыто — закройте крестиком'
  if (-not (Clear-AppFolder -Root $AppRoot)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $AppRoot = Join-Path -Path $LocalApp -ChildPath ('AA Coder Fedor 3.0-' + $stamp)
    Write-Host ('      previous folder is in use. Installing next to it: ' + $AppRoot)
  }
} else {
  Write-Host '[3/5] Extracting...'
  Set-SetupUi -Pct 36 -Msg 'Распаковываю программу' -Sub 'Идет установка, не черный экран'
}
New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
Write-Host '      extracting files...'
try {
  Expand-ZipSafe -ZipPath $ZipPath -Dest $AppRoot
} catch {
  if ($_.Exception.Message -match 'being used by another process') {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $AppRoot = Join-Path -Path $LocalApp -ChildPath ('AA Coder Fedor 3.0-' + $stamp)
    Write-Host ('      extract blocked. Installing next to it: ' + $AppRoot)
    New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
    Expand-ZipSafe -ZipPath $ZipPath -Dest $AppRoot
  } else {
    throw
  }
}
Get-ChildItem -LiteralPath $AppRoot -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

$nested = Join-Path -Path $AppRoot -ChildPath 'Fedor2'
$nestedPkg = Join-Path -Path $nested -ChildPath 'package.json'
$rootPkg = Join-Path -Path $AppRoot -ChildPath 'package.json'
if ((Test-Path -LiteralPath $nestedPkg) -and -not (Test-Path -LiteralPath $rootPkg)) {
  Get-ChildItem -LiteralPath $nested | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $AppRoot -Force
  }
  Remove-Item -LiteralPath $nested -Recurse -Force -ErrorAction SilentlyContinue
}

$workspace = Join-Path -Path $UserProfile -ChildPath 'Fedor2\workspace'
[Environment]::SetEnvironmentVariable('GROK_WORKSPACE', $workspace, 'Process')
New-Item -ItemType Directory -Force -Path $workspace | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding $false
$envFile = Join-Path -Path $AppRoot -ChildPath '.env.local'
$envText = ($EnvBody.Trim() + [Environment]::NewLine + 'GROK_WORKSPACE=' + $workspace + [Environment]::NewLine)
[System.IO.File]::WriteAllText($envFile, $envText, $utf8)
Write-Host '      Keys written.'

$starter = Join-Path -Path $AppRoot -ChildPath 'scripts\start-grok-coder.ps1'
if (-not (Test-Path -LiteralPath $starter)) { throw 'Archive is missing scripts\start-grok-coder.ps1' }
$bootCmd = Join-Path -Path $AppRoot -ChildPath 'start-grok-coder.cmd'
if (-not (Test-Path -LiteralPath $bootCmd)) { throw 'Archive is missing start-grok-coder.cmd' }
$guard = Join-Path -Path $AppRoot -ChildPath 'coder-v2\src\guard.cjs'
if (-not (Test-Path -LiteralPath $guard)) { throw 'Archive is missing coder-v2\src\guard.cjs' }
$hubCore = Join-Path -Path $AppRoot -ChildPath 'coder-v2\src\hub.cjs'
if (-not (Test-Path -LiteralPath $hubCore)) { throw 'Archive is missing coder-v2\src\hub.cjs' }
$agentDir = Join-Path -Path $workspace -ChildPath '.agent'
$bundledAgent = Join-Path -Path $AppRoot -ChildPath 'coder-v2\src\agent'
if (Test-Path -LiteralPath $bundledAgent) {
  New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
  foreach ($name in @('goal-brain.mjs', 'loop-guard.mjs')) {
    $src = Join-Path -Path $bundledAgent -ChildPath $name
    $dst = Join-Path -Path $agentDir -ChildPath $name
    if ((Test-Path -LiteralPath $src) -and -not (Test-Path -LiteralPath $dst)) {
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
  }
}
$nodeCmd = Get-Command -Name node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  Write-Host ('      Node.js: ' + (& node --version))
} else {
  Write-Host '      Node.js not in PATH yet — portable Node will be installed.'
}

Write-Host '[4/5] Checking this copy...'
Set-SetupUi -Pct 58 -Msg 'Проверяю файлы' -Sub 'Сначала ярлык на рабочем столе, потом запуск'
Sync-PackedEdition -Root $AppRoot -ZipPath $ZipPath
Write-InstallOkStamp -Root $AppRoot
Write-InstallLaunchers

Write-Host '[5/5] Checking Node / packages / Electron and starting...'
Set-SetupUi -Pct 68 -Msg 'Проверяю Node и пакеты' -Sub 'Если чего-то нет — скачаю. Проценты идут вверх.'
$skipLaunch = [Environment]::GetEnvironmentVariable('FEDOR_SKIP_LAUNCH')
if ($skipLaunch -eq '1') {
  Write-Host '      FEDOR_SKIP_LAUNCH=1 — window will not open'
  Set-SetupUi -Pct 100 -Msg 'Готово' -Sub 'На рабочем столе ярлык: AA Coder Fedor 3.0' -Done 1
} else {
  try {
    & $starter
  } catch {
    Write-Host ('      start warning: ' + $_.Exception.Message)
  }
  Set-SetupUi -Pct 100 -Msg 'Готово' -Sub 'На рабочем столе ярлык: AA Coder Fedor 3.0' -Done 1
}
} catch {
  $errText = Format-ErrorText $_
  $pkg = Join-Path -Path $AppRoot -ChildPath 'package.json'
  $filesReady = Test-Path -LiteralPath $pkg
  if ($filesReady) {
    try { Write-InstallOkStamp -Root $AppRoot } catch {}
    try { Write-InstallLaunchers } catch {}
    Write-Host '      Files are in place. Open AA Coder Fedor 3.0 from the Desktop.'
    try { Set-SetupUi -Pct 100 -Msg 'Готово' -Sub 'На рабочем столе ярлык: AA Coder Fedor 3.0' -Done 1 } catch {}
    exit 0
  }
  Write-Host ''
  Write-Host ('ERROR: ' + $errText) -ForegroundColor Red
  Write-Host ('Log: ' + $LogPath)
  try { Set-SetupUi -Pct 100 -Msg 'Установка остановилась' -Sub $errText -Log $errText -Err $errText -Done 1 } catch {}
  try { [void](Read-Host 'Press Enter to close') } catch { Start-Sleep -Seconds 16 }
  exit 1
}
