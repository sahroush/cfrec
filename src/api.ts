// Browser-side user.status fetch with localStorage cache (10 min per handle).
// Plan section 7 "User solved set".

const CACHE_TTL_MS = 10 * 60 * 1000;
const BASE = "https://codeforces.com/api";

export class UserFetchError extends Error {
  constructor(message: string, public readonly kind: "not-found" | "rate-limit" | "network" | "api") {
    super(message);
  }
}

const cache = new Map<string, { at: number; keys: string[] }>();

function cacheRead(handle: string): Set<string> | null {
  const hit = cache.get(handle.toLowerCase()) ?? readLS(handle);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return new Set(hit.keys);
}

function readLS(handle: string): { at: number; keys: string[] } | null {
  try {
    const raw = localStorage.getItem(`cfrec:solved:${handle.toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheWrite(handle: string, keys: string[]) {
  const entry = { at: Date.now(), keys };
  cache.set(handle.toLowerCase(), entry);
  try {
    localStorage.setItem(`cfrec:solved:${handle.toLowerCase()}`, JSON.stringify(entry));
  } catch {
    // private mode / quota: memory cache still works
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchUserSolved(handle: string): Promise<Set<string>> {
  const cached = cacheRead(handle);
  if (cached) return cached;

  const url = `${BASE}/user.status?handle=${encodeURIComponent(handle)}&lang=en`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new UserFetchError(`Network error reaching Codeforces: ${(e as Error).message}`, "network");
  }
  if (res.status === 400) {
    // CF returns 400 for unknown handle
    throw new UserFetchError(`Handle "${handle}" not found`, "not-found");
  }
  if (!res.ok) throw new UserFetchError(`Codeforces API HTTP ${res.status}`, "api");

  let body: { status: string; comment?: string; result?: { verdict?: string; problem: { contestId?: number; index: string } }[] };
  try {
    body = await res.json();
  } catch {
    throw new UserFetchError("Invalid response from Codeforces", "api");
  }

  if (body.status !== "OK") {
    if (body.comment === "Call limit exceeded") {
      await sleep(3000);
      return fetchUserSolved(handle); // retry once after 3s
    }
    if (body.comment?.includes("not found")) {
      throw new UserFetchError(`Handle "${handle}" not found`, "not-found");
    }
    throw new UserFetchError(body.comment ?? "Codeforces API error", "api");
  }

  const keys = new Set<string>();
  for (const sub of body.result ?? []) {
    if (sub.verdict !== "OK" || sub.problem.contestId === undefined) continue;
    keys.add(`${sub.problem.contestId}${sub.problem.index}`);
  }
  cacheWrite(handle, [...keys]);
  return keys;
}
