import test from 'node:test';
import assert from 'node:assert/strict';
import { animeThemesProvider } from '../src/providers/animethemes.ts';
import { collectClaims } from '../src/app/discover.ts';
import type { Media } from '../src/domain/types.ts';

const fetchJson = (body: unknown): typeof fetch => (async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
) as typeof fetch;

test('AnimeThemes maps structured OP/ED records into MMDE claims', async () => {
  const provider = animeThemesProvider(fetchJson({
    data: { findAnimeByExternalSite: [{
      id: 1,
      name: 'Test Anime',
      slug: 'test-anime',
      animethemes: [
        { id: 10, type: 'OP', sequence: 1, song: { id: 20, title: 'Opening Song', artists: [{ id: 30, name: 'Artist A' }] }, animethemeentries: [{ episodes: '1-12' }] },
        { id: 11, type: 'ED', sequence: 1, song: { id: 21, title: 'Ending Song', artists: [{ id: 31, name: 'Artist B' }] } },
      ],
    }] },
  }));
  const media: Media = { id: 'a', type: 'anime', title: 'Test Anime', altTitles: [], externalIds: { mal: '1' }, partRef: { kind: 'season', number: 2 } };
  const claims = await provider.discover(media);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((x) => [x.role, x.position, x.title, x.artists, x.part.kind, x.part.number]), [
    ['opening', 'OP1', 'Opening Song', ['Artist A'], 'season', 2],
    ['ending', 'ED1', 'Ending Song', ['Artist B'], 'season', 2],
  ]);
});

test('discovery fans out to related productions', async () => {
  const media: Media = {
    id: 'root', type: 'anime', title: 'Root', altTitles: [], externalIds: {},
    relatedMedia: [
      { id: 's2', type: 'anime', title: 'Root 2nd Season', altTitles: [], externalIds: {}, partRef: { kind: 'season', number: 2 } },
      { id: 'movie', type: 'anime', title: 'Root Movie', altTitles: [], externalIds: {}, partRef: { kind: 'movie' } },
    ],
  };
  const seen: string[] = [];
  const provider = { name: 'test', async discover(target: Media) {
    seen.push(target.id);
    return [{ part: target.partRef ?? { kind: 'whole' }, role: 'opening' as const, position: 'OP1', title: target.title, artists: ['A'], evidence: { provider: 'test', fetchedAt: '1970-01-01T00:00:00.000Z' } }];
  }};
  const result = await collectClaims(media, [provider]);
  assert.deepEqual(seen, ['root', 's2', 'movie']);
  assert.equal(result.claims.length, 3);
});
