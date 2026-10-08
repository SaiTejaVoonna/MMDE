import type { Media, MediaTrack, PartKind, TrackRole } from '../domain/types.ts';

const PART_ORDER: PartKind[] = ['season', 'movie', 'special', 'ova', 'whole'];
const ROLE_ORDER: TrackRole[] = ['opening', 'ending', 'insert', 'character', 'ost', 'score', 'promo', 'other'];
const ROLE_LABEL: Record<TrackRole, string> = {
  opening: 'Openings',
  ending: 'Endings',
  insert: 'Insert Songs',
  character: 'Character Songs',
  ost: 'OST',
  score: 'Original Score',
  promo: 'Promotional',
  other: 'Other',
};
const MARK = { confirmed: '[confirmed]', suggested: '[suggested]', unverified: '[unverified]' } as const;

function partLabel(t: MediaTrack): string {
  const k = t.part.kind;
  const name = k === 'season' ? 'Season' : k === 'movie' ? 'Movie' : k === 'ova' ? 'OVA' : k === 'special' ? 'Special' : 'Whole media';
  return t.part.number != null && k !== 'whole' ? `${name} ${t.part.number}` : name;
}

/** Group tracks into Part -> Role, in a stable, readable order. */
export function organize(tracks: MediaTrack[]): Array<{ part: string; roles: Array<{ role: string; tracks: MediaTrack[] }> }> {
  const sorted = [...tracks].sort(
    (a, b) =>
      PART_ORDER.indexOf(a.part.kind) - PART_ORDER.indexOf(b.part.kind) ||
      (a.part.number ?? 0) - (b.part.number ?? 0) ||
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      (a.position ?? '').localeCompare(b.position ?? ''),
  );
  const out: Array<{ part: string; roles: Array<{ role: string; tracks: MediaTrack[] }> }> = [];
  for (const t of sorted) {
    const label = partLabel(t);
    let part = out.find((p) => p.part === label);
    if (!part) out.push((part = { part: label, roles: [] }));
    const roleLabel = ROLE_LABEL[t.role];
    let role = part.roles.find((r) => r.role === roleLabel);
    if (!role) part.roles.push((role = { role: roleLabel, tracks: [] }));
    role.tracks.push(t);
  }
  return out;
}

export function render(media: Media, tracks: MediaTrack[]): string {
  const lines = [`${media.title}${media.year ? ` (${media.year})` : ''}`];
  for (const p of organize(tracks)) {
    lines.push('', p.part);
    for (const r of p.roles) {
      lines.push(`  ${r.role}`);
      for (const t of r.tracks) {
        const pos = t.position ? `${t.position}: ` : '';
        lines.push(`    ${pos}${t.title} - ${t.artists.join(', ')}  ${MARK[t.status]} ${t.confidence}`);
      }
    }
  }
  return lines.join('\n');
}
