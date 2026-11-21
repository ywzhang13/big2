"use client";
// 麻將的設定面板：換成三款共用的 GamePrefsPanel（阿妍〈麻將換共用名牌設定結算〉第 1 張卡；小宜〈共用設定面板 v1〉）。
// 麻將只交「外觀」「自摸特效」兩頁的區塊資料，外框、聲音頁（語音、互動音效、自動播放、震動）是共用的。
// 入口不變：≡ 選單（MjTableMenu）、大廳齒輪都是 openPrefs() 發 mj-open-prefs；掛載點（牌桌、觀戰、總大廳）都不用改。
// 設定值不搬家：外觀、聲音本來就存在 lib/mahjong/prefs（LINE 帳號跟帳號、沒登入存這台 mj.prefs.v4），共用面板讀寫同一份；
// 自摸特效存在伺服器（/api/mahjong/zimo-fx）。
// 自摸特效頁：點卡片＝預覽＋直接存（阿哲 2026-11-20 拿掉「確定」）。存的順序交給整頁共用的佇列（./zimoFxSaver，審伯 R1、R2）：
// 關閉再打開、連點都只有一條佇列、一次一筆，最後存的是最後點的；回應遺失、失敗時向伺服器確認，確認前不標「使用中」。
// 如來神掌只有 GET 回 ownerFx 才出現。
import { useEffect, useState, useSyncExternalStore } from "react";
import GamePrefsPanel, { type CardSection, type PrefsTab } from "@/components/gamePrefs/GamePrefsPanel";
import MjTile from "./MjTile";
import ZimoFxPreferencePreview from "./ZimoFxPreferencePreview";
import type { Tile } from "@/lib/mahjong/tiles";
import { BACKS, FELTS, THEMES, DEFAULT_PREFS, usePrefs, setPrefs, type BackId, type FeltId } from "@/lib/mahjong/prefs";
import { getMyFx, selectMyFx, type ZimoFxChoice } from "@/lib/mahjong/zimoFxClient";
import { createZimoFxSaver } from "./zimoFxSaver";

const FX_CARDS: { code: ZimoFxChoice; name: string; art?: string }[] = [
  { code: "golden", name: "金色自摸" },
  { code: "meteor", name: "隕石", art: "/mahjong-fx/meteor/meteor-title.webp" },
  { code: "thunder", name: "雷霆", art: "/mahjong-fx/zimo/thunder/thunder-title.webp" },
  { code: "storm", name: "風暴", art: "/mahjong-fx/zimo/storm/storm-title.webp" },
  { code: "frost", name: "冰封", art: "/mahjong-fx/zimo/frost/frost-title.webp" },
  { code: "blackhole", name: "黑洞", art: "/mahjong-fx/zimo/blackhole/blackhole-title.webp" },
  { code: "sakura", name: "櫻花", art: "/mahjong-fx/zimo/sakura/sakura-title.webp" },
];
/** 老闆專屬的卡片：只有 GET 回 ownerFx 才顯示（不寫死帳號） */
const OWNER_FX_CARDS: { code: ZimoFxChoice; name: string; art?: string }[] = [
  { code: "rulai", name: "如來神掌", art: "/mahjong-fx/zimo/rulai/rulai-title.webp" },
];

const PREVIEW_TILES: Tile[] = [
  { id: -11, suit: "m", rank: 5, display: "五萬" },
  { id: -12, suit: "p", rank: 7, display: "七筒" },
  { id: -13, suit: "s", rank: 3, display: "三條" },
  { id: -14, suit: "z", rank: 5, display: "中" },
];

/** 快速主題卡裡的色塊（填滿共用 .gpp-theme .sw 那格；數值照原本的 .mjp-theme .sw） */
const SW: React.CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 };
const SW_I: React.CSSProperties = { width: 16, height: 22, borderRadius: 3, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.15)" };

export default function MjPrefsPanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("mj-open-prefs", onOpen);
    return () => window.removeEventListener("mj-open-prefs", onOpen);
  }, []);
  // 每次打開重新掛：分頁從「外觀」開始、重新問一次自摸特效
  return open ? <Panel onClose={() => setOpen(false)} /> : null;
}

/** 整頁一條（不隨面板開關重建） */
const fxSaver = createZimoFxSaver({ get: getMyFx, post: selectMyFx });

