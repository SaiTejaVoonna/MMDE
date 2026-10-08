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
  const call = async (path) => {
    const r = await fetch(path);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('MMDE returned HTTP ' + r.status));
    return data;
  };
  const search = async (q) => (await call('/api/search?q=' + encodeURIComponent(q))).results || [];
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
      const data = await call('/api/seasons/' + encodeURIComponent(media.id));
      const seasons = data.seasons || [];
      app.append(el('div', { class: 'card' },
        el('h3', {}, 'Seasons'),
        el('div', { class: 'chips' }, seasons.map(s => el('button', { class: 'chip', type: 'button' },
          el('strong', {}, s.name || ('Season ' + s.seasonNumber)),
          el('span', {}, (s.episodeCount || 0) + ' episodes' + (s.airDate ? ' · ' + s.airDate.slice(0,4) : ''))
        )))
      ));
    } catch (e) {
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
        el('div', { class: 'note mode-note' }, 'TMDB credentials stay on the MMDE server and are never stored in this page.')
      )
    );
    input.focus();
  };
  renderSearch();
})();