# 十三支牌面手機小圖（老馬 2026-11-21）：public/tiles/thirteen 的 card-front-*.v4／*.gold.v1 和 card-back.v2
# 縮成 240 寬（等比，LANCZOS），另存成 <原檔名>.m.webp；原圖不動。components/thirteen/cardArt.ts 在手機上用 .m
# 執行：uv run --no-project --with pillow python -I scripts/gen-thirteen-card-m.py
# 換了原圖要重產時，新圖要換版本號（長期快取，見 README「靜態素材快取」），再跑 node scripts/asset-hashes.mjs --write
import glob, os
from PIL import Image

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "tiles", "thirteen")
W = 240
srcs = sorted(glob.glob(f"{DIR}/card-front-*.v4.webp") + glob.glob(f"{DIR}/card-front-*.gold.v1.webp")) + [f"{DIR}/card-back.v2.webp"]
before = after = 0
for f in srcs:
    out = f[: -len(".webp")] + ".m.webp"
    im = Image.open(f)
    im.load()
    im.resize((W, round(im.height * W / im.width)), Image.LANCZOS).save(out, "WEBP", quality=88, method=6)
    before += os.path.getsize(f)
    after += os.path.getsize(out)
print(f"{len(srcs)} 張：{before // 1024}KB → {after // 1024}KB")
