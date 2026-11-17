# 十三支（4 人加一色）計分引擎 API

老柯，2026-11-13，分支 `feat/thirteen-engine`。

規則依據：〈十三支-四人加一色-規則書-定案版 v2〉，加上老闆 2026-11-13 改的打槍罰分（被一家打槍，多付那家 **1 分**）。阿妍的 v3 規則書交出後，會再對一次分數。

`lib/thirteen/` 裡全部是純函式，不碰畫面、不碰資料庫，前端和後端都能直接用：

```ts
import { deal, autoArrange, checkArrangement, validateSubmission, scoreRound, revealOrder, SCORING } from "@/lib/thirteen";
```

## 牌

```ts
interface Card { id: string; suit: "S" | "H" | "D" | "C"; rank: number; deck: 1 | 2 }
```

- `rank` 是 2～14，其中 11=J、12=Q、13=K、14=A。
- `id` 是唯一的，格式為「花色＋點數字母＋第幾副」。
  - 例：`"SA1"` 是第一副黑桃 A，`"SA2"` 是第二副黑桃 A，`"HT1"` 是紅心 10。
  - 只有黑桃有第 2 副。
- 畫面上兩張 ♠A 長得一樣，共用同一張圖。理牌、拖曳、送出都用 `id` 分辨。
- 比大小只看點數和牌型，不看是哪一副，也不比花色。

| 函式 | 說明 |
|---|---|
| `buildDeck(): Card[]` | 回傳 65 張牌：一副 52 張，再加第二副黑桃 13 張 |
| `deal(rng?): { hands: Card[][]; rest: Card[] }` | 洗牌後發 4 家，每家 16 張（`HAND_SIZE`）；`rest` 是剩下的 1 張，收起來、不公開。老闆 2026-11-18：加一色每人 16 張，自己挑 13 張理牌，另外 3 張不用 |
| `shuffle(xs, rng?)` | Fisher-Yates 洗牌 |
| `secureRandomInt(n)` | 回傳 0～n−1 的密碼學安全隨機整數，洗牌預設用它 |

**洗牌的亂數**（審伯 2026-11-13 必修）：
- 不帶 `rng` 時，一律用密碼學安全亂數 `crypto.getRandomValues`。瀏覽器和 Node 19 以上都有。
- 取不到 `crypto` 時會直接丟錯，**絕不會**退回 `Math.random`。
- `rng` 只給測試注入固定種子用，正式的發牌流程不要傳。
| `parseCards("AS AS 9H")` | 把文字轉成牌，測試和除錯用。同一手裡第二次出現的黑桃，自動當成第 2 副 |

## 排法和送出

```ts
interface Arrangement { front: Card[]; middle: Card[]; back: Card[] }  // 頭道 3 張、中道 5 張、尾道 5 張
```

| 函式 | 說明 |
|---|---|
| `checkArrangement(a)` | **前端用來決定能不能按送出。** 合法時回 `{ ok: true, values: { front, middle, back } }`，每一道是 `{ cat, keys }`；不合法時回 `{ ok: false, error, message }` |
| `validateSubmission(dealt, input: unknown)` | **後端收到送出時要再擋一次。** `dealt` 是這位玩家的 16 張；送出的 13 張每一張都要在裡面，沒送的 3 張就是不用的。 `input` 可以直接放網路送來、還沒驗證過的內容，函式自己會先檢查格式：必須是物件，`front`、`middle`、`back` 三道都是陣列，裡面每個元素都是字串。任何格式錯誤都回 `bad_input`，不會丟錯。格式對了才接著檢查張數是不是 3／5／5、有沒有重複的 id、送來的牌是不是發給這位玩家的、有沒有倒水。通過時回 `{ ok: true, arrangement }` |
| `autoArrange(cards)` | 理牌時間到了（或斷線）時呼叫，從 16 張（也收 13 張）裡挑 13 張排出一組不倒水的組合，沒挑到的就是不用的牌 |

`autoArrange` 排出的是「最好」的三墩：在所有不倒水的排法裡先比尾道、再比中道、再比頭道，取最大的（字典序最大）。只看自己的牌，不考慮對手，也不另外追特殊加分。做法是尾道挑最大的 5 張、中道挑剩下最大的 5 張、頭道挑再剩下最大的 3 張；一樣大的選法（例如葫蘆用哪幾張 K）每一種都試，取最好的一組。16 張時沒挑到的 3 張不用。已和窮舉所有排法的結果對照過（`tests/_thirteen-deal16.ts` G7）。

`error` 可能的值，`message` 是可以直接顯示給玩家的中文：

| error | message |
|---|---|
| `bad_input` | 送出的資料格式不對 |
| `bad_size` | 頭道要 3 張、中道和尾道各 5 張 |
| `duplicate_card` | 同一張牌不能用兩次 |
| `not_your_card` | 有不是你的牌 |
| `foul_front_middle` | 倒水：頭道不能比中道大 |
| `foul_middle_back` | 倒水：中道不能比尾道大 |

倒水的判定：頭道 > 中道，或中道 > 尾道，才算倒水；兩道一樣大不算。頭道 3 張和中道 5 張比的時候，只比到 3 張為止。

## 牌型

```ts
evalFive(cards) / evalThree(cards) / evalRow(cards): { cat, keys }
compareValue(a, b): number   // 正數＝a 大，負數＝b 大，0＝一樣大
```

