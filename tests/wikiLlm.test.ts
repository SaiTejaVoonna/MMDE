import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaims, wikiLlmProvider } from '../src/providers/wikiLlm.ts';

const PAGE = `Season 1 used "Nameless Story" by Takuma Terashima as the opening theme and "Another Colony" by TRUE as the ending theme.`;
const NOW = '2026-10-08T00:00:00.000Z';
const item = (o: object) => ({ part: { kind: 'season', number: 1 }, role: 'opening', position: 'OP1', title: 'Nameless Story', artists: ['Takuma Terashima'], quote: '"Nameless Story" by Takuma Terashima as the opening theme', ...o });

test('keeps a claim whose quote is really in the page', () => {
  const c = parseClaims(JSON.stringify([item({})]), PAGE, 'https://en.wikipedia.org/wiki/X', NOW);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.evidence.provider, 'wikipedia+llm');
});

test('drops hallucinated claims: invented quote, quote without the title, bad role/part, junk JSON', () => {
  const bad = [
    item({ quote: 'Meguru Mono was the second opening of season one' }), // quote not in page
    item({ title: 'Totally Made Up Song' }), // quote does not mention the title
    item({ role: 'banger' }), // invalid role
    item({ part: { kind: 'galaxy' } }), // invalid part
    item({ quote: '' }),
  ];
  assert.equal(parseClaims(JSON.stringify(bad), PAGE, 'u', NOW).length, 0);
  assert.equal(parseClaims('sorry I cannot', PAGE, 'u', NOW).length, 0);
  assert.equal(parseClaims('[{broken', PAGE, 'u', NOW).length, 0);
});

test('tolerates prose around the JSON array', () => {
  const raw = `Here you go:\n${JSON.stringify([item({})])}\nHope that helps!`;
  assert.equal(parseClaims(raw, PAGE, 'u', NOW).length, 1);
});

test('provider: search -> extract -> LLM -> guarded claims (fake fetch + fake LLM)', async () => {
  const fakeFetch = (async (url: string) => {
    const u = String(url);
    const body = u.includes('list=search')
      ? { query: { search: [{ title: 'Slime season 1' }] } }
      : { query: { pages: { 1: { extract: PAGE } } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const p = wikiLlmProvider({ fetchImpl: fakeFetch, userAgent: 'test', now: () => NOW, complete: async () => JSON.stringify([item({}), item({ title: 'Fake', quote: 'Fake by nobody' })]) });
  const claims = await p.discover({ id: 'm', type: 'anime', title: 'Slime', altTitles: [], externalIds: {} });
  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.title, 'Nameless Story');
  assert.match(claims[0]!.evidence.url!, /en\.wikipedia\.org\/wiki\/Slime_season_1/);
});
