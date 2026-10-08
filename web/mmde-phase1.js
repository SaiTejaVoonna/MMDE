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
  const saveLibQuiet = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) { /* storage unavailable */ } };
  const trackKey = (filmId, section, title) => filmId + '|' + section + '|' + title.toLowerCase();
  const PLATFORMS = [['spotify', 'Spotify'], ['apple', 'Apple Music'], ['youtube', 'YouTube'], ['youtubeMusic', 'YouTube Music'], ['deezer', 'Deezer']];
  // Small simplified glyphs (not the official logos), drawn inline so nothing external is loaded.
  const ICONS = {
    spotify: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.5 9.2c4.4-1.3 9.6-1 13.4 1.3M6.3 12.7c3.5-1 7.2-.7 10.2 1.1M7.2 16c2.7-.7 5.3-.5 7.6.8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    apple: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M16.5 4.5v9.6a3 3 0 1 1-1.8-2.7V7.7l-5 1.2v7.2a3 3 0 1 1-1.8-2.7V6.8z" fill="currentColor"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="3.5" fill="currentColor"/><path d="M10.2 9.3v5.4l4.7-2.7z" fill="var(--icon-cut,#0b0f1a)"/></svg>',
    youtubeMusic: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.2 8.9v6.2l5.2-3.1z" fill="currentColor"/></svg>',
    deezer: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="currentColor"><rect x="3" y="15.5" width="3.6" height="3"/><rect x="7.6" y="15.5" width="3.6" height="3"/><rect x="12.2" y="15.5" width="3.6" height="3"/><rect x="16.8" y="15.5" width="3.6" height="3"/><rect x="12.2" y="11" width="3.6" height="3"/><rect x="16.8" y="11" width="3.6" height="3"/><rect x="16.8" y="6.5" width="3.6" height="3"/></g></svg>',
  };
  const icon = (p) => { const t = document.createElement('template'); t.innerHTML = ICONS[p]; return t.content.firstChild; };
  const searchLink = (p, q) => {
    const e = encodeURIComponent(q);
    return { youtube: 'https://www.youtube.com/results?search_query=' + e, youtubeMusic: 'https://music.youtube.com/search?q=' + e, spotify: 'https://open.spotify.com/search/' + e, apple: 'https://music.apple.com/search?term=' + e, deezer: 'https://www.deezer.com/search/' + e }[p];
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
  const SRC_NAME = { wikipedia: 'Wikipedia', apple: 'Apple Music', deezer: 'Deezer', credits: 'artist matches composer', animethemes: 'AnimeThemes', musicbrainz: 'MusicBrainz', community: 'community playlist' };
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
          meta && !meta.proof && meta.deezerIsrc ? el('small', { class: 'tproof', title: 'ISRC read from Deezer\'s public catalog. It identifies this exact recording across services.' }, 'Recording code · ISRC ' + meta.deezerIsrc + ' (Deezer)') : null,
          meta && meta.proof ? el('small', { class: 'tproof', title: 'From MusicBrainz, a public release database: the same codes the music industry uses to identify a release. MMDE reads the data, never the audio.' }, 'Official release' + [meta.proof.label, meta.proof.releaseDate, meta.proof.isrc || meta.deezerIsrc ? 'ISRC ' + (meta.proof.isrc || meta.deezerIsrc) + (meta.deezerIsrc && meta.proof.isrc && meta.deezerIsrc === meta.proof.isrc ? ' (MusicBrainz and Deezer agree)' : meta.deezerIsrc && !meta.proof.isrc ? ' (Deezer)' : '') : '', meta.proof.upc ? 'UPC ' + meta.proof.upc : ''].filter(Boolean).map((x) => ' · ' + x).join('')) : null,
          meta && meta.versions && meta.versions.length ? el('small', { class: 'tproof', title: 'Matched by track number and length, not by title: probably the same song in another language release' }, 'Probably also in ' + meta.versions.map((v) => v.language + ' ("' + v.title + '")').join(', ')) : null,
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
    // ISRC from Deezer, only for songs that scroll into view and have a direct Deezer link (one small request each, throttled on the server).
    let seen = false; let isrcTried = false;
    const loadIsrc = () => {
      if (!meta || isrcTried || (meta.proof && meta.proof.isrc)) return;
      const m = links.deezer && links.deezer.kind === 'resolved' ? /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d{1,15})/.exec(links.deezer.url) : null;
      if (!m) return;
      isrcTried = true;
      call('/api/deezer-isrc?id=' + m[1]).then((r) => { if (r && r.isrc) { meta.deezerIsrc = r.isrc; draw(); } }).catch(() => { /* optional extra */ });
    };
    const set = (r) => {
      (r.links || []).forEach((l) => { if (links[l.platform] && /^https:\/\//.test(l.url)) links[l.platform] = { url: l.url, kind: l.kind === 'resolved' ? 'resolved' : 'search' }; });
      if (r.art && /^https:\/\//.test(r.art)) art = r.art;
      draw();
      if (seen) loadIsrc();
    };
    if (initial) { (initial.links ? Object.entries(initial.links).forEach(([p, l]) => { if (links[p] && l && /^https:\/\//.test(l.url)) links[p] = { url: l.url, kind: l.kind === 'resolved' ? 'resolved' : 'search' }; }) : 0); if (initial.art && /^https:\/\//.test(initial.art)) art = initial.art; }
    draw();
    if (meta && 'IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); seen = true; loadIsrc(); } }); io.observe(row); }
    const handle = { el: row, set, done: false, resolve: async () => {
      if (handle.done) return; handle.done = true;
      try { set(await call('/api/track-links?title=' + encodeURIComponent(t.title) + '&film=' + encodeURIComponent(film.title) + '&artist=' + encodeURIComponent((t.artists || []).slice(0, 3).join('|')) + (t.lengthSec ? '&length=' + t.lengthSec : '') + (film.year ? '&year=' + film.year : ''))); }
      catch (e) { /* keep the search links; they still work */ }
      // keep a saved favorite in step with newly found links
      const f = fav(); if (f) { f.links = links; f.art = art; saveLib(); }
    } };
    return handle;
  };

  let viewToken = 0;
  const resolveQueue = (rows, token, concurrency) => {
    let i = 0;
    const worker = async () => { while (i < rows.length && token === viewToken) { const r = rows[i++]; await r.resolve(); } };
    return Promise.all(Array.from({ length: concurrency }, worker));
  };

  const skeleton = () => el('div', { class: 'skel-wrap', 'aria-label': 'Loading songs' }, el('div', { class: 'skel-head' }), el('div', { class: 'skel-grid' }, ...Array.from({ length: 8 }, () => el('div', { class: 'skel-card' }, el('div', { class: 'skel-art' }), el('div', { class: 'skel-line' }), el('div', { class: 'skel-line short' })))));
  const SRC_ICON = { ok: '✓', empty: '○', failed: '✗', pending: '…' };
  const sourceStrip = (sources, onRetry) => el('div', { class: 'srcstrip', role: 'status' },
    el('span', { class: 'note' }, 'Checked: '),
    ...(sources || []).map((x) => el('span', { class: 'srcchip s-' + x.state, title: x.label + ': ' + (x.detail || x.state) }, el('b', {}, SRC_ICON[x.state] || ''), ' ' + x.label,
      x.state === 'failed' ? el('button', { type: 'button', class: 'srcretry', onclick: onRetry }, 'retry') : null)),
    ...(sources || []).filter((x) => x.state !== 'ok' && x.state !== 'pending').slice(0, 3).map((x) => el('small', { class: 'srcdetail' }, x.label + ': ' + (x.detail || x.state))));

  const soundtrackCard = (d, scope) => {
    const body = el('div', {});
    const card = el('div', { class: 'card' }, el('h3', {}, scope ? 'Music for ' + (scope.name || 'Season ' + scope.number) : 'Soundtrack'), body);
    const token = viewToken;
    body.append(skeleton());
    const film = { id: d.id, title: d.title, kind: d.kind, year: d.year, posterPath: d.posterPath };
    const yt = el('a', { href: safeUrl(searchLink('youtube', d.title + ' ' + (d.year || '') + ' soundtrack')), target: '_blank', rel: 'noopener noreferrer' }, 'Search YouTube for the ' + d.title + ' soundtrack');
    const extra = (d.composers && d.composers.length ? '&composer=' + encodeURIComponent(d.composers.join('|')) : '') + (d.altTitles && d.altTitles.length ? '&alt=' + encodeURIComponent(d.altTitles.join('|')) : '') + ((d.genres || []).includes('Animation') && d.originalLanguage === 'ja' ? '&anime=1' : '') + (scope ? '&season=' + scope.number + (scope.airYear ? '&seasonYear=' + scope.airYear : '') : '');
    const url = '/api/soundtrack-merged?title=' + encodeURIComponent(d.title) + (d.year ? '&year=' + d.year : '') + extra;
    let rendered = false; let fullDone = false;

    const render = (m, isFast) => {
      if (token !== viewToken) return;
      const openNames = new Set([...body.querySelectorAll('details.tsection[open]')].map((x) => x.dataset.name));
      const reload = () => start(true);
      const strip = sourceStrip(m.sources, reload);
      if (!m.sections || !m.sections.length) {
        if (isFast) { rendered = true; body.replaceChildren(strip, el('p', { class: 'note' }, 'Nothing yet from Wikipedia, Apple Music or Deezer. Still checking MusicBrainz and AnimeThemes…'), skeleton()); return; }
        body.replaceChildren(strip, el('p', { class: 'note' }, 'No soundtrack list was found for this title yet. The line above says what each source answered. '), el('button', { type: 'button', class: 'chip', onclick: reload }, 'Check again'), ' ', yt); return;
      }
      rendered = true;
      const toResolve = [];
      const makeRow = (sec, t) => {
        const initial = { links: {}, art: t.art };
        if (t.links.apple) initial.links.apple = { url: t.links.apple, kind: 'resolved' };
        if (t.links.deezer) initial.links.deezer = { url: t.links.deezer, kind: 'resolved' };
        const r = trackRow(film, sec.name, t, initial, { confidence: t.confidence, evidence: t.evidence, proof: t.proof, versions: t.versions });
        r.missing = !(t.links.apple && t.links.deezer);
        return r;
      };
      const matchSecs = scope ? m.sections.filter((x) => x.scope === 'match') : m.sections;
      const otherSecs = scope ? m.sections.filter((x) => x.scope !== 'match') : [];
      // Every song becomes one item whose row element is created once; sorting/filtering/grouping only re-arranges these elements.
      const items = matchSecs.flatMap((sec, si) => sec.tracks.map((t, ti) => ({ sec, si, ti, t, r: makeRow(sec, t) })));
      const prefs = lib.prefs || (lib.prefs = {});
      const st = { q: '', sort: prefs.sort || 'original', group: prefs.group || 'section', conf: 'all', type: 'all', source: 'all', lang: 'All', origOnly: false, direct: false, fav: false };
      const wrap = el('div', { class: 'tview-cards' });
      const listBox = el('div', { class: 'tlist' });
      const countNote = el('p', { class: 'note tcount' });
      const confBtns = {}; const langBtns = {};
      const norm = (x) => String(x || '').toLowerCase();
      const passes = (it, ignoreConf) => {
        const t = it.t;
        if (!ignoreConf && st.conf !== 'all' && t.confidence !== st.conf) return false;
        if (st.type !== 'all' && (t.type || 'song') !== st.type) return false;
        if (st.source !== 'all' && !t.evidence.some((e) => e.source === st.source)) return false;
        if (st.lang !== 'All' && it.sec.language !== st.lang) return false;
        if (st.origOnly && t.version && t.version !== 'original') return false;
        if (st.direct && !(t.links.apple || t.links.deezer)) return false;
        if (st.fav && !lib.favorites[trackKey(film.id, it.sec.name, t.title)]) return false;
        if (st.q && !(norm(t.title) + ' ' + norm((t.artists || []).join(' '))).includes(norm(st.q))) return false;
        return true;
      };
      const CONF_RANK = { green: 0, amber: 1, red: 2 };
      const dateOf = (it) => (it.sec.releaseDate || '').slice(0, 10) || '9999';
      const SORTS = {
        original: { label: 'Original order', cmp: (a, b) => a.si - b.si || a.ti - b.ti },
        dateAsc: { label: 'Release date: oldest first', cmp: (a, b) => dateOf(a).localeCompare(dateOf(b)) || a.si - b.si || a.ti - b.ti },
        dateDesc: { label: 'Release date: newest first', cmp: (a, b) => (dateOf(a) === '9999' ? 1 : dateOf(b) === '9999' ? -1 : dateOf(b).localeCompare(dateOf(a))) || a.si - b.si || a.ti - b.ti },
        confidence: { label: 'Most confirmed first', cmp: (a, b) => CONF_RANK[a.t.confidence] - CONF_RANK[b.t.confidence] || a.si - b.si || a.ti - b.ti },
        title: { label: 'Title A to Z', cmp: (a, b) => a.t.title.localeCompare(b.t.title, undefined, { sensitivity: 'base' }) },
        length: { label: 'Longest first', cmp: (a, b) => (b.t.lengthSec || 0) - (a.t.lengthSec || 0) },
      };
      const TYPE_LABEL = { song: 'Songs', score: 'Background score', opening: 'Openings', ending: 'Endings' };
      const GROUPS = {
        section: { label: 'Group by album / list', key: (it) => it.sec.name + (it.sec.language && !it.sec.name.includes(it.sec.language) ? ' · ' + it.sec.language : '') },
        language: { label: 'Group by language', key: (it) => it.sec.language || 'Language not stated' },
        type: { label: 'Group by type', key: (it) => TYPE_LABEL[it.t.type || 'song'] },
        year: { label: 'Group by release year', key: (it) => (dateOf(it) === '9999' ? 'Date not stated' : dateOf(it).slice(0, 4)) },
        none: { label: 'One list (no groups)', key: () => 'All songs' },
      };
      const groupNode = (name, list, open) => {
        const rows = list.map((it) => it.r);
        const big = rows.length > 12;
        const det = el('details', { class: 'tsection' + (list.every((it) => it.sec.origin === 'community') ? ' tcommunity' : '') }, ...[
          el('summary', {}, name + ' · ' + rows.length + (rows.length === 1 ? ' track' : ' tracks')),
          big ? el('button', { type: 'button', class: 'chip findbtn', onclick: (e) => { const todo = rows.filter((r) => r.missing && !r.done); e.target.disabled = true; e.target.textContent = 'Finding exact links for ' + todo.length + ' songs... (a few minutes)'; resolveQueue(todo, token, 2).then(() => { e.target.textContent = 'Done: exact links shown where found'; }); } }, 'Find missing Apple Music / Deezer links (takes a while)') : null,
          el('div', { class: 'tbody' }, ...rows.map((r) => r.el))].filter(Boolean));
        det.dataset.name = name;
        if (open) det.open = true;
        if (!big) resolveQueue(rows.filter((r) => r.missing && !r.done), token, 2);
        return det;
      };
      let firstLayout = true;
      const layout = () => {
        const openNames = new Set([...listBox.querySelectorAll('details.tsection[open]')].map((x) => x.dataset.name));
        const base = items.filter((it) => passes(it, true));
        const vis = base.filter((it) => st.conf === 'all' || it.t.confidence === st.conf).sort(SORTS[st.sort].cmp);
        const cnt = { green: 0, amber: 0, red: 0 }; base.forEach((it) => { cnt[it.t.confidence]++; });
        Object.entries(confBtns).forEach(([k, b]) => { b.classList.toggle('active', st.conf === k); const n = k === 'all' ? base.length : cnt[k]; b.querySelector('.n').textContent = n; });
        Object.entries(langBtns).forEach(([k, b]) => b.classList.toggle('active', st.lang === k));
        const filtered = vis.length !== items.length;
        countNote.replaceChildren(...['Showing ' + vis.length + ' of ' + items.length + ' songs' + (filtered ? '. ' : '.'), filtered ? el('button', { type: 'button', class: 'srcretry', onclick: clearAll }, 'Clear filters') : null].filter(Boolean));
        if (!vis.length) { listBox.replaceChildren(el('p', { class: 'note' }, 'No songs match these filters. '), el('button', { type: 'button', class: 'chip', onclick: clearAll }, 'Clear filters')); return; }
        const groups = new Map();
        for (const it of vis) { const k = GROUPS[st.group].key(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
        let gi = 0;
        // Keep what the user had open when the same groups come back; a new set of groups (after changing "group by") opens its first two (all, for one list).
        const keep = [...groups.keys()].some((k) => openNames.has(k));
        const nodes = [...groups].map(([name, list]) => groupNode(name, list, keep ? openNames.has(name) : (st.group === 'none' || (gi++ < 2 && !list.every((x) => x.sec.origin === 'community')))));
        firstLayout = false;
        listBox.replaceChildren(...nodes);
      };
      const clearAll = () => { Object.assign(st, { q: '', conf: 'all', type: 'all', source: 'all', lang: 'All', origOnly: false, direct: false, fav: false }); syncControls(); layout(); };
      const select = (opts, get, set, aria) => { const sel = el('select', { class: 'tsel', 'aria-label': aria, onchange: (e) => set(e.target.value) }, ...opts.map(([v, label]) => el('option', { value: v }, label))); sel.value = get(); return sel; };
      const sources = [...new Set(items.flatMap((it) => it.t.evidence.map((e) => e.source)))].filter((x) => x !== 'credits');
      const SRC_LABEL = { wikipedia: 'Wikipedia', apple: 'Apple Music', deezer: 'Deezer', musicbrainz: 'MusicBrainz', animethemes: 'AnimeThemes', community: 'Community playlist' };
      const present = (k) => items.some((it) => (it.t.type || 'song') === k);
      const qBox = el('input', { class: 'tq', type: 'search', placeholder: 'Search these songs…', 'aria-label': 'Search these songs', oninput: (e) => { st.q = e.target.value; layout(); } });
      const sortSel = select(Object.entries(SORTS).map(([k, v]) => [k, v.label]), () => st.sort, (v) => { st.sort = v; prefs.sort = v; saveLibQuiet(); if (v !== 'original' && st.group === 'section') { st.group = 'none'; groupSel.value = 'none'; } layout(); }, 'Sort songs');
      const groupSel = select(Object.entries(GROUPS).map(([k, v]) => [k, v.label]), () => st.group, (v) => { st.group = v; prefs.group = v; saveLibQuiet(); layout(); }, 'Group songs');
      const typeSel = select([['all', 'All types'], ...Object.entries(TYPE_LABEL).filter(([k]) => present(k)).map(([k, v]) => [k, v])], () => st.type, (v) => { st.type = v; layout(); }, 'Filter by type');
      const srcSel = select([['all', 'All sources'], ...sources.map((k) => [k, SRC_LABEL[k] || k])], () => st.source, (v) => { st.source = v; layout(); }, 'Filter by source');
      const toggle = (label, key, title) => { const b = el('button', { type: 'button', class: 'chip tog', 'aria-pressed': 'false', title, onclick: () => { st[key] = !st[key]; layout(); syncControls(); } }, label); b.dataset.key = key; return b; };
      const toggles = [toggle('Original versions only', 'origOnly', 'Hide instrumentals, remixes, covers, live and TV-size versions'), toggle('Direct links only', 'direct', 'Only songs that already have a direct Apple Music or Deezer link'), toggle('♥ Favorites only', 'fav', 'Only songs you hearted')];
      const syncControls = () => { qBox.value = st.q; typeSel.value = st.type; srcSel.value = st.source; toggles.forEach((b) => { b.classList.toggle('active', !!st[b.dataset.key]); b.setAttribute('aria-pressed', String(!!st[b.dataset.key])); }); };
      const confChip = (key, label, dot) => { const b = el('button', { type: 'button', class: 'chip' + (key === 'all' ? ' active' : ''), onclick: () => { st.conf = key; layout(); } }, dot ? el('span', { class: 'cdot cdot-' + dot }) : null, label + ' ', el('span', { class: 'n' }, '0')); confBtns[key] = b; return b; };
      const langs = (m.languages || []).map((x) => x.language);
      const otherNodes = otherSecs.map((sec, i) => { const rows = sec.tracks.map((t) => makeRow(sec, t)); rows.forEach((r) => { if (r.missing) toResolve.push(r); }); const det = el('details', { class: 'tsection' }, el('summary', {}, sec.name + ' · ' + rows.length + (rows.length === 1 ? ' track' : ' tracks')), el('div', { class: 'tbody' }, ...rows.map((r) => r.el))); det.dataset.name = sec.name; return det; });
      const c = m.counts;
      wrap.append(
        strip,
        ...(isFast ? [el('p', { class: 'note pending-note' }, el('span', { class: 'spin' }), 'Showing what we have so far. MusicBrainz, AnimeThemes and other-language names are still being checked, so more songs and proof lines may appear.')] : []),
        el('p', { class: 'note' }, c.total + ' songs found' + (m.wikipedia ? ' · tracklist from ' : ''), m.wikipedia ? el('a', { href: safeUrl(m.wikipedia.url), target: '_blank', rel: 'noopener noreferrer' }, 'Wikipedia') : null, m.wikipedia ? ' (CC BY-SA 4.0)' : '', '. MMDE never plays or hosts audio.'),
        el('div', { class: 'toolbar' }, qBox, sortSel, groupSel, typeSel, srcSel),
        el('div', { class: 'chips fchips' },
          confChip('all', 'All'), confChip('green', 'Confirmed', 'green'), confChip('amber', 'One source', 'amber'), confChip('red', 'Unverified', 'red'),
          ...toggles,
          el('span', { class: 'viewtoggle' },
            el('button', { type: 'button', class: 'chip active', onclick: (e) => { wrap.classList.remove('tview-list'); wrap.classList.add('tview-cards'); e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); } }, 'Cards'),
            el('button', { type: 'button', class: 'chip', onclick: (e) => { wrap.classList.remove('tview-cards'); wrap.classList.add('tview-list'); e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === e.currentTarget)); } }, 'List'))),
        ...(langs.length >= 2 ? [el('div', { class: 'chips fchips' }, el('span', { class: 'note' }, 'Language: '), ...['All', ...langs].map((lang) => { const b = el('button', { type: 'button', class: 'chip' + (lang === 'All' ? ' active' : ''), onclick: () => { st.lang = lang; layout(); } }, lang === 'All' ? 'All languages' : lang + ' ' + m.languages.find((x) => x.language === lang).songs); langBtns[lang] = b; return b; }))] : []),
        el('p', { class: 'note' }, el('span', { class: 'cdot cdot-green' }), 'confirmed by 2+ independent sources   ', el('span', { class: 'cdot cdot-amber' }), 'one source   ', el('span', { class: 'cdot cdot-red' }), 'only in a community playlist. Solid buttons are direct catalog links; dashed ones open a search.'),
        countNote,
        ...(scope ? [el('p', { class: 'note' }, 'Showing music that belongs to ' + (scope.name || 'Season ' + scope.number) + (scope.airYear ? ' (aired ' + scope.airYear + ')' : '') + '. Albums that name another season are hidden' + (m.season && m.season.excluded ? ' (' + m.season.excluded + ' hidden)' : '') + '.')] : []),
        ...(scope && !items.length ? [el('p', { class: 'note' }, 'Nothing was found that is tied to this season yet.')] : []),
        listBox,
        ...(otherNodes.length ? [el('details', { class: 'tsection tother' }, el('summary', {}, 'Other music from the whole series, not tied to a season · ' + (otherSecs.reduce((n, x) => n + x.tracks.length, 0) === 1 ? '1 song' : otherSecs.reduce((n, x) => n + x.tracks.length, 0) + ' songs')), el('div', {}, ...otherNodes))] : []),
        ...(m.verified === 'none' ? [el('p', { class: 'note' }, 'We could not verify that these albums belong to this title: no composer credit on TMDB and no Wikipedia tracklist. They were matched by name only, so songs are marked unverified (red) unless two catalogs agree.')] : []),
        ...((m.skipped || []).length ? [el('p', { class: 'note' }, 'Skipped ' + m.skipped.length + (m.skipped.length === 1 ? ' album' : ' albums') + ' with the same name that did not match this title\'s composer: ' + m.skipped.map((x) => x.name).join('; ') + '.')] : []),
        ...(m.partial && !isFast ? [el('p', { class: 'note' }, 'Some sources were too slow or unreachable, so this list may be incomplete. ', el('button', { type: 'button', class: 'chip', onclick: reload }, 'Check again'))] : []),
        el('p', { class: 'note' }, 'Looking somewhere else? ', yt));
      body.replaceChildren(wrap);
      syncControls();
      layout();
      resolveQueue(toResolve, token, 2);
    };

    // Two stages: the fast one (Wikipedia + Apple Music + Deezer) shows songs quickly; the full one adds MusicBrainz, AnimeThemes and
    // other-language names and replaces it. If the full answer arrives first, the late fast answer is ignored.
    const start = (fresh) => {
      fullDone = false; rendered = false;
      body.replaceChildren(skeleton());
      call(url + '&fast=1' + (fresh ? '&fresh=1' : '')).then((m) => { if (!fullDone) render(m, true); }).catch(() => { /* the full request reports errors */ });
      call(url + (fresh ? '&fresh=1' : '')).then((m) => { fullDone = true; render(m, false); }).catch((e) => {
        fullDone = true;
        if (token === viewToken && !rendered) body.replaceChildren(el('p', { class: 'note' }, 'Could not load the soundtrack: ' + e.message + ' '), el('button', { type: 'button', class: 'chip', onclick: () => start(true) }, 'Try again'), ' ', yt);
      });
    };
    start(false);
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