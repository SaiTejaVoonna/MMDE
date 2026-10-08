import { firstYear } from '../text.js';

// Wikipedia search: keyless, CORS via origin=*. Natural-language friendly and follows redirects, so
// "bahubali", "tensura" and "og telugu film" all land on the right article. One request returns
// title + short description + thumbnail. Text is CC BY-SA: keep the article link.
const API = 'https://en.wikipedia.org/w/api.php';
const WORK = /film|movie|series|television|anime|animation|animated|\bova\b|video game|miniseries|web series|show|documentary|cartoon|light novel|manga|novel|musical|sitcom|drama/i;

export function inferKind(desc) {
  const d = String(desc ?? '').toLowerCase();
  if (/anime|animated|original video animation|\bova\b/.test(d)) return 'anime';
  if (/video game/.test(d)) return 'game';
  if (/television|tv series|web series|miniseries|sitcom|\bshow\b/.test(d)) return 'tv';
  if (/\bfilm\b|\bmovie\b/.test(d)) return 'movie';
  if (/novel|manga/.test(d)) return 'book';
  return 'other';
}

export function inferLanguage(desc) {
  const m = /\b([A-Z][a-z]+)-language\b/.exec(String(desc ?? ''));
  return m ? m[1] : undefined;
}

export function mapWikipediaPages(pages) {
  return Object.values(pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((p) => WORK.test(p.description ?? ''))
    .map((p) => ({
      id: `wikipedia:${p.pageid}`,
      kind: inferKind(p.description),
      title: p.title,
      altTitles: [],
      year: firstYear(p.description),
      language: inferLanguage(p.description),
      description: p.description ?? '',
      poster: p.thumbnail?.source,
      sources: { wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` },
      wikiTitle: p.title,
    }));
}

const TYPE_WORD = { movie: 'film', tv: 'television series', anime: 'anime', game: 'video game' };

export async function searchWikipedia(parsed, fetchImpl) {
  const q = [parsed.text, parsed.lang, TYPE_WORD[parsed.type]].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: q, gsrlimit: '20', gsrnamespace: '0',
    prop: 'description|pageimages', piprop: 'thumbnail', pithumbsize: '120', redirects: '1',
  });
  const res = await fetchImpl(`${API}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
  const j = await res.json();
  return mapWikipediaPages(j.query?.pages);
}

export async function getWikipediaSummary(title, fetchImpl) {
  const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'extracts', exintro: '1', explaintext: '1', exchars: '700', titles: title, redirects: '1' });
  const res = await fetchImpl(`${API}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
  const j = await res.json();
  return Object.values(j.query?.pages ?? {})[0]?.extract ?? '';
}
