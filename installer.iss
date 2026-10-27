; 桌面宠物安装包（Inno Setup 6）
; 存档在 %APPDATA%\DeskPet，安装/升级/卸载都不会动它（卸载时默认保留）

#define MyAppName "桌面宠物"
#ifndef MyAppVersion
  #define MyAppVersion "0.8.0"
#endif
#define MyAppExe "桌面宠物.exe"

[Setup]
AppId={{6F1B7E42-3C1D-4B8E-9A77-2C5D8E1F4A30}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=DeskPet
DefaultDirName={localappdata}\Programs\DeskPet
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=DeskPet-Setup-{#MyAppVersion}
SetupIconFile=assets\electron.ico
UninstallDisplayIcon={app}\{#MyAppExe}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UsePreviousAppDir=yes
AllowNoIcons=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[InstallDelete]
; 升级时清掉上一版留下、这版不再需要的文件
Type: filesandordirs; Name: "{app}\locales"
Type: files; Name: "{app}\dxcompiler.dll"
Type: files; Name: "{app}\dxil.dll"
Type: files; Name: "{app}\resources\app\src\xb.jpeg"
Type: files; Name: "{app}\resources\app\src\*.jpeg"

[Files]
Source: "build\DeskPet\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "debug.log"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM "{#MyAppExe}" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  SaveFile: String;
begin
  if CurStep = ssInstall then
  begin
    SaveFile := ExpandConstant('{userappdata}\DeskPet\save.json');
    if FileExists(SaveFile) then
      FileCopy(SaveFile, SaveFile + '.bak', False);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  SaveDir: String;
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    SaveDir := ExpandConstant('{userappdata}\DeskPet');
    if DirExists(SaveDir) then
    begin
      if MsgBox('是否同时删除存档？' + #13#10 + #13#10 + SaveDir + #13#10 + '选择“否”会保留存档，以后重装可以接着养。',
        mbConfirmation, MB_YESNO) = IDYES then
        DelTree(SaveDir, True, True, True);
    end;
  end;
end;
