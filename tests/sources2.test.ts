import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import { deezerIsrcResolver } from '../src/providers/deezerIsrc.ts';
import { wikidataTitleSource } from '../src/providers/wikidataTitles.ts';
import { mergeSoundtrack } from '../src/app/soundtrackMerge.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import type { CatalogAlbum, CatalogTrack } from '../src/providers/catalogAlbums.ts';

const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

test('deezerIsrcResolver: reads and validates the ISRC, caches, rejects bad ids, surfaces Deezer errors', async () => {
  let calls = 0;
  const f = (async (u: string) => { calls++; return String(u).endsWith('/track/1') ? resp({ id: 1, isrc: 'jpw741900057' }) : String(u).endsWith('/track/2') ? resp({ id: 2, isrc: '' }) : resp({ error: { type: 'DataException' } }); }) as unknown as typeof fetch;
  const isrcOf = deezerIsrcResolver('MMDE-test', f, { intervalMs: 1 });
  assert.equal(await isrcOf('1'), 'JPW741900057'); assert.equal(await isrcOf('1'), 'JPW741900057'); assert.equal(calls, 1, 'second call cached');
  assert.equal(await isrcOf('2'), null);
  await assert.rejects(() => isrcOf('3'), /error/); await assert.rejects(() => isrcOf('../x'), /invalid id/);
});

test('wikidataTitleSource: other-language names of a film/series entity, skipping look-alikes of another year', async () => {
  const f = (async (u: string) => {
    const p = new URL(String(u)).searchParams;
    if (p.get('action') === 'wbsearchentities') return resp({ search: [
      { id: 'Q1', description: '2015 video game' }, { id: 'Q2', description: '2019 Japanese anime television series' }, { id: 'Q3', description: '2001 film' }] });
    assert.equal(p.get('ids'), 'Q2');
    return resp({ entities: { Q2: { labels: { ja: { value: '炎炎ノ消防隊' }, en: { value: 'Fire Force' }, zh: { value: '炎炎消防队' } }, aliases: { ja: [{ value: 'エンエンノショウボウタイ' }] } } } });
  }) as unknown as typeof fetch;
  const out = await wikidataTitleSource('MMDE-test', f).find('Fire Force', 2019);
  assert.deepEqual(out, ['炎炎ノ消防隊', 'エンエンノショウボウタイ', '炎炎消防队']);
});

const pl: CatalogAlbum = { platform: 'deezer-playlist', id: '9', name: 'My Fire Force picks', artist: 'fan', url: 'https://www.deezer.com/playlist/9', kind: 'playlist' };
const pt = (no: number, title: string, album: string, artists: string[]): CatalogTrack => ({ no, title, artists, url: 'https://www.deezer.com/track/' + no, id: String(no), album });

test('mergeSoundtrack: a community-playlist song whose OWN album is named after the title and credited to the composer is no longer "community only"', () => {
  const m = mergeSoundtrack(null, [{ album: pl, tracks: [
    pt(1, 'Inferno', 'Fire Force Original Soundtrack', ['Kenichiro Suehiro']),
    pt(2, 'Random Pick', 'Some Compilation 2020', ['Someone']),
    pt(3, 'Look-alike', 'Fire Force Tribute', ['Cover Band']),
  ] }], { composers: ['Kenichiro Suehiro'], titles: ['Fire Force'] });
  const by = Object.fromEntries(m.sections.flatMap((s) => s.tracks).map((t) => [t.title, t]));
  assert.notEqual(by['Inferno']!.confidence, 'red'); assert.ok(by['Inferno']!.evidence.some((e) => e.source === 'deezer'));
  const jp = mergeSoundtrack(null, [{ album: pl, tracks: [pt(1, 'Inferno', '炎炎ノ音楽隊〜TVアニメ「炎炎ノ消防隊」オリジナルサウンドトラック〜', ['Mrs. GREEN APPLE'])] }], { composers: ['Kenichiro Suehiro'], titles: ['Fire Force', '炎炎ノ消防隊'] });
  assert.notEqual(jp.sections[0]!.tracks[0]!.confidence, 'red', 'a distinctive (Japanese) title in the song\'s album name is enough, even when the singer is not the composer');
  assert.equal(by['Random Pick']!.confidence, 'red'); assert.equal(by['Look-alike']!.confidence, 'red', 'right album name but not the composer');
});

test('buildMergedSoundtrack: Wikidata titles are added to the alternative titles (one slot after the TMDB ones) and a failing Wikidata is harmless', async () => {
  let seenAlts: string[] = [];
  const base = { wiki: async () => null, albums: async (_t: string, _y?: number, _e?: string[], alts: string[] = []) => { seenAlts = alts; return []; }, albumTracks: async () => [] };
  await buildMergedSoundtrack({ ...base, wikidata: async () => ['炎炎ノ消防隊', '炎炎消防队'] }, 'Fire Force', 2019, { alts: ['Enen no Shouboutai', 'Fire Brigade'] });
  assert.deepEqual(seenAlts.slice(0, 3), ['Enen no Shouboutai', 'Fire Brigade', '炎炎ノ消防隊']);
  await buildMergedSoundtrack({ ...base, wikidata: async () => { throw new Error('down'); } }, 'Fire Force', 2019, { alts: ['A'] });
  assert.deepEqual(seenAlts, ['A']);
});

test('GET /api/deezer-isrc: validates the id, returns the code, maps failures to 502, 503 when not configured', async () => {
  const mk = async (extra: object) => {
    const server = createApp({ providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: fileURLToPath(new URL('../web', import.meta.url)), ...extra } as never);
    await new Promise<void>((r) => server.listen(0, r));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  };
  const off = await mk({}); assert.equal((await fetch(`${off.base}/api/deezer-isrc?id=1`)).status, 503); await off.close();
  const on = await mk({ deezerIsrc: async (id: string) => { if (id === '2') throw new Error('boom'); return id === '1' ? 'JPW741900057' : null; } });
  assert.equal((await fetch(`${on.base}/api/deezer-isrc?id=abc`)).status, 400);
  assert.deepEqual(await (await fetch(`${on.base}/api/deezer-isrc?id=1`)).json(), { isrc: 'JPW741900057' });
  assert.deepEqual(await (await fetch(`${on.base}/api/deezer-isrc?id=3`)).json(), { isrc: null });
  assert.equal((await fetch(`${on.base}/api/deezer-isrc?id=2`)).status, 502);
  await on.close();
});
