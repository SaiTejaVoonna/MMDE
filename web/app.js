// MMDE prototype frontend. No dependencies. All dynamic text goes through textContent (no innerHTML).
const $app = document.getElementById('app');
const mediaCache = new Map(); // id -> media object from search, needed to start a discovery

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
};
const PLATFORM_LABEL = { spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube', youtubeMusic: 'YouTube Music', deezer: 'Deezer' };
const ROLE_FILTERS = ['All', 'Openings', 'Endings', 'Insert Songs', 'Character Songs', 'OST', 'Original Score'];

function landing() {
  const input = el('input', { class: 'search', type: 'search', placeholder: 'Search an anime, movie, game or show...', autocomplete: 'off', 'aria-label': 'Search media' });
  const suggest = el('div', { class: 'suggest', hidden: true });
  const status = el('div', { class: 'note' });
  let timer = 0, seq = 0;
  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) { suggest.hidden = true; status.textContent = ''; return; }
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      suggest.replaceChildren(...r.results.map((m) => {
        mediaCache.set(m.id, m);
        return el('button', { type: 'button', onclick: () => { location.hash = `#/media/${encodeURIComponent(m.id)}`; } },
          m.title, el('small', {}, `${m.type}${m.year ? ' · ' + m.year : ''}`));
      }));
      suggest.hidden = r.results.length === 0;
      status.textContent = r.results.length ? '' : `No results from: ${r.sources.join(', ')}.` + (r.errors.length ? ` Errors: ${r.errors.join('; ')}` : '');
    } catch (e) { status.textContent = `Search failed: ${e.message}`; }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  const examples = ['That Time I Got Reincarnated as a Slime', 'Jujutsu Kaisen', 'Attack on Titan', 'Naruto'];
  $app.replaceChildren(
    el('section', { class: 'hero' },
      el('h1', {}, 'Know the Title.', el('br'), el('em', {}, 'Discover the Music.')),
      el('p', {}, 'Search a title. MMDE finds its openings, endings, inserts and soundtracks, then links you to where the music lives.'),
      el('div', { class: 'searchwrap' }, input, suggest),
      status,
      el('div', { class: 'note' }, 'Try:'),
      el('div', { class: 'chips' }, examples.map((t) => el('button', { class: 'chip', type: 'button', onclick: () => { input.value = t; input.focus(); run(); } }, t))),
      el('div', { class: 'note' }, 'Offline mode only knows the local sample (Slime). Other titles need the live providers.'),
    ),
  );
  input.focus();
}

function header(media) {
  return el('div', { class: 'card' }, el('div', { class: 'mh' }, el('div', {},
    el('h2', {}, media.title),
    el('div', { class: 'meta' }, el('span', { class: 'tag' }, media.type), media.year ? el('span', { class: 'tag' }, String(media.year)) : null,
      ...Object.entries(media.externalIds || {}).map(([k, v]) => el('span', { class: 'tag' }, `${k}:${v}`))))));
}

function progressView(job) {
  return el('div', { class: 'card' }, el('strong', {}, 'Adding to discovery'),
    el('ul', { class: 'progress' }, job.steps.map((s) => el('li', {},
      el('span', { class: `dot ${s.state}` }, s.state === 'done' ? '✓' : s.state === 'error' ? '!' : ''),
      el('span', {}, s.label), s.detail ? el('small', {}, s.detail) : null))));
}

function trackRow(t) {
  const open = () => row.parentElement.classList.toggle('open');
  const links = t.links.map((l) => {
    const href = safeUrl(l.url);
    return href ? el('a', { class: `plat ${l.kind}`, href, onclick: (e) => e.stopPropagation(), target: '_blank', rel: 'noopener noreferrer', title: l.kind === 'search' ? 'Search link, not a verified match' : 'Matched item' },
      PLATFORM_LABEL[l.platform] + (l.kind === 'search' ? ' (search)' : '')) : null;
  });
  const row = el('div', { class: 'row', onclick: open, role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') open(); } },
    el('span', { class: 'pos' }, t.position || ''),
    el('div', {}, el('div', { class: 'tt' }, t.title), el('div', { class: 'ta' }, t.artists.join(', ') || 'unknown artist')),
    el('div', { class: 'right' }, links, el('span', { class: `st ${t.status}`, title: `confidence ${t.confidence}` }, t.status)));
  const detail = el('div', { class: 'detail' },
    el('div', {}, `Version: ${t.version} · confidence ${t.confidence}` + (t.recording?.mbid ? ` · MusicBrainz ${t.recording.mbid}` : '') + (t.recording?.isrcs?.length ? ` · ISRC ${t.recording.isrcs.join(', ')}` : '')),
    el('div', {}, 'Evidence:'),
    el('ul', {}, t.evidence.map((e) => { const href = safeUrl(e.url); return el('li', {}, `${e.provider}: `, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, e.url) : (e.url || 'no source URL'), e.quote ? ` - "${e.quote}"` : ''); })));
  return el('div', { class: 'track' }, row, detail);
}

