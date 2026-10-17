(() => {
'use strict';

const CONFIG = { PAGE_SIZE: 50 };
const VIDEO_EXT = /\.(mp4|webm)$/i;
const $ = (s, r = document) => r.querySelector(s);

/* ---------- media URLs: base + encoded path segments (filenames never altered) ---------- */
const mediaUrl = (file, dir = '') =>
  MEDIA_BASE + (dir + file).split('/').map(encodeURIComponent).join('/');

/* ---------- data ---------- */
const overrides = (typeof POST_OVERRIDES !== 'undefined' && POST_OVERRIDES) || {};
const all = posts.map(p => {
  const m = { ...p, ...(overrides[p.id] || {}) };
  m.items = m.files.map(f => ({ file: f, url: mediaUrl(f), video: VIDEO_EXT.test(f) }));
  m.type = m.items.length > 1 ? 'carousel' : (m.items[0].video ? 'video' : 'image');
  return m;
}).filter(p => !p.hidden && p.items.length);
const byId = new Map(all.map(p => [p.id, p]));
const videoPosts = all.filter(p => p.type === 'video');

/* ---------- state ---------- */
let tab = 'all', page = 1, current = null, slide = 0;
let renderedKey = '', lastFocus = null;
const missing = new Map();
const store = (() => {
  let d = { liked: [], saved: [] };
  try { d = { ...d, ...JSON.parse(localStorage.getItem('hena-local-v1') || '{}') }; } catch (e) {}
  return {
    has: (k, id) => d[k].includes(id),
    toggle(k, id) {
      const i = d[k].indexOf(id);
      i < 0 ? d[k].push(id) : d[k].splice(i, 1);
      try { localStorage.setItem('hena-local-v1', JSON.stringify(d)); } catch (e) {}
      return i < 0;
    }
  };
})();

const view = () => (tab === 'videos' ? videoPosts : all);
const pageCount = () => Math.max(1, Math.ceil(view().length / CONFIG.PAGE_SIZE));
const pageOf = (p, list = view()) => {
  const i = list.indexOf(p);
  return i < 0 ? 1 : Math.floor(i / CONFIG.PAGE_SIZE) + 1;
};
const url = (o = {}) => {
  const q = new URLSearchParams();
  const t = o.tab ?? tab, pg = o.page ?? page;
  if (t === 'videos') q.set('tab', 'videos');
  if (pg > 1) q.set('page', pg);
  if (o.post) q.set('post', o.post);
  const s = q.toString();
  return location.pathname + (s ? '?' + s : '');
};
const icon = n => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ico'); s.innerHTML = `<use href="#i-${n}"/>`; return s; };
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

/* ---------- profile header ---------- */
function initProfile() {
  const av = $('#avatar');
  av.src = mediaUrl(PROFILE.photo, PROFILE_DIR);
  av.addEventListener('error', () => { av.removeAttribute('src'); });
  $('#vavatar').src = av.src;
  $('#vavatar').addEventListener('error', e => e.target.removeAttribute('src'));
  const stats = $('#stats');
  stats.replaceChildren();
  const add = (n, label) => { const li = el('li'); const b = el('b', '', String(n)); li.append(b, ' ' + label); stats.append(li); };
  add(all.length.toLocaleString(), 'posts');
  if (PROFILE.followers != null) add(Number(PROFILE.followers).toLocaleString(), 'followers');
  if (PROFILE.following != null) add(Number(PROFILE.following).toLocaleString(), 'following');
  if (PROFILE.bio) { const b = $('#bio'); b.textContent = PROFILE.bio; b.hidden = false; }
}

/* ---------- grid ---------- */
let thumbObserver = null;
function teardownGrid() {
  if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
  const grid = $('#grid');
  grid.querySelectorAll('video').forEach(releaseVideo);
  grid.querySelectorAll('img').forEach(i => i.removeAttribute('src'));
  grid.replaceChildren();
}
function releaseVideo(v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); }

function renderGrid() {
  teardownGrid();
  page = Math.min(Math.max(1, page), pageCount());
  const list = view().slice((page - 1) * CONFIG.PAGE_SIZE, page * CONFIG.PAGE_SIZE);
  const grid = $('#grid'), frag = document.createDocumentFragment();
  thumbObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const v = e.target;
      thumbObserver.unobserve(v);
      v.preload = 'metadata';
      v.src = v.dataset.src + '#t=0.1';
    }
  }, { rootMargin: '300px' });
  list.forEach((p, i) => {
    const first = p.items[0];
    const a = el('a', 'tile');
    a.href = url({ post: p.id });
    a.dataset.id = p.id;
    a.setAttribute('aria-label', (p.type === 'carousel' ? 'Open carousel post ' : p.type === 'video' ? 'Open video post ' : 'Open photo post ') + ((page - 1) * CONFIG.PAGE_SIZE + i + 1));
    let m;
    if (first.video) {
      m = el('video'); m.muted = true; m.playsInline = true; m.preload = 'none'; m.tabIndex = -1;
      m.setAttribute('aria-hidden', 'true'); m.dataset.src = first.url; m.dataset.file = first.file;
      thumbObserver.observe(m);
    } else {
      m = new Image(); m.loading = 'lazy'; m.decoding = 'async'; m.alt = ''; m.src = first.url; m.dataset.file = first.file;
    }
    a.append(m);
    if (p.type === 'carousel' || first.video) {
      const b = el('span', 'badge'); b.append(icon(p.type === 'carousel' ? 'carousel' : 'reel')); a.append(b);
    }
    frag.append(a);
  });
  grid.append(frag);
  $('#empty').hidden = list.length > 0;
  renderPager();
  renderedKey = tab + ':' + page;
  document.querySelectorAll('.tab').forEach(t => t.dataset.tab === tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
}

