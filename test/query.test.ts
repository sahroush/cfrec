// Unit tests for src/query.ts. Plan M3 acceptance.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runQuery, type ProblemRow, type Query } from "../src/query.ts";

function row(over: Partial<ProblemRow>): ProblemRow {
  return {
    id: "100A", contestId: 100, index: "A", name: "Test", rating: 1000,
    tags: [], medalistCount: 1, globalSolvedCount: 100, ...over,
  };
}

function q(over: Partial<Query>): Query {
  return {
    solvedKeys: new Set(), hideSolved: true, minRating: 0, maxRating: 4000,
    includeUnrated: false, tags: [], tagMode: "any", excludeTags: [],
    minMedalists: 1, page: 1, pageSize: 50, ...over,
  };
}

const data: ProblemRow[] = [
  row({ id: "100A", contestId: 100, rating: 800, medalistCount: 5, tags: ["greedy"] }),
  row({ id: "100B", contestId: 100, index: "B", rating: 1200, medalistCount: 5, tags: ["dp"] }),
  row({ id: "99C", contestId: 99, index: "C", rating: 1200, medalistCount: 3, tags: ["dp", "trees"] }),
  row({ id: "101D", contestId: 101, index: "D", rating: 2000, medalistCount: 3, tags: ["math"] }),
  row({ id: "98E", contestId: 98, index: "E", rating: null, medalistCount: 2, tags: ["greedy"] }),
  row({ id: "97F", contestId: 97, index: "F", rating: null, medalistCount: 2, tags: ["*special"] }),
];

test("sort: medalistCount desc, rating asc, contestId desc", () => {
  const r = runQuery(data, q({ includeUnrated: true }));
  assert.deepEqual(r.rows.map((x) => x.id), ["100A", "100B", "99C", "101D", "98E", "97F"]);
});

test("rating bounds inclusive", () => {
  const r = runQuery(data, q({ minRating: 800, maxRating: 1200 }));
  assert.deepEqual(r.rows.map((x) => x.id), ["100A", "100B", "99C"]);
});

test("unrated excluded by default, included with includeUnrated", () => {
  assert.equal(runQuery(data, q({})).rows.filter((x) => x.rating === null).length, 0);
  const r = runQuery(data, q({ includeUnrated: true }));
  assert.deepEqual(r.rows.map((x) => x.id), ["100A", "100B", "99C", "101D", "98E", "97F"]);
});

test("tag ANY vs ALL", () => {
  const any = runQuery(data, q({ tags: ["dp", "trees"], tagMode: "any" }));
  assert.deepEqual(any.rows.map((x) => x.id), ["100B", "99C"]);
  const all = runQuery(data, q({ tags: ["dp", "trees"], tagMode: "all" }));
  assert.deepEqual(all.rows.map((x) => x.id), ["99C"]);
});

test("tag exact match incl. *special", () => {
  const r = runQuery(data, q({ tags: ["*special"], includeUnrated: true }));
  assert.deepEqual(r.rows.map((x) => x.id), ["97F"]);
});

test("excludeTags drops rows containing any", () => {
  const r = runQuery(data, q({ tags: ["dp"], excludeTags: ["trees"] }));
  assert.deepEqual(r.rows.map((x) => x.id), ["100B"]);
});

test("hideSolved uses solvedKeys", () => {
  const r = runQuery(data, q({ solvedKeys: new Set(["100A", "100B"]), includeUnrated: true }));
  assert.deepEqual(r.rows.map((x) => x.id), ["99C", "101D", "98E", "97F"]);
});

test("minMedalists filter", () => {
  const r = runQuery(data, q({ minMedalists: 4 }));
  assert.deepEqual(r.rows.map((x) => x.id), ["100A", "100B"]);
});

test("pagination", () => {
  const p1 = runQuery(data, q({ pageSize: 2, page: 1, includeUnrated: true }));
  const p3 = runQuery(data, q({ pageSize: 2, page: 3, includeUnrated: true }));
  const p4 = runQuery(data, q({ pageSize: 2, page: 4, includeUnrated: true }));
  assert.deepEqual(p1.rows.map((x) => x.id), ["100A", "100B"]);
  assert.deepEqual(p3.rows.map((x) => x.id), ["98E", "97F"]);
  assert.deepEqual(p4.rows.map((x) => x.id), []);
  assert.equal(p1.total, 6);
});
