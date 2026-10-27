# 生成安装包：先构建免安装目录，再用 Inno Setup 编译。
# 用法： powershell -ExecutionPolicy Bypass -File build-installer.ps1
# 依赖： Inno Setup 6（默认在 %USERPROFILE%\dsh-tools\innosetup，可用 -InnoDir 指定）
param(
  [string]$InnoDir = "$env:USERPROFILE\dsh-tools\innosetup",
  [string]$StageDir = "$PSScriptRoot\build\DeskPet"
)
$ErrorActionPreference = "Stop"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-portable.ps1") -OutDir $StageDir
$iscc = Join-Path $InnoDir "ISCC.exe"
if (-not (Test-Path $iscc)) { throw "没找到 Inno Setup：$iscc" }
$pkg = Get-Content (Join-Path $PSScriptRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
& $iscc "/DMyAppVersion=$($pkg.version)" (Join-Path $PSScriptRoot "installer.iss")
Write-Host "安装包 -> $(Join-Path $PSScriptRoot 'dist')"
