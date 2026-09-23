#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$TempDir = [Environment]::GetEnvironmentVariable('TEMP')
if (-not $TempDir) { $TempDir = [Environment]::GetFolderPath('LocalApplicationData') }
$Log = Join-Path -Path $TempDir -ChildPath 'fedor-hub.log'
$Alive = Join-Path -Path $TempDir -ChildPath 'fedor-hub-alive.flag'
$LocalApp = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
if (-not $LocalApp) { $LocalApp = Join-Path -Path ([Environment]::GetFolderPath('UserProfile')) -ChildPath 'AppData\Local' }
$HubRoot = Join-Path -Path $LocalApp -ChildPath 'Fedor2\hub'
$AppDir = Join-Path -Path $LocalApp -ChildPath 'Fedor2\hub-app'
$StateFile = Join-Path -Path $HubRoot -ChildPath 'state.json'
$KeyFile = Join-Path -Path $HubRoot -ChildPath 'admin.key'
$InboxDir = Join-Path -Path $HubRoot -ChildPath 'inbox'
$CopyFile = Join-Path -Path $HubRoot -ChildPath 'copy.json'
$Stamp = Join-Path -Path $AppDir -ChildPath '.fedor-hub-ok'
$BootPs1 = Join-Path -Path $LocalApp -ChildPath 'Fedor2\fedor-hub.ps1'
$AdminKey = 'fedor-uchet'
$script:CurrentSort = 'name'
$script:StatusBox = $null
$script:UserView = $null
$script:InvView = $null
$script:KeyBox = $null

function Write-Log([string]$Text) {
  $line = ((Get-Date).ToString('HH:mm:ss') + ' ' + $Text)
  try { [IO.File]::AppendAllText($Log, ($line + [Environment]::NewLine), $utf8) } catch {}
}

function Mark-Alive {
  try { [IO.File]::WriteAllText($Alive, 'ok') } catch {}
}

function Hide-Console {
  try {
    $code = "using System; using System.Runtime.InteropServices; public class FedorHubWin { [DllImport(`"kernel32.dll`")] public static extern IntPtr GetConsoleWindow(); [DllImport(`"user32.dll`")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }"
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
    $hwnd = [FedorHubWin]::GetConsoleWindow()
    if ($hwnd -ne [IntPtr]::Zero) { [void][FedorHubWin]::ShowWindow($hwnd, 0) }
  } catch {}
}

function Show-Fail([string]$Text) {
  Write-Log $Text
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [void][System.Windows.Forms.MessageBox]::Show($Text, 'Fedor uchet')
  } catch {}
}

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $HubRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
}

function Install-HubCopy {
  $self = [Environment]::GetEnvironmentVariable('GROK_SELF')
  if ($self -and (Test-Path -LiteralPath $self)) {
    Copy-Item -LiteralPath $self -Destination (Join-Path -Path $AppDir -ChildPath 'AA-Coder-Fedor-Hub.bat') -Force
  }
  $desk = [Environment]::GetFolderPath('Desktop')
  $ps = Join-Path -Path $PSHOME -ChildPath 'powershell.exe'
  if ($desk) {
    try {
      $w = New-Object -ComObject WScript.Shell
      $lnk = $w.CreateShortcut((Join-Path -Path $desk -ChildPath 'Fedor uchet.lnk'))
      $lnk.TargetPath = $ps
      $lnk.Arguments = '-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $BootPs1 + '"'
      $lnk.WorkingDirectory = $AppDir
      $lnk.WindowStyle = 7
      $lnk.Description = 'Fedor uchet'
      $lnk.Save()
    } catch {
      Write-Log ('shortcut: ' + $_.Exception.Message)
    }
  }
  [IO.File]::WriteAllText($Stamp, ('ok' + [Environment]::NewLine), $utf8)
  [IO.File]::WriteAllText($KeyFile, ($AdminKey + [Environment]::NewLine), $utf8)
}

function Empty-State {
  return [ordered]@{
    users = @()
    invoices = @()
    copies = @()
    usedLicenses = @()
    usedPayRefs = @()
    updatedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  }
}

function Read-State {
  try {
    if (Test-Path -LiteralPath $StateFile) {
      $obj = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($obj) { return $obj }
    }
  } catch { Write-Log ('state: ' + $_.Exception.Message) }
  return (Empty-State)
}

function Write-State($state) {
  $state.updatedAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $json = $state | ConvertTo-Json -Depth 10
  $tmp = $StateFile + '.' + $PID + '.tmp'
  [IO.File]::WriteAllText($tmp, ($json + [Environment]::NewLine), $utf8)
  Move-Item -LiteralPath $tmp -Destination $StateFile -Force
}

