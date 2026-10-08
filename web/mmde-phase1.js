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
  // Chronological timeline: a line with a year marker above each poster, oldest first.
  const filmGrid = (parts, currentId) => el('div', { class: 'tl' }, parts.map((p, i) =>
    el('button', { type: 'button', class: 'pcard tlitem' + (p.id === currentId ? ' current' : ''), onclick: () => showDetails({ id: p.id, type: 'movie', title: p.title }) },
      el('span', { class: 'tlyear' }, String(p.year || 'TBA')),
      poster(p.posterPath, 'w342'),
      el('strong', {}, (i + 1) + '. ' + p.title),
      el('small', {}, p.id === currentId ? 'you are here' : (p.releaseDate || '')))));

  // ---- Your library: followed titles and favorite songs. Saved in this browser only (browser storage); nothing is sent anywhere.
  const LIB_KEY = 'mmde.library.v1';
  const loadLib = () => {
    try { const x = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); if (x && typeof x.follows === 'object' && typeof x.favorites === 'object') return x; } catch (e) { /* private mode etc. */ }
    return { follows: {}, favorites: {} };
  };
  let lib = loadLib();
  const libWatchers = new Set(); // repaint callbacks for buttons that show library state
  const saveLib = () => {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) { /* storage unavailable: library lasts until the page closes */ }
    refreshNav();
    libWatchers.forEach((f) => f());
  };
  const trackKey = (filmId, section, title) => filmId + '|' + section + '|' + title.toLowerCase();
  const PLATFORMS = [['spotify', 'Spotify'], ['apple', 'Apple Music'], ['youtube', 'YouTube'], ['deezer', 'Deezer']];
  // Small simplified glyphs (not the official logos), drawn inline so nothing external is loaded.
  const ICONS = {
    spotify: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.5 9.2c4.4-1.3 9.6-1 13.4 1.3M6.3 12.7c3.5-1 7.2-.7 10.2 1.1M7.2 16c2.7-.7 5.3-.5 7.6.8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    apple: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M16.5 4.5v9.6a3 3 0 1 1-1.8-2.7V7.7l-5 1.2v7.2a3 3 0 1 1-1.8-2.7V6.8z" fill="currentColor"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="3.5" fill="currentColor"/><path d="M10.2 9.3v5.4l4.7-2.7z" fill="var(--icon-cut,#0b0f1a)"/></svg>',
    deezer: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="currentColor"><rect x="3" y="15.5" width="3.6" height="3"/><rect x="7.6" y="15.5" width="3.6" height="3"/><rect x="12.2" y="15.5" width="3.6" height="3"/><rect x="16.8" y="15.5" width="3.6" height="3"/><rect x="12.2" y="11" width="3.6" height="3"/><rect x="16.8" y="11" width="3.6" height="3"/><rect x="16.8" y="6.5" width="3.6" height="3"/></g></svg>',
  };
  const icon = (p) => { const t = document.createElement('template'); t.innerHTML = ICONS[p]; return t.content.firstChild; };
  const searchLink = (p, q) => {
    const e = encodeURIComponent(q);
    return { youtube: 'https://www.youtube.com/results?search_query=' + e, spotify: 'https://open.spotify.com/search/' + e, apple: 'https://music.apple.com/search?term=' + e, deezer: 'https://www.deezer.com/search/' + e }[p];
  };
  const fmtLen = (sec) => (sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : '');
  const safeUrl = (u) => (/^https:\/\//.test(u) ? u : '#');

  const navEl = el('nav', { class: 'topnav' });
  const refreshNav = () => {
    navEl.replaceChildren(
      el('button', { type: 'button', class: 'navbtn', onclick: () => { backFn = () => renderSearch(''); showLibrary('list'); } }, 'My list ' + Object.keys(lib.follows).length),
      el('button', { type: 'button', class: 'navbtn', onclick: () => { backFn = () => renderSearch(''); showLibrary('favorites'); } }, '♥ Favorites ' + Object.keys(lib.favorites).length));
  };
  const topBar = document.querySelector('.top');
  if (topBar) topBar.insertBefore(navEl, topBar.querySelector('.badge-proto'));

  const followButton = (d) => {
    const btn = el('button', { type: 'button', class: 'followbtn' });
    const paint = () => { const on = !!lib.follows[d.id]; btn.textContent = on ? '✓ Following' : '+ Follow'; btn.classList.toggle('on', on); };
    libWatchers.add(() => { if (btn.isConnected) paint(); else libWatchers.forEach((f) => { if (f.btn === btn) libWatchers.delete(f); }); });
    [...libWatchers].pop().btn = btn;
    btn.addEventListener('click', () => {
      if (lib.follows[d.id]) delete lib.follows[d.id];
      else lib.follows[d.id] = { id: d.id, title: d.title, kind: d.kind, year: d.year, posterPath: d.posterPath, at: Date.now() };
      saveLib(); paint();
    });
    paint();
    return btn;
  };

  // One song row: platform buttons (exact = verified catalog match, dashed = search only) and a favorite heart.
  const CONF_TEXT = { green: 'Confirmed: listed by 2 or more independent sources', amber: 'One source: listed by one reputable source', red: 'Unverified: only found in community playlists' };
  const SRC_NAME = { wikipedia: 'Wikipedia', apple: 'Apple Music', deezer: 'Deezer', credits: 'artist matches composer', animethemes: 'AnimeThemes', community: 'community playlist' };
  const trackRow = (film, section, t, initial, meta) => {
    const links = {};
    PLATFORMS.forEach(([p]) => { links[p] = { url: searchLink(p, t.title + ' ' + film.title), kind: 'search' }; });
    let art = '';
    const fav = () => lib.favorites[trackKey(film.id, section, t.title)];
    const row = el('div', { class: 'trow titem' });
    if (meta) row.dataset.conf = meta.confidence;
    const heart = el('button', { type: 'button', class: 'heart', 'aria-label': 'Favorite' });
    const paintHeart = () => { const on = !!fav(); heart.textContent = on ? '♥' : '♡'; heart.classList.toggle('on', on); heart.title = on ? 'Remove from favorites' : 'Add to favorites (also follows the title)'; };
    const draw = () => {
      row.replaceChildren(
        el('span', { class: 'tno' }, t.no || ''),
        art ? el('img', { class: 'tart', src: safeUrl(art), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'tart blank' }),
        el('span', { class: 'tinfo' },
          el('strong', {}, meta ? el('span', { class: 'cdot cdot-' + meta.confidence, title: CONF_TEXT[meta.confidence] + '\n' + meta.evidence.map((e) => e.label).join('\n') }) : null, t.title),
          el('small', {}, [(t.artists || []).join(', '), fmtLen(t.lengthSec)].filter(Boolean).join(' · ')),
          meta ? el('small', { class: 'tsrc' }, [...new Set(meta.evidence.map((e) => SRC_NAME[e.source] || e.source))].join(' + '),
            ...meta.evidence.filter((e) => e.source === 'animethemes' && e.url).slice(0, 1).map((e) => el('a', { class: 'vlink', href: safeUrl(e.url), target: '_blank', rel: 'noopener noreferrer', title: 'Watch this opening/ending on AnimeThemes (opens their site)' }, ' ▶ video'))) : null),
        el('span', { class: 'tpills' }, PLATFORMS.map(([p, name]) => {
          const a = el('a', {
            class: 'plink ' + (links[p].kind === 'resolved' ? 'exact' : 'guess'), 'data-p': p, href: safeUrl(links[p].url), target: '_blank', rel: 'noopener noreferrer', 'aria-label': name + (links[p].kind === 'resolved' ? ' (direct link)' : ' (search)'),
            title: links[p].kind === 'resolved' ? 'Open on ' + name + ' (verified match)' : 'Search ' + name + ' (not a verified match)'
          }, el('span', { class: 'plabel' }, name));
          a.prepend(icon(p));
          return a;
        })),
        heart);
      paintHeart();
    };
    heart.addEventListener('click', () => {
      const k = trackKey(film.id, section, t.title);
      if (lib.favorites[k]) delete lib.favorites[k];
      else {
        lib.favorites[k] = { key: k, filmId: film.id, filmTitle: film.title, filmPoster: film.posterPath, section, no: t.no, title: t.title, artists: t.artists || [], lengthSec: t.lengthSec, links, art, meta: meta ? { confidence: meta.confidence, evidence: meta.evidence.map((e) => ({ source: e.source, label: e.label })) } : undefined, at: Date.now() };
        if (!lib.follows[film.id]) lib.follows[film.id] = { id: film.id, title: film.title, kind: film.kind || 'movie', year: film.year, posterPath: film.posterPath, at: Date.now() };
      }
      saveLib(); paintHeart();
    });
    const set = (r) => {
      (r.links || []).forEach((l) => { if (links[l.platform] && /^https:\/\//.test(l.url)) links[l.platform] = { url: l.url, kind: l.kind === 'resolved' ? 'resolved' : 'search' }; });
      if (r.art && /^https:\/\//.test(r.art)) art = r.art;
      draw();
    };
    if (initial) { (initial.links ? Object.entries(initial.links).forEach(([p, l]) => { if (links[p] && l && /^https:\/\//.test(l.url)) links[p] = { url: l.url, kind: l.kind === 'resolved' ? 'resolved' : 'search' }; }) : 0); if (initial.art && /^https:\/\//.test(initial.art)) art = initial.art; }
    draw();
    return { el: row, set, resolve: async () => {
      try { set(await call('/api/track-links?title=' + encodeURIComponent(t.title) + '&film=' + encodeURIComponent(film.title) + '&artist=' + encodeURIComponent((t.artists || []).slice(0, 3).join('|')))); }
      catch (e) { /* keep the search links; they still work */ }
      // keep a saved favorite in step with newly found links
      const f = fav(); if (f) { f.links = links; f.art = art; saveLib(); }
    } };
  };

  let viewToken = 0;
  const resolveQueue = (rows, token, concurrency) => {
    let i = 0;
    const worker = async () => { while (i < rows.length && token === viewToken) { const r = rows[i++]; await r.resolve(); } };
    return Promise.all(Array.from({ length: concurrency }, worker));
  };

  const soundtrackCard = (d, scope) => {
    const body = el('div', {});
    const card = el('div', { class: 'card' }, el('h3', {}, scope ? 'Music for ' + (scope.name || 'Season ' + scope.number) : 'Soundtrack'), body);
    const token = viewToken;
    body.append(el('div', { class: 'search-loading' }, el('div', { class: 'loading-line' }, el('span', { class: 'loading-fill' })), el('span', { class: 'loading-label' }, 'Collecting from Wikipedia, Apple Music and Deezer... (the first time can take up to a minute for big films)')));
    const film = { id: d.id, title: d.title, kind: d.kind, year: d.year, posterPath: d.posterPath };
    const yt = el('a', { href: safeUrl(searchLink('youtube', d.title + ' ' + (d.year || '') + ' soundtrack')), target: '_blank', rel: 'noopener noreferrer' }, 'Search YouTube for the ' + d.title + ' soundtrack');
    const extra = (d.composers && d.composers.length ? '&composer=' + encodeURIComponent(d.composers.join('|')) : '') + (d.altTitles && d.altTitles.length ? '&alt=' + encodeURIComponent(d.altTitles.join('|')) : '') + ((d.genres || []).includes('Animation') && d.originalLanguage === 'ja' ? '&anime=1' : '') + (scope ? '&season=' + scope.number + (scope.airYear ? '&seasonYear=' + scope.airYear : '') : '');
    call('/api/soundtrack-merged?title=' + encodeURIComponent(d.title) + (d.year ? '&year=' + d.year : '') + extra).then((m) => {
      if (token !== viewToken) return;
      if (!m.sections || !m.sections.length) { body.replaceChildren(el('p', { class: 'note' }, 'No soundtrack list was found on Wikipedia, Apple Music or Deezer for this title yet. '), yt); return; }
      const toResolve = [];
      const buildSection = (sec, idx) => {
        const rows = sec.tracks.map((t) => {
          const initial = { links: {}, art: t.art };
          if (t.links.apple) initial.links.apple = { url: t.links.apple, kind: 'resolved' };
          if (t.links.deezer) initial.links.deezer = { url: t.links.deezer, kind: 'resolved' };
          const r = trackRow(film, sec.name, t, initial, { confidence: t.confidence, evidence: t.evidence });
          r.missing = !(t.links.apple && t.links.deezer);
          return r;
        });
        const big = rows.length > 12;
        const det = el('details', { class: 'tsection' + (sec.origin === 'community' ? ' tcommunity' : '') }, ...[
          el('summary', {}, sec.name + ' · ' + rows.length + (rows.length === 1 ? ' track' : ' tracks')),
          big ? el('button', { type: 'button', class: 'chip findbtn', onclick: (e) => { const todo = rows.filter((r) => r.missing); e.target.disabled = true; e.target.textContent = 'Finding exact links for ' + todo.length + ' songs... (a few minutes)'; resolveQueue(todo, token, 2).then(() => { e.target.textContent = 'Done: exact links shown where found'; }); } }, 'Find missing Apple Music / Deezer links (takes a while)') : null,
          el('div', { class: 'tbody' }, ...rows.map((r) => r.el))].filter(Boolean));
        if (idx < 2 && sec.origin !== 'community') det.open = true;
        if (!big) toResolve.push(...rows.filter((r) => r.missing));
        return det;
      };
      const matchSecs = scope ? m.sections.filter((x) => x.scope === 'match') : m.sections;
      const otherSecs = scope ? m.sections.filter((x) => x.scope !== 'match') : [];
      const sections = matchSecs.map(buildSection);
      const otherNodes = otherSecs.map((sec, i) => buildSection(sec, 99 + i));
      const c = m.counts;
      const wrap = el('div', { class: 'tfilter-all tview-cards' });
      const filterChip = (key, label, dot) => el('button', { type: 'button', class: 'chip' + (key === 'all' ? ' active' : ''), onclick: (e) => {
        const chip = e.currentTarget; wrap.className = 'tfilter-' + key + ' ' + (wrap.classList.contains('tview-list') ? 'tview-list' : 'tview-cards'); chip.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === chip));
      } }, dot ? el('span', { class: 'cdot cdot-' + dot }) : null, label);
      wrap.append(
        el('p', { class: 'note' }, c.total + ' songs found' + (m.wikipedia ? ' · tracklist from ' : ''), m.wikipedia ? el('a', { href: safeUrl(m.wikipedia.url), target: '_blank', rel: 'noopener noreferrer' }, 'Wikipedia') : null, m.wikipedia ? ' (CC BY-SA 4.0)' : '', '. MMDE never plays or hosts audio.'),
        el('div', { class: 'chips fchips' },
          filterChip('all', 'All ' + c.total),
          filterChip('green', 'Confirmed ' + c.green, 'green'),
          filterChip('amber', 'One source ' + c.amber, 'amber'),
          filterChip('red', 'Unverified ' + c.red, 'red'),
          el('span', { class: 'viewtoggle' },
            el('button', { type: 'button', class: 'chip active', onclick: (e) => { wrap.classList.remove('tview-list'); wrap.classList.add('tview-cards'); e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); } }, 'Cards'),
            el('button', { type: 'button', class: 'chip', onclick: (e) => { wrap.classList.remove('tview-cards'); wrap.classList.add('tview-list'); e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); } }, 'List'))),
        el('p', { class: 'note' }, el('span', { class: 'cdot cdot-green' }), 'confirmed by 2+ independent sources   ', el('span', { class: 'cdot cdot-amber' }), 'one source   ', el('span', { class: 'cdot cdot-red' }), 'only in a community playlist. Solid buttons are direct catalog links; dashed ones open a search.'),
        ...(scope ? [el('p', { class: 'note' }, 'Showing music that belongs to ' + (scope.name || 'Season ' + scope.number) + (scope.airYear ? ' (aired ' + scope.airYear + ')' : '') + '. Albums that name another season are hidden' + (m.season && m.season.excluded ? ' (' + m.season.excluded + ' hidden)' : '') + '.')] : []),
        ...(scope && !sections.length ? [el('p', { class: 'note' }, 'Nothing was found that is tied to this season yet.')] : []),
        ...sections,
        ...(otherNodes.length ? [el('details', { class: 'tsection tother' }, el('summary', {}, 'Other music from the whole series, not tied to a season · ' + (otherSecs.reduce((n, x) => n + x.tracks.length, 0) === 1 ? '1 song' : otherSecs.reduce((n, x) => n + x.tracks.length, 0) + ' songs')), el('div', {}, ...otherNodes))] : []),
        ...(m.verified === 'none' ? [el('p', { class: 'note' }, 'We could not verify that these albums belong to this title: no composer credit on TMDB and no Wikipedia tracklist. They were matched by name only, so songs are marked unverified (red) unless two catalogs agree.')] : []),
        ...((m.skipped || []).length ? [el('p', { class: 'note' }, 'Skipped ' + m.skipped.length + (m.skipped.length === 1 ? ' album' : ' albums') + ' with the same name that did not match this title\'s composer: ' + m.skipped.map((x) => x.name).join('; ') + '.')] : []),
        ...(m.partial ? [el('p', { class: 'note' }, 'Some albums were too slow to load, so this list may be incomplete. Reload to try again.')] : []),
        el('p', { class: 'note' }, 'Looking somewhere else? ', yt));
      body.replaceChildren(wrap);
      resolveQueue(toResolve, token, 2);
    }).catch((e) => { if (token === viewToken) body.replaceChildren(el('p', { class: 'note' }, 'Could not load the soundtrack: ' + e.message + ' '), yt); });
    return card;
  };

  const showLibrary = (view) => {
    window.scrollTo(0, 0); viewToken++;
    const back = el('a', { href: '#/', onclick: (e) => { e.preventDefault(); renderSearch(''); } }, '← Home');
    const tabs = el('div', { class: 'chips fchips' },
      el('button', { type: 'button', class: 'chip' + (view === 'list' ? ' active' : ''), onclick: () => showLibrary('list') }, 'My list ' + Object.keys(lib.follows).length),
      el('button', { type: 'button', class: 'chip' + (view === 'favorites' ? ' active' : ''), onclick: () => showLibrary('favorites') }, '♥ Favorites ' + Object.keys(lib.favorites).length));
    const stuff = [back, el('h2', { style: 'margin:10px 0' }, view === 'list' ? 'My list' : 'Favorites'), tabs];
    if (view === 'list') {
      const items = Object.values(lib.follows).sort((a, b) => b.at - a.at);
      stuff.push(items.length ? el('div', { class: 'postergrid' }, items.map((f) => {
        const favCount = Object.values(lib.favorites).filter((x) => x.filmId === f.id).length;
        return el('div', { class: 'pcard' },
          el('button', { type: 'button', class: 'pcardopen', onclick: () => { backFn = () => showLibrary('list'); showDetails({ id: f.id, type: f.kind, title: f.title }); } }, poster(f.posterPath, 'w342'), el('strong', {}, f.title), el('small', {}, [f.kind, f.year, favCount ? '♥ ' + favCount : ''].filter(Boolean).join(' · '))),
          el('button', { type: 'button', class: 'unfollow', onclick: () => { delete lib.follows[f.id]; saveLib(); showLibrary('list'); } }, 'Unfollow'));
      })) : el('p', { class: 'note' }, 'Nothing here yet. Open a movie or show and press "+ Follow".'));
    } else {
      const favs = Object.values(lib.favorites);
      const byFilm = {};
      favs.forEach((f) => { (byFilm[f.filmId] = byFilm[f.filmId] || []).push(f); });
      if (!favs.length) stuff.push(el('p', { class: 'note' }, 'No favorite songs yet. Press the ♡ on any song in a soundtrack.'));
      Object.values(byFilm).forEach((list) => {
        const film = { id: list[0].filmId, title: list[0].filmTitle, posterPath: list[0].filmPoster };
        const bySection = {};
        list.sort((a, b) => (a.no || 0) - (b.no || 0)).forEach((f) => { (bySection[f.section] = bySection[f.section] || []).push(f); });
        stuff.push(el('div', { class: 'card' },
          el('h3', {}, film.title),
          ...Object.entries(bySection).flatMap(([sec, songs]) => [el('p', { class: 'note' }, sec), el('div', { class: 'tview-list' }, ...songs.map((f) => trackRow(film, f.section, { no: f.no, title: f.title, artists: f.artists, lengthSec: f.lengthSec }, f, f.meta).el))])));
      });
      stuff.push(el('div', { class: 'chips', style: 'margin-top:18px' },
        el('button', { type: 'button', class: 'chip', onclick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(lib, null, 2)], { type: 'application/json' })), download: 'mmde-library.json' });
          document.body.append(a); a.click(); a.remove();
        } }, 'Export backup'),
        el('label', { class: 'chip' }, 'Import backup', el('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: (e) => {
          const file = e.target.files && e.target.files[0]; if (!file) return;
          file.text().then((txt) => {
            const x = JSON.parse(txt);
            if (!x || typeof x.follows !== 'object' || typeof x.favorites !== 'object') throw new Error('not an MMDE backup');
            lib = { follows: { ...lib.follows, ...x.follows }, favorites: { ...lib.favorites, ...x.favorites } }; saveLib(); showLibrary('favorites');
          }).catch((err) => window.alert('Could not import: ' + err.message));
        } }))));
    }
    app.replaceChildren(...stuff);
  };
  // One season of a series: only music that belongs to it (named seasons, or released around when it aired).
  const showSeason = (d, sn) => {
    window.scrollTo(0, 0); viewToken++;
    const scope = { number: sn.seasonNumber, name: sn.name || ('Season ' + sn.seasonNumber), airYear: sn.airDate ? Number(sn.airDate.slice(0, 4)) : undefined };
    const back = el('a', { href: '#/', onclick: (e) => { e.preventDefault(); showDetails({ id: d.id, type: 'tv', title: d.title }); } }, '← Back to ' + d.title);
    const hero = el('section', { class: 'dhero' },
      poster(sn.posterPath || d.posterPath, 'w342', 'dposter'),
      el('div', { class: 'dtext' },
        el('h2', {}, d.title + ' · ' + scope.name),
        chips([(sn.episodeCount || 0) + ' episodes', sn.airDate ? 'aired ' + sn.airDate : null, sn.voteAverage ? '★ ' + sn.voteAverage : null]),
        sn.overview ? el('p', { class: 'overview' }, sn.overview) : null,
        followButton(d)));
    const switcher = el('div', { class: 'chips fchips' }, (d.seasons || []).filter((x) => x.seasonNumber >= 1).map((x) =>
      el('button', { type: 'button', class: 'chip' + (x.seasonNumber === sn.seasonNumber ? ' active' : ''), onclick: () => showSeason(d, x) }, x.name || ('Season ' + x.seasonNumber))));
    app.replaceChildren(back, hero, switcher, soundtrackCard(d, scope));
  };
  const showDetails = async (media) => {
    window.scrollTo(0, 0); viewToken++;
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
        d.overview ? el('p', { class: 'overview' }, d.overview) : null,
        followButton(d)));
    const parts = [back, hero];
    if (d.kind !== 'collection') parts.push(soundtrackCard(d));
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
        el('p', { class: 'note' }, 'Click a season to see only the music that belongs to it.'),
        el('div', { class: 'tl' }, seasons.map((sn) => {
          const clickable = sn.seasonNumber >= 1;
          const card = el(clickable ? 'button' : 'div', clickable ? { type: 'button', class: 'pcard tlitem', onclick: () => showSeason(d, sn) } : { class: 'pcard tlitem' },
            el('span', { class: 'tlyear' }, sn.airDate ? sn.airDate.slice(0, 4) : 'TBA'),
            poster(sn.posterPath, 'w342'),
            el('strong', {}, sn.name || ('Season ' + sn.seasonNumber)),
            el('small', {}, (sn.episodeCount || 0) + ' episodes' + (sn.voteAverage ? ' · ★ ' + sn.voteAverage : '')),
            clickable ? el('small', { class: 'tlgo' }, 'Find its music →') : null);
          return card;
        }))));
    }
    if (d.kind === 'collection') parts.push(el('div', { class: 'card' }, el('h3', {}, 'Music'), el('p', { class: 'note' }, 'Open a film above to see its soundtrack. Follow the collection to keep all its films in My list.')));
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

  // Home-page rows: a title strip of poster cards.
  const homeRow = (title, items, pick, emptyText) => {
    const row = el('section', { class: 'homerow' }, el('h3', {}, title));
    if (!items.length) { if (emptyText) row.append(el('p', { class: 'note' }, emptyText)); return row; }
    row.append(el('div', { class: 'hscroll' }, items.map((m) => el('button', { type: 'button', class: 'pcard hcard', onclick: () => pick(m) },
      poster(m.posterPath, 'w342'), el('strong', {}, m.title), el('small', {}, [TYPE_LABEL[m.type] || m.type, m.year].filter(Boolean).join(' · '))))));
    return row;
  };
  const homeRowLoader = (title, kind) => {
    const slot = el('div', {});
    call('/api/trending?kind=' + kind).then((r) => { slot.replaceWith(homeRow(title, r.results || [], (m) => { backFn = () => renderSearch(''); showDetails(m); })); }).catch(() => slot.remove());
    return slot;
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
      ),
      homeRow('Your list', Object.values(lib.follows).sort((a, b) => b.at - a.at).slice(0, 14).map((f) => ({ id: f.id, type: f.kind, title: f.title, year: f.year, posterPath: f.posterPath })), (m) => { backFn = () => renderSearch(''); showDetails(m); }, 'Nothing followed yet. Open any title and press "+ Follow".'),
      homeRowLoader('Trending this week', 'all'),
      homeRowLoader('Popular anime', 'anime')
    );
    sb.input.focus();
    if (initial) sb.input.setSelectionRange(initial.length, initial.length);
  };
  refreshNav();
  renderSearch('');
})();