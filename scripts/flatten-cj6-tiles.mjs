// 把 Cangjie6 牌面改成平面版（CC BY-SA 4.0 修改）：拿掉牌身（綠色牌背、側面、白色牌面、漸層、反光），
// viewBox 大小＝原本白色牌面 #rect3765，位置改成以圖案為中心，只留字和花色；白底、細框、圓角由 MjTile 畫。
// 用法：node scripts/flatten-cj6-tiles.mjs <原始 SVG 資料夾> <輸出資料夾>
import { chromium } from "playwright";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error("用法：node scripts/flatten-cj6-tiles.mjs <src> <out>");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of readdirSync(src).filter((x) => x.endsWith(".svg"))) {
  const xml = readFileSync(join(src, f), "utf8");
  const res = await page.evaluate(async (text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = document.importNode(doc.documentElement, true);
    document.body.replaceChildren(svg);
    const face = svg.querySelector("#rect3765");
    if (!face) return { error: "找不到牌面" };
    // 牌身：外框、綠色牌背、側面、白色牌面、漸層、反光（筒子的點和牌身在同一個群組，所以逐一拿掉，不刪整個群組）
    const body = ["#rect4031", "#rect3767", "#rect3861", "#rect3765", "#rect3008", "#path3932", "#path3936", "#path3882"]
      .map((s) => svg.querySelector(s)).filter(Boolean);
    body.push(...[...svg.querySelectorAll("path, polygon")].filter((e) => getComputedStyle(e).fill.includes("SVGID_1_")));
    if (body.length < 9) return { error: `牌身元素只找到 ${body.length} 個` };
    // 牌面在 svg 使用者座標裡的範圍
    const b = face.getBBox();
    const m = svg.getCTM().inverse().multiply(face.getCTM());
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const vb = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((v) => +v.toFixed(2));
    body.forEach((e) => e.remove());
    svg.querySelector("foreignObject")?.remove(); // Illustrator 的私有資料參照
    svg.setAttribute("viewBox", vb.join(" "));
    svg.removeAttribute("style");
    svg.removeAttribute("x");
    svg.removeAttribute("y");
    // 原圖的牌面偏左上（右下是立體側面），拆掉牌身後圖案不在正中：畫出來量圖案範圍，viewBox 大小不變、改以圖案為中心
    const S = 4;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.round(vb[2] * S); c.height = Math.round(vb[3] * S);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    if (x1 < 0) return { error: "沒有圖案" };
    const cx = vb[0] + (x0 + x1 + 1) / 2 / S, cy = vb[1] + (y0 + y1 + 1) / 2 / S;
    vb[0] = +(cx - vb[2] / 2).toFixed(2); vb[1] = +(cy - vb[3] / 2).toFixed(2);
    svg.setAttribute("viewBox", vb.join(" "));
    return { vb, svg: new XMLSerializer().serializeToString(svg) };
  }, xml);
  if (res.error) throw new Error(`${f}：${res.error}`);
  writeFileSync(join(out, f), `<?xml version="1.0" encoding="utf-8"?>\n<!-- Cangjie6 (Wikimedia Commons, CC BY-SA 4.0)，已修改：移除立體牌身、只留牌面圖案 -->\n${res.svg}\n`);
  console.log(f, res.vb.join(" "));
}
await browser.close();
