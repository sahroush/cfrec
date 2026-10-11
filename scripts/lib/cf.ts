// Public Codeforces API client. One global limiter: >=2500ms between requests.
// Plan section 6 step 1. No API key, everything anonymous.

export class CfError extends Error {
  constructor(message: string, public readonly retriable: boolean) {
    super(message);
  }
}

const MIN_GAP_MS = 2500;
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawRequest(url: string): Promise<unknown> {
  // Serialize all requests through one chain, each waiting out the global gap.
  const run = chain.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const res = await fetch(url);
    lastRequestAt = Date.now();
    if (!res.ok && res.status >= 500) throw new CfError(`HTTP ${res.status}`, true);
    if (!res.ok) throw new CfError(`HTTP ${res.status}`, false);
    return res.json();
  });
  chain = run.catch(() => {}); // keep the chain alive on failures
  return run;
}

// Serializes limiter retries so a retry cannot leapfrog other queued calls.
let retryChain: Promise<unknown> = Promise.resolve();

function call<T>(method: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  qs.set("lang", "en");
  const url = `https://codeforces.com/api/${method}?${qs}`;
  return retryChain.then(async () => {
    let err: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const body = await rawRequest(url) as { status: string; comment?: string; result?: T };
        if (body.status === "OK") return body.result as T;
        if (body.comment === "Call limit exceeded") {
          await sleep(5000);
          err = new CfError(body.comment, true);
          continue;
        }
        throw new CfError(body.comment ?? "unknown CF error", false);
      } catch (e) {
        if (e instanceof CfError && !e.retriable) throw e;
        err = e;
        if (attempt < 4) await sleep(2000 * 2 ** attempt); // network/5xx backoff
      }
    }
    throw err instanceof Error ? err : new CfError(String(err), true);
  }) as Promise<T>;
}

export const cf = {
  problemsetProblems: () =>
    call<{ problems: CfProblem[]; problemStatistics: { contestId: number; index: string; solvedCount: number }[] }>(
      "problemset.problems",
      {},
    ),
  userInfo: (handles: string[]) =>
    call<{ handle: string }[]>("user.info", { handles: handles.join(";"), checkHistoricHandles: "true" }),
  userStatus: (handle: string, from?: number, count?: number) =>
    call<Submission[]>("user.status", { handle, from, count }),
};

export interface CfProblem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type: string;
  rating?: number;
  tags: string[];
}

export interface Submission {
  id: number;
  problem: CfProblem;
  verdict?: string;
}

export function problemKey(p: { contestId?: number; index: string }): string | null {
  if (p.contestId === undefined) return null;
  return `${p.contestId}${p.index}`;
}
