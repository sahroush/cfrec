// UI wiring. Plan section 8. Plain DOM, URL params as source of truth.

import { runQuery, type ProblemRow, type Query } from "./query.ts";
import { fetchUserSolved, UserFetchError } from "./api.ts";

interface Meta {
  generatedAt: number;
  medalistCount: number;
  handles: string[];
  allTags: string[];
  minRating: number;
  maxRating: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let meta: Meta;
let rows: ProblemRow[] = [];
let solvedKeys = new Set<string>();
let totalSolvedByUser = 0;
let page = 1;
let lastQuery = "";

function paramsToState(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function readForm(): Query {
  const tags = parseList(($("tags") as HTMLInputElement).value);
  const excludeTags = parseList(($("exclude-tags") as HTMLInputElement).value);
  const mode = document.querySelector<HTMLInputElement>('input[name="tag-mode"]:checked')!.value as "any" | "all";
  return {
    solvedKeys,
    hideSolved: ($("hide-solved") as HTMLInputElement).checked,
    minRating: Number(($("min") as HTMLInputElement).value) || 0,
    maxRating: Number(($("max") as HTMLInputElement).value) || 4000,
    includeUnrated: ($("include-unrated") as HTMLInputElement).checked,
    tags,
    tagMode: mode,
    excludeTags,
    minMedalists: Math.max(1, Number(($("min-medalists") as HTMLInputElement).value) || 1),
    page,
    pageSize: 50,
  };
}

function parseList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

function writeUrl(q: Query) {
  const p = new URLSearchParams();
  const handle = ($("handle") as HTMLInputElement).value.trim();
  if (handle) p.set("handle", handle);
  p.set("min", String(q.minRating));
  p.set("max", String(q.maxRating));
  if (q.tags.length) p.set("tags", q.tags.join(","));
  if (q.tagMode !== "any") p.set("mode", q.tagMode);
  if (q.excludeTags.length) p.set("ex", q.excludeTags.join(","));
  if (!q.hideSolved) p.set("show-solved", "1");
  if (q.includeUnrated) p.set("unrated", "1");
  if (q.minMedalists > 1) p.set("minmed", String(q.minMedalists));
  if (page > 1) p.set("page", String(page));
  history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
}

function stateToForm() {
  const p = paramsToState();
  if (p.get("handle")) ($("handle") as HTMLInputElement).value = p.get("handle")!;
  if (p.get("min")) ($("min") as HTMLInputElement).value = p.get("min")!;
  if (p.get("max")) ($("max") as HTMLInputElement).value = p.get("max")!;
  if (p.get("tags")) ($("tags") as HTMLInputElement).value = p.get("tags")!;
  if (p.get("ex")) ($("exclude-tags") as HTMLInputElement).value = p.get("ex")!;
  if (p.get("mode") === "all") (document.querySelector<HTMLInputElement>('input[name="tag-mode"][value="all"]') as HTMLInputElement).checked = true;
  if (p.get("show-solved")) ($("hide-solved") as HTMLInputElement).checked = false;
  if (p.get("unrated")) ($("include-unrated") as HTMLInputElement).checked = true;
  if (p.get("minmed")) ($("min-medalists") as HTMLInputElement).value = p.get("minmed")!;
  page = Number(p.get("page")) || 1;
}

function showError(msg: string) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = false;
}

function render() {
  const q = readForm();
  writeUrl(q);
  const { total, rows: pageRows } = runQuery(rows, q);
  const tbody = $("rows");
  tbody.innerHTML = "";
  const offset = (q.page - 1) * q.pageSize;
  for (const [i, r] of pageRows.entries()) {
    const tr = document.createElement("tr");
    const url = `https://codeforces.com/problemset/problem/${r.contestId}/${r.index}`;
    const solvers = r.solvers?.map((i) => meta.handles[i]).filter(Boolean) ?? [];
    tr.innerHTML =
      `<td class="num">${offset + i + 1}</td>` +
      `<td><a href="${url}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></td>` +
      `<td class="num">${r.rating ?? "—"}</td>` +
      `<td class="tags">${escapeHtml(r.tags.join(", "))}</td>` +
      `<td class="num" title="${escapeHtml(solvers.join(", "))}">${r.medalistCount} / ${meta.medalistCount}</td>` +
      `<td class="num">${r.globalSolvedCount}</td>`;
    tbody.appendChild(tr);
  }
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted)">No problems match.</td></tr>`;
  }
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  $("page-info").textContent = `Page ${q.page} / ${pages} — ${total} problems`;
  ($("prev") as HTMLButtonElement).disabled = q.page <= 1;
  ($("next") as HTMLButtonElement).disabled = q.page >= pages;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

async function search() {
  const handle = ($("handle") as HTMLInputElement).value.trim();
  $("error").hidden = true;
  $("summary").textContent = "";
  if (!handle) {
    showError("Enter a handle first.");
    return;
  }
  ($("rows") as HTMLElement).innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;
  try {
    solvedKeys = await fetchUserSolved(handle);
  } catch (e) {
    if (e instanceof UserFetchError) {
      showError(e.kind === "rate-limit" ? "Rate limited by Codeforces — try again in a few seconds." : e.message);
    } else {
      showError(String(e));
    }
    $("rows").innerHTML = "";
    return;
  }
  // Summary: X of the Y problems the medalists solved (Y = rows in dataset)
  totalSolvedByUser = rows.filter((r) => solvedKeys.has(r.id)).length;
  $("summary").textContent = `You have solved ${totalSolvedByUser} of the ${rows.length} problems the medalists solved.`;
  page = 1;
  render();
}

function goPage(delta: number) {
  page = Math.max(1, page + delta);
  render();
  window.scrollTo({ top: 0 });
}

async function init() {
  stateToForm();
  const [problemsRes, metaRes] = await Promise.all([
    fetch("data/problems.json"),
    fetch("data/meta.json"),
  ]);
  rows = await problemsRes.json();
  meta = await metaRes.json();

  const dl = $("tag-list") as HTMLDataListElement;
  dl.innerHTML = meta.allTags.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");

  const date = new Date(meta.generatedAt * 1000).toISOString().slice(0, 10);
  $("footer").innerHTML =
    `Data generated on ${date}, based on ${meta.medalistCount} medalists. ` +
    `Source list: <a href="https://codeforces.com/list/c17b31a0a22063a63b1d9c6eec779553" target="_blank" rel="noopener">Iran OI gold medalists</a>.`;

  $("controls").addEventListener("submit", (e) => {
    e.preventDefault();
    search();
  });
  $("prev").addEventListener("click", () => goPage(-1));
  $("next").addEventListener("click", () => goPage(1));

  // Auto-run when URL carries a handle (shareable searches).
  if (paramsToState().get("handle")) search();
  else render();
}

init();
