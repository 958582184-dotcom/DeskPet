# 生成免安装版：把 Electron 运行时 + 本应用打进一个目录，双击 exe 即用。
# 用法： powershell -ExecutionPolicy Bypass -File build-portable.ps1 [-OutDir D:\QQPet2005]
#
# 默认输出到 %LOCALAPPDATA%\QQPet2005：本机实测 E: 盘启动 Electron 会被环境拦掉
# （同一份二进制放 C: 盘正常），所以默认不往工作区里放可执行版本。
param(
  [string]$ElectronDir = "$env:USERPROFILE\.dsh\electron",
  [string]$OutDir = (Join-Path $env:LOCALAPPDATA "DeskPet"),
  [string]$Rcedit = "$env:USERPROFILE\dsh-tools\rcedit-x64.exe"
)

$ErrorActionPreference = "Stop"

$exe = Join-Path $ElectronDir "electron.exe"
if (-not (Test-Path $exe)) {
  throw "没找到 Electron：$exe`n可以用 -ElectronDir 指定，或先 npm install electron"
}

if (Test-Path $OutDir) {
  Remove-Item -LiteralPath $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Force $OutDir | Out-Null

Copy-Item (Join-Path $ElectronDir "*") $OutDir -Recurse -Force

$appDir = Join-Path $OutDir "resources\app"
New-Item -ItemType Directory -Force $appDir | Out-Null

foreach ($f in @("main.js", "package.json", "README.md")) {
  $src = Join-Path $PSScriptRoot $f
  if (Test-Path $src) { Copy-Item $src $appDir -Force }
}
foreach ($d in @("src", "preload", "renderer", "assets")) {
  Copy-Item (Join-Path $PSScriptRoot $d) $appDir -Recurse -Force
}

# 精简：只保留中英语言包
$locales = Join-Path $OutDir "locales"
if (Test-Path $locales) {
  Get-ChildItem $locales -File | Where-Object { $_.Name -notin @("zh-CN.pak", "en-US.pak") } | Remove-Item -Force
}
# 软件渲染不需要 D3D 着色器编译器
foreach ($f in @("dxcompiler.dll", "dxil.dll")) {
  $p = Join-Path $OutDir $f
  if (Test-Path $p) { Remove-Item $p -Force }
}
# 运行时不需要原始图标素材（徽章用裁剪后的 png）
$srcDir = Join-Path $appDir "src"
if (Test-Path $srcDir) {
  Get-ChildItem $srcDir -File | Where-Object { $_.Name -like "创意设计*" -or $_.Name -eq "xb.jpeg" } | Remove-Item -Force
}

# Electron 只在没有 resources\app 时才用 default_app.asar
$defaultApp = Join-Path $OutDir "resources\default_app.asar"
if (Test-Path $defaultApp) { Remove-Item $defaultApp -Force }

Rename-Item (Join-Path $OutDir "electron.exe") "桌面宠物.exe"

# 应用图标（rcedit 改 exe 内嵌图标）
$appExe = Join-Path $OutDir "桌面宠物.exe"
$appIcon = Join-Path $PSScriptRoot "assets\app.ico"
if ((Test-Path $Rcedit) -and (Test-Path $appIcon)) {
  & $Rcedit $appExe --set-icon $appIcon | Out-Null
}

$note = @"
桌面宠物 · 免安装版

双击 桌面宠物.exe 启动。
启动后：桌面上出现企鹅，托盘里有图标。
关闭窗口不会退出，退出请用托盘菜单「退出」或面板右下角「退出程序」。

存档位置：%APPDATA%\DeskPet\save.json
开机自启：托盘菜单里勾选「开机自动启动」
"@
$note | Set-Content (Join-Path $OutDir "使用说明.txt") -Encoding UTF8

Write-Host "OK -> $OutDir"