/* failed media: report, never substitute */
$('#grid').addEventListener('error', e => {
  const m = e.target;
  if (!m.dataset || !m.dataset.file) return;
  const tile = m.closest('.tile');
  if (tile) tile.classList.add('missing');
  reportMissing(m.dataset.file);
}, true);
function reportMissing(file) {
  if (missing.has(file)) return;
  missing.set(file, true);
  $('#missing').hidden = false;
  $('#missing-sum').textContent = `${missing.size} media file${missing.size === 1 ? '' : 's'} could not be loaded`;
  $('#missing-list').append(el('li', '', file));
  console.warn('Media failed to load:', file);
}

function renderPager() {
  const n = pageCount(), nav = $('#pager');
  nav.replaceChildren();
  if (n <= 1) return;
  const link = (p, label, extra) => {
    const a = el('a', extra || '', label); a.href = url({ page: p }); a.dataset.page = p;
    if (p === page && !extra) a.setAttribute('aria-current', 'page');
    return a;
  };
  const dis = label => { const s = el('span', 'off', label); s.setAttribute('aria-disabled', 'true'); return s; };
  nav.append(page > 1 ? link(page - 1, 'Previous', 'step') : dis('Previous'));
  const want = new Set([1, n, page - 1, page, page + 1]);
  if (page <= 3) { want.add(2); want.add(3); }
  if (page >= n - 2) { want.add(n - 1); want.add(n - 2); }
  let prev = 0;
  [...want].filter(p => p >= 1 && p <= n).sort((a, b) => a - b).forEach(p => {
    if (p - prev > 1) nav.append(el('span', 'gap', '…'));
    nav.append(link(p, String(p)));
    prev = p;
  });
  nav.append(page < n ? link(page + 1, 'Next', 'step') : dis('Next'));
}

/* ---------- viewer ---------- */
const V = {
  root: $('#viewer'), stage: $('#stage'), media: $('#vmedia'),
  prev: $('#slide-prev'), next: $('#slide-next'), counter: $('#counter'), dots: $('#dots'),
  pprev: $('#post-prev'), pnext: $('#post-next'), cap: $('#vcaption'), time: $('#vtime'),
  like: $('#like-btn'), save: $('#save-btn'), fs: $('#fs-btn')
};
const navList = () => (view().includes(current) ? view() : all);

function clearStage() {
  V.stage.querySelectorAll('video').forEach(releaseVideo);
  V.stage.querySelectorAll('img').forEach(i => i.removeAttribute('src'));
  V.stage.replaceChildren();
}

