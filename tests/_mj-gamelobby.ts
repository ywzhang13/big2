// 麻將換成三款共用的開房、加入、取名、等人（老馬 2026-11-20；小宜〈共用開房流程 v1.1〉）：
//   S 設定卡：圈數 4 顆一列、底 8 顆一列 4、每台 6 顆一列 3；預設 1 圈／底 100／每台 20 是選中的；沒有副標「每圈4局」「基本分」「台數加成」、沒有公式
//   P 頁面原始檔：開房、加入、取名、等人都用共用元件；麻將自己的暱稱欄、mj_name_source 拿掉；名字存 game_name；舊的「等待玩家加入」「房間碼」「點擊複製連結」標題不見
//   N 名字：麻將原本手動改過的 mj_name 第一次會搬到 game_name；LINE 自動帶入的不搬（重新帶 LINE 名稱）
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CreateRoomShell } from "../components/gameLobby/GameLobby";
import { loadGameName } from "../components/gameLobby/name";
import { MJ_SECTIONS } from "../components/mahjong/mjLobbySections";

const results: string[] = [];
const ok = (cond: boolean, msg: string) => results.push(`${cond ? "✅" : "❌"} ${msg}`);

{ // S
  const html = renderToStaticMarkup(createElement(CreateRoomShell, { brand: null, sections: MJ_SECTIONS, initialName: { name: "阿華", fromLine: false }, busy: false, error: "", onCreate: () => {}, onBack: () => {} }));
  const opts = (k: string) => (html.match(new RegExp(`data-gl-opt="${k}:`, "g")) ?? []).length;
  ok(opts("rounds") === 4 && opts("base") === 8 && opts("fan") === 6, "S1 三張卡：圈數 4 顆、底 8 顆、每台 6 顆");
  ok(/grid-template-columns:repeat\(4, 1fr\)[^>]*>[^]*?data-gl-opt="rounds:1"/.test(html) && html.includes("repeat(3, 1fr)"), "S2 圈數、底一列 4 顆，每台一列 3 顆");
  ok(/class="gl-opt on"[^>]*data-gl-opt="rounds:1"/.test(html) && /class="gl-opt on"[^>]*data-gl-opt="base:100"/.test(html) && /class="gl-opt on"[^>]*data-gl-opt="fan:20"/.test(html), "S3 預設選中 1圈、底 100、每台 20（跟原本一樣）");
  ok(html.includes(">1圈<") && html.includes(">8圈<"), "S4 圈數寫「1圈」…「8圈」");
  ok(!/每圈4局|基本分|台數加成|台數 ×/.test(html), "S5 沒有副標、沒有公式（v1.1 §8）");
}
{ // P
  const src = readFileSync("app/mahjong/page.tsx", "utf8");
  ok(["<CreateRoomShell", "<JoinByCode", "<InviteNamePrompt", "<WaitingRoom"].every((t) => src.includes(t)), "P1 開房、加入、取名、等人都用共用元件");
  ok(!/function NameField|mj_name_source|"mj_name"/.test(src), "P2 麻將自己的暱稱欄、mj_name_source、直接寫 mj_name 都拿掉");
  ok(src.includes("saveGameName(mjStorage()") && src.includes("loadGameName(mjStorage()"), "P3 名字照共用規則存讀 game_name（遊客分頁走 mjStorage）");
  ok(!/等待玩家加入|點擊複製連結|房間碼 \(4位數\)|加入遊戲</.test(src), "P4 舊等人標題、「點擊複製連結」、「房間碼 (4位數)」「加入遊戲」不見了");
  ok(src.includes("<MjStartConfirm") && src.includes("data-rc-suspended-ban") && src.includes("<BlockedDialog"), "P5 開局確認、暫停紅條、不能開局視窗都還在");
}
{ // N
  const mem = (init: Record<string, string>) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  const manual = mem({ mj_name: "麻將老手阿華", mj_name_source: "manual" });
  ok(loadGameName(manual, { mj: manual, big2: null }) === "麻將老手阿華" && manual.m.get("game_name") === "麻將老手阿華", "N1 麻將手動改過的名字搬到 game_name");
  const line = mem({ mj_name: "LINE名", mj_name_source: "line" });
  ok(loadGameName(line, { mj: line, big2: null }) === "", "N2 LINE 自動帶入的不搬（重新帶 LINE 名稱）");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
