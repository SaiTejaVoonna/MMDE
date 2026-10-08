// Text helpers shared by every source. Pure, no I/O.
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Title key that ignores "(TV series)", "season 2", "2nd season", "final season" so seasons collapse to one work. */
export function baseKey(title) {
  let t = String(title ?? '').replace(/\([^)]*(?:film|tv series|television series|anime|season|series|miniseries|video game|ova|manga|novel)[^)]*\)/gi, ' ');
  t = norm(t);
  t = t
    .replace(/\b(?:season|part|cour|series)\s*(?:\d+|[ivx]+)\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/g, ' ')
    .replace(/\bfinal season\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

export const firstYear = (s) => {
  const m = /\b(18|19|20)\d{2}\b/.exec(String(s ?? ''));
  return m ? Number(m[0]) : undefined;
};

function lev(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0..1 similarity of two already-normalized words ("bahubali" ~ "baahubali" = 0.89). */
export const wordSim = (a, b) => (a === b ? 1 : !a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length));
