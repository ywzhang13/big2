"use client";
// 三款共用的結算外框（小宜〈十三支 v15〉§4～6，位置對齊麻將每局結算）：遮罩、左右兩欄、大標題、標題下的小區塊和小按鈕、明細表格、
//   一家一列的框（名字、標記、輸贏和累計、自己那一列金框）、「還在等 A、B」、「確認 2/4」小牌子、右下角主要按鈕、查看牌桌時的「回到結算」。
// 中間放牌的那一塊、名字下的標記、每一行明細的名稱和數字由各遊戲自己交。樣式前綴 .gr-（gameResult.css）。
// 十三支、麻將在用（麻將 2026-11-21 小宜〈麻將換共用元件 v1〉§4 補：明細 plain＋單位、第二顆按鈕、蓋在四家列上的展開區、胡牌那一列、灰字標題、多行標題下小區塊）。
// 新加的都是選填，不給就跟原本一樣（十三支不用改）。
// attrs：各遊戲自己的 data-* 屬性（測試、驗收腳本用），外框原樣掛上去
import type { ReactNode } from "react";
import "./gameResult.css";

type Attrs = Record<`data-${string}`, string | number | undefined>;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "zero");

/** 明細一行：預設 signed（+N／−N、綠紅）；plain＝不帶正負號、金色、後面接單位（麻將「5 台」） */
export interface GrItem { label: string; value: number; format?: "signed" | "plain"; unit?: string }
const itemValue = (it: GrItem) => (it.format === "plain"
  ? <b className="v plain">{it.value}{it.unit ?? ""}</b>
  : <b className={`v ${tone(it.value)}`}>{signed(it.value)}</b>);
export interface GrRow {
  key: string | number;
  me?: boolean;
  /** win＝胡牌那一家（金色底框；自己那列仍以 me 為準） */
  tone?: "win";
  name: string;
  /** 名字下的標記（全壘打、彈孔…） */
  marks?: ReactNode;
  /** 中間放牌的那一塊（遊戲自己畫） */
  body?: ReactNode;
  /** 右邊：這局輸贏（null＝不顯示）、下面一行小字（累計） */
  delta: number | null;
  sub?: ReactNode;
  attrs?: Attrs;
  /** 總結算：名次圓點（0＝第一名）、名字一行、統計欄；有給就畫總結算那種列 */
  rank?: number;
  stats?: { label: string; value: number; attrs?: Attrs }[];
}

