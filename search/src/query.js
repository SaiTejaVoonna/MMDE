// "og telugu movie" -> { text: "og", lang: "telugu", type: "movie" }
// Language/type words are hints (used to filter and rank), not part of the title.
const LANGS = new Set(['telugu', 'hindi', 'tamil', 'malayalam', 'kannada', 'bengali', 'marathi', 'punjabi', 'english', 'japanese', 'korean', 'chinese']);
const TYPES = { movie: 'movie', movies: 'movie', film: 'movie', films: 'movie', anime: 'anime', cartoon: 'anime', series: 'tv', show: 'tv', shows: 'tv', tv: 'tv', serial: 'tv', game: 'game', games: 'game' };

export function parseQuery(raw) {
  const original = String(raw ?? '').trim();
  const tokens = original.split(/\s+/).filter(Boolean);
  let lang = null;
  let type = null;
  const rest = [];
  for (const tok of tokens) {
    const w = tok.toLowerCase();
    if (!lang && LANGS.has(w)) lang = w;
    else if (!type && TYPES[w]) type = TYPES[w];
    else rest.push(tok);
  }
  // A query made only of hint words ("anime", "telugu") is treated as a plain title search.
  if (rest.length === 0) return { original, text: original, lang: null, type: null };
  return { original, text: rest.join(' '), lang, type };
}
