import { parseCsv, parseDivision } from "./meets";

/**
 * Pasted results text → the column-headed results CSV the normal importer reads.
 *
 * Accepts either:
 *  - a spreadsheet / CSV / tab-separated table with a header row (Event, First/Last or Name, School, Mark, Place, Gender), or
 *  - plain results text as most results sites show it (Hy-Tek style): an event title line ("Girls 55 Meter Dash"),
 *    followed by one line per athlete ("1 Jane Doe 11 Cornwall Central 7.45").
 *
 * Nothing is guessed: a line that can't be split into name, school and mark is skipped and counted.
 */
export type PastedParse = { csv: string; rows: number; events: number; skipped: number; format: "table" | "text" };

const MARK = /^(?:(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?|\d{1,3}\.\d{1,3}[hH]?|\d{1,3}-\d{1,2}(?:\.\d{1,2})?|\d{1,3}'\s?\d{1,2}(?:\.\d{1,2})?"?|\d{1,3}\.\d{2}m)$/;
const STATUS = /^(DQ|DSQ|DNF|DNS|NH|ND|NM|FS|SCR|FOUL)$/i;
const GRADE = /^(9|10|11|12|FR|SO|JR|SR|Fr|So|Jr|Sr|fr|so|jr|sr)$/;
const GENDER_WORD = /\b(boys?|girls?|men'?s?|women'?s?)\b/i;

const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function isTable(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  if (!/[,\t]/.test(first)) return false;
  const header = (parseCsv(first)[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return header.includes("event") && (header.includes("mark") || header.includes("result") || header.includes("time"));
}

function splitName(raw: string): { first: string; last: string } {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.includes(",")) {
    const [last, first] = t.split(",", 2).map((x) => x.trim());
    return { first: first ?? "", last: last ?? "" };
  }
  const parts = t.split(" ");
  if (parts.length === 1) return { first: "", last: parts[0] ?? "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

type Row = { event: string; place: string; first: string; last: string; grade: string; school: string; mark: string; status: string };

function parseLine(line: string, event: string): Row | null {
  const cleaned = line.replace(/\s+[qQxX*]$/, "").replace(/\s+[+-]?\d\.\d\s*$/, "").trim();
  // Column-separated copy (tabs or 2+ spaces) keeps name and school apart.
  let cols = cleaned.split(/\t|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  let tokens = cleaned.split(/\s+/);
  let place = "";
  if (/^(\d{1,3}|T\d{1,3}|--?)\.?$/.test(tokens[0] ?? "")) {
    place = /\d/.test(tokens[0] ?? "") ? (tokens[0] ?? "").replace(/\.$/, "") : "";
    tokens = tokens.slice(1);
    if (cols.length > 1 && /^(\d{1,3}|T\d{1,3}|--?)\.?$/.test(cols[0] ?? "")) cols = cols.slice(1);
    // "1 Jane Doe" in one column: the place is single-space separated from the name.
    else if (cols.length > 1) cols[0] = (cols[0] ?? "").replace(/^(\d{1,3}|T\d{1,3}|--?)\.?\s+/, "");
  }
  // A grade single-space separated from the school ("11 Cornwall Central") or the name ("Jane Doe 11") is its own column.
  cols = cols.flatMap((c) => {
    const lead = c.match(/^(\S+)\s+(.+)$/);
    if (lead && GRADE.test(lead[1] ?? "") && !MARK.test(lead[2] ?? "")) return [lead[1] ?? "", lead[2] ?? ""];
    const tail = c.match(/^(.+?)\s+(\S+)$/);
    if (tail && GRADE.test(tail[2] ?? "") && /[a-z]/i.test(tail[1] ?? "")) return [tail[1] ?? "", tail[2] ?? ""];
    return [c];
  });
  // Mark (or status): the LAST mark-like token on the line (seed mark comes first, final mark last).
  let markIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = (tokens[i] ?? "").replace(/^[*#]/, "");
    if (MARK.test(t) || STATUS.test(t)) { markIdx = i; break; }
  }
  if (markIdx < 1) return null;
  const markTok = (tokens[markIdx] ?? "").replace(/^[*#]/, "");
  const mark = STATUS.test(markTok) ? "" : markTok;
  const status = STATUS.test(markTok) ? markTok.toUpperCase() : "";
  // Drop seed marks that sit before the final mark.
  let body = tokens.slice(0, markIdx);
  while (body.length && (MARK.test(body[body.length - 1] ?? "") || /^(NT|NH|SEED)$/i.test(body[body.length - 1] ?? ""))) body = body.slice(0, -1);
  if (body.length < 2) return null;

  let name = "";
  let school = "";
  let grade = "";
  const g = body.findIndex((t, i) => i > 0 && GRADE.test(t));
  if (cols.length >= 3) {
    // name | (grade) | school | marks…
    const nonMark = cols.filter((c) => !MARK.test(c) && !STATUS.test(c) && !/^(NT|NH)$/i.test(c));
    name = nonMark[0] ?? "";
    if (GRADE.test(nonMark[1] ?? "")) { grade = nonMark[1] ?? ""; school = nonMark[2] ?? ""; } else school = nonMark[1] ?? "";
  } else if (g > 0) {
    name = body.slice(0, g).join(" ");
    grade = body[g] ?? "";
    school = body.slice(g + 1).join(" ");
  } else {
    // No separator: split at the pool school name when present, otherwise the line is ambiguous.
    const joined = body.join(" ");
    const at = joined.search(/\bcornwall\b/i);
    if (at <= 0) return null;
    name = joined.slice(0, at).trim();
    school = joined.slice(at).trim();
  }
  if (!name || !school) return null;
  const { first, last } = splitName(name);
  return { event, place, first, last, grade, school, mark, status };
}

export function pastedToCsv(text: string): PastedParse {
  const clean = text.replace(/\r/g, "").replace(/\u00a0/g, " ").trim();
  if (!clean) return { csv: "", rows: 0, events: 0, skipped: 0, format: "text" };
  if (isTable(clean)) {
    const rows = parseCsv(clean);
    const csv = rows.map((r) => r.map(q).join(",")).join("\n");
    const header = (rows[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const ev = header.indexOf("event");
    return { csv, rows: Math.max(0, rows.length - 1), events: new Set(rows.slice(1).map((r) => r[ev] ?? "")).size, skipped: 0, format: "table" };
  }
  const out: Row[] = [];
  let event = "";
  let skipped = 0;
  const events = new Set<string>();
  for (const raw of clean.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const hasMark = tokens.some((t) => MARK.test(t.replace(/^[*#]/, "")));
    if (!hasMark && GENDER_WORD.test(line)) {
      const d = parseDivision(line);
      if (d.event) { event = line.replace(/\s+/g, " "); events.add(event); continue; }
    }
    if (!event) continue;
    if (/^(name|place|pl|athlete|year|school|team|finals?|prelims?|seed|heat \d+|flight \d+)\b/i.test(line) && !hasMark) continue;
    const r = parseLine(line, event);
    if (r) out.push(r); else if (hasMark) skipped++;
  }
  const header = ["Event", "Place", "First", "Last", "Grade", "School", "Mark", "Status"];
  const csv = [header.join(","), ...out.map((r) => [r.event, r.place, r.first, r.last, r.grade, r.school, r.mark, r.status].map(q).join(","))].join("\n");
  return { csv: out.length ? csv : "", rows: out.length, events: events.size, skipped, format: "text" };
}
