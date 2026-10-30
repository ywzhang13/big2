"use client";
import { useState } from "react";

/** LINE 頭像；沒有或載入失敗顯示名字第一個字（同觀戰的 SpxAvatar） */
export function FxsAvatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="fxs-av" aria-hidden>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- LINE 頭像外部網址，不經過 next/image
        <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
      ) : (
        Array.from(name)[0] ?? "?"
      )}
    </span>
  );
}
