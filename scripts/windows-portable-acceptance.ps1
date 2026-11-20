# Run on the disposable Windows 11 desktop as its ordinary test user.
param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Node, [string]$DataParent, [scriptblock]$OnStep)
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'SESSHUTTLE-QA' -or $env:USERNAME -ne 'SesshuttleQA') { throw 'Disposable test desktop required' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'A standard user is required' }
$pointer = Join-Path $env:USERPROFILE 'Sesshuttle Location.json'
if ((Test-Path -LiteralPath $pointer) -or (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'Sesshuttle Data'))) { throw 'A fresh test account is required' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('SesshuttleTest.NativeDialog' -as [type])) {
Add-Type -Namespace SesshuttleTest -Name NativeDialog -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr window);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetDlgItem(System.IntPtr window, int id);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PostMessage(System.IntPtr window, uint message, System.IntPtr wParam, System.IntPtr lParam);
'@
}
$ae = [Windows.Automation.AutomationElement]
$scope = [Windows.Automation.TreeScope]
$wsh = New-Object -ComObject WScript.Shell
$work = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Portable test ' + [guid]::NewGuid())
$program = Join-Path $work 'Portable app'
$chosen = if ($DataParent) { Join-Path (Resolve-Path -LiteralPath $DataParent).Path ([guid]::NewGuid().ToString()) } else { $work }
$parent = Join-Path $chosen ('Chat ' + [char]0x4e2d + [char]0x6587 + ' 100%')
$folder = Join-Path $parent 'Sesshuttle Data'
$db = Join-Path $folder 'data\sesshuttle.sqlite'
$audit = Join-Path $PSScriptRoot 'windows-appdata-audit.mjs'
New-Item -ItemType Directory -Path $work,$parent -Force | Out-Null
function Snapshot($name) {
  & $Node $audit snapshot (Join-Path $work ($name + '.json'))
  if ($LASTEXITCODE) { throw 'AppData inventory failed' }
  if ($OnStep) { & $OnStep ("AppData inventory: " + $name) }
}
function FindWindow($name,$class) {
  $until = (Get-Date).AddMinutes(4)
  do {
    foreach ($window in $ae::RootElement.FindAll($scope::Children,[Windows.Automation.Condition]::TrueCondition)) {
      if ($window.Current.Name -like $name -and $window.Current.ClassName -like $class) { return $window }
    }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -ge $until)
  throw "Window missing: $name $class"
}
function ClickId($window,$id) {
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  [SesshuttleTest.NativeDialog]::SetForegroundWindow($handle) | Out-Null
  # Common dialogs and message boxes receive IDOK/IDCANCEL through WM_COMMAND.
  $button = [SesshuttleTest.NativeDialog]::GetDlgItem($handle,[int]$id)
  if (-not [SesshuttleTest.NativeDialog]::PostMessage($handle,0x0111,[IntPtr][int]$id,$button)) {
    throw "Could not press button $id in $($window.Current.Name)"
  }
}
function ExitApp($process, [switch]$DuringLoad) {
  $main = FindWindow '*sesshuttle*' 'Chrome_WidgetWin_1'
  if (-not $DuringLoad) {
    $doc = New-Object Windows.Automation.PropertyCondition($ae::ControlTypeProperty,[Windows.Automation.ControlType]::Document)
    $button = New-Object Windows.Automation.PropertyCondition($ae::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
    $until = (Get-Date).AddMinutes(3)
    do {
      $page = $main.FindFirst($scope::Descendants,$doc)
      if ($page -and $page.FindFirst($scope::Descendants,$button)) { break }
      if ((Get-Date) -ge $until) { throw 'The main window did not display its actions' }
      Start-Sleep -Milliseconds 500
    } while ($true)
  }
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
if (-not $cancel.WaitForExit(120000)) { throw 'Launcher still running after Cancel' }
if ((Test-Path -LiteralPath $pointer) -or (Test-Path -LiteralPath $folder)) { throw 'Cancel created data or a location file' }
Snapshot 'cancel'
$first = Start-Process -FilePath $exe -PassThru
$picker = FindWindow '*folder*' '#32770'
if ($OnStep) { & $OnStep ("Selecting " + $parent) }
# Navigate the address bar of the native chooser. Its shell controls may not
# expose an editable UI Automation element, particularly while loading a drive.
Set-Clipboard -Value $parent
[SesshuttleTest.NativeDialog]::SetForegroundWindow([IntPtr]$picker.Current.NativeWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
$wsh.SendKeys('%d')
Start-Sleep -Milliseconds 500
$wsh.SendKeys('^a')
$wsh.SendKeys('^v')
Start-Sleep -Milliseconds 400
$wsh.SendKeys('{ENTER}')
Start-Sleep -Seconds 3
ClickId $picker '1'
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
if ($OnStep) { & $OnStep 'Original icon reopened the selected database' }
if (-not (Test-Path -LiteralPath (Join-Path $folder 'Open Sesshuttle.cmd'))) { throw 'Missing data folder shortcut' }
$relocated = Join-Path $work ('App ' + [char]0x4e2d + [char]0x6587 + ' 100%')
Move-Item -LiteralPath $program -Destination $relocated
$program = $relocated
$third = Start-Process -FilePath (Join-Path $program 'Sesshuttle.exe') -PassThru
ExitApp $third
if ((ReadDevice) -ne $id) { throw 'Moving the program changed the profile' }
if ($OnStep) { & $OnStep 'Relocated icon reopened the selected database' }
$early = Start-Process -FilePath (Join-Path $program 'Sesshuttle.exe') -PassThru
ExitApp $early -DuringLoad
if ((ReadDevice) -ne $id) { throw 'Closing a loading window changed the profile' }
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
[pscustomobject]@{ archiveSHA256=(Get-FileHash -Algorithm SHA256 $Archive).Hash; account=$identity.Name; build=[Environment]::OSVersion.Version.ToString(); architecture=$env:PROCESSOR_ARCHITECTURE; device=$id; profile=$folder; audit=$work; cancel=$true; twoLaunches=$true; relocatedExecutable=$true; closeDuringLoad=$true; uninstalled=$true } | ConvertTo-Json -Compress
