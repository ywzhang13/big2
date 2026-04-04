/**
 * Generate a random 4-digit room code (0000-9999).
 */
export function generateCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

/**
 * Generate a UUID-like random session token.
 */
export function generateSessionToken(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4 pattern
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