function As-List($value) {
  if ($null -eq $value) { return @() }
  return @($value)
}

function When-Text($ts) {
  if (-not $ts) { return 'net vizita' }
  try {
    return [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$ts).LocalDateTime.ToString('g')
  } catch { return 'net vizita' }
}

function Sort-Users($users, $by) {
  $list = @(As-List $users)
  if ($by -eq 'lastSeen') { return @($list | Sort-Object { [int64]($_.lastSeenAt) } -Descending) }
  if ($by -eq 'tokens') { return @($list | Sort-Object { [int64]($_.lifetimeTokens) } -Descending) }
  return @($list | Sort-Object { [string]$_.name }, { [string]$_.email })
}

function Ingest-Replies($state) {
  $n = 0
  if (-not (Test-Path -LiteralPath $InboxDir)) { return 0 }
  foreach ($file in @(Get-ChildItem -LiteralPath $InboxDir -Filter 'reply-*.json' -ErrorAction SilentlyContinue)) {
    try { $rep = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    $hit = $null
    foreach ($u in (As-List $state.users)) {
      if (($rep.userId -and $u.id -eq $rep.userId) -or ($rep.email -and $u.email -eq $rep.email) -or ($rep.deviceLabel -and $u.deviceLabel -and $u.deviceLabel -eq $rep.deviceLabel)) {
        $hit = $u
        break
      }
    }
    if (-not $hit) { continue }
    $cur = 0; try { $cur = [int64]$hit.lifetimeTokens } catch {}
    $got = 0; try { $got = [int64]$rep.lifetimeTokens } catch {}
    if ($got -gt $cur) { $hit.lifetimeTokens = $got }
    if ($rep.lastSeenAt) { $hit.lastSeenAt = [int64]$rep.lastSeenAt }
    $hit.lastTokenReportAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $n++
  }
  return $n
}

function Apply-LocalCopy($state) {
  if (-not (Test-Path -LiteralPath $CopyFile)) { return }
  try { $copy = Get-Content -LiteralPath $CopyFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
  foreach ($u in (As-List $state.users)) {
    $match = $false
    if ($copy.userId -and $u.id -eq $copy.userId) { $match = $true }
    if ($copy.email -and $u.email -eq $copy.email) { $match = $true }
    if ($copy.deviceLabel -and $u.deviceLabel -and $u.deviceLabel -eq $copy.deviceLabel) { $match = $true }
    if (-not $match) { continue }
    $cur = 0; try { $cur = [int64]$u.lifetimeTokens } catch {}
    $got = 0; try { $got = [int64]$copy.lifetimeTokens } catch {}
    if ($got -gt $cur) { $u.lifetimeTokens = $got }
    if ($copy.lastSeenAt) { $u.lastSeenAt = [int64]$copy.lastSeenAt }
  }
}

function Write-Asks($state) {
  New-Item -ItemType Directory -Force -Path $InboxDir | Out-Null
  $n = 0
  $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  foreach ($u in (As-List $state.users)) {
    if (-not $u.id) { continue }
    $payload = @{ type = 'ask-tokens'; userId = [string]$u.id; t = $t } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path -Path $InboxDir -ChildPath ('ask-' + $u.id + '.json')), ($payload + [Environment]::NewLine), $utf8)
    $n++
  }
  return $n
}

function Set-Status([string]$Text, [bool]$Bad = $false) {
  if (-not $script:StatusBox) { return }
  $script:StatusBox.Text = $Text
  if ($Bad) {
    $script:StatusBox.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
  } else {
    $script:StatusBox.ForeColor = [System.Drawing.Color]::FromArgb(110, 231, 183)
  }
}

function Assert-Key {
  $typed = ''
  if ($script:KeyBox) { $typed = [string]$script:KeyBox.Text }
  if ($typed.Trim() -ne $AdminKey) {
    Set-Status 'Нет доступа. Ключ: fedor-uchet' $true
    return $false
  }
  return $true
}

function Fill-Lists {
  if (-not (Assert-Key)) { return }
  $state = Read-State
  Apply-LocalCopy $state
  $users = Sort-Users (As-List $state.users) $script:CurrentSort
  $invoices = @(As-List $state.invoices)
  $script:UserView.Items.Clear()
  foreach ($u in $users) {
    $name = [string]($(if ($u.name) { $u.name } else { $u.email }))
    $email = [string]$u.email
    $tok = 0; try { $tok = [int64]$u.lifetimeTokens } catch {}
    $plan = [string]($(if ($u.planId) { $u.planId } else { 'free' }))
    $lab = [string]$u.deviceLabel
    $seen = When-Text $u.lastSeenAt
    $item = New-Object System.Windows.Forms.ListViewItem($name)
    [void]$item.SubItems.Add($email)
    [void]$item.SubItems.Add($plan)
    [void]$item.SubItems.Add([string]$tok)
    [void]$item.SubItems.Add($seen)
    [void]$item.SubItems.Add($lab)
    [void]$script:UserView.Items.Add($item)
  }
  $script:InvView.Items.Clear()
  foreach ($i in $invoices) {
    $item = New-Object System.Windows.Forms.ListViewItem([string]$i.id)
    [void]$item.SubItems.Add([string]$i.amountRub)
    [void]$item.SubItems.Add([string]$i.method)
    [void]$item.SubItems.Add([string]$i.status)
    $item.Tag = [string]$i.id
    [void]$script:InvView.Items.Add($item)
  }
  Set-Status ('Пользователей: ' + @($users).Count + '   счета: ' + @($invoices).Count)
}

