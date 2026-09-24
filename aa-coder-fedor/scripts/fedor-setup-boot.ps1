#requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
Write-Host ''
Write-Host 'AA Coder Fedor 3.0'
Write-Host 'Keep this window open. Setup UI is opening.'
Write-Host ''
$self = [Environment]::GetEnvironmentVariable('GROK_SELF')
if (-not $self) { throw 'GROK_SELF missing' }
if (-not (Test-Path -LiteralPath $self)) { throw 'Setup file not found. Copy the full AA-Coder-Fedor-4-Setup.bat, not a shortcut.' }
$raw = [IO.File]::ReadAllText($self)
$tmp = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
if (-not $tmp) { $tmp = [Environment]::GetEnvironmentVariable('TEMP') }
if (-not $tmp) { $tmp = [Environment]::GetEnvironmentVariable('TMP') }
$tmp = Join-Path -Path $tmp -ChildPath 'Fedor2'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$SkipUi = [Environment]::GetEnvironmentVariable('FEDOR_SKIP_LAUNCH')
$AdFiles = @('ad-code.jpg','ad-both.jpg','ad-parallel.jpg','ad-memory.jpg','ad-agents.jpg','ad-sbp.jpg','ad-crew.jpg','ad-free.jpg')
$AllNames = @('GROK_BOOT','GROK_HTA','GROK_AD_ad-code.jpg','GROK_AD_ad-both.jpg','GROK_AD_ad-parallel.jpg','GROK_AD_ad-memory.jpg','GROK_AD_ad-agents.jpg','GROK_AD_ad-sbp.jpg','GROK_AD_ad-crew.jpg','GROK_AD_ad-free.jpg','GROK_INSTALL_PS1','GROK_APP_ZIP','GROK_END')

function Get-SectionBytes {
  param([string]$Text, [string]$Name)
  $startTok = '-----' + $Name + '-----'
  $i = $Text.LastIndexOf($startTok)
  if ($i -lt 0) { return $null }
  $from = $i + $startTok.Length
  $end = $Text.Length
  foreach ($other in $AllNames) {
    if ($other -eq $Name) { continue }
    $tok = '-----' + $other + '-----'
    $j = $Text.IndexOf($tok, $from)
    if ($j -ge 0 -and $j -lt $end) { $end = $j }
  }
  $b64 = [regex]::Replace($Text.Substring($from, $end - $from), '[^A-Za-z0-9+/=]', '')
  if ($b64.Length -lt 8) { return $null }
  try { return [Convert]::FromBase64String($b64) } catch { return $null }
}

