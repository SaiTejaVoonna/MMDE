(() => {
  const app = document.getElementById('app');
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  // Backend location comes from config.js (public setting, never a secret). '' = same origin as this page.
  const rawBase = (window.MMDE_CONFIG && typeof window.MMDE_CONFIG.apiBaseUrl === 'string') ? window.MMDE_CONFIG.apiBaseUrl.trim() : '';
  const API_BASE = rawBase.replace(/\/+$/, '');
  const baseValid = API_BASE === '' || /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/.test(API_BASE);
  const onStaticHost = /(^|\.)github\.io$/.test(location.hostname);
  const configProblem = !baseValid
    ? 'The backend URL in config.js is not a valid http(s) URL.'
    : (onStaticHost && !API_BASE ? 'This page is hosted statically and no backend URL is configured (apiBaseUrl in config.js).' : '');
  let backendName = 'this site';
  try { if (API_BASE && baseValid) backendName = new URL(API_BASE).host; } catch (e) { /* invalid; reported via configProblem */ }
  const call = async (path) => {
    if (configProblem) throw new Error(configProblem);
    let r;
    try { r = await fetch(API_BASE + path); }
    catch (e) { throw new Error('Cannot reach the MMDE backend (' + backendName + '). It may be offline, or it does not allow this website (CORS: MMDE_WEB_ORIGIN).'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 429) throw new Error('Too many requests. Please wait a few seconds and try again.');
    if (!r.ok) throw new Error(data.error || ('MMDE returned HTTP ' + r.status));
    return data;
  };
  // Phase 1 is the fast path: ask only TMDB (+ local seeds). If the server has no TMDB credential it falls back to all sources.
  const langName = (c) => { try { return c ? new Intl.DisplayNames(['en'], { type: 'language' }).of(c) : ''; } catch (e) { return ''; } };
  const search = async (q, deep) => {
    const data = await call('/api/search?q=' + encodeURIComponent(q) + '&sources=tmdb,local-seeds' + (deep ? '&deep=1' : ''));
    return { items: data.results || [], tmdbDown: (data.errors || []).some((e) => /^tmdb/i.test(String(e))) };
  };
  const IMG = 'https://image.tmdb.org/t/p/';
  const poster = (path, size, cls) => path
    ? el('img', { class: cls || 'poster', src: IMG + size + path, alt: '', loading: 'lazy' })
    : el('div', { class: (cls || 'poster') + ' noposter' }, '?');
  const mins = (n) => (n ? Math.floor(n / 60) + 'h ' + (n % 60) + 'm' : '');
  const chips = (list) => el('div', { class: 'meta' }, list.filter(Boolean).map((t) => el('span', { class: 'tag' }, t)));
  const filmGrid = (parts, currentId) => el('div', { class: 'postergrid' }, parts.map((p, i) =>
    el('button', { type: 'button', class: 'pcard' + (p.id === currentId ? ' current' : ''), onclick: () => showDetails({ id: p.id, type: 'movie', title: p.title }) },
      poster(p.posterPath, 'w342'),
      el('strong', {}, (i + 1) + '. ' + p.title),
      el('small', {}, (p.year || 'TBA') + (p.id === currentId ? ' · you are here' : ''))
    )));
  const musicCard = () => el('div', { class: 'card' }, el('h3', {}, 'Music'), el('p', { class: 'note' }, 'Soundtrack and song discovery for this title is the next step. Nothing is hosted or streamed here: it will link out to Spotify, Apple Music and YouTube.'));
  const showDetails = async (media) => {
    window.scrollTo(0, 0);
    const back = el('a', { href: '#/', onclick: (e) => { e.preventDefault(); backFn(); } }, '← Back');
    if (!/^tmdb-(tv|movie|collection)-\d+$/.test(media.id)) {
      app.replaceChildren(back,
        el('div', { class: 'card' }, el('h2', {}, media.title), chips([media.type, media.year])),
        el('div', { class: 'card' }, el('h3', {}, 'No details for this entry'), el('p', { class: 'note' }, 'This is a built-in sample entry. Go back and search again: when TMDB answers, the real result with posters, seasons and franchise films appears.')));
      return;
    }
    app.replaceChildren(back, el('div', { class: 'search-loading' }, el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })), el('span', { class: 'loading-label' }, 'Loading details...')));
    let d;
    try { d = await call('/api/details/' + encodeURIComponent(media.id)); }
    catch (e) { app.replaceChildren(back, el('div', { class: 'card warn' }, 'Could not load details: ' + e.message + ' (press Back and try again)')); return; }
    const hero = el('section', { class: 'dhero', style: d.backdropPath ? 'background-image:linear-gradient(90deg,rgba(8,11,20,.97) 25%,rgba(8,11,20,.72)),url(' + IMG + 'w780' + d.backdropPath + ')' : '' },
      poster(d.posterPath, 'w342', 'dposter'),
      el('div', { class: 'dtext' },
        el('h2', {}, d.title),
        d.tagline ? el('p', { class: 'tagline' }, d.tagline) : null,
        chips([d.kind === 'collection' ? 'collection' : d.kind, d.year, mins(d.runtimeMin), d.voteAverage ? '★ ' + d.voteAverage : null, langName(d.originalLanguage), d.kind === 'collection' ? (d.parts || []).length + ' films' : null].concat(d.genres || [])),
        d.spokenLanguages && d.spokenLanguages.length ? el('p', { class: 'note' }, 'Spoken languages: ' + d.spokenLanguages.join(', ')) : null,
        d.overview ? el('p', { class: 'overview' }, d.overview) : null));
    const parts = [back, hero];
    if (d.kind === 'collection') {
      parts.push(el('div', { class: 'card' }, el('h3', {}, 'Films in release order'), el('p', { class: 'note' }, 'TMDB gives release order. Story (chronological) order is not in TMDB.'), filmGrid(d.parts || [], null)));
    }
    if (d.kind === 'movie' && d.collection) {
      parts.push(el('div', { class: 'card' },
        el('h3', {}, 'Part of ' + d.collection.name),
        el('p', { class: 'note' }, 'Release order'),
        filmGrid(d.parts || [], d.id),
        el('button', { type: 'button', class: 'chip', onclick: () => showDetails({ id: d.collection.id, type: 'collection', title: d.collection.name }) }, 'Open the whole ' + d.collection.name)));
    }
    if (d.kind === 'tv') {
      const seasons = d.seasons || [];
      parts.push(el('div', { class: 'card' }, el('h3', {}, 'Seasons'),
        el('div', { class: 'postergrid' }, seasons.map((s) => el('div', { class: 'pcard' },
          poster(s.posterPath, 'w342'),
          el('strong', {}, s.name || ('Season ' + s.seasonNumber)),
          el('small', {}, (s.episodeCount || 0) + ' episodes' + (s.airDate ? ' · ' + s.airDate.slice(0, 4) : '') + (s.voteAverage ? ' · ★ ' + s.voteAverage : '')))))));
    }
    parts.push(musicCard());
    app.replaceChildren(...parts);
  };
  let backFn = () => renderSearch('');
  let resultsCache = { q: '', r: null }; // tabs and Back reuse the last full search instead of asking TMDB again
  const TYPE_LABEL = { movie: 'Movie', tv: 'TV', collection: 'Collection', anime: 'Sample' };
  const metaLine = (m) => [TYPE_LABEL[m.type] || m.type, m.year, langName(m.originalLanguage)].filter(Boolean).join(' · ');
  const TMDB_WARN = 'TMDB could not be reached just now (network). Showing limited results - press Enter to search again.';

  // One search box used on the home page and the results page: live suggestions while typing, Enter = all results.
  const searchBox = (value, onAll, onPick) => {
    const input = el('input', { class: 'search', type: 'search', placeholder: 'Search a movie, TV show, anime or franchise...', autocomplete: 'off', 'aria-label': 'Search media', value });
    const box = el('div', { class: 'suggest', hidden: true, style: 'max-height:70vh;overflow-y:auto' });
    const wrap = el('div', { class: 'searchwrap' }, input, box);
    let seq = 0; let timer;
    const close = () => { seq++; box.hidden = true; box.replaceChildren(); };
    const note = (t) => el('div', { class: 'note', style: 'padding:12px 18px;margin:0' }, t);
    const suggest = async () => {
      const q = input.value.trim(); const my = ++seq;
      if (q.length < 2) { box.hidden = true; box.replaceChildren(); return; }
      box.hidden = false; box.replaceChildren(note('Searching...'));
      try {
        const { items, tmdbDown } = await search(q);
        if (my !== seq) return;
        box.replaceChildren();
        if (tmdbDown) box.append(note(TMDB_WARN));
        if (!items.length) { box.append(note(tmdbDown ? '' : 'No quick matches. Press Enter to search everything.')); return; }
        items.slice(0, 8).forEach((m) => box.append(el('button', { type: 'button', class: 'srow', onclick: () => { close(); onPick(m, input.value.trim()); } },
          m.posterPath ? el('img', { src: IMG + 'w92' + m.posterPath, alt: '', width: 40, height: 60, loading: 'lazy' }) : el('span', { class: 'sthumb' }),
          el('span', {}, m.title, el('small', {}, metaLine(m))))));
        box.append(el('button', { type: 'button', class: 'sall', onclick: () => { close(); onAll(q); } }, 'View all results for "' + q + '" →'));
      } catch (e) { if (my === seq) box.replaceChildren(note(e.message)); }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 350); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); const q = input.value.trim(); close(); if (q.length >= 2) onAll(q); }
      if (e.key === 'Escape') close();
    });
    document.addEventListener('click', (e) => { if (document.contains(wrap) && !wrap.contains(e.target)) close(); });
    return { wrap, input };
  };

  const showResults = async (q, filter) => {
    filter = filter || 'all';
    window.scrollTo(0, 0);
    const sb = searchBox(q, (x) => showResults(x, 'all'), (m, typed) => { backFn = () => showResults(q, filter); showDetails(m); });
    const home = el('a', { href: '#/', onclick: (e) => { e.preventDefault(); renderSearch(''); } }, '← Home');
    const body = el('div', {});
    app.replaceChildren(home, el('div', { style: 'margin:14px 0 6px' }, sb.wrap), body);
    let r = resultsCache.q === q ? resultsCache.r : null;
    if (!r) {
      body.append(el('div', { class: 'search-loading' }, el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })), el('span', { class: 'loading-label' }, 'Searching everything...')));
      try { r = await search(q, true); } catch (e) { body.replaceChildren(el('div', { class: 'card warn' }, e.message)); return; }
      if (!r.tmdbDown) resultsCache = { q, r };
    }
    const items = r.items;
    const count = (t) => items.filter((m) => m.type === t).length;
    const tabs = [['all', 'All', items.length], ['movie', 'Movies', count('movie')], ['tv', 'TV shows', count('tv')], ['collection', 'Collections', count('collection')]].filter((t) => t[0] === 'all' || t[2] > 0);
    const shown = filter === 'all' ? items : items.filter((m) => m.type === filter);
    body.replaceChildren(...[
      el('h2', { style: 'margin:8px 0' }, 'Results for "' + q + '"'),
      r.tmdbDown ? el('div', { class: 'note' }, TMDB_WARN) : null,
      el('div', { class: 'chips fchips' }, tabs.map((t) => el('button', { type: 'button', class: 'chip' + (t[0] === filter ? ' active' : ''), onclick: () => showResults(q, t[0]) }, t[1] + ' ' + t[2]))),
      shown.length
        ? el('div', { class: 'rgrid' }, shown.map((m) => el('button', { type: 'button', class: 'rcard', onclick: () => { backFn = () => showResults(q, filter); showDetails(m); } },
            poster(m.posterPath, 'w185'),
            el('span', { class: 'rtext' }, el('strong', {}, m.title), el('small', {}, metaLine(m)), m.overview ? el('span', { class: 'rover' }, m.overview) : null))))
        : el('p', { class: 'note' }, 'Nothing found. Try fewer words, or add a language or year, like "kalki hindi 2024".')].filter(Boolean));
  };

  const renderSearch = (initial) => {
    window.scrollTo(0, 0);
    const sb = searchBox(initial || '', (q) => showResults(q, 'all'), (m, typed) => { backFn = () => renderSearch(typed); showDetails(m); });
    const backend = el('div', { class: 'note backend-status', id: 'backend-status' }, configProblem || 'Checking backend...');
    if (!configProblem) {
      call('/api/health').then((h) => {
        backend.textContent = 'Backend: online (' + backendName + ')' + (h.tmdb ? '' : ' - TMDB is not configured on the server, so title search is limited and seasons are unavailable');
      }).catch((e) => { backend.textContent = e.message; });
    }
    app.replaceChildren(
      el('section', { class: 'hero' },
        el('h1', {}, 'Know the Title.', el('br'), el('em', {}, 'Discover the Music.')),
        el('p', {}, 'Search any movie, TV show, anime or franchise. Pick it, then pick a film or season, then discover its music.'),
        sb.wrap,
        backend,
        el('div', { class: 'note try-label' }, 'Try searching'),
        el('div', { class: 'chips' }, ['That Time I Got Reincarnated as a Slime', 'Star Wars', 'Bahubali', 'Jujutsu Kaisen', 'Attack on Titan'].map((t) => el('button', { class: 'chip', type: 'button', onclick: () => showResults(t, 'all') }, t))),
        el('div', { class: 'note mode-note' }, 'TMDB credentials stay on the MMDE server and are never stored in this page.')
      )
    );
    sb.input.focus();
    if (initial) sb.input.setSelectionRange(initial.length, initial.length);
  };
  renderSearch('');
})();