function resultView(r, filter, rerender, onRefresh) {
  const counts = { confirmed: 0, suggested: 0, unverified: 0 };
  r.tracks.forEach((t) => counts[t.status]++);
  const roleLabels = new Set(r.groups.flatMap((g) => g.roles.map((x) => x.role)));
  const parts = r.groups.map((g) => {
    const roles = g.roles.filter((x) => filter === 'All' || x.role === filter);
    return roles.length ? el('div', {}, el('h3', { class: 'part' }, g.part), roles.map((x) => el('div', {}, el('h4', { class: 'role' }, x.role), x.tracks.map(trackRow)))) : null;
  });
  const relevant = r.releases.filter((x) => filter === 'All' || (filter === 'OST' && x.kind === 'ost'));
  const releases = relevant.length
    ? el('div', {}, el('h3', { class: 'part' }, 'Soundtrack releases'), relevant.map((x) => {
      const href = safeUrl(x.evidence.url);
      return el('div', { class: 'card rel' }, el('div', {}, el('div', { class: 'tt' }, x.title), el('div', { class: 'ta' }, x.artists.join(', ')),
        el('div', { class: 'ta' }, [x.kind.toUpperCase(), x.label, x.trackCount ? `${x.trackCount} tracks` : null, x.date, x.part ? `(${x.part.kind})` : null].filter(Boolean).join(' · '))),
        el('div', {}, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, 'source') : el('span', { class: 'ta' }, 'no source URL')));
    }))
    : null;
  const noOst = !roleLabels.has('OST') && !roleLabels.has('Original Score') && !r.releases.some((x) => x.kind === 'ost')
    ? el('div', { class: 'empty' }, 'No OST or original score found yet for this title. That usually means the sources queried had none, not that none exists.') : null;
  return el('div', {},
    header(r.media),
    el('div', { class: 'card' }, el('div', { class: 'meta' }, `${r.tracks.length} tracks · `, el('span', { class: 'st confirmed' }, `${counts.confirmed} confirmed`), el('span', { class: 'st suggested' }, `${counts.suggested} suggested`), el('span', { class: 'st unverified' }, `${counts.unverified} unverified`),
      el('span', {}, `sources: ${r.sources.join(', ')}`), el('button', { class: 'btn ghost', type: 'button', onclick: onRefresh }, 'Re-discover')),
      el('div', { class: 'chips' }, ROLE_FILTERS.map((f) => el('button', { class: `chip ${f === filter ? 'on' : ''}`, type: 'button', onclick: () => rerender(f) }, f)))),
    parts, releases, filter === 'All' || filter === 'OST' ? noOst : null,
    r.errors.length ? el('div', { class: 'card warn' }, 'Provider notes: ', r.errors.join(' | ')) : null);
}

async function mediaPage(id) {
  let filter = 'All';
  const show = (r) => {
    const draw = () => $app.replaceChildren(el('a', { href: '#/' }, '← Back to search'), resultView(r, filter, (f) => { filter = f; draw(); }, () => discover(r.media)));
    draw();
  };
  const discover = async (media) => {
    $app.replaceChildren(el('a', { href: '#/' }, '← Back to search'), header(media), el('div', { class: 'note' }, 'Starting discovery...'));
    try {
      const { jobId } = await api('/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ media }) });
      for (;;) {
        const job = await api(`/api/jobs/${jobId}`);
        $app.replaceChildren(el('a', { href: '#/' }, '← Back to search'), header(media), progressView(job));
        if (job.state === 'error') throw new Error(job.error || 'discovery failed');
        if (job.state === 'done') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      show(await api(`/api/media/${encodeURIComponent(media.id)}`));
    } catch (e) {
      $app.replaceChildren(el('a', { href: '#/' }, '← Back to search'), el('div', { class: 'card warn' }, `Discovery failed: ${e.message}`));
    }
  };
  try { show(await api(`/api/media/${encodeURIComponent(id)}`)); }
  catch (e) {
    if (e.status !== 404) return $app.replaceChildren(el('div', { class: 'card warn' }, e.message));
    const media = mediaCache.get(id);
    if (!media) { location.hash = '#/'; return; }
    discover(media);
  }
}

function route() {
  const m = location.hash.match(/^#\/media\/(.+)$/);
  if (m) mediaPage(decodeURIComponent(m[1])); else landing();
}
window.addEventListener('hashchange', route);
route();
