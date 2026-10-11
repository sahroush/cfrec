# Plan: Medalist Problem Recommender for Codeforces

## 1. Goal

Build a tool where a user enters a Codeforces handle and gets a ranked list of Codeforces problems that the user has **not solved yet**, ordered by **how many Iran OI gold medalists solved them**. The user can filter by:

- rating interval (min and max)
- tags (a group of tags, with ANY / ALL matching, plus optional excluded tags)

The set of medalists is a fixed list of Codeforces handles (see section 3, step 0).

---

## 2. Feasibility findings (already verified against the official API docs)

Verdict: **feasible, using only the public Codeforces API, no API key needed.**

| Need | API method | Notes |
|---|---|---|
| All problems with rating and tags | `problemset.problems` | One call. Returns `problems[]` (with `contestId`, `index`, `name`, `rating` (can be absent), `tags`) and `problemStatistics[]` (with `solvedCount`). |
| A user's submissions | `user.status?handle=H` | Optional `from` and `count`. Sorted by submission id descending. Each submission has `verdict` and `problem`. |
| Check / canonicalize handles | `user.info?handles=a;b;c` | Semicolon-separated, up to 10000 handles. `checkHistoricHandles` defaults to true, so renamed handles resolve. |

Constraints:

- **Rate limit: at most 1 request per 2 seconds.** Exceeding it returns `status: "FAILED"` with comment `Call limit exceeded`.
- All methods work anonymously. Responses are `{ status, comment?, result? }`.
- JSONP is supported (`jsonp=callbackName` query param).

**The one gap:** the API has **no method to read the members of a user list** (`codeforces.com/list/<hash>`). `user.friends` only returns the authenticated user's own friends. The list page also disallows automated access (robots), so **do not build a scraper for it**. The handles must be exported once, manually, by the user (step 0), and committed as a static file.

---

## 3. Decisions (already made, do not revisit)

