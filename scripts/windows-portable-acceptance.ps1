# Run on the disposable Windows 11 desktop as its ordinary test user.
param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'SESSHUTTLE-QA' -or $env:USERNAME -ne 'SesshuttleQA') { throw 'Disposable test desktop required' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'A standard user is required' }
$pointer = Join-Path $env:USERPROFILE 'Sesshuttle Location.json'
if ((Test-Path -LiteralPath $pointer) -or (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'Sesshuttle Data'))) { throw 'A fresh test account is required' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ae = [Windows.Automation.AutomationElement]
$scope = [Windows.Automation.TreeScope]
$wsh = New-Object -ComObject WScript.Shell
$work = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Portable test ' + [guid]::NewGuid())
$program = Join-Path $work 'Portable app'
$parent = Join-Path $work ('Chat ' + [char]0x4e2d + [char]0x6587 + ' 100%')
$folder = Join-Path $parent 'Sesshuttle Data'
$db = Join-Path $folder 'data\sesshuttle.sqlite'
$audit = Join-Path $PSScriptRoot 'windows-appdata-audit.mjs'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
function Snapshot($name) {
  & $Node $audit snapshot (Join-Path $work ($name + '.json'))
  if ($LASTEXITCODE) { throw 'AppData inventory failed' }
}
function FindWindow($name,$class) {
  $until = (Get-Date).AddSeconds(150)
  do {
    foreach ($window in $ae::RootElement.FindAll($scope::Children,[Windows.Automation.Condition]::TrueCondition)) {
      if ($window.Current.Name -like $name -and $window.Current.ClassName -like $class) { return $window }
    }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -ge $until)
  throw "Window missing: $name $class"
}
function ClickId($window,$id) {
  $c = New-Object Windows.Automation.PropertyCondition($ae::AutomationIdProperty,$id)
  $button = $window.FindFirst($scope::Descendants,$c)
  if (-not $button) { throw "Missing control $id in $($window.Current.Name)" }
  $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function ExitApp($process) {
  $main = FindWindow '*sesshuttle*' 'Chrome_WidgetWin_1'
  $main.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern).Close()
  if (-not $process.WaitForExit(60000) -or $process.ExitCode -ne 0) { throw 'App did not close normally' }
}
function ReadDevice {
  $result = & $Node $audit device $db
  if ($LASTEXITCODE -or -not $result) { throw 'No device identity in selected database' }
  return $result
}
Snapshot 'before'
& "$env:SystemRoot\System32\tar.exe" -tf $Archive | Out-Null
if ($LASTEXITCODE) { throw 'Invalid archive' }
New-Item -ItemType Directory -Path $program | Out-Null
& "$env:SystemRoot\System32\tar.exe" -xf $Archive -C $program
if ($LASTEXITCODE) { throw 'Extraction failed' }
$exe = Join-Path $program 'Sesshuttle.exe'
$cancel = Start-Process -FilePath $exe -PassThru
$picker = FindWindow '*folder*' '#32770'
ClickId $picker '2'
if (-not $cancel.WaitForExit(45000) -or (Test-Path -LiteralPath $pointer) -or (Test-Path -LiteralPath $folder)) { throw 'Cancel created data or left the app open' }
Snapshot 'cancel'
$first = Start-Process -FilePath $exe -PassThru
$picker = FindWindow '*folder*' '#32770'
$editor = $picker.FindFirst($scope::Descendants,(New-Object Windows.Automation.PropertyCondition($ae::AutomationIdProperty,'1148')))
if ($editor -and $editor.GetCurrentPropertyValue($ae::IsValuePatternAvailableProperty)) {
  $editor.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($parent)
  ClickId $picker '1'
} else {
  $picker.SetFocus()
  $wsh.SendKeys('%n')
  Start-Sleep -Milliseconds 300
  Set-Clipboard -Value $parent
  $wsh.SendKeys('^v')
  $wsh.SendKeys('{ENTER}')
}
$confirm = FindWindow 'Sesshuttle' '#32770'
ClickId $confirm '1'
ExitApp $first
$marker = Get-Content -LiteralPath (Join-Path $folder 'sesshuttle-data.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$location = Get-Content -LiteralPath $pointer -Encoding UTF8 -Raw | ConvertFrom-Json
if (-not $marker.initialized -or $location.id -ne $marker.id -or $location.folder -ne $folder) { throw 'Wrong saved location' }
$id = ReadDevice
Snapshot 'first'
$again = Start-Process -FilePath $exe -PassThru
ExitApp $again
if ((ReadDevice) -ne $id) { throw 'Second icon launch opened a different profile' }
if (-not (Test-Path -LiteralPath (Join-Path $folder 'Open Sesshuttle.cmd'))) { throw 'Missing data folder shortcut' }
Remove-Item -LiteralPath $program,$folder -Recurse -Force
if ((Get-Content -LiteralPath $pointer -Encoding UTF8 -Raw | ConvertFrom-Json).id -ne $marker.id) { throw 'Location ownership changed' }
Remove-Item -LiteralPath $pointer
if ((Test-Path -LiteralPath $program) -or (Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $pointer)) { throw 'Portable uninstall incomplete' }
Snapshot 'after'
foreach ($stage in 'cancel','first','after') {
  $diff = & $Node $audit compare (Join-Path $work 'before.json') (Join-Path $work ($stage + '.json'))
  if ($LASTEXITCODE) { throw 'Inventory comparison failed' }
  Set-Content -LiteralPath (Join-Path $work ($stage + '-diff.json')) -Value $diff -Encoding UTF8
}
[pscustomobject]@{ archiveSHA256=(Get-FileHash -Algorithm SHA256 $Archive).Hash; account=$identity.Name; build=[Environment]::OSVersion.Version.ToString(); architecture=$env:PROCESSOR_ARCHITECTURE; device=$id; profile=$folder; audit=$work; cancel=$true; twoLaunches=$true; uninstalled=$true } | ConvertTo-Json -Compress