function showSlide(i) {
  const items = current.items;
  slide = Math.min(Math.max(0, i), items.length - 1);
  const it = items[slide];
  clearStage();
  const box = el('div', 'slide loading');
  const err = el('div', 'err', it.video
    ? "This video can't be played. The file is missing or the format isn't supported by this browser."
    : "This photo couldn't be loaded. The file may be missing.");
  const done = () => box.classList.remove('loading');
  const fail = () => { done(); box.classList.add('failed'); reportMissing(it.file); };
  let m;
  if (it.video) {
    m = document.createElement('video');
    m.controls = true; m.playsInline = true; m.preload = 'metadata'; m.controlsList = 'nodownload';
    m.addEventListener('loadedmetadata', done); m.addEventListener('loadeddata', done); m.addEventListener('error', fail);
    m.addEventListener('play', () => {
      document.querySelectorAll('video').forEach(v => { if (v !== m && !v.paused) v.pause(); });
    });
    m.src = it.url;
  } else {
    m = new Image(); m.decoding = 'async'; m.alt = 'Photo by hennaah.11';
    m.addEventListener('load', done); m.addEventListener('error', fail);
    m.src = it.url;
  }
  box.append(m, err);
  V.stage.append(box);
  const n = items.length;
  V.prev.hidden = !(n > 1 && slide > 0);
  V.next.hidden = !(n > 1 && slide < n - 1);
  V.counter.hidden = n < 2; V.counter.textContent = `${slide + 1}/${n}`;
  V.dots.hidden = n < 2;
  if (n > 1) {
    V.dots.replaceChildren();
    for (let k = 0; k < n; k++) V.dots.append(el('i', k === slide ? 'on' : ''));
  }
}