- **Language:** TypeScript everywhere. Node 20+ for the crawler, Vite + TypeScript for the frontend (plain DOM or a small framework, agent's choice, keep dependencies minimal).
- **Architecture:** offline crawl produces static JSON; the frontend is a static site. No database.
- **Solved definition:** a problem counts as solved by a user if they have at least one submission with `verdict === "OK"` on it. Count **distinct medalists**, not submissions.
- **Problem identity:** key = `${contestId}${index}` (e.g. `1850A`). Only problems that appear in `problemset.problems` are considered. This drops gym and other non-problemset submissions automatically.
- **Primary ranking:** number of distinct medalists who solved the problem, descending. Tie-break: rating ascending (unrated last), then `contestId` descending.
- **User's own submissions:** fetched at query time in the browser (1 call per search), so the 1 request / 2 s limit is per visitor IP and no backend is needed. See the spike in M0.5.

---

## 4. Repo layout

```
/
  data/
    medalists.input.json      # manual export, see step 0 (committed)
    medalists.json            # canonicalized handles, produced by crawler
    solved/<handle>.json      # per-medalist solved keys (committed, resume cache)
  scripts/
    crawl.ts                  # fetches problemset + medalist submissions
    aggregate.ts              # builds public/data/*.json
    lib/cf.ts                 # API client with global rate limiter + retry
  src/                        # frontend
    api.ts                    # browser-side user.status fetch (fetch or JSONP)
    query.ts                  # pure filter/sort/paginate logic (unit tested)
    ui.ts / main.ts
  public/data/
    problems.json             # aggregated, consumed by the frontend
    meta.json
  test/
    query.test.ts
    aggregate.test.ts
    fixtures/
  README.md
```

---

## 5. Data model

### `data/medalists.input.json` (manual)

```json
{ "source": "https://codeforces.com/list/c17b31a0a22063a63b1d9c6eec779553",
  "exportedAt": "YYYY-MM-DD",
  "handles": ["handleA", "handleB"] }
```

### `data/solved/<handle>.json`

```json
{ "handle": "handleA", "fetchedAt": 1760000000, "solved": ["1850A", "1850B"] }
```

### `public/data/problems.json`

Only include problems solved by at least one medalist.

```ts
type ProblemRow = {
  id: string;            // "1850A"
  contestId: number;
  index: string;         // "A"
  name: string;
  rating: number | null; // null if unrated
  tags: string[];
  medalistCount: number; // distinct medalists who solved it
  globalSolvedCount: number; // from problemStatistics
  solvers?: number[];    // optional: indexes into meta.handles, for the "who solved it" tooltip
};
```

### `public/data/meta.json`

```json
{ "generatedAt": 1760000000, "medalistCount": 0, "handles": [], "allTags": [], "minRating": 800, "maxRating": 3500 }
```

`medalistCount` here is the number of medalists whose submissions were successfully crawled (denominator for "37 / 120").

---

## 6. Pipeline

### Step 0: manual handle export (user does this, agent only documents it in README)

1. Open the list page in a normal browser.
2. Run this in DevTools console (untested, adjust if the markup differs; if logged in, remove the user's own handle from the header):
   ```js
   copy(JSON.stringify([...new Set([...document.querySelectorAll('a[href^="/profile/"]')]
     .map(a => a.textContent.trim()).filter(Boolean))], null, 2))
   ```
3. Compare the count with the number of users shown on the list page, then paste the result into `data/medalists.input.json`.

### Step 1: API client (`scripts/lib/cf.ts`)

- One global queue; enforce **at least 2500 ms** between any two requests (the limit is 2000 ms, keep margin).
- On `status: "FAILED"` with `Call limit exceeded`: wait 5 s, retry, up to 5 attempts, then throw.
- On network errors or HTTP 5xx: exponential backoff, up to 5 attempts.
- On other `FAILED` comments (e.g. handle not found): throw a typed error, do not retry.
- Always send `lang=en` where relevant.

### Step 2: canonicalize handles

- Call `user.info` with all handles joined by `;` (chunk to 500 per call to be safe).
- Note: if any handle in a batch does not exist, the whole call may fail. On failure, bisect the batch (or retry one by one) to find the bad handles. Write them to `data/medalists.problems.txt` and continue without them.
- Save canonical handles to `data/medalists.json`.

### Step 3: crawl submissions (`scripts/crawl.ts`)

1. Call `problemset.problems` once. Build `validKeys` (a Set of `contestId+index`) and a metadata map.
2. For each medalist handle, call `user.status?handle=H` (omit `from` and `count` to get everything). If a response times out or is too large for a heavy account, fall back to paging with `from` and `count=10000`.
3. Keep only submissions with `verdict === "OK"`, derive the key from `problem.contestId + problem.index`, keep only keys in `validKeys`, dedupe.
4. Write `data/solved/<handle>.json` after each handle (**resumable**: skip handles whose file is newer than `--max-age` hours, default 24, unless `--force`).
5. Print progress and an ETA. Expected runtime is about `N * 2.5 s` for N medalists.

### Step 4: aggregate (`scripts/aggregate.ts`)

1. Read all `data/solved/*.json`.
2. For each key, count distinct handles.
3. Join with problem metadata and `solvedCount`.
4. Write `public/data/problems.json` (sorted by `medalistCount` desc) and `public/data/meta.json` (`allTags` = sorted union of all tags).
5. Print sanity stats: number of problems, top 10, and the distribution of `medalistCount`.

---

## 7. Query engine (`src/query.ts`, pure functions, no DOM)

```ts
type Query = {
  solvedKeys: Set<string>;     // from the user's submissions
  hideSolved: boolean;         // default true
  minRating: number;           // default 0
  maxRating: number;           // default 4000
  includeUnrated: boolean;     // default false
  tags: string[];              // included tags
  tagMode: "any" | "all";      // default "any"
  excludeTags: string[];
  minMedalists: number;        // default 1
  page: number; pageSize: number; // default 50
};
function runQuery(rows: ProblemRow[], q: Query): { total: number; rows: ProblemRow[] }
```

Rules:

- Rating filter applies to rated problems only; unrated problems pass only if `includeUnrated`.
- Empty `tags` means no tag restriction.
- `any`: row has at least one of `tags`. `all`: row has every one of `tags`.
- `excludeTags`: drop rows containing any of them.
- Sort as in section 3.
- Tag matching is exact string match (Codeforces tags are lowercase; some start with `*`, e.g. `*special`).

### User solved set (`src/api.ts`)

- Call `https://codeforces.com/api/user.status?handle=H`, build `solvedKeys` from `verdict === "OK"` submissions with a `contestId`.
- Cache in `localStorage` for 10 minutes per handle.
- Handle errors with clear messages: user not found, rate limit (retry once after 3 s), network failure.

---

## 8. Frontend spec

- Inputs: handle, rating min/max (number inputs, defaults 800 and 3500), tag multi-select with search, an ANY/ALL toggle, an "exclude tags" multi-select, "hide solved" checkbox (default on), "include unrated" checkbox.
- Summary line after search: `You have solved X of the Y problems the medalists solved`.
- Results table columns: problem name (links to `https://codeforces.com/problemset/problem/{contestId}/{index}`), rating, tags, `medalistCount / medalistCount_total`, global solved count. Optional tooltip listing solver handles.
- Pagination (50 per page).
- All state is mirrored in URL query params (`?handle=&min=&max=&tags=a,b&mode=any&ex=c`) so searches are shareable.
- Footer: "Data generated on {generatedAt}, based on {medalistCount} medalists", plus a link to the source list.
- Works on mobile widths. Light and dark themes via `prefers-color-scheme`.

---

## 9. Milestones and acceptance criteria

**M0: spike (do this first, small).**
- M0.1: confirm the API behaves as documented with one `problemset.problems` call and one `user.status` call.
- M0.5: from a page served on a different origin (e.g. `localhost:5173`), test whether `fetch` to `https://codeforces.com/api/user.status?handle=tourist&from=1&count=5` works (CORS). If blocked, test JSONP via a `<script>` tag with `jsonp=cb`. If both fail, fall back to a tiny serverless proxy (e.g. a Cloudflare Worker) with a 10 minute cache. Record the result in the README and implement `src/api.ts` accordingly.

**M1: client + crawler.** Acceptance: running `npm run crawl` on a 3-handle fixture list produces 3 `data/solved/*.json` files, respects the rate limit (assert no two requests closer than 2000 ms in a test with a mocked clock), and resumes without refetching.

**M2: aggregator.** Acceptance: unit test with a fixture of 3 medalists and 5 problems yields the expected `medalistCount` values, including a problem solved twice by the same medalist (counts once) and a gym submission (ignored).

**M3: query engine.** Acceptance: unit tests cover rating bounds (inclusive), unrated handling, tag ANY vs ALL, excluded tags, hide-solved, tie-breaking, pagination.

**M4: frontend.** Acceptance: entering a real handle returns results in under 5 seconds on a normal connection; URL params round-trip; invalid handle shows a friendly error.

**M5: deploy and refresh.** Static hosting (GitHub Pages or Cloudflare Pages). Add a scheduled GitHub Action (weekly) that runs crawl + aggregate and commits the data. Note: Codeforces may throttle or block datacenter IPs, so verify the Action actually completes; if it does not, document the local `npm run refresh` workflow instead.

---

## 10. Edge cases

- **Div1 / Div2 duplicates:** the same problem often appears under two contest ids. Default behavior treats them as separate problems. Known side effect: a user who solved the Div2 copy may still see the Div1 copy. Stretch goal: link duplicates only within paired contests (same round, Div1 and Div2) by identical problem name, then treat either as solved for the user and merge medalist counts.
- **Unrated problems:** `rating` is absent for some problems; handled via `includeUnrated`.
- **Renamed handles:** `user.info` with historic handles resolves them at crawl time; at query time, if the user's handle was renamed, the API still resolves it, so no special handling.
- **Medalist with zero submissions or private/deleted account:** skip with a warning, exclude from `medalistCount`.
- **Problems with `type === "QUESTION"`:** exclude.
- **Very large submission histories:** page with `from`/`count` if needed.

---

## 11. Stretch goals (only after M5)

- "Most distinctive" ranking: `medalistCount / medalistTotal` divided by `globalSolvedCount / totalActiveUsers`, to surface problems medalists love that the general population skips.
- Filter by contest year or contest type.
- Per-tag breakdown of the user's solved vs medalists' solved.
- Export results as CSV, or as a Codeforces-compatible problem list.

---

## 12. Rules for the agent

- Use only the public JSON API. Do not scrape any `codeforces.com` HTML page, including the list page.
- Never exceed 1 request per 2 seconds against the API from any script you write. Use the shared limiter in `lib/cf.ts`.
- Do not add an API key flow; everything needed is public.
- Keep runtime dependencies small; prefer the platform `fetch`.
- Write tests for `query.ts` and `aggregate.ts` before the UI.
- Keep the README current: how to export handles, how to run crawl/aggregate/dev/build, and the result of the M0.5 CORS spike.
- When something in this plan conflicts with observed API behavior, trust the observed behavior, note it in the README, and continue.
