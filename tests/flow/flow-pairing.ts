// iPhone 主畫面 App 的 LINE 登入交接（一次性配對代碼＋背景輪詢）：
//   H 正常交接：主畫面發起 → 輪詢 pending → Safari 認領 → 主畫面領回登入，用領回的身分建房、加入
//   S 安全：只有發起的 App（有密鑰）領得走、過期、重複使用、別的裝置拿代碼、Safari 的憑證不是同一個人、猜錯次數限制
//   L 不記 log、資料庫只存雜湊和加密後的憑證
import { POST as pairStart } from "../../app/api/auth/pairing/start/route";
import { POST as pairClaim } from "../../app/api/auth/pairing/claim/route";
import { POST as pairPoll } from "../../app/api/auth/pairing/poll/route";
import { POST as create } from "../../app/api/mahjong/create/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { opts } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import * as ps from "../support/stub-pairing-store";
import * as gs from "../support/stub-guest-store";
import { MAX_POLL_FAILURES, FAIL_LIMIT, START_LIMIT } from "../../lib/pairing/pairing";

opts.autoBind = false; // 座位一律照真的綁帳號
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
// 這個檔案跑的所有程式不能把代碼、密鑰、登入憑證寫進 log
const logged: string[] = [];
for (const m of ["log", "info", "warn", "error", "debug"] as const) {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); if (m !== "log") orig(...args); };
}