function renderCaption(text) {
  V.cap.replaceChildren();
  if (!text) { V.cap.hidden = true; return; }
  V.cap.hidden = false;
  const b = el('strong', '', PROFILE.username);
  V.cap.append(b, ' ');
  text.split(/([#@][\p{L}\p{N}_.]*[\p{L}\p{N}_])/u).forEach((part, i) => {
    if (i % 2) V.cap.append(el('span', 'tag', part)); else if (part) V.cap.append(document.createTextNode(part));
  });
}

function showPost(p) {
  current = p;
  renderCaption(p.caption);
  if (p.timestamp) {
    const d = new Date(p.timestamp);
    V.time.textContent = isNaN(d) ? p.timestamp : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    if (!isNaN(d)) V.time.dateTime = d.toISOString();
    V.time.hidden = false;
  } else V.time.hidden = true;
  V.like.setAttribute('aria-pressed', store.has('liked', p.id));
  V.save.setAttribute('aria-pressed', store.has('saved', p.id));
  const list = navList(), i = list.indexOf(p);
  V.pprev.disabled = i <= 0; V.pnext.disabled = i >= list.length - 1;
  document.title = `Hena (@${PROFILE.username}) – post`;
  showSlide(0);
}

function openViewer(p) {
  if (V.root.hidden) {
    lastFocus = document.activeElement;
    V.root.hidden = false;
    document.documentElement.classList.add('modal-open');
    $('#app').inert = true;
    $('.vclose').focus({ preventScroll: true });
  }
  showPost(p);
}
function closeViewerUI() {
  if (V.root.hidden) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  clearStage();
  V.root.hidden = true;
  document.documentElement.classList.remove('modal-open');
  $('#app').inert = false;
  current = null;
  document.title = `Hena (@${PROFILE.username})`;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

function gotoPost(p, mode) {
  const list = navList();
  if (list === view()) page = pageOf(p, list);
  const u = url({ post: p.id });
  mode === 'push' ? history.pushState(null, '', u) : history.replaceState(null, '', u);
  openViewer(p);
}
function stepPost(d) {
  const list = navList(), n = list[list.indexOf(current) + d];
  if (n) gotoPost(n, 'replace');
}
function closeViewer() {
  if (V.root.hidden) return;
  history.replaceState(null, '', url({ page: current && view().includes(current) ? pageOf(current) : page }));
  route();
}

/* ---------- routing ---------- */
function route() {
  const q = new URLSearchParams(location.search);
  tab = q.get('tab') === 'videos' ? 'videos' : 'all';
  const p = byId.get(q.get('post'));
  if (p && tab === 'videos' && !videoPosts.includes(p)) tab = 'all';
  page = parseInt(q.get('page'), 10) || (p ? pageOf(p) : 1);
  page = Math.min(Math.max(1, page), pageCount());
  if (p) {
    openViewer(p);              // grid is rendered only when the viewer closes
  } else {
    closeViewerUI();
    if (renderedKey !== tab + ':' + page) renderGrid();
  }
}

/* ---------- events (delegated) ---------- */
$('#grid').addEventListener('click', e => {
  const a = e.target.closest('.tile');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  const p = byId.get(a.dataset.id);
  if (p) gotoPost(p, 'push');
});
$('#pager').addEventListener('click', e => {
  const a = e.target.closest('a[data-page]');
  if (!a) return;
  e.preventDefault();
  page = +a.dataset.page;
  history.pushState(null, '', url());
  renderGrid();
  window.scrollTo({ top: 0 });
});
$('#tabs').addEventListener('click', e => {
  const a = e.target.closest('.tab');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.tab === tab) return;
  tab = a.dataset.tab; page = 1;
  history.pushState(null, '', url());
  renderGrid();
});
V.root.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeViewer(); });
V.prev.addEventListener('click', () => showSlide(slide - 1));
V.next.addEventListener('click', () => showSlide(slide + 1));
V.pprev.addEventListener('click', () => stepPost(-1));
V.pnext.addEventListener('click', () => stepPost(1));
V.like.addEventListener('click', () => V.like.setAttribute('aria-pressed', store.toggle('liked', current.id)));
V.save.addEventListener('click', () => {
  const on = store.toggle('saved', current.id);
  V.save.setAttribute('aria-pressed', on);
  toast(on ? 'Saved on this device only' : 'Removed from saved');
});
$('#share-btn').addEventListener('click', async () => {
  const link = location.origin + url({ post: current.id });
  try {
    if (navigator.share) { await navigator.share({ title: 'Hena (@hennaah.11)', url: link }); return; }
    await navigator.clipboard.writeText(link);
    toast('Link copied');
  } catch (e) { if (e && e.name !== 'AbortError') toast(link); }
});
if (V.media.requestFullscreen) {
  V.fs.addEventListener('click', () => {
    document.fullscreenElement ? document.exitFullscreen() : V.media.requestFullscreen().catch(() => {});
  });
} else V.fs.hidden = true;

document.addEventListener('keydown', e => {
  if (V.root.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (k === 'Escape') { if (!document.fullscreenElement) closeViewer(); }
  else if ((k === 'ArrowLeft' || k === 'ArrowRight') && (e.target.tagName !== 'VIDEO' || e.shiftKey)) {
    const d = k === 'ArrowLeft' ? -1 : 1, n = current.items.length;
    if (n > 1 && slide + d >= 0 && slide + d < n) showSlide(slide + d); else stepPost(d);
    e.preventDefault();
  } else if (k === 'PageUp' || k === 'k') stepPost(-1);
  else if (k === 'PageDown' || k === 'j') stepPost(1);
  else if (k === 'Tab') {            // keep focus inside the dialog
    const f = [...V.root.querySelectorAll('button:not([disabled]):not([hidden]),video[controls]')].filter(x => x.offsetParent);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
  }
});

/* touch swipe between carousel items */
let sx = 0, sy = 0, tracking = false;
V.stage.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { tracking = false; return; }
  tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
}, { passive: true });
V.stage.addEventListener('touchend', e => {
  if (!tracking || !current) return;
  tracking = false;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    const n = current.items.length, d = dx < 0 ? 1 : -1;
    if (n > 1 && slide + d >= 0 && slide + d < n) showSlide(slide + d);
  }
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) V.stage.querySelectorAll('video').forEach(v => v.pause());
});
window.addEventListener('popstate', route);

/* theme + toast */
$('#theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hena-theme', next); } catch (e) {}
});
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- start ---------- */
initProfile();
route();
})();