function Write-SectionFile {
  param([string]$Text, [string]$Name, [string]$Dest)
  $bytes = Get-SectionBytes -Text $Text -Name $Name
  if (-not $bytes) { return $false }
  [IO.File]::WriteAllBytes($Dest, $bytes)
  return $true
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

function Write-Ui {
  param([int]$Pct, [string]$Msg, [string]$Sub, [string]$Err)
  $uiFile = Join-Path -Path $tmp -ChildPath 'fedor2-setup-ui.txt'
  $nl = [Environment]::NewLine
  $errText = [string]$Err
  $subText = [string]$Sub
  if ($errText -and -not $subText) { $subText = $errText }
  $doneBit = '0'
  if ($errText) { $doneBit = '1' }
  $logText = $errText
  $body = 'PCT=' + [int]$Pct + $nl + 'MSG=' + [string]$Msg + $nl + 'SUB=' + $subText + $nl + 'LOG=' + $logText + $nl + 'DONE=' + $doneBit + $nl + 'ERR=' + $errText + $nl
  $unicode = New-Object System.Text.UnicodeEncoding $false, $true
  try { [IO.File]::WriteAllText($uiFile, $body, $unicode) } catch {}
  $tempDir = [Environment]::GetEnvironmentVariable('TEMP')
  if ($tempDir) {
    $tempUi = Join-Path -Path $tempDir -ChildPath 'fedor2-setup-ui.txt'
    if ($tempUi -ne $uiFile) {
      try { [IO.File]::WriteAllText($tempUi, $body, $unicode) } catch {}
    }
  }
}

function Start-HtaIfNeeded {
  $ready = [Environment]::GetEnvironmentVariable('GROK_HTA_READY')
  if ($ready -eq '1') { return }
  if ($SkipUi -eq '1') { return }
  $htaPath = Join-Path -Path $tmp -ChildPath 'fedor2-setup.hta'
  Write-SectionFile -Text $raw -Name 'GROK_HTA' -Dest $htaPath | Out-Null
  foreach ($n in $AdFiles) {
    Write-SectionFile -Text $raw -Name ('GROK_AD_' + $n) -Dest (Join-Path -Path $tmp -ChildPath $n) | Out-Null
  }
  Write-Ui -Pct 4 -Msg 'Installing' -Sub 'Setup is running. Progress will move up.'
  try {
    if (Test-Path -LiteralPath $htaPath) {
      $sysRoot = [Environment]::GetEnvironmentVariable('SystemRoot')
      if (-not $sysRoot) { $sysRoot = 'C:\Windows' }
      $mshta = Join-Path -Path $sysRoot -ChildPath 'System32\mshta.exe'
      if (Test-Path -LiteralPath $mshta) {
        Start-Process -FilePath $mshta -ArgumentList ('"' + $htaPath + '"')
      }
    }
  } catch {}
  [Environment]::SetEnvironmentVariable('GROK_HTA_READY', '1', 'Process')
}

function Show-BootError {
  param($Rec, [string]$Message)
  $text = ''
  if ($Rec) {
    try { $text = Format-ErrorText $Rec } catch {}
  }
  if (-not $text) { $text = [string]$Message }
  if (-not $text) { $text = 'Setup failed' }
  Write-Host ''
  Write-Host ('ERROR: ' + $text)
  try { Write-Ui -Pct 100 -Msg 'Setup stopped' -Sub $text -Err $text } catch {}
  try { [void](Read-Host 'Press Enter to close') } catch { Start-Sleep -Seconds 20 }
  exit 1
}

try {
  Start-HtaIfNeeded
  $ps1Path = Join-Path -Path $tmp -ChildPath 'grok-coder-install.ps1'
  $ps1Bytes = Get-SectionBytes -Text $raw -Name 'GROK_INSTALL_PS1'
  if (-not $ps1Bytes) { throw 'Installer payload missing. The Setup.bat was truncated. Copy the whole file again.' }
  if ($ps1Bytes.Length -lt 3 -or $ps1Bytes[0] -ne 239 -or $ps1Bytes[1] -ne 187 -or $ps1Bytes[2] -ne 191) {
    $bom = [byte[]](239, 187, 191)
    $withBom = New-Object byte[] ($ps1Bytes.Length + 3)
    [System.Buffer]::BlockCopy($bom, 0, $withBom, 0, 3)
    [System.Buffer]::BlockCopy($ps1Bytes, 0, $withBom, 3, $ps1Bytes.Length)
    $ps1Bytes = $withBom
  }
  [IO.File]::WriteAllBytes($ps1Path, $ps1Bytes)
  $zipBytes = Get-SectionBytes -Text $raw -Name 'GROK_APP_ZIP'
  if ($zipBytes -and $zipBytes.Length -gt 80) {
    $zipPath = Join-Path -Path $tmp -ChildPath 'grok-coder-app.zip'
    [IO.File]::WriteAllBytes($zipPath, $zipBytes)
    [Environment]::SetEnvironmentVariable('GROK_READY_ZIP', $zipPath, 'Process')
  }
  Write-Ui -Pct 8 -Msg 'Installing' -Sub 'Unpacking the coder'
  & $ps1Path
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} catch {
  Show-BootError -Rec $_
}
