import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/app/discover.ts';
import { organize, render } from '../src/app/organize.ts';
import { curatedProvider, loadSeed } from '../src/providers/curated.ts';
import type { DiscoveryProvider, RecordingResolver } from '../src/providers/types.ts';
import type { Media, TrackClaim } from '../src/domain/types.ts';

const media: Media = { id: 'm', type: 'anime', title: 'Test Show', altTitles: [], externalIds: {} };
const fakeProvider = (name: string, claims: Array<Partial<TrackClaim> & Pick<TrackClaim, 'title' | 'artists'>>): DiscoveryProvider => ({
  name,
  async discover() {
    return claims.map((c) => ({
      part: { kind: 'season', number: 1 }, role: 'opening', evidence: { provider: name, fetchedAt: '1970-01-01T00:00:00.000Z' }, ...c,
    }));
  },
});
const goodResolver: RecordingResolver = {
  name: 'fake-mb',
  async resolve(title, artists) {
    return [{ title, artists, mbid: 'mbid-1', isrcs: ['JPXX00000001'], source: 'fake-mb' }];
  },
};

test('single source, no resolver -> unverified', async () => {
  const { tracks } = await discover(media, [fakeProvider('a', [{ title: 'Song', artists: ['X'] }])]);
  assert.equal(tracks[0]!.status, 'unverified');
});

test('single source + good recording match -> suggested, never confirmed', async () => {
  const { tracks } = await discover(media, [fakeProvider('a', [{ title: 'Song', artists: ['X'] }])], goodResolver);
  assert.equal(tracks[0]!.status, 'suggested');
  assert.equal(tracks[0]!.recording?.mbid, 'mbid-1');
});

test('two agreeing sources + recording match -> confirmed, evidence merged', async () => {
  const { tracks } = await discover(
    media,
    [fakeProvider('a', [{ title: 'Song', artists: ['X'] }]), fakeProvider('b', [{ title: 'Song (TV Size)', artists: ['X'] }, { title: 'Song', artists: ['X'] }])],
    goodResolver,
  );
  const original = tracks.find((t) => t.version === 'original')!;
  assert.equal(original.status, 'confirmed');
  assert.equal(original.evidence.length, 2);
  // the TV-size claim stays a separate track, not merged into the original
  assert.ok(tracks.some((t) => t.version === 'tv_size'));
});

test('a failing provider does not abort discovery', async () => {
  const boom: DiscoveryProvider = { name: 'boom', async discover() { throw new Error('down'); } };
  const { tracks, errors } = await discover(media, [boom, fakeProvider('a', [{ title: 'Song', artists: ['X'] }])]);
  assert.equal(tracks.length, 1);
  assert.match(errors[0]!, /boom: down/);
});

test('organize groups by part then role in a stable order', async () => {
  const { tracks } = await discover(media, [
    fakeProvider('a', [
      { title: 'End', artists: ['X'], role: 'ending', position: 'ED1' },
      { title: 'Open', artists: ['X'], role: 'opening', position: 'OP1' },
      { title: 'S2 Open', artists: ['X'], role: 'opening', part: { kind: 'season', number: 2 } },
    ]),
  ]);
  const g = organize(tracks);
  assert.deepEqual(g.map((p) => p.part), ['Season 1', 'Season 2']);
  assert.deepEqual(g[0]!.roles.map((r) => r.role), ['Openings', 'Endings']);
});

test('slime sample seed loads, renders, and is only ever "unverified" offline', async () => {
  const seed = await loadSeed(new URL('../data/seeds/slime.sample.json', import.meta.url).pathname);
  const { tracks } = await discover(seed.media, [curatedProvider(seed)]);
  assert.equal(tracks.length, 4);
  assert.ok(tracks.every((t) => t.status === 'unverified'));
  const out = render(seed.media, tracks);
  assert.match(out, /Season 1/);
  assert.match(out, /OP1: Nameless Story/);
  assert.match(seed._status ?? '', /UNVERIFIED/);
});
