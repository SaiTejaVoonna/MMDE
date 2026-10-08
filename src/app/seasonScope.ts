// Season scoping: when someone opens "Season 1" of a series, only music that belongs to that season should show.
// Catalog names usually say so ("season 4 vol.1", "第4期", "2nd Season"); when they don't, the release year is the next best clue.

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** Season numbers an album or section name mentions, e.g. 'TV Animation "Slime season 4" OST' -> [4]. */
export function seasonMarkers(name: string): number[] {
  const out = new Set<number>();
  const text = name.normalize('NFKC');
  for (const m of text.matchAll(/season\s*(\d{1,2})\b/gi)) out.add(Number(m[1]));
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/gi)) out.add(Number(m[1]));
  for (const m of text.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/gi)) out.add(ORDINALS[m[1]!.toLowerCase()]!);
  for (const m of text.matchAll(/第\s*(\d{1,2})\s*期/g)) out.add(Number(m[1]));
  for (const m of text.matchAll(/\bS(\d{1,2})\b(?!\w)/g)) out.add(Number(m[1]));
  return [...out].filter((n) => n >= 1 && n <= 99).sort((a, b) => a - b);
}

export type SeasonFit = 'match' | 'unspecified' | 'excluded';

/**
 * match       = names this season, or (no season named) was released within a year of when the season aired
 * excluded    = names only OTHER seasons
 * unspecified = no season named and no useful date: shown separately as "other music from the series"
 */
export function classifyForSeason(name: string, releaseDate: string | undefined, season: number, airYear?: number): SeasonFit {
  const markers = seasonMarkers(name);
  if (markers.length) return markers.includes(season) ? 'match' : 'excluded';
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : NaN;
  if (airYear && Number.isFinite(year)) return Math.abs(year - airYear) <= 1 ? 'match' : 'unspecified';
  return 'unspecified';
}
