import test from 'node:test';
import assert from 'node:assert/strict';
import { jikanResolver } from '../src/providers/jikan.ts';
import { wikipediaResolver } from '../src/providers/wikipedia.ts';

const fake = (body: unknown): typeof fetch => (async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
) as typeof fetch;

test('Jikan resolves anime aliases such as Tensura', async () => {
  const resolver = jikanResolver(fake({
    data: [{
      mal_id: 37430,
      title: 'Tensei shitara Slime Datta Ken',
      title_english: 'That Time I Got Reincarnated as a Slime',
      title_japanese: '転生したらスライムだった件',
      title_synonyms: ['Tensura'],
      type: 'TV',
      year: 2018
    }]
  }));
  const results = await resolver.search('Tensura');
  assert.equal(results[0]?.title, 'That Time I Got Reincarnated as a Slime');
  assert.ok(results[0]?.altTitles.includes('Tensura'));
});

test('Wikipedia provides broad media results such as films', async () => {
  const resolver = wikipediaResolver(fake({
    query: { search: [{ pageid: 1, title: 'Baahubali: The Beginning', snippet: '2015 Indian Telugu-language epic action film' }] }
  }));
  const results = await resolver.search('Baahubali');
  assert.equal(results[0]?.title, 'Baahubali: The Beginning');
  assert.equal(results[0]?.type, 'movie');
});