function Check-Tokens {
  if (-not (Assert-Key)) { return }
  $state = Read-State
  $asked = Write-Asks $state
  Apply-LocalCopy $state
  $got = Ingest-Replies $state
  Write-State $state
  $script:CurrentSort = 'tokens'
  Fill-Lists
  Set-Status ('Запросил ' + $asked + ', ответили ' + $got)
}

function Mark-Paid {
  if (-not (Assert-Key)) { return }
  if ($script:InvView.SelectedItems.Count -lt 1) {
    Set-Status 'Выбери счет' $true
    return
  }
  $id = [string]$script:InvView.SelectedItems[0].Tag
  $state = Read-State
  foreach ($inv in (As-List $state.invoices)) {
    if ([string]$inv.id -eq $id) { $inv.status = 'paid' }
  }
  Write-State $state
  Fill-Lists
  Set-Status ('Оплачено: ' + $id)
}

function New-DarkButton([string]$Text, [int]$X, [int]$Y, [int]$W) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $Text
  $b.Left = $X
  $b.Top = $Y
  $b.Width = $W
  $b.Height = 28
  $b.FlatStyle = 'Flat'
  $b.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
  $b.ForeColor = [System.Drawing.Color]::White
  $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 60)
  return $b
}

function Show-App {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Hide-Console

  $bg = [System.Drawing.Color]::FromArgb(11, 11, 11)
  $panel = [System.Drawing.Color]::FromArgb(30, 30, 30)
  $muted = [System.Drawing.Color]::FromArgb(136, 136, 136)
  $font = New-Object System.Drawing.Font('Segoe UI', 9)

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Fedor uchet'
  $form.StartPosition = 'CenterScreen'
  $form.Size = New-Object System.Drawing.Size(920, 680)
  $form.MinimumSize = New-Object System.Drawing.Size(760, 520)
  $form.BackColor = $bg
  $form.ForeColor = [System.Drawing.Color]::FromArgb(204, 204, 204)
  $form.Font = $font
  $form.TopMost = $false

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Учет'
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
  $title.ForeColor = [System.Drawing.Color]::White
  $title.AutoSize = $true
  $title.Left = 18
  $title.Top = 14
  $form.Controls.Add($title)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = 'Сила в коде'
  $hint.ForeColor = $muted
  $hint.AutoSize = $true
  $hint.Left = 120
  $hint.Top = 22
  $form.Controls.Add($hint)

  $keyLabel = New-Object System.Windows.Forms.Label
  $keyLabel.Text = 'Ключ'
  $keyLabel.AutoSize = $true
  $keyLabel.Left = 18
  $keyLabel.Top = 58
  $form.Controls.Add($keyLabel)

  $script:KeyBox = New-Object System.Windows.Forms.TextBox
  $script:KeyBox.Left = 78
  $script:KeyBox.Top = 54
  $script:KeyBox.Width = 220
  $script:KeyBox.BackColor = $panel
  $script:KeyBox.ForeColor = [System.Drawing.Color]::White
  $script:KeyBox.BorderStyle = 'FixedSingle'
  $script:KeyBox.UseSystemPasswordChar = $true
  $script:KeyBox.Text = $AdminKey
  $form.Controls.Add($script:KeyBox)

  $openBtn = New-DarkButton 'Открыть' 300 52 90
  $openBtn.Add_Click({ Fill-Lists })
  $form.Controls.Add($openBtn)

  $checkBtn = New-DarkButton 'Проверить токены' 400 52 160
  $checkBtn.Add_Click({ Check-Tokens })
  $form.Controls.Add($checkBtn)

  $paidBtn = New-DarkButton 'Оплачено' 570 52 110
  $paidBtn.Add_Click({ Mark-Paid })
  $form.Controls.Add($paidBtn)

  $sortName = New-DarkButton 'по имени' 18 92 90
  $sortName.Add_Click({ $script:CurrentSort = 'name'; Fill-Lists })
  $form.Controls.Add($sortName)
  $sortSeen = New-DarkButton 'по визиту' 114 92 96
  $sortSeen.Add_Click({ $script:CurrentSort = 'lastSeen'; Fill-Lists })
  $form.Controls.Add($sortSeen)
  $sortTok = New-DarkButton 'по токенам' 216 92 110
  $sortTok.Add_Click({ $script:CurrentSort = 'tokens'; Fill-Lists })
  $form.Controls.Add($sortTok)

  $script:StatusBox = New-Object System.Windows.Forms.Label
  $script:StatusBox.Left = 330
  $script:StatusBox.Top = 98
  $script:StatusBox.Width = 540
  $script:StatusBox.Height = 22
  $script:StatusBox.ForeColor = [System.Drawing.Color]::FromArgb(110, 231, 183)
  $script:StatusBox.Text = 'Готово'
  $form.Controls.Add($script:StatusBox)

  $uLabel = New-Object System.Windows.Forms.Label
  $uLabel.Text = 'Пользователи'
  $uLabel.ForeColor = [System.Drawing.Color]::White
  $uLabel.Left = 18
  $uLabel.Top = 132
  $uLabel.AutoSize = $true
  $form.Controls.Add($uLabel)

  $script:UserView = New-Object System.Windows.Forms.ListView
  $script:UserView.View = 'Details'
  $script:UserView.FullRowSelect = $true
  $script:UserView.HideSelection = $false
  $script:UserView.BackColor = $panel
  $script:UserView.ForeColor = [System.Drawing.Color]::White
  $script:UserView.BorderStyle = 'FixedSingle'
  $script:UserView.Left = 18
  $script:UserView.Top = 154
  $script:UserView.Width = 868
  $script:UserView.Height = 280
  $script:UserView.Anchor = 'Top,Left,Right,Bottom'
  [void]$script:UserView.Columns.Add('Имя', 180)
  [void]$script:UserView.Columns.Add('Почта', 220)
  [void]$script:UserView.Columns.Add('План', 80)
  [void]$script:UserView.Columns.Add('Токены', 90)
  [void]$script:UserView.Columns.Add('Визит', 150)
  [void]$script:UserView.Columns.Add('ПК', 140)
  $form.Controls.Add($script:UserView)

  $iLabel = New-Object System.Windows.Forms.Label
  $iLabel.Text = 'Счета  (выбери и нажми Оплачено)'
  $iLabel.ForeColor = [System.Drawing.Color]::White
  $iLabel.Left = 18
  $iLabel.Top = 442
  $iLabel.AutoSize = $true
  $iLabel.Anchor = 'Left,Bottom'
  $form.Controls.Add($iLabel)

  $script:InvView = New-Object System.Windows.Forms.ListView
  $script:InvView.View = 'Details'
  $script:InvView.FullRowSelect = $true
  $script:InvView.HideSelection = $false
  $script:InvView.BackColor = $panel
  $script:InvView.ForeColor = [System.Drawing.Color]::White
  $script:InvView.BorderStyle = 'FixedSingle'
  $script:InvView.Left = 18
  $script:InvView.Top = 464
  $script:InvView.Width = 868
  $script:InvView.Height = 140
  $script:InvView.Anchor = 'Left,Right,Bottom'
  [void]$script:InvView.Columns.Add('ID', 260)
  [void]$script:InvView.Columns.Add('Сумма', 80)
  [void]$script:InvView.Columns.Add('Способ', 120)
  [void]$script:InvView.Columns.Add('Статус', 120)
  $form.Controls.Add($script:InvView)

  $foot = New-Object System.Windows.Forms.Label
  $foot.Text = $HubRoot
  $foot.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
  $foot.Left = 18
  $foot.Top = 612
  $foot.Width = 860
  $foot.Anchor = 'Left,Right,Bottom'
  $form.Controls.Add($foot)

  $form.Add_Shown({
    Mark-Alive
    Fill-Lists
    $form.Activate()
  })
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 12000
  $timer.Add_Tick({ Fill-Lists })
  $timer.Start()
  $form.Add_FormClosed({ $timer.Stop() })
  [void]$form.ShowDialog()
}

try {
  Mark-Alive
  Write-Log 'start'
  $sta = [Threading.Thread]::CurrentThread.GetApartmentState()
  if ($sta -ne 'STA') {
    $ps = Join-Path -Path $PSHOME -ChildPath 'powershell.exe'
    $args = '-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    Start-Process -FilePath $ps -ArgumentList $args | Out-Null
    exit 0
  }
  Ensure-Dirs
  Install-HubCopy
  Show-App
  exit 0
} catch {
  Show-Fail ([string]$_.Exception.Message)
  exit 1
}
