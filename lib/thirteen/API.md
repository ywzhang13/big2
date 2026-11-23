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
| `autoArrange(cards)` | 推薦排法、理牌時間到了（或斷線）代排時呼叫，從 16 張（也收 13 張）裡挑 13 張排出一組不倒水的組合，沒挑到的就是不用的牌；會優先保留衝三、鐵支、同花順、五龍等加分牌型 |

`autoArrange` 排出的是「最好」的三墩（阿哲 2026-11-18 拍板）：
1. 只看不倒水的排法（頭道 ≤ 中道 ≤ 尾道）。
2. **先比牌型加分合計**（`score.ts` 的 `bonusOf`：頭道衝三 +2；中道鐵支 +4、同花順 +6、五龍 +8；尾道鐵支 +2、同花順 +3、五龍 +4）。
3. 加分一樣多，再比尾道、中道、頭道，取最大的（字典序最大）。

為什麼加分優先：這一墩贏的時候，輸掉這一墩的人要額外付牌型加分（和 `scorePair` 一致），值得比尾道或中道稍微大一點多。例如手上有三張 Q，舊做法會拿一張 Q 去湊尾道同花，頭道剩一對，白白丟掉衝三的 2 分；新判準會把 QQQ 留在頭道，只要中、尾道還排得出不倒水的組合。兩組鐵支時大的放尾道、小的放中道（2＋4＝6 分），不會把其中一組拆掉當散牌。

只看自己的牌，不考慮對手。做法：先列出每墩可能拿加分的組合（三條、鐵支、同花順、五龍），每墩「不拿加分」或「拿其中一個」的組合都試；固定好的墩以外，尾道挑剩下最大的、中道再挑剩下最大的、頭道再挑剩下最大的（一樣大的選法每一種都試）；加分上限已經不可能超過目前最好的就跳過。16 張時沒挑到的 3 張不用。結果和窮舉所有不倒水排法的最佳完全相同（`tests/_thirteen-arrange-bonus.ts` B4、`tests/_thirteen-deal16.ts` G7）；伺服器單次計算 2000 手 16 張平均約 10 毫秒、最慢約 100 毫秒（B6）。

**改到排牌邏輯（`arrange.ts` 的 `autoArrange`）時要跑慢測 `npm run test:slow`**（`tests/slow/thirteen-arrange-10k.ts`，約 15 分鐘）：隨機 1 萬局（4 萬手 16 張）都不倒水、都是本人的 13 張，另外把 `tests/_thirteen-random.ts` 跑滿 1 萬局。常規 `npm test` 這兩支都只跑 1,000 局（`_thirteen-deal16.ts` G5、`_thirteen-random.ts`）。

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
| 10 | 同花順（v4 是「非黑桃同花順」；舊規則房包含黑桃） |
| 12 | 黑桃同花順（**只在 v4 房出現**） |
| 13～15 | 彩金三條、彩金葫蘆、彩金鐵支（**只在 v4 房出現**；大小見下方「v4 規則」） |
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
- 打槍（v4 以前）：三道全贏才算，有平手就不算。被打槍的人再多付 `GUN_PENALTY`。v5 的打槍改了，見下一節。
  - 例：對方中道鐵支又打槍你，你要付 3＋1＋4＝8 分。
- 一家打槍另外三家就是全壘打，另外三家各再付 `HOME_RUN_PENALTY`。

## v4 規則（老闆 2026-11-19 定案；新開的房都是 v4，取代沒上線的 v3）

### 規則版本 `scoreRule`

| 值 | 哪些房 | 一道的輸贏 | 特殊牌型 | 全壘打 | 牌型 |
|---|---|---|---|---|---|
| `"v5"` | 2026-11-20 起新開的房（`create` 寫進 `settings.scoreRule`） | **不算分** | 那一道被你贏過的人各付 `SCORING.BONUS_V5`（彩金牌型改了，見下） | 同 v4（三家各再付 2） | 同 v4。**打槍**：沒有一道輸給對方、至少贏一道就算（平手的道不影響）。**彩金分**：見下 |
| `"v4"` | 2026-11-19 上線後、11-20 v5 上線前開的房 | **不算分** | 那一道被你贏過的人各付 `SCORING.BONUS_V4` | 三家各再付 2 | 黑桃同花順、彩金牌型 |
| `"jia"` | 甲案上線後、這次上線前開的房 | 1 墩 | 只算 `SCORING.BONUS` | 三家各再付 3 | 舊牌型 |
| `"v1"` | 設定裡沒有 `scoreRule` 的房 | 1 墩 | 1＋`SCORING.BONUS` | 三家各再付 3 | 舊牌型 |

