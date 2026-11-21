// 牌優先（老馬 2026-11-21 第一把卡頓量測，紀錄在 big2-perf/.tmp/perf/）：
// 4G、手機 CPU 降速 4 倍下，開局那一刻麻將同時下載約 2.3MB、十三支約 7MB 的特效圖和音效，
// 牌面圖排在後面，手牌空白 8～13 秒、一張張冒出來。改成：
//   ・進大廳就先在背景載牌面（warmImages），開局時牌面已經在快取裡
//   ・特效、音效等畫面上的牌和名牌大頭照都載完，才開始下載（whenScreenImagesLoaded）

/** 等畫面上現有的圖（牌面、名牌大頭照）和大廳先載的牌面（warmImages）都載完再回來；最多等 maxMs，時間到照樣回來，不會讓特效永遠載不到 */
export function whenScreenImagesLoaded(maxMs = 8000): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const until = Date.now() + maxMs;
  return new Promise((done) => {
    const check = () => {
      const pending = warmLeft > 0 || Array.from(document.images ?? []).some((i) => !i.complete && i.loading !== "lazy");
      if (!pending || Date.now() >= until) done();
      else setTimeout(check, 250);
    };
    setTimeout(check, 300); // 先讓牌桌畫出來，第一幀的牌面圖才會出現在 document.images 裡
  });
}

const warming: HTMLImageElement[] = []; // 載完前留著參照，免得被回收、下載中斷
let warmLeft = 0; // 還沒載完（含排隊中）的張數：特效要等它歸零才開始下載，牌面才不會被特效擠到後面（十三支亮牌時別家的牌）

/** 背景先載這些圖（低優先、一次 6 張）：頁面載完才開始，不跟頁面本身搶頻寬 */
export function warmImages(urls: readonly string[], concurrency = 6): void {
  if (typeof window === "undefined") return;
  const queue = [...new Set(urls)];
  warmLeft += queue.length;
  const next = () => {
    const url = queue.shift();
    if (!url) return;
    const img = new Image();
    img.fetchPriority = "low";
    img.decoding = "async";
    const done = () => { warming.splice(warming.indexOf(img), 1); warmLeft--; next(); };
    img.onload = done;
    img.onerror = done;
    warming.push(img);
    img.src = url;
  };
  const go = () => { for (let k = 0; k < concurrency; k++) next(); };
  if (document.readyState === "complete") setTimeout(go, 0);
  else window.addEventListener("load", go, { once: true });
}
