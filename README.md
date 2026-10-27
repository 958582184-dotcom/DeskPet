# DeskPet

Windows 桌面宠物（Electron）：透明置顶小窗、托盘常驻、状态 / 打工 / 上课 / 专精。

![宠物](preview/pet.png)

## 运行

```
npm install
npm start
```

## 构建

```
powershell -ExecutionPolicy Bypass -File build-portable.ps1
ISCC installer.iss
```

## 存档

`%APPDATA%\DeskPet\save.json`

## 素材

动画与字体来自 `dsh-pet`；专精徽章由 `src` 下原图裁剪生成。
