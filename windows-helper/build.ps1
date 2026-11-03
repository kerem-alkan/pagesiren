# build.ps1 - PageSirenAlarm.cs -> PageSirenAlarm.exe (with the .NET Framework compiler that ships with Windows).
# Opens no window and runs nothing; it only produces the exe.
# -Cikti <path>: builds somewhere else (a running exe is locked, so a new version is built and tested there first).
param([string]$Cikti)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cs = Join-Path $dir 'PageSirenAlarm.cs'
$exe = if ($Cikti) { $Cikti } else { Join-Path $dir 'PageSirenAlarm.exe' }
if (Test-Path $exe) { Remove-Item $exe -Force }
Add-Type -TypeDefinition (Get-Content $cs -Raw -Encoding UTF8) -Language CSharp `
  -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions `
  -OutputAssembly $exe -OutputType WindowsApplication
Write-Output ("built: " + $exe + " (" + (Get-Item $exe).Length + " bytes)")
