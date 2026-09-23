#requires -Version 5.1
$ErrorActionPreference = 'Continue'
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

$global:FedorHub = @{
  Root = $HubRoot
  StateFile = $StateFile
  InboxDir = $InboxDir
  CopyFile = $CopyFile
  AdminKey = $AdminKey
  Sort = 'name'
  Form = $null
  KeyBox = $null
  Status = $null
  Users = $null
  Invoices = $null
}

function Write-Log([string]$Text) {
  $line = ((Get-Date).ToString('HH:mm:ss') + ' ' + $Text)
  try { [IO.File]::AppendAllText($Log, ($line + [Environment]::NewLine), $utf8) } catch {}
}

function Mark-Alive {
  try { [IO.File]::WriteAllText($Alive, 'ok') } catch {}
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

function Remove-OldLaunchers {
  $homes = @()
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))) {
    if ($folder) { $homes += $folder }
  }
  $one = Join-Path -Path ([Environment]::GetFolderPath('UserProfile')) -ChildPath 'OneDrive\Desktop'
  if (Test-Path -LiteralPath $one) { $homes += $one }
  foreach ($desk in $homes) {
    foreach ($name in @('Fedor-uchet.bat', 'Fedor uchet.bat', 'Fedor-uchet.lnk')) {
      $p = Join-Path -Path $desk -ChildPath $name
      try { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } } catch {}
    }
  }
}

function Install-HubCopy {
  $self = [Environment]::GetEnvironmentVariable('GROK_SELF')
  if ($self -and (Test-Path -LiteralPath $self)) {
    Copy-Item -LiteralPath $self -Destination (Join-Path -Path $AppDir -ChildPath 'AA-Coder-Fedor-Hub.bat') -Force
  }
  Remove-OldLaunchers
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
    if (Test-Path -LiteralPath $global:FedorHub.StateFile) {
      $raw = Get-Content -LiteralPath $global:FedorHub.StateFile -Raw -Encoding UTF8
      if ($raw -and $raw.Trim()) {
        $obj = $raw | ConvertFrom-Json
        if ($obj) { return $obj }
      }
    }
  } catch {
    Write-Log ('state: ' + $_.Exception.Message)
  }
  return (Empty-State)
}

