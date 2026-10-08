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
  const search = async (q) => {
    const data = await call('/api/search?q=' + encodeURIComponent(q) + '&sources=tmdb,local-seeds');
    return { items: data.results || [], tmdbDown: (data.errors || []).some((e) => /^tmdb/i.test(String(e))) };
  };
  const showSeasons = async (media) => {
    app.replaceChildren(
      el('a', { href: '#/', onclick: e => { e.preventDefault(); renderSearch(); } }, '← Back to search'),
      el('div', { class: 'card' }, el('h2', {}, media.title), el('div', { class: 'meta' }, el('span', { class: 'tag' }, media.type), media.year ? el('span', { class: 'tag' }, media.year) : null)),
      el('div', { class: 'search-loading' }, el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })), el('span', { class: 'loading-label' }, media.type === 'tv' ? 'Loading seasons...' : (media.type === 'movie' ? 'Movie selected' : 'Sample entry selected')))
    );
    if (media.type !== 'tv') {
      const isMovie = media.type === 'movie';
      app.append(el('div', { class: 'card' },
        el('h3', {}, isMovie ? 'Movie' : 'No season data'),
        el('p', { class: 'note' }, isMovie ? 'Movies do not have seasons.' : 'This is a built-in sample entry. Go back and search again: when TMDB answers, the real TV result with seasons appears.')));
      return;
    }
    try {
      const data = await call('/api/seasons/' + encodeURIComponent(media.id));
      const seasons = data.seasons || [];
      const loadingEl = app.querySelector('.search-loading'); if (loadingEl) loadingEl.remove();
      app.append(el('div', { class: 'card' },
        el('h3', {}, 'Seasons'),
        el('div', { class: 'chips' }, seasons.map(s => el('button', { class: 'chip', type: 'button' },
          el('strong', {}, s.name || ('Season ' + s.seasonNumber)),
          ' ',
          el('span', {}, ' · ' + (s.episodeCount || 0) + ' episodes' + (s.airDate ? ' · ' + s.airDate.slice(0,4) : ''))
        )))
      ));
    } catch (e) {
      const loadingEl = app.querySelector('.search-loading'); if (loadingEl) loadingEl.remove();
      app.append(el('div', { class: 'card warn' }, 'Could not load seasons: ' + e.message));
    }
  };
  const renderSearch = () => {
    const input = el('input', { class: 'search', type: 'search', placeholder: 'Search a movie, anime or TV show...', autocomplete: 'off', 'aria-label': 'Search media' });
    const status = el('div', { class: 'note search-status' });
    const loading = el('div', { class: 'search-loading', hidden: true },
      el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })),
      el('span', { class: 'loading-label' }, 'Searching MMDE...')
    );
    const results = el('div', { class: 'suggest' });
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
        if (tmdbDown) status.textContent = warn;
        results.append(...items.map(m => el('button', { type: 'button', onclick: () => showSeasons(m) },
          m.title, el('small', {}, m.type + (m.year ? ' · ' + m.year : ''))
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