**v5 的彩金規則（老闆 2026-11-20 定案）**：
- 彩金分：任何一道擺了 3 張以上彩金點數（`SCORING.LUCKY_ROW_MIN`），**不管那道輸贏**，另外三家各付 1（`SCORING.LUCKY_POINT`）。結果在 `RoundResult.luckyPoints`（四家淨額，合計 0），左欄明細 `HandStat.luckyPoints`、`ScoredStat.luckyPoints`（乘底分）。
- 彩金牌型加分（`SCORING.BONUS_V5`，一樣只向那一道被你贏過的人收、每贏一家收一次）：頭墩彩金衝三照衝三 1；中墩彩金三條 0、彩金葫蘆 1、彩金鐵支 9；尾墩彩金三條 0、彩金葫蘆 0、彩金鐵支 4。其他牌型和 v4 一樣，牌型大小不變。
- 例：中墩彩金鐵支贏三家、其他道沒贏＝9×3＋彩金分 3＝+30，三家各 −10。
- 一副 65 張每個點數 5 張、彩金牌本身不在手上，所以一局最多一個人、一道拿到彩金分。

舊房整場照原本的規則，不會中途換。打槍都是向那家收 1：v4、jia、v1 要三道都贏同一家；v5 只要沒有一道輸給他、至少贏一道（例：平手、贏、贏；贏、平手、平手；三道全平不算），判定在 `gunnerOf`。牌局狀態、亮牌內容（`reveal`、`th_reveal`、410 的 `record.finalHand`）都帶 `scoreRule`。

### 彩金牌 `luckyCard`

- 65 張發給四家各 16 張，剩下的 1 張就是這一局的彩金牌（存在牌局狀態的 `rest[0]`）。
- 格式：`Card`＝`{ id, suit, rank, deck }`，例如 `{ "id": "S51", "suit": "S", "rank": 5, "deck": 1 }`。`rank` 2～14（14＝A）。
- 哪裡拿得到（v4 的房）：
  - 牌局狀態 `luckyCard`：開始理牌起四家、觀戰、不在桌上的人都看得到；等人時是 `null`。
  - 公開頻道的 `th_hand_start` 廣播：`payload.luckyCard`。
  - 亮牌內容 `reveal.luckyCard`、410 的 `record.finalHand.luckyCard`。
- 舊規則房（v1、jia）一律是 `null`，剩下的那張照舊不給任何人。
- 點數跟彩金牌一樣的牌叫「彩金點數」（只看點數，不看花色）。

### 新牌型代號（代號不重編，比大小不能直接比數字）

| cat | `CAT` | `CAT_NAME` | 條件（v4） |
|---|---|---|---|
| 15 | `LUCKY_FOUR` | 彩金鐵支 | 鐵支的四張是彩金點數 |
| 14 | `LUCKY_FULL_HOUSE` | 彩金葫蘆 | 葫蘆的三張那組是彩金點數（對子是彩金點數不算） |
| 13 | `LUCKY_THREE` | 彩金三條 | 三條是彩金點數；**頭墩請顯示「彩金衝三」**（左欄明細名稱已經是「彩金衝三」） |
| 12 | `SPADE_STRAIGHT_FLUSH` | 黑桃同花順 | 五張都是黑桃的同花順 |
| 10 | `STRAIGHT_FLUSH` | 同花順 | v4 就是「非黑桃同花順」（黑桃以外的同花順）；舊房包含黑桃 |

