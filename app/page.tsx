"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";

// 首頁（綠金華麗風，小宜 2026-10-24 設計、老闆確認）：深綠牌桌底、老闆的「阿瑋 CASINO」徽章、兩張金框遊戲卡。
// 素材在 public/home/（由原始 PNG 裁掉透明留白、縮成網頁用寬度的 WebP）；排版在 globals.css 的 .home-*
const GAMES = [
  { key: "big2", href: "/big2", name: "大老二", desc: "4 人撲克競技 · Big Two", art: "/home/home-big2.webp", artAlt: "黑桃、紅心、方塊、梅花四張 2", w: 400, h: 235 },
  { key: "mj", href: "/mahjong", name: "台灣麻將", desc: "16 張制 · 4 人桌遊", art: "/home/home-mahjong.webp", artAlt: "中、發、白皮三張麻將牌", w: 400, h: 227 },
];

export default function Lobby() {
  const router = useRouter();

  return (
    <div className="home">
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
              <span className="home-name">{g.name}</span>
              {/* 窄的時候只在「·」後面換行，不會把「桌遊」拆成兩行 */}
              <span className="home-desc">
                {g.desc.split(" · ").map((part, i, all) => (
                  <Fragment key={i}>
                    <span className="whitespace-nowrap">{i < all.length - 1 ? `${part} ·` : part}</span>
                    {i < all.length - 1 && " "}
                  </Fragment>
                ))}
              </span>
            </span>
            <span className="home-go" aria-hidden="true">›</span>
          </button>
        ))}
      </nav>

      <p className="home-foot">選擇遊戲開始遊玩 · 支援多人即時對戰</p>
    </div>
  );
}