function Panel({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  const { data: fx, confirmed, save } = useSyncExternalStore(fxSaver.subscribe, fxSaver.get, fxSaver.get);
  const [picked, setPick] = useState<ZimoFxChoice | null>(null);
  const [replay, setReplay] = useState(0);
  useEffect(() => { void fxSaver.load(); }, []);
  const pick = picked ?? confirmed; // 還沒點過：預覽伺服器確認的那一張

  const granted = (c: ZimoFxChoice) => !!fx && c in fx.available;
  const choose = (code: ZimoFxChoice) => {
    setPick(code);
    setReplay((n) => n + 1);
    fxSaver.choose(code);
  };

  const themeOn = THEMES.find((t) => t.back === prefs.back && t.felt === prefs.felt)?.id ?? null;
  const look: PrefsTab = {
    id: "look", name: "外觀",
    sections: [
      { kind: "theme", title: "快速主題", value: themeOn, onChange: (id) => { const t = THEMES.find((x) => x.id === id); if (t) setPrefs({ back: t.back, felt: t.felt }); },
        options: THEMES.map((t) => ({ id: t.id, name: t.name, sw: (
          <span style={{ ...SW, background: `linear-gradient(145deg, ${FELTS[t.felt].table[0]}, ${FELTS[t.felt].table[2]})` }}>
            <i style={{ ...SW_I, background: `linear-gradient(180deg, ${BACKS[t.back].c.join(",")})` }} />
            <i style={{ ...SW_I, background: "#fff" }} />
          </span>
        ) })) },
      { kind: "swatch", title: "牌背顏色", value: prefs.back, onChange: (id) => setPrefs({ back: id as BackId }),
        options: (Object.keys(BACKS) as BackId[]).map((id) => ({ id, name: BACKS[id].name, bg: `linear-gradient(180deg, ${BACKS[id].c.join(",")})` })) },
      { kind: "swatch", title: "桌布", value: prefs.felt, onChange: (id) => setPrefs({ felt: id as FeltId }),
        options: (Object.keys(FELTS) as FeltId[]).map((id) => ({ id, name: FELTS[id].name, bg: `linear-gradient(145deg, ${FELTS[id].table.join(",")})` })) },
    ],
    preview: (
      <div className="felt" style={{ background: `linear-gradient(145deg, ${FELTS[prefs.felt].table.join(",")})` }}>
        <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} />)}</div>
        <div className="row">{PREVIEW_TILES.map((t) => <MjTile key={t.id} tile={t} width={30} height={41} faceDown />)}</div>
      </div>
    ),
    previewCap: `${BACKS[prefs.back].name}／${FELTS[prefs.felt].name}`,
    onReset: () => setPrefs({ back: DEFAULT_PREFS.back, felt: DEFAULT_PREFS.felt }),
  };

  const cards: CardSection = {
    kind: "cards", cols: 4, value: pick, onChange: (id) => choose(id as ZimoFxChoice),
    options: [...FX_CARDS, ...OWNER_FX_CARDS.filter((c) => fx?.ownerFx?.some((o) => o === c.code))].map(({ code, name, art }) => {
      const s = save?.code === code ? save.state : null;
      return {
        id: code, name,
        // eslint-disable-next-line @next/next/no-img-element
        thumb: <span className={`mjp-fx-thumb${code === "golden" ? " gold" : ""}`}>{art && <img src={art} alt="" />}</span>,
        status: s === "saving" ? { text: "儲存中…", tone: "ready" as const } : s === "failed" ? { text: "儲存失敗", tone: "lock" as const }
          : s === "unconfirmed" ? { text: "未確認，再點一次", tone: "lock" as const }
          : confirmed === code ? { text: "使用中", tone: "use" as const } : granted(code) ? { text: "可使用", tone: "ready" as const } : { text: "預覽", tone: "lock" as const },
      };
    }),
  };
  const fxTab: PrefsTab = {
    id: "fx", name: "自摸特效", afterSound: true, visible: !!fx, sections: [cards],
    preview: pick ? <ZimoFxPreferencePreview fx={pick} replay={replay} muted={prefs.fxMuted} volume={prefs.fxVol} name={fx?.displayName ?? "LINE 使用者"} /> : undefined,
    onReset: () => choose("golden"),
  };

  return <GamePrefsPanel game="mahjong" open onClose={onClose} tabs={[look, fxTab]} />;
}