function Write-State($state) {
  Set-Note $state 'updatedAt' ([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
  $json = $state | ConvertTo-Json -Depth 10
  $tmp = $global:FedorHub.StateFile + '.' + $PID + '.tmp'
  [IO.File]::WriteAllText($tmp, ($json + [Environment]::NewLine), $utf8)
  Move-Item -LiteralPath $tmp -Destination $global:FedorHub.StateFile -Force
}

function As-List($value) {
  if ($null -eq $value) { return @() }
  return @($value)
}

function Set-Note($obj, [string]$Name, $Value) {
  if ($null -eq $obj) { return }
  try {
    $prop = $obj.PSObject.Properties[$Name]
    if ($prop) {
      $prop.Value = $Value
      return
    }
  } catch {}
  try {
    Add-Member -InputObject $obj -MemberType NoteProperty -Name $Name -Value $Value -Force
  } catch {}
}

function Get-Note($obj, [string]$Name, $Fallback = $null) {
  if ($null -eq $obj) { return $Fallback }
  try {
    $prop = $obj.PSObject.Properties[$Name]
    if ($prop -and $null -ne $prop.Value) { return $prop.Value }
  } catch {}
  return $Fallback
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
  $dir = [string]$global:FedorHub.InboxDir
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter 'reply-*.json' -ErrorAction SilentlyContinue)) {
    try { $rep = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    $hit = $null
    foreach ($u in (As-List $state.users)) {
      if (($rep.userId -and $u.id -eq $rep.userId) -or ($rep.email -and $u.email -eq $rep.email) -or ($rep.deviceLabel -and $u.deviceLabel -and $u.deviceLabel -eq $rep.deviceLabel)) {
        $hit = $u
        break
      }
    }
    if (-not $hit) { continue }
    $cur = 0; try { $cur = [int64](Get-Note $hit 'lifetimeTokens' 0) } catch {}
    $got = 0; try { $got = [int64](Get-Note $rep 'lifetimeTokens' 0) } catch {}
    if ($got -gt $cur) { Set-Note $hit 'lifetimeTokens' $got }
    $seen = Get-Note $rep 'lastSeenAt' $null
    if ($seen) { Set-Note $hit 'lastSeenAt' ([int64]$seen) }
    Set-Note $hit 'lastTokenReportAt' ([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
    $n++
  }
  return $n
}

function Apply-LocalCopy($state) {
  $copyPath = [string]$global:FedorHub.CopyFile
  if (-not (Test-Path -LiteralPath $copyPath)) { return }
  try { $copy = Get-Content -LiteralPath $copyPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
  foreach ($u in (As-List $state.users)) {
    try {
      $match = $false
      if ($copy.userId -and $u.id -eq $copy.userId) { $match = $true }
      if ($copy.email -and $u.email -eq $copy.email) { $match = $true }
      if ($copy.deviceLabel -and $u.deviceLabel -and $u.deviceLabel -eq $copy.deviceLabel) { $match = $true }
      if (-not $match) { continue }
      $cur = 0; try { $cur = [int64](Get-Note $u 'lifetimeTokens' 0) } catch {}
      $got = 0; try { $got = [int64](Get-Note $copy 'lifetimeTokens' 0) } catch {}
      if ($got -gt $cur) { Set-Note $u 'lifetimeTokens' $got }
      $seen = Get-Note $copy 'lastSeenAt' $null
      if ($seen) { Set-Note $u 'lastSeenAt' ([int64]$seen) }
    } catch {
      Write-Log ('copy-row: ' + $_.Exception.Message)
    }
  }
}

function Write-Asks($state) {
  $dir = [string]$global:FedorHub.InboxDir
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $n = 0
  $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  foreach ($u in (As-List $state.users)) {
    if (-not $u.id) { continue }
    $payload = @{ type = 'ask-tokens'; userId = [string]$u.id; t = $t } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path -Path $dir -ChildPath ('ask-' + $u.id + '.json')), ($payload + [Environment]::NewLine), $utf8)
    $n++
  }
  return $n
}

function Set-Status([string]$Text, [bool]$Bad = $false) {
  $box = $global:FedorHub.Status
  if ($null -eq $box) { return }
  try {
    $box.Text = $Text
    if ($Bad) {
      $box.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
    } else {
      $box.ForeColor = [System.Drawing.Color]::FromArgb(110, 231, 183)
    }
  } catch {}
}

function Ok-Key {
  $typed = [string]$global:FedorHub.AdminKey
  try {
    if ($global:FedorHub.KeyBox -and [string]$global:FedorHub.KeyBox.Text) {
      $typed = [string]$global:FedorHub.KeyBox.Text
    }
  } catch {}
  return ($typed.Trim() -eq [string]$global:FedorHub.AdminKey)
}

function Fill-Lists {
  try {
    if ($null -eq $global:FedorHub.Users -or $null -eq $global:FedorHub.Invoices) { return }
    if (-not (Ok-Key)) {
      Set-Status 'Нет доступа. Ключ: fedor-uchet' $true
      return
    }
    $state = Read-State
    Apply-LocalCopy $state
    $users = Sort-Users (As-List $state.users) $global:FedorHub.Sort
    $invoices = @(As-List $state.invoices)
    $global:FedorHub.Users.Items.Clear()
    if (@($users).Count -lt 1) {
      $empty = New-Object System.Windows.Forms.ListViewItem('Пока нет копий')
      [void]$empty.SubItems.Add('Когда сотрудник поставит кодер, расход появится здесь')
      [void]$empty.SubItems.Add('')
      [void]$empty.SubItems.Add('0')
      [void]$empty.SubItems.Add('')
      [void]$empty.SubItems.Add('')
      [void]$global:FedorHub.Users.Items.Add($empty)
    } else {
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
        [void]$global:FedorHub.Users.Items.Add($item)
      }
    }
    $global:FedorHub.Invoices.Items.Clear()
    if (@($invoices).Count -lt 1) {
      $empty = New-Object System.Windows.Forms.ListViewItem('Нет счетов')
      [void]$empty.SubItems.Add('')
      [void]$empty.SubItems.Add('')
      [void]$empty.SubItems.Add('')
      [void]$global:FedorHub.Invoices.Items.Add($empty)
    } else {
      foreach ($i in $invoices) {
        $item = New-Object System.Windows.Forms.ListViewItem([string]$i.id)
        [void]$item.SubItems.Add([string]$i.amountRub)
        [void]$item.SubItems.Add([string]$i.method)
        [void]$item.SubItems.Add([string]$i.status)
        $item.Tag = [string]$i.id
        [void]$global:FedorHub.Invoices.Items.Add($item)
      }
    }
    Set-Status ('Пользователей: ' + @($users).Count + '   счета: ' + @($invoices).Count)
  } catch {
    Write-Log ('fill: ' + $_.Exception.Message)
    Set-Status ('Ошибка списка: ' + $_.Exception.Message) $true
  }
}

function Check-Tokens {
  try {
    if (-not (Ok-Key)) { Set-Status 'Нет доступа. Ключ: fedor-uchet' $true; return }
    $state = Read-State
    $asked = Write-Asks $state
    Apply-LocalCopy $state
    $got = Ingest-Replies $state
    Write-State $state
    $global:FedorHub.Sort = 'tokens'
    Fill-Lists
    Set-Status ('Запросил ' + $asked + ', ответили ' + $got)
  } catch {
    Write-Log ('check: ' + $_.Exception.Message)
    Set-Status ('Ошибка проверки: ' + $_.Exception.Message) $true
  }
}

function Mark-Paid {
  try {
    if (-not (Ok-Key)) { Set-Status 'Нет доступа. Ключ: fedor-uchet' $true; return }
    $view = $global:FedorHub.Invoices
    if ($null -eq $view -or $view.SelectedItems.Count -lt 1) {
      Set-Status 'Выбери счет' $true
      return
    }
    $id = [string]$view.SelectedItems[0].Tag
    if (-not $id) { Set-Status 'Это не счет' $true; return }
    $state = Read-State
    foreach ($inv in (As-List $state.invoices)) {
      if ([string]$inv.id -eq $id) { Set-Note $inv 'status' 'paid' }
    }
    Write-State $state
    Fill-Lists
    Set-Status ('Оплачено: ' + $id)
  } catch {
    Write-Log ('paid: ' + $_.Exception.Message)
    Set-Status ('Ошибка оплаты: ' + $_.Exception.Message) $true
  }
}

function New-DarkButton([string]$Text, [int]$X, [int]$Y, [int]$W) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $Text
  $b.Left = $X
  $b.Top = $Y
  $b.Width = $W
  $b.Height = 28
  $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $b.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
  $b.ForeColor = [System.Drawing.Color]::White
  try { $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 60) } catch {}
  return $b
}