async function req(fn: (r: Request) => Promise<Response>, body: object, tok?: string, ip = "1.1.1.1") {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (tok) h.authorization = `Bearer ${tok}`;
  const r = await fn(new Request("http://x", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control"), retry: r.headers.get("retry-after") };
}
const LINE = { id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "阿瑋", pictureUrl: null, isGuest: false };
const OTHER = { id: "bbbbbbbb-0000-4000-8000-000000000002", displayName: "別人", pictureUrl: null, isGuest: false };
/** Safari 完成 LINE 登入：拿到一組 access token＋refresh token */
let sn = 0;
function safariLogin(user = LINE) {
  const i = ++sn;
  tokens[`safari-tok-${i}`] = user;
  ps.refreshTokens.set(`safari-rt-${i}`, user);
  return { access: `safari-tok-${i}`, refresh: `safari-rt-${i}` };
}
const start = (ip?: string) => req(pairStart, {}, undefined, ip);
const poll = (code: unknown, secret: unknown, ip?: string) => req(pairPoll, { code, secret }, undefined, ip);
const claim = (code: unknown, refreshToken: unknown, tok?: string, ip?: string) => req(pairClaim, { code, refreshToken }, tok, ip);
const allSecrets: string[] = [];

// ===================== H 正常交接 =====================
let paired = { access: "", refresh: "" };
{
  ps.reset(); gs.reset();
  const t0 = Date.now();
  const s = await start();
  allSecrets.push(s.body.code, s.body.secret);
  const ttl = Date.parse(s.body.expiresAt) - t0;
  eq([s.status, /^[A-Za-z0-9_-]{43}$/.test(s.body.code), /^[A-Za-z0-9_-]{43}$/.test(s.body.secret), s.body.code !== s.body.secret, ttl > 175_000 && ttl <= 181_000, s.cache],
    [200, true, true, true, true, "no-store"], "H1 主畫面 App 發起：拿到代碼和領取密鑰（各 32 bytes 亂數），3 分鐘後過期，回應不快取");
  const p1 = await poll(s.body.code, s.body.secret);
  eq([p1.status, p1.body.status], [200, "pending"], "H2 Safari 還沒登入完：輪詢回 pending");
  const safari = safariLogin();
  allSecrets.push(safari.access, safari.refresh);
  const c = await claim(s.body.code, safari.refresh, safari.access);
  eq([c.status, c.body], [200, { success: true, displayName: "阿瑋" }], "H3 Safari 完成 LINE 登入後認領：成功");
  const p2 = await poll(s.body.code, s.body.secret);
  paired = { access: p2.body.accessToken, refresh: p2.body.refreshToken };
  allSecrets.push(paired.access, paired.refresh);
  eq([p2.status, p2.body.status, tokens[paired.access]?.id, paired.access !== safari.access, paired.refresh !== safari.refresh, ps.refreshTokens.has(safari.refresh), ps.rows.size],
    [200, "ready", LINE.id, true, true, false, 0],
    "H4 主畫面 App 輪詢：領回同一個人的登入（伺服器換過一組新的，Safari 那組 refresh token 已失效），配對資料整筆刪除");
  const room = await req(create, { hostId: "pair-p0", totalRounds: 1, basePoints: 100, fanPoints: 20 }, paired.access);
  const j = await req(join, { code: room.body.code, name: "阿瑋", playerId: "pair-p0" }, paired.access);
  eq([room.status, j.status, j.body.seat], [200, 200, 0], "H5 用領回的登入身分建房、加入：都成功");
}

// ===================== S 安全 =====================
{
  ps.reset(); gs.reset();
  const s = await start();
  const safari = safariLogin();
  await claim(s.body.code, safari.refresh, safari.access);
  const thief = await poll(s.body.code, "x".repeat(43), "9.9.9.9");
  const noSecret = await poll(s.body.code, undefined, "9.9.9.9");
  eq([thief.status, thief.body.error, noSecret.status, [...ps.rows.values()][0]?.status], [404, "invalid_or_expired", 404, "ready"],
    "S1 別的裝置看到網址上的代碼、但沒有密鑰：領不到（404），登入還在等原本的 App 領");
  const ok = await poll(s.body.code, s.body.secret);
  const again = await poll(s.body.code, s.body.secret);
  eq([ok.body.status, again.status, again.body.error], ["ready", 404, "invalid_or_expired"], "S2 原本的 App 領走後，同一組代碼和密鑰再領一次：404（只能用一次）");
  const reclaim = await claim(s.body.code, safariLogin().refresh, safari.access);
  eq([reclaim.status, reclaim.body.error], [404, "invalid_or_expired"], "S3 用過的代碼再認領：404");
}
{
  ps.reset(); gs.reset();
  const s = await start();
  const a = safariLogin(), b = safariLogin();
  const first = await claim(s.body.code, a.refresh, a.access);
  const second = await claim(s.body.code, b.refresh, b.access, "8.8.8.8");
  eq([first.status, second.status, second.body.error], [200, 404, "invalid_or_expired"], "S4 同一個代碼被認領兩次：第一次成功，第二次 404（不能事後換成別的帳號）");
}
{
  ps.reset(); gs.reset();
  const s = await start();
  const row = [...ps.rows.values()][0];
  row.expiresAt = new Date(Date.now() - 1000).toISOString(); // 過了 3 分鐘
  const safari = safariLogin();
  const c = await claim(s.body.code, safari.refresh, safari.access);
  const p = await poll(s.body.code, s.body.secret);
  eq([c.status, p.status, p.body.error, ps.rows.size, ps.refreshTokens.has(safari.refresh)], [404, 404, "invalid_or_expired", 0, true],
    "S5 過期的代碼：認領、輪詢都 404，過期資料被刪掉（Safari 的登入沒被動到）");
  const s2 = await start();
  const s3 = await start();
  await claim(s2.body.code, safariLogin().refresh, `safari-tok-${sn}`);
  [...ps.rows.values()].forEach((r) => (r.expiresAt = new Date(Date.now() - 1000).toISOString()));
  await start();
  eq([ps.rows.size, [...ps.rows.values()].every((r) => r.status === "pending")], [1, true], "S6 已認領但沒被領走、已過期的配對（含加密的登入憑證）：下一次有人發起時清掉");
  void s3;
}
{
  ps.reset(); gs.reset();
  const s = await start();
  const safari = safariLogin();
  const noLogin = await claim(s.body.code, safari.refresh);
  tokens["guest-x"] = { id: "cccccccc-0000-4000-8000-000000000003", displayName: "遊客", pictureUrl: null, isGuest: true };
  const guest = await claim(s.body.code, safari.refresh, "guest-x");
  const someoneElse = safariLogin(OTHER);
  const mismatch = await claim(s.body.code, someoneElse.refresh, safari.access);   // access token 是阿瑋、refresh token 是別人
  const junk = await claim(s.body.code, "not-a-real-refresh-token", safari.access);
  eq([noLogin.status, guest.status, guest.body.error, mismatch.status, mismatch.body.error, junk.status, [...ps.rows.values()][0].status],
    [401, 403, "guest_not_allowed", 400, "invalid_session", 400, "pending"],
    "S7 認領要登入（401）、遊客不行（403）、refresh token 不是同一個人或無效（400）；配對還是等待中");
}
{
  ps.reset(); gs.reset();
  const s = await start();
  for (let i = 0; i < MAX_POLL_FAILURES; i++) await poll(s.body.code, `${"y".repeat(42)}${i}`, `7.7.7.${i}`);
  const right = await poll(s.body.code, s.body.secret);
  eq([ps.rows.size, right.status], [0, 404], `S8 同一個代碼的密鑰錯 ${MAX_POLL_FAILURES} 次（換不同 IP 也一樣）：整筆作廢，原本的 App 也要重新發起`);
}
{
  ps.reset(); gs.reset();
  const s = await start();
  const fails = [];
  for (let i = 0; i < FAIL_LIMIT.max; i++) fails.push((await poll(`${"z".repeat(42)}${i % 10}`, s.body.secret, "6.6.6.6")).status);
  const lockedRight = await poll(s.body.code, s.body.secret, "6.6.6.6");
  const otherIp = await poll(s.body.code, s.body.secret, "5.5.5.5");
  eq([fails.slice(0, -1).every((x) => x === 404), fails.at(-1), lockedRight.status, lockedRight.body.error, Number(lockedRight.retry) > 0, otherIp.status],
    [true, 429, 429, "too_many_attempts", true, 200], `S9 同一個 IP 亂猜代碼 ${FAIL_LIMIT.max} 次就鎖 10 分鐘（鎖住時對的也不收、有 Retry-After）；別的 IP 不受影響`);
  const starts = [];
  for (let i = 0; i <= START_LIMIT.max; i++) starts.push((await start("4.4.4.4")).status);
  eq([starts.slice(0, START_LIMIT.max).every((x) => x === 200), starts.at(-1)], [true, 429], `S10 同一個 IP 10 分鐘內最多發起 ${START_LIMIT.max} 次，不能拿來灌資料庫`);
}

// ===================== L 不記 log、只存雜湊和加密資料 =====================
{
  ps.reset(); gs.reset();
  const s = await start();
  const safari = safariLogin();
  await claim(s.body.code, safari.refresh, safari.access);
  allSecrets.push(s.body.code, s.body.secret, safari.access, safari.refresh);
  const stored = JSON.stringify([...ps.rows.entries()]);
  const plain = ["paired-tok-", "paired-refresh-", s.body.code, s.body.secret].filter((x) => stored.includes(x));
  eq(plain, [], "L1 資料庫裡沒有代碼、密鑰本身（只存雜湊），登入憑證是加密後才存");
  await poll(s.body.code, s.body.secret);
  const leaked = allSecrets.filter((x) => x && logged.some((l) => l.includes(x)));
  eq(leaked, [], "L2 整個測試過程中，代碼、密鑰、access／refresh token 都沒有出現在任何 log");
}

process.stdout.write(results.join("\n") + "\n"); // console.log 被上面攔下來檢查了，結果直接寫到 stdout
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
