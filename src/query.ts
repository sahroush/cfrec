// Pure filter/sort/paginate logic. Plan section 7. No DOM.

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

export interface Query {
  solvedKeys: Set<string>;
  hideSolved: boolean;
  minRating: number;
  maxRating: number;
  includeUnrated: boolean;
  tags: string[];
  tagMode: "any" | "all";
  excludeTags: string[];
  minMedalists: number;
  page: number;
  pageSize: number;
}

export function runQuery(rows: ProblemRow[], q: Query): { total: number; rows: ProblemRow[] } {
  const filtered = rows.filter((row) => {
    if (q.hideSolved && q.solvedKeys.has(row.id)) return false;
    if (row.rating === null) {
      if (!q.includeUnrated) return false;
    } else {
      if (row.rating < q.minRating || row.rating > q.maxRating) return false;
    }
    if (row.tags.some((t) => q.excludeTags.includes(t))) return false;
    if (q.tags.length > 0) {
      const ok = q.tagMode === "any"
        ? q.tags.some((t) => row.tags.includes(t))
        : q.tags.every((t) => row.tags.includes(t));
      if (!ok) return false;
    }
    if (row.medalistCount < q.minMedalists) return false;
    return true;
  });

  // Section 3 sort: medalistCount desc, rating asc (unrated last), contestId desc.
  filtered.sort((a, b) =>
    b.medalistCount - a.medalistCount ||
    (a.rating ?? Infinity) - (b.rating ?? Infinity) ||
    b.contestId - a.contestId,
  );

  const start = (q.page - 1) * q.pageSize;
  return { total: filtered.length, rows: filtered.slice(start, start + q.pageSize) };
}
