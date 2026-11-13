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

  function loadStream(url) {
    els.playerError.classList.add('hidden');
    els.playerLoading.classList.remove('hidden');
    els.player.setAttribute('poster', '');
    els.streamInfo.textContent = '';
    els.mirrorList.innerHTML = '';
    renderMirrorButtons();

    const isHls = url.includes('.m3u8');
    const video = els.player;
    video.addEventListener('playing', () => els.playerLoading.classList.add('hidden'), { once: true });

    // cleanup previous hls
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();

    const isSecure = location.protocol === 'https:';
    const isHttp = url.startsWith('http://');

    if (isHls && Hls && Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl') === '') {
      // use hls.js
      hls = new Hls({ enableWorker: false });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { els.playerLoading.classList.add('hidden'); video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (ev, data) => {
        console.error('HLS error', data);
        els.playerLoading.classList.add('hidden');
        if (data.fatal) handleStreamError(isSecure, isHttp);
      });
    } else {
      // native (mp4 or Safari HLS)
      video.src = url;
      els.playerLoading.classList.remove('hidden');
      video.play().catch(() => {});
      video.onloadedmetadata = () => { els.playerLoading.classList.add('hidden'); };
      video.onerror = () => { els.playerLoading.classList.add('hidden'); handleStreamError(isSecure, isHttp); };
    }

    if (isSecure && isHttp) {
      els.playerHint.classList.remove('hidden');
    } else {
      els.playerHint.classList.add('hidden');
    }
  }

  function handleStreamError(isSecure, isHttp) {
    let msg = 'Unable to play this stream. ';
    if (isSecure && isHttp) msg = "This stream is HTTP-only and browsers block HTTP content on HTTPS sites. Try another mirror below.";
    else msg = "This stream isn't playing. Try another mirror below.";
    els.playerErrorMsg.textContent = msg;
    els.playerError.classList.remove('hidden');
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
    if (currentMirrors.length <= 1) return;
    mirrorIndex = (mirrorIndex + 1) % currentMirrors.length;
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
    if (hls) { hls.destroy(); hls = null; }
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
