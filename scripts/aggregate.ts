// Aggregate data/solved/*.json -> public/data/problems.json + meta.json
// Plan section 6 step 4.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cf, problemKey, type CfProblem } from "./lib/cf.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ProblemRow {
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number | null;
  tags: string[];
  medalistCount: number;
  globalSolvedCount: number;
  solvers?: number[];
}

export interface SolvedFile { handle: string; fetchedAt: number; solved: string[] }

// Pure core, exported for tests: build rows from solved files + problemset metadata.
export function buildRows(
  solvedFiles: SolvedFile[],
  problems: CfProblem[],
  stats: Map<string, number>,
): { rows: ProblemRow[]; handles: string[] } {
  const byKey = new Map<string, CfProblem>();
  for (const p of problems) {
    if (p.type !== "PROGRAMMING") continue;
    const k = problemKey(p);
    if (k !== null) byKey.set(k, p);
  }

  // handle -> index into meta.handles (deduped, sorted for stable output)
  const handles = [...new Set(solvedFiles.map((f) => f.handle))].sort();
  const handleIdx = new Map(handles.map((h, i) => [h, i]));

  const counts = new Map<string, Set<number>>();
  for (const f of solvedFiles) {
    const idx = handleIdx.get(f.handle);
    if (idx === undefined) continue;
    for (const key of f.solved) {
      if (!byKey.has(key)) continue;
      let set = counts.get(key);
      if (!set) { set = new Set(); counts.set(key, set); }
      set.add(idx);
    }
  }

  const rows: ProblemRow[] = [];
  for (const [key, solvers] of counts) {
    const p = byKey.get(key)!;
    rows.push({
      id: key,
      contestId: p.contestId!,
      index: p.index,
      name: p.name,
      rating: p.rating ?? null,
      tags: p.tags,
      medalistCount: solvers.size,
      globalSolvedCount: stats.get(key) ?? 0,
      solvers: [...solvers].sort((a, b) => a - b),
    });
  }

  rows.sort((a, b) =>
    b.medalistCount - a.medalistCount ||
    (a.rating ?? Infinity) - (b.rating ?? Infinity) || // unrated last
    b.contestId - a.contestId,
  );
  return { rows, handles };
}

// CLI entry
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const solvedDir = join(root, "data", "solved");
  const files: SolvedFile[] = [];
  for (const name of readdirSync(solvedDir)) {
    if (!name.endsWith(".json")) continue;
    files.push(JSON.parse(readFileSync(join(solvedDir, name), "utf8")));
  }
  console.log(`Read ${files.length} solved files`);

  const ps = await cf.problemsetProblems();
  const stats = new Map<string, number>();
  for (const s of ps.problemStatistics) stats.set(`${s.contestId}${s.index}`, s.solvedCount);

  const { rows, handles } = buildRows(files, ps.problems, stats);

  const allTags = [...new Set(rows.flatMap((r) => r.tags))].sort();
  const ratings = rows.map((r) => r.rating).filter((r): r is number => r !== null);
  const meta = {
    generatedAt: Math.floor(Date.now() / 1000),
    medalistCount: handles.length,
    handles,
    allTags,
    minRating: ratings.length ? Math.min(...ratings) : 800,
    maxRating: ratings.length ? Math.max(...ratings) : 3500,
  };

  writeFileSync(join(root, "public", "data", "problems.json"), JSON.stringify(rows));
  writeFileSync(join(root, "public", "data", "meta.json"), JSON.stringify(meta));

  // Sanity stats (plan section 6 step 5)
  console.log(`Problems: ${rows.length}`);
  console.log("Top 10:");
  for (const r of rows.slice(0, 10)) console.log(`  ${r.id} ${r.name} — ${r.medalistCount} medalists`);
  const dist = new Map<number, number>();
  for (const r of rows) dist.set(r.medalistCount, (dist.get(r.medalistCount) ?? 0) + 1);
  console.log("medalistCount distribution:", [...dist.entries()].sort((a, b) => b[0] - a[0]).slice(0, 15));
}
