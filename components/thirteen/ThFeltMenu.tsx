"use client";
// 十三支左上角的選單與設定：換成三款共用的 GameMenu＋GamePrefsPanel（小宜〈共用設定面板 v1〉）。
// 十三支自己只交「外觀」一頁（桌布四款色塊＋預覽）；聲音頁是共用的（互動音效音量、靜音、震動…，三款同步）
import { useState } from "react";
import GameMenu from "@/components/gamePrefs/GameMenu";
import type { PrefsTab } from "@/components/gamePrefs/GamePrefsPanel";
import { applyFelt, FELTS, loadFelt, type FeltKey } from "./feltTheme";
import { CARD_BACK_SRC, cardSrc } from "./cardArt";
import { makeCard } from "@/lib/thirteen";
import "./thRoom.css"; // .th-menu 位置（理牌預覽頁沒有載牌桌樣式）

/** 桌布色塊：和牌桌同一組中心色→邊緣色（thRoom.css 的 --th-c*，從四神獸圖取的） */
const FELT_SW: Record<FeltKey, [string, string, string]> = {
  green: ["#3BAD5C", "#07602F", "#034D26"], wine: ["#D5262D", "#800A17", "#640410"],
  gray: ["#646464", "#39383B", "#2E2E2F"], blue: ["#1980A0", "#024260", "#012F4A"],
};
/** 預覽框用手機版小圖（牌桌上已經載過，不多下載） */
const FELT_IMG: Record<FeltKey, string> = {
  green: "/tiles/thirteen/th-felt-dragon.v2.m.webp", wine: "/tiles/thirteen/th-felt-phoenix.v2.m.webp",
  gray: "/tiles/thirteen/th-felt-tiger.v3.m.webp", blue: "/tiles/thirteen/th-felt-tortoise.v2.m.webp",
};
const PREVIEW = [makeCard("S", 14, 1), makeCard("H", 13, 1)];

export default function ThFeltMenu() {
  const [felt, setFelt] = useState<FeltKey>(() => (typeof window === "undefined" ? "green" : loadFelt()));
  const pick = (k: string) => { const f = k as FeltKey; setFelt(f); applyFelt(f); };
  const look: PrefsTab = {
    id: "look", name: "外觀",
    sections: [{ kind: "swatch", title: "桌布", value: felt, onChange: pick,
      options: FELTS.map((f) => ({ id: f.key, name: f.name, bg: `linear-gradient(145deg, ${FELT_SW[f.key].join(",")})` })) }],
    preview: (
      <div className="felt" style={{ background: `url("${FELT_IMG[felt]}") center top / cover no-repeat, radial-gradient(ellipse at 50% 46%, ${FELT_SW[felt][0]}, ${FELT_SW[felt][1]} 60%, ${FELT_SW[felt][2]})` }}>
        <div className="row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={CARD_BACK_SRC} alt="" width={36} height={50} />
          {PREVIEW.map((c) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c.id} src={cardSrc(c)} alt="" width={36} height={50} />
          ))}
        </div>
      </div>
    ),
    previewCap: FELTS.find((f) => f.key === felt)?.name,
    onReset: () => pick("green"),
  };
  return <GameMenu game="thirteen" className="th-menu" tabs={[look]} />;
}