function Show-App {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  try {
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
    [System.Windows.Forms.Application]::add_ThreadException({
      param($sender, $ev)
      $msg = ''
      try { $msg = [string]$ev.Exception.Message } catch { $msg = 'ui error' }
      Write-Log ('ui: ' + $msg)
      Set-Status ('Ошибка: ' + $msg) $true
    })
  } catch {}

  $bg = [System.Drawing.Color]::FromArgb(11, 11, 11)
  $panel = [System.Drawing.Color]::FromArgb(30, 30, 30)
  $muted = [System.Drawing.Color]::FromArgb(136, 136, 136)
  $font = New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericSansSerif, 9)

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Fedor uchet'
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $form.Size = New-Object System.Drawing.Size(920, 680)
  $form.MinimumSize = New-Object System.Drawing.Size(760, 520)
  $form.BackColor = $bg
  $form.ForeColor = [System.Drawing.Color]::FromArgb(204, 204, 204)
  $form.Font = $font
  $global:FedorHub.Form = $form

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'Учет'
  $title.Font = New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericSansSerif, 16, [System.Drawing.FontStyle]::Bold)
  $title.ForeColor = [System.Drawing.Color]::White
  $title.AutoSize = $true
  $title.Left = 18
  $title.Top = 14
  $form.Controls.Add($title)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = 'Сила в коде  ·  приложение, не браузер'
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

  $keyBox = New-Object System.Windows.Forms.TextBox
  $keyBox.Left = 78
  $keyBox.Top = 54
  $keyBox.Width = 220
  $keyBox.BackColor = $panel
  $keyBox.ForeColor = [System.Drawing.Color]::White
  $keyBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $keyBox.UseSystemPasswordChar = $true
  $keyBox.Text = $AdminKey
  $form.Controls.Add($keyBox)
  $global:FedorHub.KeyBox = $keyBox

  $global:FedorHub.Fill = ${function:Fill-Lists}
  $global:FedorHub.Check = ${function:Check-Tokens}
  $global:FedorHub.Paid = ${function:Mark-Paid}

  $openBtn = New-DarkButton 'Открыть' 310 52 90
  $openBtn.Add_Click({ & $global:FedorHub.Fill })
  $form.Controls.Add($openBtn)

  $checkBtn = New-DarkButton 'Проверить токены' 410 52 160
  $checkBtn.Add_Click({ & $global:FedorHub.Check })
  $form.Controls.Add($checkBtn)

  $paidBtn = New-DarkButton 'Оплачено' 580 52 110
  $paidBtn.Add_Click({ & $global:FedorHub.Paid })
  $form.Controls.Add($paidBtn)

  $sortName = New-DarkButton 'по имени' 18 92 90
  $sortName.Add_Click({ $global:FedorHub.Sort = 'name'; & $global:FedorHub.Fill })
  $form.Controls.Add($sortName)
  $sortSeen = New-DarkButton 'по визиту' 114 92 96
  $sortSeen.Add_Click({ $global:FedorHub.Sort = 'lastSeen'; & $global:FedorHub.Fill })
  $form.Controls.Add($sortSeen)
  $sortTok = New-DarkButton 'по токенам' 216 92 110
  $sortTok.Add_Click({ $global:FedorHub.Sort = 'tokens'; & $global:FedorHub.Fill })
  $form.Controls.Add($sortTok)

  $status = New-Object System.Windows.Forms.Label
  $status.Left = 340
  $status.Top = 98
  $status.Width = 540
  $status.Height = 22
  $status.ForeColor = [System.Drawing.Color]::FromArgb(110, 231, 183)
  $status.Text = 'Готово'
  $form.Controls.Add($status)
  $global:FedorHub.Status = $status

  $uLabel = New-Object System.Windows.Forms.Label
  $uLabel.Text = 'Пользователи'
  $uLabel.ForeColor = [System.Drawing.Color]::White
  $uLabel.Left = 18
  $uLabel.Top = 132
  $uLabel.AutoSize = $true
  $form.Controls.Add($uLabel)

  $users = New-Object System.Windows.Forms.ListView
  $users.View = [System.Windows.Forms.View]::Details
  $users.FullRowSelect = $true
  $users.HideSelection = $false
  $users.BackColor = $panel
  $users.ForeColor = [System.Drawing.Color]::White
  $users.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $users.Left = 18
  $users.Top = 154
  $users.Width = 868
  $users.Height = 280
  $users.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
  [void]$users.Columns.Add('Имя', 180)
  [void]$users.Columns.Add('Почта', 220)
  [void]$users.Columns.Add('План', 80)
  [void]$users.Columns.Add('Токены', 90)
  [void]$users.Columns.Add('Визит', 150)
  [void]$users.Columns.Add('ПК', 140)
  $form.Controls.Add($users)
  $global:FedorHub.Users = $users

  $iLabel = New-Object System.Windows.Forms.Label
  $iLabel.Text = 'Счета  (выбери и нажми Оплачено)'
  $iLabel.ForeColor = [System.Drawing.Color]::White
  $iLabel.Left = 18
  $iLabel.Top = 442
  $iLabel.AutoSize = $true
  $iLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Bottom
  $form.Controls.Add($iLabel)

  $inv = New-Object System.Windows.Forms.ListView
  $inv.View = [System.Windows.Forms.View]::Details
  $inv.FullRowSelect = $true
  $inv.HideSelection = $false
  $inv.BackColor = $panel
  $inv.ForeColor = [System.Drawing.Color]::White
  $inv.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $inv.Left = 18
  $inv.Top = 464
  $inv.Width = 868
  $inv.Height = 140
  $inv.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
  [void]$inv.Columns.Add('ID', 260)
  [void]$inv.Columns.Add('Сумма', 80)
  [void]$inv.Columns.Add('Способ', 120)
  [void]$inv.Columns.Add('Статус', 120)
  $form.Controls.Add($inv)
  $global:FedorHub.Invoices = $inv

  $foot = New-Object System.Windows.Forms.Label
  $foot.Text = $HubRoot
  $foot.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
  $foot.Left = 18
  $foot.Top = 612
  $foot.Width = 860
  $foot.Anchor = [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
  $form.Controls.Add($foot)

  $form.Add_Shown({
    Mark-Alive
    try { & $global:FedorHub.Fill } catch {}
    try { $global:FedorHub.Form.Activate() } catch {}
  })
  Mark-Alive
  Fill-Lists
  [void]$form.ShowDialog()
}

try {
  Mark-Alive
  Write-Log 'start app'
  $sta = [Threading.Thread]::CurrentThread.GetApartmentState()
  if ($sta -ne 'STA') {
    $ps = Join-Path -Path $PSHOME -ChildPath 'powershell.exe'
    $argList = '-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    Start-Process -FilePath $ps -ArgumentList $argList | Out-Null
    exit 0
  }
  Ensure-Dirs
  if (-not (Test-Path -LiteralPath $StateFile)) {
    Write-State (Empty-State)
  }
  Install-HubCopy
  Show-App
  exit 0
} catch {
  Show-Fail ([string]$_.Exception.Message)
  exit 1
}
