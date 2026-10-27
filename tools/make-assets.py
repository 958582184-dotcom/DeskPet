"""从 dsh-pet 素材里生成头像/托盘图标：取待机 GIF 的首帧，裁出角色本体。"""

from PIL import Image

SRC = r"D:\Program Files\dsh-pet-main\dsh-pet\assets\preview\daiji-huxi-xiuxian.gif"
OUT = r"E:\MyWord\qqpet-desktop\assets"

im = Image.open(SRC)
im.seek(0)
frame = im.convert("RGBA")

# 去掉近白背景（GIF 常把透明压成白）
px = frame.load()
w, h = frame.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if r > 245 and g > 245 and b > 245:
            px[x, y] = (r, g, b, 0)

bbox = frame.getbbox()
if bbox:
    frame = frame.crop(bbox)

# 补成正方形，四周留 8% 边
side = max(frame.width, frame.height)
pad = int(side * 0.08)
canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
canvas.alpha_composite(frame, ((canvas.width - frame.width) // 2, (canvas.height - frame.height) // 2))

canvas.resize((256, 256), Image.LANCZOS).save(OUT + r"\avatar.png")
canvas.resize((96, 96), Image.LANCZOS).save(OUT + r"\avatar-96.png")
canvas.resize((32, 32), Image.LANCZOS).save(OUT + r"\tray.png")
print("bbox", bbox, "->", canvas.size)
