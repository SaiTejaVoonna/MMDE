import type { DiscoveryResult } from '../domain/types.ts';

export interface DiagContext {
  modeLabel: string;
  live?: boolean;
  hasApiKey?: boolean; // never the key itself
  url?: string;
  userAgent?: string;
  now: string;
  lastSearch?: { query: string; sources: string[]; errors: string[]; count: number };
}

const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '...' : s);

/**
 * Plain-text diagnostics for pasting into a chat: environment, which providers reported
 * errors, every track's status/evidence, releases. Display-only; no logic of its own.
 * Never includes the API key.
 */
export function buildDiagnostics(r: DiscoveryResult, c: DiagContext): string {
  const failed = (name: string) => r.errors.filter((e) => e.startsWith(`${name}:`) || e.startsWith(`${name} (`));
  const lines: string[] = [];
  lines.push('MMDE DIAGNOSTICS');
  lines.push(`generated: ${c.now}`);
  lines.push(`result generatedAt: ${r.generatedAt}`);
  lines.push(`mode: ${c.modeLabel}`);
  lines.push(`live providers: ${c.live == null ? 'n/a' : c.live ? 'on' : 'off'}; AI extractor key set: ${c.hasApiKey == null ? 'n/a' : c.hasApiKey ? 'yes' : 'no'}`);
  if (c.url) lines.push(`page: ${c.url}`);
  if (c.userAgent) lines.push(`browser: ${c.userAgent}`);
  lines.push('');
  lines.push(`MEDIA: ${r.media.title} (${r.media.type}${r.media.year ? ', ' + r.media.year : ''}) id=${r.media.id} externalIds=${JSON.stringify(r.media.externalIds)}`);
  if (c.lastSearch) {
    lines.push(`LAST SEARCH: "${c.lastSearch.query}" -> ${c.lastSearch.count} results from [${c.lastSearch.sources.join(', ')}]` + (c.lastSearch.errors.length ? `; errors: ${c.lastSearch.errors.join(' | ')}` : '; no errors'));
  }
  lines.push('');
  lines.push('PROVIDERS (configured -> errors reported)');
  for (const s of r.sources) {
    const f = failed(s);
    lines.push(`- ${s}: ${f.length ? 'ERRORS: ' + f.join(' | ') : 'no error reported'}`);
  }
  const other = r.errors.filter((e) => !r.sources.some((s) => e.startsWith(`${s}:`) || e.startsWith(`${s} (`)));
  if (other.length) lines.push(`other errors: ${other.join(' | ')}`);
  lines.push(`all errors (${r.errors.length}): ${r.errors.length ? r.errors.join(' | ') : 'none'}`);
  lines.push('');
  const counts = { confirmed: 0, suggested: 0, unverified: 0 };
  for (const t of r.tracks) counts[t.status]++;
  lines.push(`TRACKS: ${r.tracks.length} total; confirmed ${counts.confirmed}, suggested ${counts.suggested}, unverified ${counts.unverified}`);
  for (const t of r.tracks) {
    const part = t.part.number != null ? `${t.part.kind} ${t.part.number}` : t.part.kind;
    lines.push(`- [${t.status}] ${part} / ${t.role}${t.position ? ' ' + t.position : ''}: "${t.title}" - ${t.artists.join(', ') || 'unknown'} | version=${t.version} confidence=${t.confidence} matchScore=${t.matchScore ?? 'none'}` +
      (t.recording ? ` | mbid=${t.recording.mbid ?? '-'} isrc=${t.recording.isrcs.join(',') || '-'}` : ' | no recording match'));
    for (const e of t.evidence) lines.push(`    evidence: ${e.provider} ${e.url ?? '(no url)'}${e.quote ? ` "${clip(e.quote)}"` : ''}`);
    const resolved = t.links.filter((l) => l.kind === 'resolved').map((l) => l.platform);
    lines.push(`    links: ${resolved.length ? 'resolved=' + resolved.join(',') : 'all search links (none resolved)'}`);
  }
  lines.push('');
  lines.push(`RELEASES: ${r.releases.length}`);
  for (const x of r.releases) lines.push(`- ${x.kind} "${x.title}" - ${x.artists.join(', ')}${x.label ? ' | ' + x.label : ''}${x.trackCount ? ' | ' + x.trackCount + ' tracks' : ''} | source ${x.evidence.url ?? '(none)'}`);
  return lines.join('\n');
}
