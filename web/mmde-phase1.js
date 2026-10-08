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
  const search = async (q) => {
    const data = await call('/api/search?q=' + encodeURIComponent(q) + '&sources=tmdb,local-seeds');
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
    const back = el('a', { href: '#/', onclick: (e) => { e.preventDefault(); renderSearch(); } }, '← Back to search');
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
  const renderSearch = () => {
    const input = el('input', { class: 'search', type: 'search', placeholder: 'Search a movie, anime or TV show...', autocomplete: 'off', 'aria-label': 'Search media' });
    const status = el('div', { class: 'note search-status' });
    const loading = el('div', { class: 'search-loading', hidden: true },
      el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })),
      el('span', { class: 'loading-label' }, 'Searching MMDE...')
    );
    const results = el('div', { class: 'suggest', style: 'max-height:70vh;overflow-y:auto' });
    const backend = el('div', { class: 'note backend-status', id: 'backend-status' }, configProblem || 'Checking backend...');
    if (!configProblem) {
      call('/api/health').then((h) => {
        backend.textContent = 'Backend: online (' + backendName + ')' + (h.tmdb ? '' : ' - TMDB is not configured on the server, so title search is limited and seasons are unavailable');
      }).catch((e) => { backend.textContent = e.message; });
    }
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      loading.hidden = false; status.textContent = ''; results.replaceChildren();
      try {
        const { items, tmdbDown } = await search(q);
        loading.hidden = true;
        const warn = 'TMDB could not be reached just now (network). Showing limited results - press Enter to search again.';
        if (!items.length) { status.textContent = tmdbDown ? warn : 'No matches found.'; return; }
        if (tmdbDown) { status.textContent = warn; results.append(el('div', { class: 'note', style: 'padding:8px 14px' }, warn)); }
        results.append(...items.map(m => el('button', { type: 'button', style: 'display:flex;gap:12px;align-items:center', onclick: () => showDetails(m) },
          m.posterPath ? el('img', { src: 'https://image.tmdb.org/t/p/w92' + m.posterPath, alt: '', width: 40, height: 60, loading: 'lazy', style: 'border-radius:6px;flex:0 0 auto;object-fit:cover' }) : null,
          el('span', {}, m.title, el('small', {}, m.type + (m.year ? ' · ' + m.year : '') + (langName(m.originalLanguage) ? ' · ' + langName(m.originalLanguage) : '')))
        )));
      } catch (e) {
        loading.hidden = true; status.textContent = e.message;
      }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    app.replaceChildren(
      el('section', { class: 'hero' },
        el('h1', {}, 'Know the Title.', el('br'), el('em', {}, 'Discover the Music.')),
        el('p', {}, 'Search a title. MMDE identifies it first, then lets you choose a season before music discovery.'),
        el('div', { class: 'searchwrap' }, input, results),
        loading, status, backend,
        el('div', { class: 'note try-label' }, 'Try searching'),
        el('div', { class: 'chips' }, ['That Time I Got Reincarnated as a Slime','Jujutsu Kaisen','Attack on Titan','Naruto'].map(t => el('button', { class: 'chip', type: 'button', onclick: () => { input.value = t; run(); } }, t))),
        el('div', { class: 'note mode-note' }, 'TMDB credentials stay on the MMDE server and are never stored in this page.')
      )
    );
    input.focus();
  };
  renderSearch();
})();