export default function GameResultFrame({ title, titleTone, sub, subs, tool, items, total, rows, overlay, next = null, ready = null, primary, secondary, peek = false, onBack, error = null, attrs, scaleVar }: {
  title: string;
  /** draw＝灰字、沒有光暈（麻將流局） */
  titleTone?: "draw";
  /** 標題下的小區塊（十三支：彩金牌；總結算：「8 局・底分 100」） */
  sub?: ReactNode;
  /** 標題下好幾行小區塊（麻將：誰胡牌、誰放槍、骰子），每個一行；排在 sub 後面 */
  subs?: ReactNode[];
  /** 標題下的小按鈕（十三支「查看牌桌」，麻將「看牌庫」的位置） */
  tool?: { label: string; onClick: () => void; attrs?: Attrs };
  /** 明細表格（左欄下半）；total＝最後一行合計 */
  items?: GrItem[];
  total?: GrItem;
  rows: GrRow[];
  /** 蓋在四家列上面的展開區（麻將看牌庫）：四家列和按鈕的位置不動，內容遊戲自己畫 */
  overlay?: ReactNode;
  /** 「還在等 A、B」；沒有人要等就是 null（位置保留） */
  next?: string | null;
  /** 「確認 2/4」＋四家小牌子；null＝不顯示 */
  ready?: { label: string; chips: { key: string | number; name: string; ok: boolean; attrs?: Attrs }[]; attrs?: Attrs } | null;
  /** 右下角主要按鈕 */
  primary: { label: string; disabled?: boolean; onClick: () => void; attrs?: Attrs };
  /** 第二顆按鈕（麻將「離開」）：透明底金框，在主要按鈕左邊 */
  secondary?: { label: string; onClick: () => void; attrs?: Attrs };
  /** 查看牌桌：整塊收起來，右下角出現「回到結算」 */
  peek?: boolean;
  onBack?: () => void;
  /** 按主要按鈕失敗的原因（主要按鈕上面一行） */
  error?: string | null;
  attrs?: Attrs;
  /** 整塊放大的倍數（CSS 變數，例如十三支 "var(--th-s2, 1)"）；不給＝1 */
  scaleVar?: string;
}) {
  const z = scaleVar ? ({ "--gr-z": scaleVar } as React.CSSProperties) : undefined;
  return (
    <div className={`gr${peek ? " peek" : ""}`} role="dialog" aria-label={title} style={z} {...attrs}>
      <div className="gr-in">
        <div className="gr-l">
          <div className={`gr-title${titleTone ? ` ${titleTone}` : ""}`}>{title}</div>
          {sub && <div className="gr-sub">{sub}</div>}
          {subs?.map((x, i) => <div key={i} className="gr-sub">{x}</div>)}
          {tool && <button type="button" className="gr-tool" onClick={tool.onClick} {...tool.attrs}>{tool.label}</button>}
          {items && total && (
            <div className="gr-items">
              {items.map((it) => (
                <div key={it.label} className="gr-item"><span className="n">{it.label}</span>{itemValue(it)}</div>
              ))}
              <div className="gr-item tot"><span className="n">{total.label}</span>{itemValue(total)}</div>
            </div>
          )}
        </div>
        <div className="gr-r">
          <div className="gr-rows">
            {rows.map((r) => (
              <div key={r.key} className={`gr-row${r.me ? " me" : ""}${r.tone === "win" ? " win" : ""}${r.rank !== undefined ? " is-final" : ""}`} {...r.attrs}>
                {r.rank !== undefined ? (
                  <>
                    <span className={`gr-rank r${Math.min(r.rank, 3)}`}>{r.rank + 1}</span>
                    <span className="gr-fname">{r.name}</span>
                    {r.stats?.map((s) => <span key={s.label} className="gr-stat" {...s.attrs}>{s.label}<b>{s.value}</b></span>)}
                  </>
                ) : (
                  <>
                    <div className="gr-who"><span className="nm">{r.name}</span>{r.marks}</div>
                    <div className="gr-body">{r.body}</div>
                  </>
                )}
                {r.delta !== null && (
                  <div className="gr-delta"><b className={tone(r.delta)}>{signed(r.delta)}</b>{r.sub && <small>{r.sub}</small>}</div>
                )}
              </div>
            ))}
            {overlay && <div className="gr-overlay">{overlay}</div>}
          </div>
          <div className="gr-next" role="status">{next ?? ""}</div>
          {error && <div className="gr-err" role="alert">{error}</div>}
          <div className="gr-foot">
            <div className="gr-ready" {...ready?.attrs}>
              {ready && <span className="cnt">{ready.label}</span>}
              {ready?.chips.map((c) => (
                <span key={c.key} className={`gr-chip ${c.ok ? "ok" : "wait"}`} {...c.attrs}><i>{c.ok ? "✓" : "…"}</i><span>{c.name}</span></span>
              ))}
            </div>
            {secondary && <button type="button" className="gr-btn ghost" onClick={secondary.onClick} {...secondary.attrs}>{secondary.label}</button>}
            <button type="button" className="gr-btn" disabled={primary.disabled} onClick={primary.onClick} {...primary.attrs}>{primary.label}</button>
          </div>
        </div>
      </div>
      {peek && onBack && <button type="button" className="gr-back" onClick={onBack} {...tool?.attrs}>回到結算</button>}
    </div>
  );
}
