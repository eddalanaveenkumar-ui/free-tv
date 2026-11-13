// Free TV — application logic
(() => {
  const BASE = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
  const DATA_DIR = 'public/data';

  // --- DOM elements ---
  const els = {
    grid: document.getElementById('channelGrid'),
    status: document.getElementById('status'),
    countText: document.getElementById('countText'),
    viewTitle: document.getElementById('viewTitle'),
    emptyMsg: document.getElementById('emptyMsg'),
    sentinel: document.getElementById('sentinel'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    categoryPills: document.getElementById('categoryPills'),
    countrySearch: document.getElementById('countrySearch'),
    countryList: document.getElementById('countryList'),
    favHint: document.getElementById('favHint'),
    favPills: document.getElementById('favPills'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    sidebarClose: document.getElementById('sidebarClose'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    sidebar: document.getElementById('sidebar'),
    playerPanel: document.getElementById('playerPanel'),
    playerClose: document.getElementById('playerClose'),
    player: document.getElementById('player'),
    playerLoading: document.getElementById('playerLoading'),
    playerError: document.getElementById('playerError'),
    playerErrorMsg: document.getElementById('playerError').querySelector('.player-error-msg'),
    retryPlayer: document.getElementById('retryPlayer'),
    npName: document.getElementById('npName'),
    npMeta: document.getElementById('npMeta'),
    npFlag: document.getElementById('npFlag'),
    npFav: document.getElementById('npFav'),
    npFullscreen: document.getElementById('npFullscreen'),
    mirrorList: document.getElementById('mirrorList'),
    streamInfo: document.getElementById('streamInfo'),
    playerHint: document.getElementById('playerHint'),
    viewGrid: document.getElementById('viewGrid'),
    viewList: document.getElementById('viewList'),
    channelTpl: document.getElementById('channelTpl'),
    metaBadge: document.getElementById('metaBadge')
  };

  // --- State ---
  let channels = [];
  let countries = [];
  let categories = [];
  let filters = {
    q: '',
    category: 'All',
    country: '',
    favorites: false
  };
  let viewMode = 'grid'; // grid | list
  let favorites = new Set();
  let current = null;
  let currentMirrors = [];
  let channelsById = new Map();
  let countryByCode = new Map();
  let streamWatchdog = null;

  // --- Parse initial filters from URL query ---
  function initFiltersFromUrl() {
    const params = new URLSearchParams(location.search);
    if (params.get('q')) filters.q = params.get('q');
    if (params.get('category')) filters.category = params.get('category');
    if (params.get('country')) filters.country = params.get('country');
    if (params.get('favs') === '1') filters.favorites = true;
    if (params.get('view')) viewMode = params.get('view');
    if (filters.q) els.searchInput.value = filters.q;
    if (filters.country) els.countrySearch.value = filters.country;
  }

  function pushFilterUrl() {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.category && filters.category !== 'All') params.set('category', filters.category);
    if (filters.country) params.set('country', filters.country);
    if (filters.favorites) params.set('favs', '1');
    params.set('view', viewMode);
    const qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }

  // --- Data loading ---
  // Compact catalog row -> channel object (streams loaded lazily)
  // row = [id, name, countryCode, category, quality]
  function expandRow(row) {
    const [id, name, countryCode, category, quality] = row;
    const countryMeta = countryByCode.get(countryCode);
    return {
      id, name, countryCode, category, quality,
      country: countryMeta ? countryMeta.name : countryCode,
      flag: countryMeta ? countryMeta.flag : '🌍',
      mirrors: null // lazy
    };
  }

  async function loadData() {
    const [indexData, catalogData, countriesData, categoriesData] = await Promise.all([
      fetchJSON(`${DATA_DIR}/index.json`),
      fetchJSON(`${DATA_DIR}/catalog.json`),
      fetchJSON(`${DATA_DIR}/countries.json`),
      fetchJSON(`${DATA_DIR}/categories.json`)
    ]);

    countries = countriesData;
    categories = categoriesData;
    countryByCode = new Map(countries.map(c => [c.code, c]));

    // Build the in-memory index of all channels from compact rows (~900 KB)
    channels = catalogData.map(expandRow);
    channelsById = new Map(channels.map(c => [c.id, c]));

    els.metaBadge.textContent = `${indexData.total} channels • ${indexData.countries} countries`;

    loadFavorites();
    renderFilters();
    renderChannels();
    initPlayerEvents();
    maybePlayFromUrl();
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  // Lazily fetch full channel records (with stream URLs) for one country
  const countryDataPromises = new Map();
  async function ensureCountryChannels(code) {
    if (!countryDataPromises.has(code)) {
      const p = fetchJSON(`${DATA_DIR}/ch/${code}.json`)
        .then(list => {
          for (const full of list) {
            const ch = channelsById.get(full.id);
            if (ch) {
              const all = [full.url, ...(full.mirrors || [])].filter(Boolean);
              ch.mirrors = [...new Set(all)];
            }
          }
          return list;
        })
        .catch(err => { countryDataPromises.delete(code); throw err; });
      countryDataPromises.set(code, p);
    }
    return countryDataPromises.get(code);
  }

  async function ensureChannelStreams(ch) {
    if (ch.mirrors && ch.mirrors.length) return ch.mirrors;
    await ensureCountryChannels(ch.countryCode);
    if (!ch.mirrors || !ch.mirrors.length) throw new Error('No playable stream');
    return ch.mirrors;
  }

  function setStatus(msg, type) {
    els.status.textContent = msg;
    els.status.className = `status show ${type || 'info'}`;
  }

  // --- Favorites (localStorage) ---
  function loadFavorites() {
    try {
      const raw = localStorage.getItem('freetv-favorites');
      if (raw) favorites = new Set(JSON.parse(raw));
    } catch (_) { favorites = new Set(); }
  }
  function saveFavorites() {
    try { localStorage.setItem('freetv-favorites', JSON.stringify([...favorites])); } catch (_) {}
  }
  function isFav(id) { return favorites.has(id); }
  function toggleFav(id) {
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    saveFavorites();
    renderFavs();
    renderChannels();
    updateNpFav();
  }

  // --- Render filters ---
  function renderFilters() {
    // Categories
    els.categoryPills.innerHTML = '';
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = `pill ${filters.category === 'All' ? 'active' : ''}`;
    allPill.textContent = `All`;
    allPill.onclick = () => setFilter('category', 'All');
    els.categoryPills.appendChild(allPill);
    for (const cat of categories) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pill ${filters.category === cat.name ? 'active' : ''}`;
      b.innerHTML = `${escapeHtml(cat.name)} <small>${cat.count}</small>`;
      b.onclick = () => setFilter('category', cat.name);
      els.categoryPills.appendChild(b);
    }

    // Countries
    renderCountryList();

    // Favorites
    renderFavs();
  }

  function renderCountryList() {
    els.countryList.innerHTML = '';
    const term = els.countrySearch.value.toLowerCase();
    const filtered = countries.filter(c =>
      c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term)
    );
    for (const c of filtered) {
      const item = document.createElement('div');
      item.className = `country-item ${filters.country === c.code ? 'active' : ''}`;
      item.innerHTML = `<span class="flag">${c.flag}</span><span class="name">${escapeHtml(c.name)}</span><span class="count">${c.count}</span>`;
      item.onclick = () => setFilter('country', c.code);
      els.countryList.appendChild(item);
    }
  }

  function renderFavs() {
    const count = favorites.size;
    els.favHint.textContent = count ? `${count} favorite channel${count === 1 ? '' : 's'}` : 'No favorites yet. Tap ★ on a channel.';
    els.favPills.innerHTML = '';
    if (!count) return;
    const favChannels = channels.filter(ch => isFav(ch.id));
    for (const ch of favChannels.slice(0, 24)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill active';
      b.innerHTML = `${ch.flag} ${escapeHtml(ch.name)}`;
      b.title = ch.country;
      b.onclick = (e) => { e.stopPropagation(); selectChannel(ch); };
      els.favPills.appendChild(b);
    }
  }

  function setFilter(key, value) {
    filters[key] = value;
    if (key === 'country') els.countrySearch.value = '';
    if (key === 'category') {
      // highlight pill handled by re-render
    }
    renderFilters();
    renderChannels();
    pushFilterUrl();
  }

  // --- Render channels ---
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function matchesFilters(ch) {
    if (filters.favorites && !isFav(ch.id)) return false;
    if (filters.category && filters.category !== 'All' && ch.category !== filters.category) return false;
    if (filters.country && ch.countryCode !== filters.country) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!ch.name.toLowerCase().includes(q) &&
          !ch.country.toLowerCase().includes(q) &&
          !ch.countryCode.toLowerCase().includes(q) &&
          !ch.category.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  // --- Incremental rendering (only ~120 cards in the DOM at a time) ---
  const PAGE_SIZE = 60;
  let filteredList = [];
  let renderedCount = 0;
  let sentinelObserver = null;

  function cardFor(ch) {
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${ch.name}, ${ch.country}`);
    card.dataset.id = ch.id;
    card.innerHTML =
      `<div class="card-flag">${ch.flag}</div>
       <div class="card-body">
         <div class="card-name">${escapeHtml(ch.name)}</div>
         <div class="card-meta">${escapeHtml(ch.country)}${ch.category !== 'General' ? ' • ' + escapeHtml(ch.category) : ''}${ch.quality ? ' • ' + ch.quality : ''}</div>
       </div>
       <div class="card-quality">${ch.quality || ''}</div>
       <button class="card-fav ${isFav(ch.id) ? 'on' : ''}" data-id="${escapeHtmlAttr(ch.id)}" title="${isFav(ch.id) ? 'Remove from favorites' : 'Add to favorites'}">${isFav(ch.id) ? '★' : '☆'}</button>`;
    card.onclick = (e) => { if (e.target.classList.contains('card-fav')) return; selectChannel(ch); };
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChannel(ch); } };
    card.querySelector('.card-fav').onclick = (e) => { e.stopPropagation(); toggleFav(ch.id); };
    return card;
  }

  function appendPage() {
    if (renderedCount >= filteredList.length) return;
    const slice = filteredList.slice(renderedCount, renderedCount + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    for (const ch of slice) frag.appendChild(cardFor(ch));
    els.grid.appendChild(frag);
    renderedCount += slice.length;
    els.emptyMsg.hidden = filteredList.length > 0;
    els.sentinel.hidden = renderedCount >= filteredList.length;
  }

  function renderChannels() {
    filteredList = channels.filter(matchesFilters);
    els.countText.textContent = `${filteredList.length.toLocaleString()} channel${filteredList.length === 1 ? '' : 's'}`;
    els.viewTitle.textContent = filters.favorites ? 'Favorites'
      : (filters.country ? (countryByCode.get(filters.country)?.name || filters.country)
        : filters.category === 'All' ? 'All Channels' : filters.category);
    els.grid.classList.toggle('list', viewMode === 'list');

    els.grid.innerHTML = '';
    renderedCount = 0;
    els.emptyMsg.hidden = filteredList.length > 0;
    appendPage();               // first screen paints immediately
    setupSentinel();
  }

  function setupSentinel() {
    if (sentinelObserver) sentinelObserver.disconnect();
    sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) appendPage();
    }, { rootMargin: '600px' });
    sentinelObserver.observe(els.sentinel);
  }

  function escapeHtmlAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  // --- Player: sequential fast-failover across mirrors ---
  let activeHls = null;
  let attemptToken = 0;          // invalidates callbacks from stale attempts
  let winningIndex = null;

  function teardownPlayer() {
    attemptToken++;              // kill any in-flight callbacks
    if (activeHls) { try { activeHls.destroy(); } catch (_) {} activeHls = null; }
    const v = els.player;
    v.onloadedmetadata = null;
    v.onerror = null;
    v.removeAttribute('src');
    try { v.load(); } catch (_) {}
  }

  function setPlayingUI(index) {
    els.playerLoading.classList.add('hidden');
    els.playerError.classList.add('hidden');
    els.streamInfo.textContent = currentMirrors.length > 1
      ? `Playing stream ${index + 1} of ${currentMirrors.length}`
      : '';
    renderMirrorButtons();
  }

  // Try mirrors in order: each gets a short budget, then we move on.
  async function playFromMirror(index, token) {
    if (token !== attemptToken) return;
    if (index >= currentMirrors.length) {
      showStreamFailure();
      return;
    }
    const url = currentMirrors[index];
    winningIndex = null;
    renderMirrorButtons();
    els.streamInfo.textContent = currentMirrors.length > 1
      ? `Connecting to stream ${index + 1} of ${currentMirrors.length}…`
      : 'Connecting…';

    const ok = await tryMirror(url, token);
    if (token !== attemptToken) return;
    if (ok) {
      winningIndex = index;
      setPlayingUI(index);
    } else {
      playFromMirror(index + 1, token);
    }
  }

  // Browsers block autoplay with sound. Try unmuted first (a click usually just
  // happened), then fall back to muted playback and offer an unmute button.
  function unmuteUi(show) {
    let btn = document.getElementById('unmuteBtn');
    if (!show) { if (btn) btn.remove(); return; }
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'unmuteBtn';
    btn.className = 'unmute-btn';
    btn.type = 'button';
    btn.textContent = '🔊 Tap for sound';
    btn.onclick = () => {
      els.player.muted = false;
      els.player.play().catch(() => {});
      btn.remove();
    };
    document.getElementById('playerAspect').appendChild(btn);
  }

  async function safePlay(video) {
    if (video.readyState >= 2 && !video.paused) { unmuteUi(video.muted); return true; }
    try {
      video.muted = false;
      await video.play();
      unmuteUi(false);
      return true;
    } catch (_) {
      try {
        video.muted = true;
        await video.play();
        unmuteUi(true);
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  // Returns true if this mirror started playing within the budget.
  function tryMirror(url, token) {
    return new Promise(resolve => {
      const video = els.player;
      const isHlsUrl = /\.m3u8(\?|$)/i.test(url);
      const isHttp = url.startsWith('http://');
      const useHlsJs = isHlsUrl && typeof Hls !== 'undefined' && Hls.isSupported();

      // HTTP streams on an HTTPS page are blocked outright — don't waste time.
      if (location.protocol === 'https:' && isHttp) { resolve(false); return; }

      let settled = false;
      let hls = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('playing', onPlaying);
        if (token !== attemptToken && ok) ok = false;
        if (ok) {
          if (hls) activeHls = hls;
        } else {
          if (hls) { try { hls.destroy(); } catch (_) {} }
          if (activeHls === hls) activeHls = null;
        }
        resolve(ok);
      };

      const onPlaying = () => finish(true);

      // Budget: 9s per mirror. Most live HLS starts in 1-3s or not at all.
      const timer = setTimeout(() => finish(false), 9000);

      // Reset element state from any previous mirror.
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      try { video.load(); } catch (_) {}
      video.addEventListener('playing', onPlaying, { once: true });

      if (useHlsJs) {
        hls = new Hls({
          enableWorker: false,
          manifestLoadingMaxRetry: 0,
          levelLoadingMaxRetry: 0,
          fragLoadingMaxRetry: 0,
          manifestLoadingTimeOut: 6000,
          levelLoadingTimeOut: 6000,
          fragLoadingTimeOut: 8000
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (settled) return;
          safePlay(video);
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (settled) return;
          safePlay(video);
          // Also accept having buffered data as success even if autoplay is blocked.
          setTimeout(() => { if (!settled && video.readyState >= 2) finish(true); }, 250);
        });
        hls.on(Hls.Events.ERROR, (ev, data) => {
          if (settled) return;
          if (data && data.fatal) finish(false);
        });
      } else {
        video.src = url;
        video.onloadedmetadata = () => { if (!settled) safePlay(video); };
        video.onerror = () => finish(false);
        safePlay(video);
      }
    });
  }

  // Probe mirrors in parallel and return them ordered fastest-first.
  // A no-cors fetch resolving means the host answered; rejecting means it's dead.
  function probeMirror(url, ms) {
    return new Promise(resolve => {
      let done = false;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        if (ctrl) ctrl.abort();
        resolve(ms); // never answered -> worst rank
      }, ms);
      const end = (rank) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(rank);
      };
      try {
        fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(() => end(performance.now()))
          .catch(() => end(ms));
      } catch (_) { end(ms); }
    });
  }

  async function orderMirrorsBySpeed(urls) {
    const budgets = urls.map(u => probeMirror(u, 4000));
    const ranks = await Promise.all(budgets);
    const scored = urls.map((u, i) => ({ url: u, rank: ranks[i] }));
    scored.sort((a, b) => a.rank - b.rank);
    return scored.map(s => s.url);
  }

  function startPlayback(ch) {
    teardownPlayer();
    winningIndex = null;
    els.playerError.classList.add('hidden');
    els.playerLoading.classList.remove('hidden');
    clearTimeout(streamWatchdog);
    playFromMirror(0, attemptToken);
    renderMirrorButtons();
  }

  async function selectChannel(ch) {
    current = ch;
    els.npFlag.textContent = ch.flag;
    els.npName.textContent = ch.name;
    els.npMeta.textContent = `${ch.country}${ch.category !== 'General' ? ' • ' + ch.category : ''}${ch.quality ? ' • ' + ch.quality : ''}`;
    updateNpFav();
    els.playerPanel.classList.add('open');
    els.playerPanel.setAttribute('aria-hidden', 'false');
    if (window.innerWidth <= 899) els.playerPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    teardownPlayer();
    winningIndex = null;
    currentMirrors = [];
    els.playerError.classList.add('hidden');
    els.playerLoading.classList.remove('hidden');
    els.streamInfo.textContent = 'Resolving stream…';
    renderMirrorButtons();
    history.replaceState({ channelId: ch.id }, '', location.pathname + location.search + '#' + ch.id);

    try {
      const mirrors = await ensureChannelStreams(ch);
      if (current !== ch) return;
      // Browsers block http:// media on https:// pages -- never waste a retry on them.
      const usable = location.protocol === 'https:'
        ? mirrors.filter(u => u.startsWith('https://'))
        : mirrors;
      if (!usable.length) {
        currentMirrors = mirrors;
        els.playerHint.textContent = 'This channel only offers http:// streams, which browsers block on HTTPS pages. Open the site over http:// to watch it.';
        els.playerHint.classList.remove('hidden');
        showStreamFailure();
        return;
      }
      currentMirrors = usable.slice(0, 6);
      // Rank by responsiveness so the live mirror is used first.
      els.streamInfo.textContent = `Checking ${currentMirrors.length} stream${currentMirrors.length > 1 ? 's' : ''}…`;
      const ranked = await orderMirrorsBySpeed(currentMirrors);
      if (current !== ch) return;
      currentMirrors = ranked;
      startPlayback(ch);
    } catch (err) {
      console.error(err);
      if (current === ch) showStreamFailure();
    }
  }

  function showStreamFailure() {
    els.playerLoading.classList.add('hidden');
    const secureHttpOnly = location.protocol === 'https:' &&
      currentMirrors.length > 0 && currentMirrors.every(u => u.startsWith('http://'));
    els.playerErrorMsg.textContent = secureHttpOnly
      ? 'These streams are HTTP-only, which browsers block on HTTPS pages. Open the site over http:// to watch this channel.'
      : 'This channel is not responding right now. Free IPTV streams go down often — try another channel or one of the mirrors below.';
    els.playerError.classList.remove('hidden');
  }

  function updateNpFav() {
    els.npFav.textContent = isFav(current.id) ? '★' : '☆';
    els.npFav.className = `icon-btn ${isFav(current.id) ? 'on' : ''}`;
  }

  function renderMirrorButtons() {
    els.mirrorList.innerHTML = '';
    currentMirrors.forEach((url, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mirror-btn ${i === winningIndex ? 'active' : ''}`;
      btn.title = url;
      btn.textContent = `Stream ${i + 1}`;
      btn.onclick = () => {
        if (i === winningIndex) return;
        teardownPlayer();                 // bumps attemptToken
        winningIndex = null;
        els.playerError.classList.add('hidden');
        els.playerLoading.classList.remove('hidden');
        els.streamInfo.textContent = `Connecting to stream ${i + 1}…`;
        playFromMirror(i, attemptToken);  // use the fresh token
      };
      els.mirrorList.appendChild(btn);
    });
  }

  els.retryPlayer.onclick = () => {
    if (!current) return;
    teardownPlayer();
    winningIndex = null;
    els.playerError.classList.add('hidden');
    els.playerLoading.classList.remove('hidden');
    playFromMirror(0, attemptToken);
  };

  // --- Fullscreen ---
  function toggleFullscreen() {
    const container = els.playerWrapEl || (els.playerWrapEl = document.querySelector('.player-wrap'));
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }
  els.npFullscreen.onclick = toggleFullscreen;

  // --- Player events ---
  function initPlayerEvents() {
    els.playerClose.onclick = () => {
      els.playerPanel.classList.remove('open');
      els.playerPanel.setAttribute('aria-hidden', 'true');
      stopPlayer();
    };
    els.npFav.onclick = () => { if (current) toggleFav(current.id); };
    els.searchInput.oninput = debounce((e) => { filters.q = e.target.value; renderFilters(); renderChannels(); pushFilterUrl(); }, 200);
    els.searchClear.onclick = () => { els.searchInput.value = ''; filters.q = ''; renderFilters(); renderChannels(); pushFilterUrl(); };
    els.countrySearch.oninput = debounce(() => { renderCountryList(); }, 100); // country filter applied by clicking items
    els.viewGrid.onclick = () => setView('grid');
    els.viewList.onclick = () => setView('list');

    // Sidebar toggles
    els.toggleSidebar.onclick = () => els.sidebar.classList.toggle('open');
    els.sidebarClose.onclick = () => els.sidebar.classList.remove('open');
    els.sidebarOverlay.onclick = () => els.sidebar.classList.remove('open');

    // Clicking player panel header area outside video closes nothing; video clicks toggle loading only
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (window.innerWidth <= 899 && els.playerPanel.classList.contains('open')) els.playerPanel.classList.remove('open');
        else els.sidebar.classList.remove('open');
      }
    });
  }

  function setView(mode) {
    viewMode = mode;
    els.viewGrid.classList.toggle('active', mode === 'grid');
    els.viewList.classList.toggle('active', mode === 'list');
    renderChannels();
    pushFilterUrl();
  }

  function stopPlayer() {
    teardownPlayer();
    winningIndex = null;
    els.playerLoading.classList.add('hidden');
    els.playerError.classList.add('hidden');
    current = null;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function maybePlayFromUrl() {
    const hash = location.hash.slice(1);
    if (hash && channels.length) {
      const ch = channels.find(c => c.id === hash);
      if (ch) selectChannel(ch);
    }
  }

  // --- Boot ---
  initFiltersFromUrl();
  loadData().catch(err => {
    console.error(err);
    setStatus('Could not load the channel list. Check your connection and reload.', 'warn');
    els.metaBadge.textContent = 'Offline';
  });

  // expose for debug
  window.__freetv = { channels: () => channels, filters: () => filters, selectChannel };
})();
