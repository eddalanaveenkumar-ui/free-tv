// ============================================================
// FreeTV — OTT-style app (rails + full-screen player)
// ============================================================
(() => {
'use strict';

const DATA = 'public/data';
const PAGE = 30;              // channels rendered per page
const FAV_KEY = 'freetv:favs';
const RECENT_KEY = 'freetv:recent';

// ---------------- DOM ----------------
const $ = (id) => document.getElementById(id);
const el = {
  topbar: $('topbar'),
  page: $('page'),
  hero: $('hero'),
  heroBg: $('heroBg'),
  heroArt: $('heroArt'),
  heroTitle: $('heroTitle'),
  heroSub: $('heroSub'),
  heroMeta: $('heroMeta'),
  heroPlay: $('heroPlay'),
  heroInfo: $('heroInfo'),

  searchInput: $('searchInput'),
  searchClear: $('searchClear'),
  favBtn: $('favBtn'),

  rails: $('rails'),
  recentRail: $('recentRail'),
  recentScroll: $('recentScroll'),
  featuredScroll: $('featuredScroll'),
  chips: $('chips'),
  trendingScroll: $('trendingScroll'),
  countryRail: $('countryRail'),
  countryRails: $('countryRails'),

  results: $('results'),
  resultsTitle: $('resultsTitle'),
  resultsCount: $('resultsCount'),
  resultsGrid: $('resultsGrid'),
  resultsSentinel: $('resultsSentinel'),

  browse: $('browse'),
  browseBack: $('browseBack'),
  browseTitle: $('browseTitle'),
  browseCount: $('browseCount'),
  browseGrid: $('browseGrid'),
  browseSentinel: $('browseSentinel'),
  browseEmpty: $('browseEmpty'),

  player: $('player'),
  video: $('video'),
  playerClose: $('playerClose'),
  npName: $('npName'),
  npMeta: $('npMeta'),
  npFav: $('npFav'),
  playerStage: $('playerStage'),
  playerLoading: $('playerLoading'),
  loadingText: $('loadingText'),
  playerError: $('playerError'),
  playerErrorMsg: $('playerErrorMsg'),
  retryBtn: $('retryBtn'),
  nextMirrorBtn: $('nextMirrorBtn'),
  mirrors: $('mirrors'),
  playerChips: $('playerChips'),
  upNextScroll: $('upNextScroll'),

  bottomnav: $('bottomnav'),
};

// ---------------- state ----------------
let channels = [];              // expanded from catalog
let byId = new Map();
let byCountry = new Map();
let countries = [];
let categories = [];
let shelves = { featured: [], trending: [], countries: [] };
let favs = new Set();
let recent = [];

let view = 'home';              // home | browse | favorites
let query = '';

// player state
let current = null;
let mirrors = [];
let mirrorIndex = 0;
let hls = null;
let attemptId = 0;        // bumps when a different channel is opened
let playId = 0;           // bumps every stream switch inside the same channel
let isOpen = false;
let heroTimer = null;

// ---------------- helpers ----------------
const qRank = (q) => { const m = (q || '').match(/(\d{3,4})/); return m ? +m[1] : 0; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const initials = (name) => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }
function restore(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (_) { return fallback; } }

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// ---------------- boot ----------------
async function boot() {
  try {
    const [catalog, countriesData, categoriesData, shelvesData, indexData] = await Promise.all([
      getJSON(`${DATA}/catalog.json`),
      getJSON(`${DATA}/countries.json`),
      getJSON(`${DATA}/categories.json`),
      getJSON(`${DATA}/shelves.json`).catch(() => ({ featured: [], trending: [], countries: [] })),
      getJSON(`${DATA}/index.json`).catch(() => null),
    ]);

    countries = countriesData;
    categories = categoriesData;
    shelves = shelvesData;

    const countryMeta = new Map(countries.map(c => [c.code, c]));

    channels = catalog.map(([id, name, cc, category, quality, logo]) => {
      const meta = countryMeta.get(cc) || {};
      return {
        id, name, countryCode: cc, category, quality: quality || '',
        logo: logo || '', country: meta.name || cc, flag: meta.flag || '🌍',
        mirrors: null,
      };
    });

    byId = new Map(channels.map(c => [c.id, c]));
    for (const c of channels) {
      if (!byCountry.has(c.countryCode)) byCountry.set(c.countryCode, []);
      byCountry.get(c.countryCode).push(c);
    }

    favs = new Set(restore(FAV_KEY, []));
    recent = restore(RECENT_KEY, []);

    if (indexData) document.querySelector('meta[name=description]')
      .setAttribute('content', `${indexData.total.toLocaleString()} free live TV channels from ${indexData.countries} countries.`);

    buildHero();
    buildRails();
    bindGlobal();
    handleRoute();
  } catch (err) {
    console.error(err);
    el.rails.innerHTML = `<div class="empty-msg">Couldn't load channels. Check your connection and reload.</div>`;
  }
}

// ---------------- lazy stream data ----------------
const countryData = new Map();
async function loadStreams(ch) {
  if (ch.mirrors && ch.mirrors.length) return ch.mirrors;
  const cc = ch.countryCode;
  if (!countryData.has(cc)) {
    const p = getJSON(`${DATA}/ch/${cc}.json`).then((list) => {
      for (const full of list) {
        const c = byId.get(full.id);
        if (!c) continue;
        const all = [full.url, ...(full.mirrors || [])].filter(Boolean);
        c.mirrors = [...new Set(all)];
      }
      return list;
    }).catch((e) => { countryData.delete(cc); throw e; });
    countryData.set(cc, p);
  }
  await countryData.get(cc);
  return ch.mirrors || [];
}

// ---------------- hero ----------------
function buildHero() {
  const lead = (shelves.featured || []).map(id => byId.get(id)).filter(Boolean).slice(0, 8);
  if (!lead.length) return;

  let i = Math.floor(Math.random() * lead.length);
  paintHero(lead[i]);

  // gentle rotation so the hero feels alive
  clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    if (view !== 'home' || isOpen) return;
    i = (i + 1) % lead.length;
    paintHero(lead[i]);
  }, 9000);
}

