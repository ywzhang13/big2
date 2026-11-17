"use client";

import { useRouter } from "next/navigation";
import "./home-games.css";

// 首頁（綠金華麗風，小宜 2026-10-24 設計、老闆確認）：深綠牌桌底、老闆的「阿瑋 CASINO」徽章、兩張金框遊戲卡。
// 素材在 public/home/（由原始 PNG 裁掉透明留白、縮成網頁用寬度的 WebP）；排版在 globals.css 的 .home-*
const GAMES = [
  { key: "big2", href: "/big2", name: "大老二", art: "/home/home-big2.webp", artAlt: "黑桃、紅心、方塊、梅花四張 2", w: 400, h: 235 },
  { key: "mj", href: "/mahjong", name: "台灣麻將", art: "/home/home-mahjong.webp", artAlt: "中、發、白皮三張麻將牌", w: 400, h: 227 },
  // 十三支（小宜〈十三支-畫面設計說明〉①a）：第三張卡，上線初期右上角掛 NEW
  { key: "th", href: "/thirteen", name: "十三支", art: "/home/home-thirteen.webp", artAlt: "兩張黑桃 A、紅心 K、方塊 Q", w: 400, h: 235, badge: "NEW" },
];

export default function Lobby() {
  const router = useRouter();

  return (
    <div className="home has-3">
      <header className="home-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="home-badge" src="/home/home-badge.webp" alt="阿瑋 CASINO" width={640} height={452} />
        <div className="home-brand-text">
          <h1 className="home-title">阿瑋娛樂城</h1>
          <p className="home-sub">多人線上桌遊平台</p>
        </div>
      </header>

      <nav className="home-cards" aria-label="選擇遊戲">
        {GAMES.map((g) => (
          <button key={g.key} type="button" onClick={() => router.push(g.href)} className={`home-card ${g.key}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="home-art" src={g.art} alt={g.artAlt} width={g.w} height={g.h} />
            <span className="home-card-text">
              {/* 老闆 2026-11-18：卡片只留遊戲名稱，拿掉副標（「4 人撲克競技 · Big Two」等） */}
              <span className="home-name">{g.name}</span>
            </span>
            <span className="home-go" aria-hidden="true">›</span>
            {"badge" in g && <span className="home-new">{g.badge}</span>}
          </button>
        ))}
      </nav>

      <p className="home-foot">選擇遊戲開始遊玩 · 支援多人即時對戰</p>
    </div>
  );
}
