// Unit tests for aggregate.ts buildRows. Plan M2 acceptance:
// duplicate submissions count once; gym (no contestId) ignored.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, type SolvedFile } from "../scripts/aggregate.ts";
import type { CfProblem } from "../scripts/lib/cf.ts";

const problems: CfProblem[] = [
  { contestId: 1850, index: "A", name: "To My Critics", type: "PROGRAMMING", rating: 800, tags: ["math"] },
  { contestId: 1850, index: "B", name: "Ten Words of Wisdom", type: "PROGRAMMING", rating: 800, tags: ["greedy"] },
  { contestId: 1850, index: "C", name: "Word on the Paper", type: "PROGRAMMING", rating: 800, tags: ["implementation"] },
  { contestId: 100, index: "A", name: "Polycarp and the Day of Pi", type: "PROGRAMMING", rating: 800, tags: ["math"] },
  { contestId: 2000, index: "X", name: "Hard Problem", type: "PROGRAMMING", rating: 3500, tags: ["dp"] },
];

const stats = new Map([
  ["1850A", 50000], ["1850B", 40000], ["1850C", 30000], ["100A", 20000], ["2000X", 100],
]);

function mk(handle: string, solved: string[]): SolvedFile {
  return { handle, fetchedAt: 1760000000, solved };
}

test("counts distinct medalists; duplicates once; gym ignored; sorted desc", () => {
  const files: SolvedFile[] = [
    mk("alpha", ["1850A", "1850A", "1850B", "2000X"]), // dup 1850A counts once
    mk("beta", ["1850A", "1850B", "100A"]),
    mk("gamma", ["1850A", "9999Z"]), // 9999Z not in problemset, dropped
  ];
  const { rows, handles } = buildRows(files, problems, stats);
  assert.deepEqual(handles, ["alpha", "beta", "gamma"]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("1850A")!.medalistCount, 3);
  assert.equal(byId.get("1850B")!.medalistCount, 2);
  assert.equal(byId.get("100A")!.medalistCount, 1);
  assert.equal(byId.get("2000X")!.medalistCount, 1);
  assert.ok(!rows.some((r) => r.id === "9999Z"));
  // sort: 1850A first (3 medalists); 1850B (2) before 100A/2000X (1, rating 800 before 3500)
  assert.deepEqual(rows.map((r) => r.id), ["1850A", "1850B", "100A", "2000X"]);
  assert.equal(byId.get("1850A")!.globalSolvedCount, 50000);
  assert.deepEqual(byId.get("1850A")!.solvers, [0, 1, 2]);
});

test("zero-solved medalist still counted in handles", () => {
  const files: SolvedFile[] = [mk("alpha", []), mk("beta", ["1850A"])];
  const { handles } = buildRows(files, problems, stats);
  assert.deepEqual(handles, ["alpha", "beta"]);
});
