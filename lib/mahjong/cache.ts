/**
 * Redis-backed game state cache + distributed room lock.
 *
 * Rationale: every discard/action/draw API handler reads + writes the full
 * game_state JSON blob to Supabase Postgres. On hot rooms this chains a lot
 * of latency and introduces races (e.g. two players passing concurrently
 * both see passedActors without the other's update).
 *
 * This module adds an optional Upstash Redis layer that:
 *   1. Caches the current game_state for fast read/write (µs vs ms)
 *   2. Provides a per-room lock so each action handler runs serially for
 *      that room — eliminating the chi-button race, auto-draw race, and
 *      double-pass race.
 *
 * Fallback: if Redis env vars are missing (local dev, no Upstash setup),
 * the cache is bypassed and all calls go straight to Postgres exactly as
 * before. The lock becomes a no-op. So adding this is backwards-compatible
 * and zero-config for dev.
 *
 * Env vars (set in Vercel / .env.local):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from "@upstash/redis";
import type { MahjongGameState } from "./gameState";

// --- Redis client (lazy, memoized) -----------------------------------------

let _client: Redis | null | undefined;

function getRedis(): Redis | null {
  if (_client !== undefined) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    _client = null;
    return null;
  }
  _client = new Redis({ url, token });
  return _client;
}

const STATE_TTL_SECONDS = 3600; // 1h — rooms older than this need DB fallback
const LOCK_TTL_MS = 5000;       // individual action handler should finish well under this

// --- Game state cache ------------------------------------------------------

function stateKey(roomId: string): string {
  return `mj:state:${roomId}`;
}

/**
 * Cache a game state for fast subsequent reads. Called after every successful
 * saveGameState() so Redis stays in sync with Postgres.
 */
export async function cacheGameState(
  roomId: string,
  state: MahjongGameState
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(stateKey(roomId), state, { ex: STATE_TTL_SECONDS });
  } catch (err) {
    // Non-fatal: if cache write fails, Postgres is still authoritative.
    console.error("[mj-cache] cacheGameState failed:", err);
  }
}

/**
 * Fetch game state from cache. Returns null on miss — caller should then
 * fall back to loadRoom() against Postgres and repopulate via cacheGameState.
 */
export async function getCachedGameState(
  roomId: string
): Promise<MahjongGameState | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const data = await redis.get<MahjongGameState>(stateKey(roomId));
    return data ?? null;
  } catch (err) {
    console.error("[mj-cache] getCachedGameState failed:", err);
    return null;
  }
}

/**
 * Invalidate cache for a specific room — used when structural state changes
 * outside the normal save path (e.g., room deletion).
 */
export async function invalidateGameState(roomId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(stateKey(roomId));
  } catch (err) {
    console.error("[mj-cache] invalidate failed:", err);
  }
}

// --- Per-room distributed lock --------------------------------------------

function lockKey(roomId: string): string {
  return `mj:lock:${roomId}`;
}

function randomToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Run a function while holding an exclusive per-room lock. Serializes all
 * mutations for a given room so actions don't interleave (which caused the
 * passedActors race, chi button flash, auto-draw after kong, etc.).
 *
 * Fallback: if Redis is not configured, runs fn directly (no-op lock).
 *
 * Acquisition: 5s lock TTL; up to ~500ms waiting for contended lock
 * (10 × 50ms poll) before giving up and throwing.
 */
export async function withRoomLock<T>(
  roomId: string,
  fn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fn();

  const key = lockKey(roomId);
  const token = randomToken();
  const maxTries = 10;
  for (let i = 0; i < maxTries; i++) {
    try {
      const acquired = await redis.set(key, token, {
        nx: true,
        px: LOCK_TTL_MS,
      });
      if (acquired === "OK") {
        try {
          return await fn();
        } finally {
          // Only release if the token still matches (don't release someone
          // else's lock if ours expired). Lua-style via pipeline.
          try {
            const current = await redis.get<string>(key);
            if (current === token) {
              await redis.del(key);
            }
          } catch {
            // best-effort
          }
        }
      }
    } catch (err) {
      console.error("[mj-lock] acquire error:", err);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`無法取得房間鎖 (roomId=${roomId})，請稍後再試`);
}