function paintHero(pick) {
  if (!pick) return;
  el.heroTitle.textContent = pick.name;
  el.heroSub.textContent = `${pick.country} • ${pick.category} — streaming free, live right now. No signup needed.`;
  el.heroMeta.innerHTML = [
    pick.quality ? `<span class="pill hd">${esc(pick.quality)}</span>` : '',
    `<span class="pill">${esc(pick.category)}</span>`,
    `<span class="pill">${esc(pick.flag)} ${esc(pick.country)}</span>`,
  ].join('');
  el.heroArt.innerHTML = pick.logo
    ? `<img src="${esc(pick.logo)}" alt="${esc(pick.name)}" referrerpolicy="no-referrer"
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'hero-fallback',textContent:'${esc(initials(pick.name))}'}))">`
    : `<div class="hero-fallback">${esc(initials(pick.name))}</div>`;
  el.heroPlay.onclick = () => openPlayer(pick);
  el.heroInfo.onclick = () => openPlayer(pick);
}

// ---------------- tiles ----------------
function tile(ch, opts = {}) {
  const t = document.createElement('div');
  t.className = 'tile' + (opts.compact ? ' compact' : '');
  t.dataset.id = ch.id;
  t.setAttribute('role', 'button');
  t.setAttribute('tabindex', '0');

  const fav = favs.has(ch.id);
  const art = ch.logo
    ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
            onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:this.dataset.fb}))"
            data-fb="${esc(initials(ch.name))}">`
    : `<div class="fallback">${esc(initials(ch.name))}</div>`;

  t.innerHTML = `
    <div class="tile-art">
      ${art}
      <span class="tile-live">LIVE</span>
      ${ch.quality ? `<span class="tile-q">${esc(ch.quality.replace('P', ''))}</span>` : ''}
      <button class="tile-fav ${fav ? 'on' : ''}" aria-label="Favorite">${fav ? '★' : '☆'}</button>
    </div>
    <div class="tile-name">${esc(ch.name)}</div>
    <div class="tile-sub">${esc(ch.flag)} ${esc(ch.country)}${ch.category !== 'General' ? ' • ' + esc(ch.category) : ''}</div>`;

  t.addEventListener('click', (e) => {
    if (e.target.closest('.tile-fav')) {
      e.stopPropagation();
      toggleFav(ch.id);
      return;
    }
    openPlayer(ch);
  });
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(ch); }
  });
  return t;
}

function countryTile(c) {
  const t = document.createElement('div');
  t.className = 'tile country-tile';
  t.innerHTML = `
    <div class="tile-art"><span class="flag-big">${c.flag}</span></div>
    <div class="tile-name">${esc(c.name)}</div>
    <div class="tile-sub">${c.count} channels</div>`;
  t.onclick = () => showBrowse({ country: c.code, title: c.name });
  return t;
}

// ---------------- rails ----------------
// Rails load in chunks of 20 as you scroll sideways — never 100+ tiles at once.
const RAIL_CHUNK = 20;

function fillRail(container, chans) {
  container.innerHTML = '';
  container._list = chans;
  container._shown = 0;
  if (container._onScroll) container.removeEventListener('scroll', container._onScroll);

  const appendChunk = () => {
    const list = container._list || [];
    if (container._shown >= list.length) return;
    const slice = list.slice(container._shown, container._shown + RAIL_CHUNK);
    const frag = document.createDocumentFragment();
    for (const ch of slice) frag.appendChild(tile(ch));
    container.appendChild(frag);
    container._shown += slice.length;
  };

  appendChunk();

  const onScroll = () => {
    const { scrollLeft, scrollWidth, clientWidth } = container;
    if (scrollLeft + clientWidth > scrollWidth - 480) appendChunk();
  };
  container._onScroll = onScroll;
  container.addEventListener('scroll', onScroll, { passive: true });
}

function buildRails() {
  const byIdList = (ids) => (ids || []).map(id => byId.get(id)).filter(Boolean);

  // featured
  const featured = byIdList(shelves.featured);
  fillRail(el.featuredScroll, featured.length ? featured : channels.slice(0, RAIL_CHUNK));

  // continue watching
  const rec = byIdList(recent).slice(0, 20);
  if (rec.length) {
    el.recentRail.hidden = false;
    fillRail(el.recentScroll, rec);
  }

  // category chips
  el.chips.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'chip active';
  all.textContent = 'All';
  all.onclick = () => showBrowse({ title: 'All channels' });
  el.chips.appendChild(all);
  for (const cat of categories) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `${esc(cat.name)} <span style="opacity:.6">${cat.count}</span>`;
    b.onclick = () => showBrowse({ category: cat.name, title: cat.name });
    el.chips.appendChild(b);
  }

  // trending
  const trending = byIdList(shelves.trending);
  fillRail(el.trendingScroll, (trending.length ? trending : channels.slice(30, 90)).slice(0, 60));

  // countries
  const order = shelves.countries && shelves.countries.length ? shelves.countries : countries.slice(0, 12).map(c => c.code);
  const cmap = new Map(countries.map(c => [c.code, c]));
  el.countryRail.innerHTML = '';
  for (const code of order) {
    const c = cmap.get(code);
    if (c) el.countryRail.appendChild(countryTile(c));
  }

  // per-country rails (top 6 markets)
  el.countryRails.innerHTML = '';
  const useCodes = order.slice(0, 6);
  for (const code of useCodes) {
    const c = cmap.get(code);
    if (!c) continue;
    const list = (byCountry.get(code) || []).filter(x => x.logo).slice(0, 40);
    if (!list.length) continue;

    const section = document.createElement('section');
    section.className = 'rail';
    section.innerHTML = `
      <div class="rail-head">
        <h2>${esc(c.flag)} ${esc(c.name)}</h2>
        <span class="rail-sub">${c.count} channels</span>
        <button class="see-all">See all</button>
      </div>
      <div class="rail-scroll"></div>`;
    section.querySelector('.see-all').onclick = () => showBrowse({ country: code, title: c.name });
    const scroller = section.querySelector('.rail-scroll');
    fillRail(scroller, list);
    el.countryRails.appendChild(section);
  }
}

// ---------------- paged grid (30 at a time) ----------------
function makePager(gridEl, sentinelEl, emptyEl) {
  let list = [];
  let rendered = 0;
  let observer = null;
  let isShowing = () => true;

  function appendPage() {
    if (rendered >= list.length) return;
    const chunk = list.slice(rendered, rendered + PAGE);
    const frag = document.createDocumentFragment();
    for (const ch of chunk) frag.appendChild(tile(ch));
    gridEl.appendChild(frag);
    rendered += chunk.length;
    if (emptyEl) emptyEl.hidden = list.length > 0;
    sentinelEl.hidden = rendered >= list.length;
  }

  function set(newList) {
    list = newList;
    rendered = 0;
    gridEl.innerHTML = '';
    appendPage();
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some(e => e.isIntersecting)) return;
        if (!isShowing()) return;      // ignore sentinels of hidden views
        appendPage();
      }, { rootMargin: '420px' });
      observer.observe(sentinelEl);
      isShowing = () => {
        let node = gridEl;
        while (node && node !== document.body) {
          if (node.hidden) return false;
          node = node.parentElement;
        }
        return true;
      };
    }
  }
  return { set, appendPage };
}

// Two independent paged grids; each observer only feeds its own list.
const resultsPager = makePager(el.resultsGrid, el.resultsSentinel, null);
const browsePager = makePager(el.browseGrid, el.browseSentinel, el.browseEmpty);

// ---------------- views ----------------
function setActiveNav(name) {
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  document.querySelectorAll('.bnav').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
}

function showHome() {
  view = 'home';
  query = '';
  el.searchInput.value = '';
  el.searchClear.classList.remove('show');
  el.results.hidden = true;
  el.browse.hidden = true;
  el.rails.hidden = false;
  el.hero.hidden = false;
  document.body.classList.remove('search-mode');
  setActiveNav('home');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function filterList({ category, country }) {
  let list = channels;
  if (country) list = list.filter(c => c.countryCode === country);
  if (category && category !== 'All') list = list.filter(c => c.category === category);
  return list;
}

function showBrowse({ category, country, title } = {}) {
  view = 'browse';
  query = '';
  el.searchInput.value = '';
  el.searchClear.classList.remove('show');
  document.body.classList.remove('search-mode');

  el.rails.hidden = true;
  el.hero.hidden = true;
  el.results.hidden = true;
  el.browse.hidden = false;

  const list = filterList({ category, country });
  el.browseTitle.textContent = title || category || 'All channels';
  el.browseCount.textContent = `${list.length.toLocaleString()} channels`;
  browsePager.set(list);

  setActiveNav('browse');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showFavorites() {
  view = 'favorites';
  el.rails.hidden = true;
  el.hero.hidden = true;
  el.results.hidden = true;
  el.browse.hidden = false;

  const list = channels.filter(c => favs.has(c.id));
  el.browseTitle.textContent = 'Your favorites';
  el.browseCount.textContent = `${list.length} channel${list.length === 1 ? '' : 's'}`;
  el.browseEmpty.textContent = 'No favorites yet — tap ☆ on any channel.';
  browsePager.set(list);

  setActiveNav('favorites');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function runSearch(q) {
  query = q.trim();
  el.searchClear.classList.toggle('show', !!query);

  if (!query) {
    el.results.hidden = true;
    if (view === 'home') { el.rails.hidden = false; el.hero.hidden = false; }
    return;
  }

  const needle = query.toLowerCase();
  const list = channels.filter(c =>
    c.name.toLowerCase().includes(needle) ||
    c.country.toLowerCase().includes(needle) ||
    c.countryCode.toLowerCase().includes(needle) ||
    c.category.toLowerCase().includes(needle)
  );

  el.rails.hidden = true;
  el.hero.hidden = true;
  el.browse.hidden = true;
  el.results.hidden = false;
  el.resultsTitle.textContent = `Results for “${query}”`;
  el.resultsCount.textContent = `${list.length.toLocaleString()} found`;
  resultsPager.set(list);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------------- favorites ----------------
function toggleFav(id) {
  if (favs.has(id)) favs.delete(id); else favs.add(id);
  store(FAV_KEY, [...favs]);
  // update every visible tile for this channel
  document.querySelectorAll(`.tile[data-id="${CSS.escape(id)}"] .tile-fav`).forEach(btn => {
    const on = favs.has(id);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
  });
  if (current && current.id === id) updatePlayerFav();
  el.favBtn.classList.toggle('on', favs.size > 0);
  if (view === 'favorites') showFavorites();
}

function updatePlayerFav() {
  const on = current && favs.has(current.id);
  el.npFav.textContent = on ? '★' : '☆';
  el.npFav.classList.toggle('on', !!on);
}

// ---------------- player ----------------
function openPlayer(ch) {
  current = ch;
  isOpen = true;

  el.player.classList.add('open');
  el.player.setAttribute('aria-hidden', 'false');
  document.body.classList.add('playing');
  history.replaceState({ channel: ch.id }, '', '#' + ch.id);

  el.npName.textContent = ch.name;
  el.npMeta.textContent = [ch.flag + ' ' + ch.country, ch.category, ch.quality].filter(Boolean).join(' • ');
  updatePlayerFav();

  el.playerChips.innerHTML = [
    ch.quality ? `<span class="mini-chip">${esc(ch.quality)}</span>` : '',
    `<span class="mini-chip">${esc(ch.category)}</span>`,
    `<span class="mini-chip">${esc(ch.country)}</span>`,
  ].join('');

  el.playerError.hidden = true;
  el.playerLoading.hidden = false;
  el.loadingText.textContent = 'Connecting…';
  el.mirrors.innerHTML = '';

  buildUpNext(ch);
  recordRecent(ch.id);

  // resolve streams lazily
  const myAttempt = ++attemptId;
  loadStreams(ch).then((list) => {
    if (myAttempt !== attemptId) return;
    mirrors = list.filter(Boolean);
    if (!mirrors.length) { failPlayer('No stream available for this channel.'); return; }
    startPlayback(0, myAttempt);
  }).catch((err) => {
    console.error(err);
    if (myAttempt === attemptId) failPlayer('Could not load this channel\'s stream.');
  });
}

function closePlayer() {
  isOpen = false;
  attemptId++;
  playId++;
  destroyHls();
  el.video.pause();
  el.video.removeAttribute('src');
  try { el.video.load(); } catch (_) {}
  el.player.classList.remove('open');
  el.player.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('playing');
  history.replaceState(null, '', location.pathname + location.search);
}

// Autoplay is often blocked with sound. Try unmuted, fall back to muted.
// Every await re-checks that we are still the active playback request — a
// previous stream's play() promise can resolve after the user switched.
async function playVideo(isCurrent) {
  const v = el.video;
  if (!isCurrent()) return false;
  try {
    v.muted = false;
    await v.play();
    return isCurrent();
  } catch (err) {
    if (!isCurrent() || (err && err.name === 'AbortError')) return false;
    try {
      v.muted = true;
      await v.play();
      return isCurrent();
    } catch (e2) {
      return false;
    }
  }
}

function destroyHls() {
  if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
}

function failPlayer(msg) {
  el.playerLoading.hidden = true;
  el.playerError.hidden = false;
  el.playerErrorMsg.textContent = msg;
}

function renderMirrors() {
  el.mirrors.innerHTML = '';
  if (mirrors.length <= 1) return;
  mirrors.forEach((url, i) => {
    const b = document.createElement('button');
    b.className = 'mirror-btn' + (i === mirrorIndex ? ' active' : '');
    b.textContent = `Stream ${i + 1}`;
    b.title = url;
    b.onclick = () => {
      if (i === mirrorIndex) return;
      mirrorIndex = i;
      renderMirrors();
      startPlayback(i, ++attemptId);
    };
    el.mirrors.appendChild(b);
  });
}

// Skip http:// mirrors when the page is on https — browsers block mixed media.
function usableMirrors() {
  if (location.protocol !== 'https:') return mirrors;
  return mirrors.filter(u => u.startsWith('https://'));
}

async function startPlayback(index, myAttempt) {
  const usable = usableMirrors();
  if (!usable.length) {
    failPlayer('This channel only offers http:// streams, which browsers block on secure pages. Try another channel.');
    return;
  }
  mirrorIndex = Math.min(index, usable.length - 1);
  const url = usable[mirrorIndex];
  const myPlay = ++playId;

  destroyHls();
  el.playerError.hidden = true;
  el.playerLoading.hidden = false;
  el.loadingText.textContent = usable.length > 1
    ? `Connecting to stream ${mirrorIndex + 1} of ${usable.length}…`
    : 'Connecting…';
  renderMirrors();

  const v = el.video;
  v.removeAttribute('src');
  try { v.load(); } catch (_) {}

  const isHls = /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url);
  const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== '';

  const done = () => {
    if (myAttempt !== attemptId) return;
    el.playerLoading.hidden = true;
    el.playerError.hidden = true;
  };

  const restart = setInterval(async () => {
    if (!hls || myAttempt !== attemptId) { clearInterval(restart); return; }
    try { await hls.startLoad(); } catch (_) {}
    clearInterval(restart);
  }, 2000);

  if (isHls && !nativeHls && window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      manifestLoadingMaxRetry: 1,
      levelLoadingMaxRetry: 1,
      fragLoadingMaxRetry: 2,
      manifestLoadingTimeOut: 8000,
      levelLoadingTimeOut: 8000,
      fragLoadingTimeOut: 12000,
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    const isCurrent = () => playId === myPlay;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      clearInterval(restart);
      if (!isCurrent()) return;
      playVideo(isCurrent);
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal || myAttempt !== attemptId) return;
      clearInterval(restart);
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          if (mirrorIndex + 1 < usableMirrors().length) startPlayback(mirrorIndex + 1, ++attemptId);
          else failPlayer('This stream is offline or unreachable right now. Try another channel.');
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          try { hls.recoverMediaError(); } catch (_) { failPlayer('Playback error — try another stream.'); }
          break;
        default:
          failPlayer('This channel isn\'t responding. Try another stream or channel.');
      }
    });
    v.addEventListener('playing', done, { once: true });
  } else {
    // native playback (Safari HLS / direct mp4)
    clearInterval(restart);
    v.src = url;
    v.addEventListener('loadeddata', done, { once: true });
    v.addEventListener('error', () => {
      if (myAttempt !== attemptId) return;
      const use = usableMirrors();
      if (mirrorIndex + 1 < use.length) startPlayback(mirrorIndex + 1, ++attemptId);
      else failPlayer('This stream can\'t be played in your browser. Try another channel.');
    }, { once: true });
    playVideo(() => playId === myPlay);
  }
}

function buildUpNext(ch) {
  const pool = (byCountry.get(ch.countryCode) || []).filter(c => c.id !== ch.id && c.logo);
  const pick = (pool.length >= 8 ? pool : channels.filter(c => c.logo && c.category === ch.category))
    .slice(0, 20);
  el.upNextScroll.innerHTML = '';
  for (const c of pick) {
    const t = tile(c);
    t.style.width = '132px';
    el.upNextScroll.appendChild(t);
  }
}

function recordRecent(id) {
  recent = [id, ...recent.filter(x => x !== id)].slice(0, 20);
  store(RECENT_KEY, recent);
}

// ---------------- global events ----------------
let searchTimer = null;

function bindGlobal() {
  // top bar shadow
  window.addEventListener('scroll', () => {
    el.topbar.classList.toggle('scrolled', window.scrollY > 12);
  }, { passive: true });

  // search
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const val = el.searchInput.value;
    el.searchClear.classList.toggle('show', !!val);
    searchTimer = setTimeout(() => runSearch(val), 180);
  });
  el.searchClear.onclick = () => {
    el.searchInput.value = '';
    el.searchInput.focus();
    runSearch('');
  };

  // nav
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.onclick = () => {
      const target = btn.dataset.nav;
      if (target === 'home') { showHome(); }
      else if (target === 'search') {
        document.body.classList.add('search-mode');
        el.searchInput.focus();
      }
      else if (target === 'browse') { showBrowse({ title: 'All channels' }); }
      else if (target === 'favorites') { showFavorites(); }
      else { showBrowse({ category: target.replace(/^\w/, c => c.toUpperCase()), title: target.replace(/^\w/, c => c.toUpperCase()) }); }
      setActiveNav(target);
    };
  });

  el.favBtn.onclick = () => { showFavorites(); };
  el.browseBack.onclick = () => { showHome(); };

  // player
  el.playerClose.onclick = closePlayer;
  el.npFav.onclick = () => { if (current) toggleFav(current.id); };
  el.retryBtn.onclick = () => { if (current) startPlayback(mirrorIndex, ++attemptId); };
  el.nextMirrorBtn.onclick = () => {
    const use = usableMirrors();
    if (use.length > 1) startPlayback((mirrorIndex + 1) % use.length, ++attemptId);
    else failPlayer('No other streams to try.');
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isOpen) closePlayer();
      else if (document.body.classList.contains('search-mode')) {
        document.body.classList.remove('search-mode');
        runSearch('');
      }
    }
  });

  // reflect favorite state on the top bar
  el.favBtn.classList.toggle('on', favs.size > 0);

  // back/forward support for grid views
  window.addEventListener('popstate', handleRoute);
}

function handleRoute() {
  const hash = location.hash.replace('#', '');
  if (hash && byId.has(hash)) {
    showHome();
    setTimeout(() => openPlayer(byId.get(hash)), 120);
  }
}

boot();
})();
