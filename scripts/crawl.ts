// Crawl medalist submissions -> data/solved/<handle>.json
// Plan section 6 step 3. Resumable: files newer than --max-age hours are skipped.

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cf, problemKey, type CfProblem } from "./lib/cf.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const solvedDir = join(root, "data", "solved");

const args = process.argv.slice(2);
const force = args.includes("--force");
const maxAgeIdx = args.indexOf("--max-age");
const maxAgeHours = maxAgeIdx >= 0 ? Number(args[maxAgeIdx + 1]) : 24;

interface MedalistsFile { handles: string[] }
interface SolvedFile { handle: string; fetchedAt: number; solved: string[] }

mkdirSync(solvedDir, { recursive: true });

const input = JSON.parse(readFileSync(join(root, "data", "medalists.input.json"), "utf8")) as MedalistsFile;
console.log(`Input list: ${input.handles.length} handles`);

// Step 2: canonicalize handles via user.info, chunked, bisect on bad handles.
// Bad handles land in data/medalists.problems.txt.
const problemHandles: string[] = [];
const canonical: string[] = [];

async function resolveBatch(handles: string[]) {
  if (handles.length === 0) return;
  try {
    const infos = await cf.userInfo(handles);
    const seen = new Set<string>();
    for (const info of infos) {
      const h = info.handle;
      if (!seen.has(h)) { seen.add(h); canonical.push(h); }
    }
  } catch (e) {
    if (handles.length === 1) {
      problemHandles.push(handles[0]);
      console.warn(`  bad handle: ${handles[0]} (${(e as Error).message})`);
    } else {
      const mid = Math.ceil(handles.length / 2);
      await resolveBatch(handles.slice(0, mid));
      await resolveBatch(handles.slice(mid));
    }
  }
}

for (let i = 0; i < input.handles.length; i += 500) {
  await resolveBatch(input.handles.slice(i, i + 500));
}
console.log(`Canonical: ${canonical.length}, bad: ${problemHandles.length}`);

if (problemHandles.length > 0) {
  writeFileSync(join(root, "data", "medalists.problems.txt"), problemHandles.join("\n") + "\n");
}

// Step 3: crawl each medalist.
const ps = await cf.problemsetProblems();
const validKeys = new Set<string>();
for (const p of ps.problems as CfProblem[]) {
  const k = problemKey(p);
  if (k !== null && p.type === "PROGRAMMING") validKeys.add(k);
}
console.log(`Problemset: ${validKeys.size} valid problems`);

const started = Date.now();
let done = 0;
let skipped = 0;

for (const handle of canonical) {
  const file = join(solvedDir, `${handle}.json`);
  if (!force && existsSync(file)) {
    const ageH = (Date.now() - statSync(file).mtimeMs) / 3_600_000;
    if (ageH < maxAgeHours) {
      skipped++;
      done++;
      continue;
    }
  }
  const t0 = Date.now();
  let solved = new Set<string>();
  try {
    // Full history in one call; fall back to paging if it fails.
    try {
      solved = extract(await cf.userStatus(handle), validKeys);
    } catch {
      solved = new Set<string>();
      for (let from = 1; ; from += 10000) {
        const page = await cf.userStatus(handle, from, 10000);
        for (const k of extract(page, validKeys)) solved.add(k);
        if (page.length < 10000) break;
      }
    }
    const out: SolvedFile = { handle, fetchedAt: Math.floor(Date.now() / 1000), solved: [...solved] };
    writeFileSync(file, JSON.stringify(out));
  } catch (e) {
    console.warn(`  FAILED ${handle}: ${(e as Error).message} — skipped, excluded from medalistCount`);
    done++;
    continue;
  }
  done++;
  const rate = (Date.now() - started) / 1000 / done;
  const eta = ((canonical.length - done) * rate).toFixed(0);
  console.log(`[${done}/${canonical.length}] ${handle}: ${solved.size} solved (${((Date.now() - t0) / 1000).toFixed(1)}s, ETA ${eta}s)`);
}

console.log(`Crawl done: ${done - skipped} fetched, ${skipped} skipped (fresh cache), ${problemHandles.length} bad handles`);

function extract(subs: { problem: CfProblem; verdict?: string }[], valid: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const s of subs) {
    if (s.verdict !== "OK") continue;
    const k = problemKey(s.problem);
    if (k !== null && valid.has(k)) out.add(k);
  }
  return out;
}