大小（`compareValue`；或用 `CAT_RANK[cat] ?? cat` 排序）：
五龍(11) ＞ 彩金鐵支(15) ＞ 非黑桃同花順(10) ＞ 黑桃同花順(12) ＞ 鐵支(9) ＞ 彩金葫蘆(14) ＞ 葫蘆(8) ＞ … ＞ 順子(4) ＞ 彩金三條(13) ＞ 三條(3) ＞ …

- 同一種牌型裡彩金最大：彩金 5 的衝三贏 6 的衝三、也贏 A 的衝三。
- 黑桃同花順大於鐵支（老闆 2026-11-23；之前是鐵支大於黑桃同花順）。v4、v5 的房都照這個大小，加分不變；舊房（v1、jia）沒有黑桃同花順，黑桃的同花順就是同花順，本來就大於鐵支。
- 倒水也照這個大小。例如中墩黑桃同花順＋尾墩鐵支是倒水（v4、v5 和舊房都是），中墩鐵支＋尾墩黑桃同花順合法；頭墩彩金衝三比中墩一般三條大，在 v4 是倒水。

### v4 加分（`SCORING.BONUS_V4`：那一道贏過誰，就向誰收這個數字）

| 墩 | 牌型 | 加分 |
|---|---|---|
| 頭墩 | 衝三 | 1 |
| 頭墩 | 彩金衝三 | 2 |
| 中墩 | 彩金葫蘆 | 1 |
| 中墩 | 黑桃同花順、鐵支 | 2 |
| 中墩 | 非黑桃同花順 | 3 |
| 中墩 | 彩金鐵支 | 6 |
| 中墩 | 五龍 | 10 |
| 尾墩 | 彩金葫蘆 | 0 |
| 尾墩 | 黑桃同花順、鐵支 | 1 |
| 尾墩 | 非黑桃同花順 | 2 |
| 尾墩 | 彩金鐵支 | 3 |
| 尾墩 | 五龍 | 5 |
| 其他 | | 0 |

- 例：中墩鐵支贏兩家、輸一家同花順 → 向贏的兩家各收 2、付那家 3。
- 全壘打（沒有特殊牌型時）：贏家 +9（三槍 3＋三家各 2），三家各 −3。
- 以上都是墩數，`scores` 再乘底分。四家總和一定是 0。

### 欄位在 v4 的意思

| 欄位 | v4 |
|---|---|
| `result.pairs[].rows[row]` | `winner` 照樣是那一道誰贏；`bonus` 是贏家那道的加分（一般牌型 0，那一道兩家之間就是 0 分） |
| `stats[].rows`（左欄「墩分」） | **永遠 0**（一道的輸贏不算分），前端可以不顯示這一行 |
| `stats[].bonuses` | 特殊牌型加分，名稱例：「衝三」「彩金衝三」「中墩彩金葫蘆」「中墩黑桃同花順」「中墩同花順」（＝非黑桃同花順）「尾墩彩金鐵支」；同名正負合併，合計 0 的不列 |
| `stats[].gunPoints`、`scored.shotPoints`、`scored.shotByPoints` | 打槍，每槍 1（× 底分） |
| `stats[].homeRunPoints` | 全壘打：自己 +6、被全壘打 −2（× 底分另見 `scored`） |
| `stats[].scored` | 上面每一項 × 底分，加總＝`scores[seat]` |
| `rowDeltas` | 每墩只有加分（一般牌型那一道 0）；三墩加總＋（打槍＋全壘打）× 底分＝`scores` |

### 函式的規則參數（沒帶＝v4、沒有彩金牌）

```ts
type HandRule = "legacy" | { lucky: number | null }   // v4 → { lucky: 彩金牌的 rank }
evalFive(cards, rule?)  evalThree(cards, rule?)  evalRow(cards, rule?)
checkArrangement(a, rule?)  autoArrange(cards, rule?)  validateSubmission(dealt, ids, rule?)
bonusOf(row, value, rule?: ScoreRule | HandRule)
scoreRound(arrs, rule?: "v1" | "jia" | "v4" | "v5", lucky?: number | null)   revealOrder(arrs, rule?, lucky?)
handRuleOf(scoreRule, lucky?)   // "v4"／"v5" → { lucky }，"v1"／"jia" → "legacy"
isV4Family(scoreRule)           // "v4"、"v5" → true（牌型、彩金牌、加分表、全壘打分一樣）
gunnerOf(a, b, aWins, bWins, scoreRule)  // 這一組誰打槍（v5 新規則；其他三道全贏）
sortCards(cards)                // 顯示順序 A、2…K
```

