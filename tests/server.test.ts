import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import { curatedProvider, loadSeed } from '../src/providers/curated.ts';
import { seedMediaResolver } from '../src/providers/seeds.ts';
import { buildLinks } from '../src/links/platforms.ts';
import type { LinkResolver, RecordingResolver } from '../src/providers/types.ts';

const here = (p: string) => new URL(p, import.meta.url).pathname;

async function boot(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const seed = await loadSeed(here('../data/seeds/slime.sample.json'));
  const server = createApp({
    providers: [curatedProvider(seed)], mediaResolvers: [seedMediaResolver([seed])], linkResolvers: [],
    store: jsonStore(), webRoot: here('../web'), ...extra,
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seed, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const j = async (url: string, init?: RequestInit) => ({ status: (await fetch(url, init)).status, body: null as any });
async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  return { status: r.status, body: (await r.json()) as any };
}

test('search -> discover -> job progress -> organized result', async () => {
  const s = await boot();
  try {
    const found = await getJson(`${s.base}/api/search?q=slime`);
    assert.equal(found.body.results[0].id, 'slime');

    const started = await getJson(`${s.base}/api/discover`, { method: 'POST', body: JSON.stringify({ media: found.body.results[0] }) });
    assert.equal(started.status, 202);

    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await getJson(`${s.base}/api/jobs/${started.body.jobId}`)).body;
      if (job.state !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(job.state, 'done');
    assert.deepEqual(job.steps.map((x: any) => x.state), ['done', 'done', 'done', 'done', 'done']);

    const res = (await getJson(`${s.base}/api/media/slime`)).body;
    assert.equal(res.tracks.length, 5);
    assert.equal(res.groups[0].part, 'Season 1');
    assert.equal(res.releases.length, 1);
    assert.equal(res.releases[0].kind, 'ost');
    // every track has all five platform links and they are search links offline
    for (const t of res.tracks) {
      assert.equal(t.links.length, 5);
      assert.ok(t.links.every((l: any) => l.kind === 'search' && l.url.startsWith('https://')));
    }
  } finally { await s.close(); }
});

test('AniList-style media (different id) still matches the seed by title', async () => {
  const s = await boot();
  try {
    const media = { id: 'anilist-37430', type: 'anime', title: 'That Time I Got Reincarnated as a Slime', altTitles: [], externalIds: { anilist: '37430' } };
    const started = await getJson(`${s.base}/api/discover`, { method: 'POST', body: JSON.stringify({ media }) });
    for (let i = 0; i < 50; i++) {
      const job = (await getJson(`${s.base}/api/jobs/${started.body.jobId}`)).body;
      if (job.state !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const res = (await getJson(`${s.base}/api/media/anilist-37430`)).body;
    assert.equal(res.tracks.length, 5);
  } finally { await s.close(); }
});

test('rejects invalid discover bodies and unknown ids', async () => {
  const s = await boot();
  try {
    assert.equal((await getJson(`${s.base}/api/discover`, { method: 'POST', body: JSON.stringify({ media: { id: 1 } }) })).status, 400);
    assert.equal((await getJson(`${s.base}/api/discover`, { method: 'POST', body: '{not json' })).status, 400);
    assert.equal((await getJson(`${s.base}/api/media/nope`)).status, 404);
    assert.equal((await getJson(`${s.base}/api/jobs/nope`)).status, 404);
  } finally { await s.close(); }
});

test('static files served; path traversal blocked', async () => {
  const s = await boot();
  try {
    const home = await fetch(`${s.base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /MMDE/);
    for (const bad of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json']) {
      const r = await fetch(`${s.base}${bad}`);
      assert.notEqual(r.status, 200, bad);
    }
  } finally { await s.close(); }
});

test('a failing recording resolver / link resolver degrades instead of failing the job', async () => {
  const boom: RecordingResolver = { name: 'mb-down', async resolve() { throw new Error('503'); } };
  const boomLinks: LinkResolver = { name: 'deezer-down', async resolve() { throw new Error('403'); } };
  const s = await boot({ recordingResolver: boom, linkResolvers: [boomLinks] });
  try {
    const started = await getJson(`${s.base}/api/discover`, { method: 'POST', body: JSON.stringify({ media: s.seed.media }) });
    let job: any;
    for (let i = 0; i < 100; i++) {
      job = (await getJson(`${s.base}/api/jobs/${started.body.jobId}`)).body;
      if (job.state !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(job.state, 'done');
    const res = (await getJson(`${s.base}/api/media/slime`)).body;
    assert.ok(res.errors.some((e: string) => e.includes('mb-down')));
    assert.ok(res.errors.some((e: string) => e.includes('deezer-down')));
    assert.equal(res.tracks.length, 5);
  } finally { await s.close(); }
});

test('buildLinks prefers resolved links and falls back to search links', () => {
  const links = buildLinks({ title: 'Nameless Story', artists: ['Takuma Terashima'] }, [{ platform: 'deezer', url: 'https://www.deezer.com/track/1', kind: 'resolved', id: '1' }]);
  assert.equal(links.find((l) => l.platform === 'deezer')!.kind, 'resolved');
  assert.equal(links.find((l) => l.platform === 'spotify')!.kind, 'search');
  assert.match(links.find((l) => l.platform === 'youtubeMusic')!.url, /music\.youtube\.com\/search\?q=Nameless%20Story/);
});
