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
  let hls = null;
  let currentMirrors = [];
  let mirrorIndex = 0;
  let playbackTimer = null;
  let playbackAttempt = 0;
  const PLAYBACK_TIMEOUT_MS = 18000;

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
  async function loadData() {
    setStatus('Loading channel list…', 'info');
    try {
      const [indexRes, channelsRes, countriesRes, categoriesRes] = await Promise.all([
        fetch(`${DATA_DIR}/index.json`),
        fetch(`${DATA_DIR}/channels.json`),
        fetch(`${DATA_DIR}/countries.json`),
        fetch(`${DATA_DIR}/categories.json`)
      ]);
      const index = await indexRes.json();
      channels = await channelsRes.json();
      countries = await countriesRes.json();
      categories = await categoriesRes.json();

      els.metaBadge.textContent = `${index.total} channels • ${index.countries} countries`;
      els.metaBadge.className = 'badge';

      loadFavorites();
      renderFilters();
      renderChannels();
      initPlayerEvents();
      maybePlayFromUrl();
    } catch (err) {
      setStatus('Failed to load channel data.', 'warn');
      console.error(err);
    }
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

  function renderChannels() {
    const list = channels.filter(matchesFilters);
    els.countText.textContent = `${list.length} channel${list.length === 1 ? '' : 's'}`;
    els.viewTitle.textContent = filters.favorites ? 'Favorites'
      : (filters.country ? countries.find(c => c.code === filters.country)?.name || filters.country
        : filters.category === 'All' ? 'All Channels' : filters.category);
    els.emptyMsg.hidden = list.length > 0;

    const frag = document.createDocumentFragment();
    const isList = viewMode === 'list';
    if (isList) els.grid.classList.add('list'); else els.grid.classList.remove('list');

    for (const ch of list) {
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
           <div class="card-meta">${escapeHtml(ch.country)} ${ch.category !== 'General' ? '• ' + escapeHtml(ch.category) : ''}${ch.quality ? ' • ' + ch.quality : ''}</div>
         </div>
         <div class="card-quality">${ch.quality || ''}</div>
         <button class="card-fav ${isFav(ch.id) ? 'on' : ''}" data-id="${escapeHtmlAttr(ch.id)}" title="${isFav(ch.id) ? 'Remove from favorites' : 'Add to favorites'}">${isFav(ch.id) ? '★' : '☆'}</button>`;
      card.onclick = (e) => { if (e.target.classList.contains('card-fav')) return; selectChannel(ch); };
      card.ondblclick = (e) => { if (e.target.classList.contains('card-fav')) return; selectChannel(ch); toggleFullscreen(); };
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChannel(ch); } };
      card.querySelector('.card-fav').onclick = (e) => { e.stopPropagation(); toggleFav(ch.id); };
      frag.appendChild(card);
    }
    els.grid.innerHTML = '';
    els.grid.appendChild(frag);
  }

  function escapeHtmlAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  // --- Player ---
  function selectChannel(ch) {
    current = ch;
    els.npFlag.textContent = ch.flag;
    els.npName.textContent = ch.name;
    els.npMeta.textContent = `${ch.country} ${ch.category !== 'General' ? '• ' + ch.category : ''}${ch.quality ? ' • ' + ch.quality : ''}`;
    currentMirrors = ch.mirrors.slice();
    mirrorIndex = 0;
    updateNpFav();
    if (els.playerPanel.classList.contains('open') === false) els.playerPanel.classList.add('open');
    els.playerPanel.setAttribute('aria-hidden', 'false');
    if (window.innerWidth <= 899) els.playerPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    loadStream(currentMirrors[mirrorIndex]);
    if (history.state && history.state.channelId === ch.id) {} else {
      history.replaceState({ channelId: ch.id }, '', location.pathname + (location.search ? location.search : '') + '#' + ch.id);
    }
  }

  function updateNpFav() {
    els.npFav.textContent = isFav(current.id) ? '★' : '☆';
    els.npFav.className = `icon-btn ${isFav(current.id) ? 'on' : ''}`;
  }

  function clearPlaybackTimer() {
    if (playbackTimer) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function showPlaybackError(message) {
    clearPlaybackTimer();
    els.playerLoading.classList.add('hidden');
    els.playerErrorMsg.textContent = message;
    els.playerError.classList.remove('hidden');
  }

  function failCurrentMirror(reason) {
    // Ignore callbacks from a previous channel/mirror attempt.
    const failedAttempt = playbackAttempt;
    clearPlaybackTimer();
    destroyHls();

    if (mirrorIndex < currentMirrors.length - 1) {
      console.warn(`Stream ${mirrorIndex + 1} failed; trying the next mirror.`, reason);
      mirrorIndex += 1;
      renderMirrorButtons();
      loadStream(currentMirrors[mirrorIndex]);
      return;
    }

    const isSecure = location.protocol === 'https:';
    const hasHttpMirror = currentMirrors.some((url) => /^http:\/\//i.test(url));
    const prefix = isSecure && hasHttpMirror
      ? 'Some mirrors use HTTP and are blocked as mixed content on this HTTPS site. '
      : '';
    showPlaybackError(prefix + (reason || 'Unable to start playback.') + ' No more mirrors are available. Try Retry to check the streams again.');
    console.error('All stream mirrors failed for the selected channel.', { failedAttempt, reason });
  }

  function loadStream(url) {
    if (!url || typeof url !== 'string') {
      showPlaybackError('This channel does not have a valid stream URL.');
      return;
    }

    clearPlaybackTimer();
    destroyHls();
    const attempt = ++playbackAttempt;
    const video = els.player;

    els.playerError.classList.add('hidden');
    els.playerLoading.classList.remove('hidden');
    els.player.setAttribute('poster', '');
    els.streamInfo.textContent = '';
    renderMirrorButtons();

    // Reset native media handlers before attaching handlers for this attempt.
    video.onplaying = null;
    video.onerror = null;
    video.onloadedmetadata = null;
    video.onstalled = null;
    video.onwaiting = null;
    video.pause();
    video.removeAttribute('src');
    video.load();

    const isSecure = location.protocol === 'https:';
    const isHttp = /^http:\/\//i.test(url);
    const isHls = /\.m3u8(?:$|[?#])/i.test(url);
    const HlsLibrary = window.Hls;

    if (isSecure && isHttp) {
      // Browsers block active mixed content; attempting playback only leaves
      // the user waiting until a media error/timeout fires.
      failCurrentMirror('This mirror uses HTTP, which browsers block on HTTPS pages.');
      return;
    }

    video.onplaying = () => {
      if (attempt !== playbackAttempt) return;
      clearPlaybackTimer();
      els.playerLoading.classList.add('hidden');
      els.playerError.classList.add('hidden');
    };

    video.onerror = () => {
      if (attempt !== playbackAttempt) return;
      const mediaError = video.error;
      const detail = mediaError
        ? `Media error ${mediaError.code}${mediaError.message ? ': ' + mediaError.message : ''}.`
        : 'The browser could not load this stream.';
      failCurrentMirror(detail);
    };

    video.onstalled = () => {
      if (attempt === playbackAttempt) console.warn('Stream stalled:', url);
    };

    // A timeout covers servers that never send a manifest/metadata or never
    // transition to playing. It also guarantees the loading overlay is removed.
    playbackTimer = setTimeout(() => {
      if (attempt === playbackAttempt) {
        failCurrentMirror(`Stream timed out after ${PLAYBACK_TIMEOUT_MS / 1000} seconds.`);
      }
    }, PLAYBACK_TIMEOUT_MS);

    if (isHls && HlsLibrary && HlsLibrary.isSupported()) {
      hls = new HlsLibrary({
        enableWorker: true,
        manifestLoadingTimeOut: 10000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 1
      });

      hls.on(HlsLibrary.Events.ERROR, (event, data) => {
        if (attempt !== playbackAttempt) return;
        console.error('HLS playback error:', data);
        if (data.fatal) {
          failCurrentMirror(`HLS error: ${data.details || data.type || 'fatal playback error'}.`);
        }
      });

      hls.on(HlsLibrary.Events.MANIFEST_PARSED, () => {
        if (attempt !== playbackAttempt) return;
        video.play().catch((error) => {
          // Muted playback is normally allowed, but surface a useful failure
          // and try the next mirror if the browser rejects playback.
          failCurrentMirror(`Playback could not start: ${error.message || error}.`);
        });
      });

      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari and other browsers with native HLS support.
      video.src = url;
      video.play().catch((error) => {
        if (attempt === playbackAttempt) failCurrentMirror(`Playback could not start: ${error.message || error}.`);
      });
    } else if (!isHls) {
      // Native MP4/other browser-supported media.
      video.src = url;
      video.play().catch((error) => {
        if (attempt === playbackAttempt) failCurrentMirror(`Playback could not start: ${error.message || error}.`);
      });
    } else {
      failCurrentMirror('HLS playback is not supported in this browser. The HLS.js library could not be initialized.');
    }

    if (isSecure && currentMirrors.some((mirror) => /^http:\/\//i.test(mirror))) {
      els.playerHint.classList.remove('hidden');
    } else {
      els.playerHint.classList.add('hidden');
    }
  }

  function handleStreamError(isSecure, isHttp) {
    const message = isSecure && isHttp
      ? 'This stream is HTTP-only and browsers block HTTP content on HTTPS sites.'
      : 'This stream is not playing.';
    failCurrentMirror(message);
  }

  function renderMirrorButtons() {
    els.mirrorList.innerHTML = '';
    currentMirrors.forEach((url, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mirror-btn ${i === mirrorIndex ? 'active' : ''}`;
      btn.title = url;
      btn.textContent = `Stream ${i + 1}`;
      btn.onclick = () => {
        if (i === mirrorIndex) return;
        mirrorIndex = i;
        renderMirrorButtons();
        loadStream(url);
      };
      els.mirrorList.appendChild(btn);
    });
    const info = currentMirrors.length > 1 ? `${currentMirrors.length} mirror${currentMirrors.length > 1 ? 's' : ''} available` : '';
    els.streamInfo.textContent = info;
  }

  function playNextMirror() {
    if (!currentMirrors.length) {
      showPlaybackError('No stream mirrors are available for this channel.');
      return;
    }
    // Manual Retry starts from the first mirror and then follows the same
    // bounded failover sequence as automatic recovery.
    mirrorIndex = 0;
    renderMirrorButtons();
    loadStream(currentMirrors[mirrorIndex]);
  }

  els.retryPlayer.onclick = () => playNextMirror();

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
    clearPlaybackTimer();
    playbackAttempt += 1;
    destroyHls();
    els.player.src = '';
    els.player.load();
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
  loadData();

  // expose for debug
  window.__freetv = { channels: () => channels, filters: () => filters, selectChannel };
})();
