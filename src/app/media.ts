import type { Media } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';

export function mergeMediaResults(results: Media[]): Media[] {
  const byTitle = new Map<string, Media>();
  for (const media of results) {
    const key = normalizeTitle(media.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, { ...media, altTitles: [...new Set(media.altTitles)] });
      continue;
    }
    const related = [...(existing.relatedMedia ?? []), ...(media.relatedMedia ?? [])];
    const relatedById = new Map(related.map((m) => [m.id, m]));
    byTitle.set(key, {
      ...existing,
      altTitles: [...new Set([...existing.altTitles, ...media.altTitles])],
      externalIds: { ...existing.externalIds, ...media.externalIds },
      year: existing.year ?? media.year,
      partRef: existing.partRef ?? media.partRef,
      relatedMedia: relatedById.size ? [...relatedById.values()] : undefined,
    });
  }
  return [...byTitle.values()];
}
