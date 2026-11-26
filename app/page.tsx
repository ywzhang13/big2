"use client";

import { useRouter } from "next/navigation";
import HomeAccount from "@/components/roomCard/HomeAccount";
import { LobbyBg, LobbyHero } from "@/components/gameLobby/LobbyHero";
import { useAutoUpdate } from "@/lib/autoUpdate";

// 首頁（大廳 v2 明亮娛樂城風，小宜〈大廳素材v2-驗收與四大廳排版規格〉2026-11-27）：背景、LOGO 底牌＋「阿瑋娛樂城」、三張遊戲卡。
// 只留 LOGO、遊戲名稱（老闆：字要少；「多人線上桌遊平台」「選擇遊戲開始遊玩 · 支援多人即時對戰」拿掉）。樣式在 app/lobby-v2.css
const GAMES = [
  { key: "thirteen", href: "/thirteen", name: "十三支" },
  { key: "mahjong", href: "/mahjong", name: "台灣麻將" },
  { key: "big2", href: "/big2", name: "大老二" },
] as const;

export default function Lobby() {
  const router = useRouter();
  useAutoUpdate(true); // 自動換新版（lib/autoUpdate.ts）：總大廳隨時都是安全時機

  return (
    <div className="lv2-home" data-lv2="home">
      <LobbyBg kind="home" />
      {/* 右上角：房卡張數、頭像選單（房卡後台／歷史紀錄／登出）、設定（房卡 v1.2 2-2）；沒登入不放 */}
      <HomeAccount />
      <LobbyHero />
      <nav className="lv2-cards" aria-label="選擇遊戲">
        {GAMES.map((g) => (
          <button key={g.key} type="button" onClick={() => router.push(g.href)} className="lv2-card" data-lv2-card={g.key}>
            <span>{g.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