`cat` 是牌型等級，對應 `CAT` 常數；`CAT_NAME[cat]` 是中文名稱：

| cat | 牌型 |
|---|---|
| 11 | 五龍 |
| 10 | 同花順 |
| 9 | 鐵支 |
| 8 | 葫蘆 |
| 7 | 同花兩對 |
| 6 | 同花一對 |
| 5 | 同花 |
| 4 | 順子 |
| 3 | 三條 |
| 2 | 兩對 |
| 1 | 一對 |
| 0 | 烏龍 |

- 頭道只會出現 3（三條）、1（一對）、0（烏龍）。
- A-2-3-4-5 是最小的順子；順子不能繞圈，所以 Q-K-A-2-3 不算順子。
- 同花帶對不算同花順。例如 ♠A ♠A ♠K ♠Q ♠J 是同花一對。

## 計分

`scoreRound(arrangements: Arrangement[4])` 回傳：

```ts
{
  totals: number[];        // 四家這局的總分，含全壘打，加起來一定是 0
  pairs: { a, b, points, gunner, rows: { front|middle|back: { winner, bonus } } }[];
                           // 6 組兩兩結算。points 是 a 從 b 拿到的分數，負數代表 a 付給 b。
                           // gunner 是打槍的座位；winner 為 null 代表那一道平手；bonus 是輸家付的特殊加分
  homeRun: number | null;  // 全壘打的座位
  values: { front, middle, back }[];  // 四家各道的牌型，給畫面顯示
}
```

規則參數集中在 `SCORING`，**改規則只要改這一處**：

```ts
SCORING.GUN_PENALTY = 1        // 被打槍時，另外多付打槍者的分數（老闆 2026-11-13 改；v2 是 3）
SCORING.HOME_RUN_PENALTY = 3   // 全壘打時，另外三家各再付的分數，和打槍的分數疊加
SCORING.BONUS                  // 特殊加分，輸掉那一道的人付給贏家
                               // 頭道：衝三 2
                               // 中道：鐵支 4、同花順 6、五龍 8
                               // 尾道：鐵支 2、同花順 3、五龍 4
```

計分怎麼算：
- 兩家之間三道各自比：贏 +1、輸 −1、平手 0。輸的人另外付贏家那一道的特殊加分。
- 三道全贏才算打槍，有平手就不算。被打槍的人再多付 `GUN_PENALTY`。
  - 例：對方中道鐵支又打槍你，你要付 3＋1＋4＝8 分。
- 一家打槍另外三家就是全壘打，另外三家各再付 `HOME_RUN_PENALTY`。

## 亮牌順序

`revealOrder(arrangements)` 回傳：

```ts
{ front: number[][]; middle: number[][]; back: number[][] }
```

- 每一道都是從最小亮到最大，一樣大的座位放在同一組，一起亮。
- 例：`front: [[2], [0, 3], [1]]` 代表頭道先亮座位 2，接著 0 和 3 一起亮，最後亮 1。
- 動畫照「頭道 → 中道 → 尾道」的順序播。這只影響畫面演出，不影響計分。

## 測試

- `tests/_thirteen-coverage.ts`（2026-11-13 補）：
  - 審伯兩項必修：用安全亂數發牌；送出資料格式錯時回失敗、不丟錯。
  - 12 級牌型兩兩相鄰的大小。
  - 各牌型同型逐項比較，核心牌和踢腳都有測。
  - 兩張一模一樣的黑桃平手。
  - 倒水邊界和中文提示。
  - 加分牌型平手時不加分；不在加分表上的牌型不加分。
  - 一家同時被三家打槍。
  - 一條龍照一般三道計分。

- `tests/_thirteen-examples.ts`：
  - 規則書 14 個範例，用新的打槍規則重算後全部通過。
  - 補充測試牌型判斷和亮牌順序。
  - 把 `GUN_PENALTY` 改回 3 時，算出的分數完全等於 v2 的分數。
- `tests/_thirteen-random.ts`，跑 1 萬局固定種子的隨機牌局，確認：
  - 65 張不重複、不遺漏。
  - 4 萬手自動排牌都不倒水。
  - 每局四家總分都是 0。
  - 壞的送出全部被擋下。

## 亮牌、結算、下一局（2026-11-18）

`lib/thirteen/flow.ts`：

| 名稱 | 說明 |
|---|---|
| `revealDurationMs(result)` | 從開始比牌到結算面板出現要多久（毫秒）。照小宜 v5 時間軸：開始比牌 1.2 秒、三墩各 2.6 秒；每個特效牌型 +0.9 秒；每組打槍 +1.0 秒；全壘打 +1.9 秒。各段長度在 `REVEAL_TIMING` |
| `SETTLE_WAIT_MS` | 結算面板出現後等多久自動開下一局：30 秒 |
| `handStats(result)` | 這局每家的明細：墩分、特殊加分（衝三、中墩鐵支…）、打槍、被打槍、全壘打、被全壘打；各項加起來等於這局總分 |
| `matchStats(state)` | 整場累計：每家打槍、被打槍、全壘打、被全壘打的次數和總分 |

亮牌時伺服器記下三個時間：`revealedAt`（亮牌）、`settleAt`（＝revealedAt＋演出長度）、`nextHandAt`（＝settleAt＋30 秒）。
四家都按確認（next-game）就馬上開下一局；有人沒按，就等到 nextHandAt 自動開。
前端 API 說明見「給老馬-十三支結算與下一局API說明.md」。
