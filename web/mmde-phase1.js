(() => {
  const app = document.getElementById('app');
  const KEY = 'mmde.tmdbToken.v1';
  const getToken = () => localStorage.getItem(KEY) || '';
  const setToken = (v) => localStorage.setItem(KEY, v);
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
  const api = async (path) => {
    const token = getToken();
    if (!token) throw new Error('Add your TMDB API Read Access Token in Settings first.');
    const r = await fetch('https://api.themoviedb.org/3' + path, {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.status_message || ('TMDB returned HTTP ' + r.status));
    return data;
  };
  const search = async (q) => {
    const query = encodeURIComponent(q);
    const [tv, movies] = await Promise.all([
      api('/search/tv?query=' + query + '&include_adult=false&language=en-US&page=1'),
      api('/search/movie?query=' + query + '&include_adult=false&language=en-US&page=1')
    ]);
    const tvResults = (tv.results || []).slice(0, 8).map(x => ({
      id: 'tmdb-tv-' + x.id, tmdbId: x.id, type: 'tv',
      title: x.name || x.original_name, year: x.first_air_date ? x.first_air_date.slice(0, 4) : '',
      poster: x.poster_path
    }));
    const movieResults = (movies.results || []).slice(0, 5).map(x => ({
      id: 'tmdb-movie-' + x.id, tmdbId: x.id, type: 'movie',
      title: x.title || x.original_title, year: x.release_date ? x.release_date.slice(0, 4) : '',
      poster: x.poster_path
    }));
    return [...tvResults, ...movieResults];
  };
  const showSettings = (message = '') => {
    const token = getToken();
    const input = el('input', { type: 'password', value: token, placeholder: 'TMDB API Read Access Token', autocomplete: 'off', style: 'width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text)' });
    const msg = el('span', { class: 'note' }, message);
    app.append(el('details', { class: 'card' },
      el('summary', {}, 'Settings'),
      el('p', { class: 'note' }, 'TMDB provides the fast title search and season data. Your token is stored only in this browser.'),
      input,
      el('div', {}, el('button', { class: 'btn', type: 'button', onclick: () => { setToken(input.value.trim()); msg.textContent = 'Saved. Search is ready.'; } }, 'Save'), ' ', msg)
    ));
  };
  const renderSearch = () => {
    const input = el('input', { class: 'search', type: 'search', placeholder: 'Search a movie, anime or TV show...', autocomplete: 'off', 'aria-label': 'Search media' });
    const status = el('div', { class: 'note search-status' });
    const loading = el('div', { class: 'search-loading', hidden: true },
      el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })),
      el('span', { class: 'loading-label' }, 'Searching TMDB...')
    );
    const results = el('div', { class: 'suggest' });
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      loading.hidden = false; status.textContent = ''; results.replaceChildren();
      try {
        const items = await search(q);
        loading.hidden = true;
        if (!items.length) { status.textContent = 'No matches found.'; return; }
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
        el('div', { class: 'searchwrap' }, input),
        loading, status,
        el('div', { class: 'note try-label' }, 'Try searching'),
        el('div', { class: 'chips' }, ['That Time I Got Reincarnated as a Slime','Jujutsu Kaisen','Attack on Titan','Naruto'].map(t => el('button', { class: 'chip', type: 'button', onclick: () => { input.value = t; run(); } }, t))),
        results
      )
    );
    showSettings();
    input.focus();
  };
  const showSeasons = async (media) => {
    app.replaceChildren(
      el('a', { href: '#/', onclick: e => { e.preventDefault(); renderSearch(); } }, '← Back to search'),
      el('div', { class: 'card' }, el('h2', {}, media.title), el('div', { class: 'meta' }, el('span', { class: 'tag' }, media.type), media.year ? el('span', { class: 'tag' }, media.year) : null)),
      el('div', { class: 'search-loading' }, el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })), el('span', { class: 'loading-label' }, media.type === 'tv' ? 'Loading seasons...' : 'Movie selected'))
    );
    if (media.type !== 'tv') {
      app.append(el('div', { class: 'card' }, el('h3', {}, 'Movie'), el('p', { class: 'note' }, 'Movies do not have seasons.')));
      return;
    }
    try {
      const data = await api('/tv/' + media.tmdbId + '?language=en-US');
      const seasons = (data.seasons || []).filter(s => s.season_number > 0);
      app.append(el('div', { class: 'card' },
        el('h3', {}, 'Seasons'),
        el('div', { class: 'chips' }, seasons.map(s => el('button', { class: 'chip', type: 'button' },
          el('strong', {}, s.name || ('Season ' + s.season_number)),
          el('span', {}, (s.episode_count || 0) + ' episodes' + (s.air_date ? ' · ' + s.air_date.slice(0,4) : ''))
        )))
      ));
    } catch (e) {
      app.append(el('div', { class: 'card warn' }, 'Could not load seasons: ' + e.message));
    }
  };
  renderSearch();
})();