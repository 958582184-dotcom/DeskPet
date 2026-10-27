@echo off
chcp 65001 >nul
setlocal

rem 带 ELECTRON_RUN_AS_NODE 的终端里启动会变成纯 Node 模式，先清掉
set "ELECTRON_RUN_AS_NODE="

set "APP=%~dp0"

rem 1) 已构建的免安装版：直接启动（用通配符，避免批处理里写中文文件名）
if exist "%LOCALAPPDATA%\DeskPet" (
  for %%F in ("%LOCALAPPDATA%\DeskPet\*.exe") do (
    start "" "%%~fF"
    exit /b 0
  )
)

rem 2) 退回 Electron 运行时 + 源码目录
set "ELECTRON="
if defined QQPET_ELECTRON if exist "%QQPET_ELECTRON%" set "ELECTRON=%QQPET_ELECTRON%"
if not defined ELECTRON if exist "%USERPROFILE%\.dsh\electron\electron.exe" set "ELECTRON=%USERPROFILE%\.dsh\electron\electron.exe"
if not defined ELECTRON if exist "%APP%node_modules\electron\dist\electron.exe" set "ELECTRON=%APP%node_modules\electron\dist\electron.exe"

if not defined ELECTRON (
  echo.
  echo   没找到 Electron 运行时。
  echo   三种办法任选其一：
  echo     1^) 到本目录执行  npm install  然后  npm start
  echo     2^) 设置环境变量 QQPET_ELECTRON 指向 electron.exe
  echo     3^) 运行  powershell -ExecutionPolicy Bypass -File build-portable.ps1
  echo.
  pause
  exit /b 1
)

start "" "%ELECTRON%" "%APP%"