**前端要注意（老馬）**：
- 理牌畫面的推薦排法、倒水檢查、牌型標籤、加分標籤，現在都是用沒帶規則的呼叫（＝v4、沒有彩金牌），**要改成帶 `handRuleOf(state.scoreRule, state.luckyCard?.rank ?? null)`**。不帶的話，手上有彩金牌型時標籤和倒水會跟伺服器不一樣（伺服器照彩金判斷）；舊房也可能推薦出伺服器判倒水的排法。
- 牌型名稱、配音、特效的對照表要加 cat 12～15；頭墩 cat 13 顯示「彩金衝三」。
- 手牌（`me.hand`、`th_deal_hand`）和亮牌的每墩、`unusedCards` 伺服器都已經照 A、2…K 排好。

### 沒用到的牌 `unusedCards`

亮牌內容（牌局狀態的 `reveal`、`th_reveal` 廣播、觀戰畫面的 `reveal`、410 的 `record.finalHand`、對局紀錄的最後一局）有：

```ts
unusedCards: Card[][]   // 依座位 0～3，每家 3 張＝這局發到的 16 張扣掉排出去的 13 張，照 A、2…K 排
```

- **只在亮牌後才有**。理牌中任何 API（自己、別家、觀戰、不在桌上的畫面）都拿不到別家的牌，也沒有 `unusedCards`。
- 這次上線前存的舊局紀錄沒有這個欄位，前端要當作沒有。

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
| `revealDurationMs(result)` | 從開始比牌到結算面板出現要多久（毫秒）。老闆 2026-11-18 定案（照參考影片節奏）：開始比牌 1.7 秒＋三墩各 6.0 秒（四家各出 1.5 秒，墩後不停）＋每個大牌（衝三、中尾墩鐵支／同花順／五龍）多佔 0.3 秒＋每一槍 1.5 秒＋全壘打 3.2 秒＋結算面板前停 1.2 秒，即 20.9＋0.3×大牌＋1.5×槍＋3.2×全壘打。一般局 20.9 秒、一槍 22.4 秒、衝三＋尾墩鐵支 21.5 秒、衝三＋尾墩鐵支＋三槍＋全壘打 29.2 秒；亮牌到自動開下一局最長 66.7 秒（`NEXT_HAND_MAX_MS`）。各段長度在 `REVEAL_TIMING`（`START_MS`、`PLAY_MS`、`ROW_WAIT_MS`、`ROW_MS`、`SPECIAL_MS`、`GUN_MS`、`HOME_RUN_MS`、`SETTLE_PAUSE_MS`） |
| `SETTLE_WAIT_MS` | 結算面板出現後等多久自動開下一局：30 秒 |
| `handStats(result)` | 這局每家的明細：墩分、特殊加分（衝三、中墩鐵支…）、打槍、被打槍、全壘打、被全壘打；各項加起來等於這局總分 |
| `matchStats(state)` | 整場累計：每家打槍、被打槍、全壘打、被全壘打的次數和總分 |

亮牌時伺服器記下三個時間：`revealedAt`（亮牌動畫起點＝決定亮牌那一刻＋`REVEAL_TIMING.LEAD_MS` 1.2 秒，2026-11-19 起；讓瀏覽器收到亮牌時「開始比牌」還沒開始）、`settleAt`（＝revealedAt＋演出長度）、`nextHandAt`（＝settleAt＋30 秒）。前端收到時 `revealedAt` 通常還在未來，動畫要等到這個時間才開始（見給老馬的說明）。
四家都按確認（next-game）就馬上開下一局；有人沒按，就等到 nextHandAt 自動開。
前端 API 說明見「給老馬-十三支結算與下一局API說明.md」。
