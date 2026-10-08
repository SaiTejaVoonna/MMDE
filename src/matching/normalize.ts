import type { VersionKind } from '../domain/types.ts';

// Version markers found in parentheses/brackets or after a dash in titles.
const VERSION_PATTERNS: Array<[VersionKind, RegExp]> = [
  ['tv_size', /\b(tv[\s-]?size|tv[\s-]?ver(?:sion)?|anime[\s-]?size|short[\s-]?ver(?:sion)?)\b/i],
  ['instrumental', /\b(instrumental|karaoke|off[\s-]?vocal)\b/i],
  ['live', /\blive\b/i],
  ['remix', /\b(remix|re[\s-]?mix|mixed by)\b/i],
  ['cover', /\b(cover|tribute|originally performed)\b/i],
  ['rerecording', /\b(re[\s-]?record(?:ed|ing)?|new recording)\b/i],
  ['full', /\b(full[\s-]?(?:size|ver(?:sion)?)|album ver(?:sion)?|extended)\b/i],
];

export function classifyVersion(title: string, disambiguation = ''): VersionKind {
  const text = `${title} ${disambiguation}`;
  for (const [kind, re] of VERSION_PATTERNS) if (re.test(text)) return kind;
  return 'original';
}

/** Strip version markers and punctuation so "Nameless Story (TV Size)" ~ "Nameless Story". */
export function normalizeTitle(title: string): string {
  let t = title.normalize('NFKC').toLowerCase();
  t = t.replace(/[(\[（][^)\]）]*[)\]）]/g, ' '); // bracketed qualifiers
  t = t.replace(/\s[-–—]\s.*$/, ' '); // trailing " - Something"
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function normalizeArtist(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Order-insensitive artist comparison for romanized names. */
export function sameArtist(a: string, b: string): boolean {
  if (similarity(a, b) >= 0.85) return true;
  const ta = a.split(' ').sort().join(' ');
  const tb = b.split(' ').sort().join(' ');
  return ta.length > 0 && similarity(ta, tb) >= 0.9;
}

/** 0..1 string similarity on already-normalized strings. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}
