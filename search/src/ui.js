import { getDetail, searchAll } from './search.js';

// Plain DOM, no innerHTML: every dynamic string goes through textContent.
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};
const safe = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const KEY = 'mmde.search.tmdbKey';
const store = {
  get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* blocked storage */ } },
};
const LABEL = { anime: 'Anime', movie: 'Movie', tv: 'TV', game: 'Game', book: 'Book', other: 'Other' };

function card(r, onOpen) {
  const link = (name, url) => { const h = safe(url); return h ? el('a', { class: 'src', href: h, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, name) : null; };
  return el('li', { class: 'card', tabindex: '0', role: 'button', onclick: () => onOpen(r), onkeydown: (e) => { if (e.key === 'Enter') onOpen(r); } },
    r.poster && safe(r.poster) ? el('img', { class: 'poster', src: safe(r.poster), alt: '', loading: 'lazy' }) : el('div', { class: 'poster ph' }, (r.title[0] || '?').toUpperCase()),
    el('div', { class: 'meta' },
      el('div', { class: 'title' }, r.title),
      el('div', { class: 'sub' }, [LABEL[r.kind] || r.kind, r.year, r.language, r.format && r.format !== 'TV' ? r.format : null, r.episodes ? `${r.episodes} eps` : null].filter(Boolean).join(' · ')),
      r.description ? el('div', { class: 'desc' }, r.description) : null,
      el('div', { class: 'srcs' }, link('AniList', r.sources.anilist), link('Wikipedia', r.sources.wikipedia), link('TMDB', r.sources.tmdb))));
}

function group(title, items, noteFn) {
  if (!items?.length) return null;
  return el('section', {}, el('h3', {}, title, el('span', { class: 'count' }, ` ${items.length}`)),
    el('ol', { class: 'rows' }, items.map((s, i) => el('li', { class: 'row' },
      el('span', { class: 'num' }, noteFn ? noteFn(s, i) : String(i + 1)),
      el('div', {}, el('div', { class: 'title' }, safe(s.url) ? el('a', { href: safe(s.url), target: '_blank', rel: 'noopener noreferrer' }, s.title) : s.title),
        el('div', { class: 'sub' }, [s.year, s.format, s.episodes ? `${s.episodes} episodes` : null, s.status ? s.status.toLowerCase().replace('_', ' ') : null].filter(Boolean).join(' · ')))))));
}

export function mount(root) {
  const input = el('input', { id: 'q', class: 'search', type: 'search', placeholder: 'Search an anime, movie or show... (try: tensura, og telugu movie, bahubali)', autocomplete: 'off', 'aria-label': 'Search' });
  const status = el('div', { id: 'status', class: 'status' });
  const list = el('ul', { id: 'results', class: 'cards' });
  const detail = el('div', { id: 'detail', hidden: true });
  const keyInput = el('input', { id: 'tmdbkey', type: 'password', placeholder: 'optional TMDB API key', autocomplete: 'off' });
  keyInput.value = store.get();
  const keyMsg = el('span', { class: 'note' });
  const settings = el('details', { class: 'settings' }, el('summary', {}, 'Settings (optional)'),
    el('p', { class: 'note' }, 'AniList and Wikipedia need no key. Add your own free TMDB key to also search TMDB (best for movies, TV and Indian cinema, and gives TV seasons). It stays in this browser only.'),
    el('p', { class: 'note' }, el('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener noreferrer' }, 'Get a free TMDB key')),
    keyInput, el('button', { class: 'btn', type: 'button', onclick: () => { store.set(keyInput.value.trim()); keyMsg.textContent = 'Saved. Search again.'; } }, 'Save'), ' ', keyMsg);

  let seq = 0;
  let timer = 0;
  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    detail.hidden = true; list.hidden = false;
    if (q.length < 2) { list.replaceChildren(); status.textContent = ''; return; }
    status.textContent = 'Searching...';
    const out = await searchAll(q, { tmdbKey: store.get() });
    if (mine !== seq) return;
    list.replaceChildren(...out.results.map((r) => card(r, open)));
    const parts = out.notes.map((n) => (n.skipped ? `${n.source} off` : n.ok ? `${n.source} ${n.count}` : `${n.source} FAILED: ${n.error}`));
    const hint = [out.parsed.lang && `language: ${out.parsed.lang}`, out.parsed.type && `type: ${out.parsed.type}`].filter(Boolean).join(', ');
    status.textContent = `${out.results.length} results${hint ? ` (${hint})` : ''} · ${parts.join(' · ')}`;
    if (!out.results.length) list.replaceChildren(el('li', { class: 'empty' }, 'No results. Check the sources above for errors, or try another spelling.'));
  };

  async function open(r) {
    list.hidden = true;
    detail.hidden = false;
    detail.replaceChildren(el('button', { class: 'btn ghost', type: 'button', onclick: () => { detail.hidden = true; list.hidden = false; } }, '← Results'), el('p', { class: 'note' }, 'Loading details...'));
    const d = await getDetail(r, { tmdbKey: store.get() });
    const f = d.franchise;
    detail.replaceChildren(...[
      el('button', { class: 'btn ghost', type: 'button', onclick: () => { detail.hidden = true; list.hidden = false; } }, '← Results'),
      el('div', { class: 'head' },
        r.poster && safe(r.poster) ? el('img', { class: 'poster big', src: safe(r.poster), alt: '' }) : null,
        el('div', {}, el('h2', {}, r.title), el('div', { class: 'sub' }, [LABEL[r.kind] || r.kind, r.year, r.language].filter(Boolean).join(' · ')),
          r.altTitles?.length ? el('div', { class: 'sub' }, 'Also: ' + r.altTitles.slice(0, 5).join(' · ')) : null,
          el('p', {}, d.summary || r.description || ''))),
      f ? el('div', {}, group('Seasons', f.seasons, (s, i) => `S${i + 1}`), el('p', { class: 'note' }, 'AniList lists each cour/part as its own entry, so a "season" here can be a part of one.'), group('Movies', f.movies), group('OVAs, specials & more', f.other)) : null,
      d.tmdbSeasons ? group('TMDB seasons', d.tmdbSeasons.map((s) => ({ title: s.title, year: s.year, episodes: s.episodes })), (s, i) => String(d.tmdbSeasons[i].number)) : null,
      d.notes.length ? el('p', { class: 'warn' }, d.notes.join(' | ')) : null].filter(Boolean));
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
  root.replaceChildren(
    el('h1', {}, 'MMDE ', el('small', {}, 'search')),
    el('p', { class: 'note' }, 'Phase 1: find the title. Anime show seasons. No music yet.'),
    input, status, list, detail, settings,
    el('p', { class: 'foot' }, 'Data: AniList (anilist.co), Wikipedia (CC BY-SA), optional TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.'));
  input.focus();
}
