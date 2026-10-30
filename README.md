# CFrec — Medalist Problem Recommender

Enter a Codeforces handle, get problems ranked by how many Iran OI gold medalists solved them.

Stack: TypeScript, Node 20+, Vite, plain DOM. Static JSON pipeline, no backend, no DB.
Uses only the public Codeforces API (no key). Rate limit: 1 req / 2 s — the crawler
client enforces >= 2.5 s between requests.

## Repo layout

- `data/medalists.input.json` — manual handle export (see below), committed
- `data/medalists.json` — canonicalized handles (crawler output)
- `data/solved/<handle>.json` — per-medalist solved problem keys (resume cache)
- `scripts/crawl.ts` — fetch problemset + all medalist submissions
- `scripts/aggregate.ts` — build `public/data/*.json`
- `scripts/lib/cf.ts` — API client: global rate limiter, retry/backoff
- `src/query.ts` — pure filter/sort/paginate (unit tested)
- `src/api.ts` — browser-side `user.status` fetch + 10-min localStorage cache
- `src/main.ts`, `src/style.css`, `index.html` — UI

## One-time: export the medalist handles

The Codeforces API cannot read list members, and the list page forbids bots.
Export manually:

1. Open the list page (`https://codeforces.com/list/...`) in a normal browser.
2. In DevTools console:
   ```js
   copy(JSON.stringify([...new Set([...document.querySelectorAll('a[href^="/profile/"]')].map(a => a.textContent.trim()).filter(Boolean))]))
   ```
3. Count-check against the list page, then save into `data/medalists.input.json`:
   ```json
   { "source": "https://codeforces.com/list/...", "exportedAt": "2026-10-11", "handles": ["...", "..."] }
   ```

## Run

```sh
npm install
npm run crawl      # ~N * 2.5 s for N medalists; resumable (24 h cache, --force to refetch, --max-age H)
npm run aggregate  # builds public/data/problems.json + meta.json
npm run dev        # vite dev server
npm run build      # production build to dist/
npm test           # unit tests (query, aggregate, rate limiter)
npm run refresh    # crawl + aggregate
```

## Data

`data/medalists.input.json` holds the full 58-handle Iran OI gold medalist
export (committed). `data/medalists.json` and `data/solved/<handle>.json` are
the crawler's canonicalized handle list and per-handle 24 h resume cache;
`public/data/{problems,meta}.json` is the aggregated site data the build copies
into `dist/`.

## Deployment

Static output in `dist/` — deploy to any static host (e.g. Cloudflare Pages:
`npx wrangler pages deploy dist`). A weekly refresh re-runs `npm run refresh`
and redeploys.

## License

MIT — see [LICENSE](LICENSE).

## CORS spike result (M0.5)

Verified live: `https://codeforces.com/api/user.status` sends
`Access-Control-Allow-Origin: *` and works with plain `fetch` from a different
origin. JSONP (`jsonp=` param) also works but is unnecessary. No proxy needed.
`src/api.ts` uses plain `fetch`.

## URL params (shareable searches)

`?handle=&min=&max=&tags=a,b&mode=any|all&ex=c,d&show-solved=1&unrated=1&minmed=N&page=N`

## Notes / observed API behavior

- `user.status` returns a full history in one call; huge accounts page via
  `from`/`count=10000` as fallback.
- Invalid handle → `status: FAILED` with a "not found" comment (and HTTP 400);
  surfaced as a friendly error in the UI.
- Gym / non-problemset submissions (no `contestId`) are dropped via the
  `problemset.problems` valid-key set.
- Problems solved by several medalists under different contest ids (Div1/Div2
  copies) count separately.
