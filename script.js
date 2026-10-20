(async () => {
  "use strict";
  const $ = id => document.getElementById(id);
  const grid = $("grid"), viewer = $("viewer"), viewerMedia = $("viewerMedia");
  function setAvatar(img) {
    const urls = [imageVariant(PROFILE_PHOTO_PATH, 240, 75), ...mediaUrls(PROFILE_PHOTO_PATH)]; let i = 0;
    img.onerror = () => { if (++i < urls.length) img.src = urls[i]; };
    img.src = urls[0];
  }
  setAvatar($("profilePhoto")); setAvatar($("viewerAvatar"));

  // Links pasted into posts.txt (separated by $) are added above the built-in posts.
  try { applyLinkPosts(await postsReady); } catch (_) {}

  const photos = posts.filter(post => post.type === "image");
  const videos = posts.filter(post => post.type === "video");
  const byId = new Map([...posts, ...profileItems].map(post => [post.id, post]));
  let filter = "posts", visiblePosts = posts, activeId = null, opened = false, activeMediaIndex = 0;
  let gridObserver = null, lastFocused = null, pointerStartX = null, pointerStartY = null;

  const savedTheme = (() => { try { return localStorage.getItem("hena-theme"); } catch (_) { return null; } })();
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (prefersDark ? "dark" : "light"));

  $("postCount").textContent = posts.length.toLocaleString();

  function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
    const dark = theme === "dark";
    const button = $("themeToggle");
    if (button) {
      button.innerHTML = dark ? '<span aria-hidden="true">☀</span><span class="theme-label">Light mode</span>' : '<span aria-hidden="true">☾</span><span class="theme-label">Dark mode</span>';
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      button.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
    const meta = $("themeColorMeta"); if (meta) meta.content = dark ? "#000000" : "#ffffff";
  }

  function isVideo(file) { return mediaType(file) === "video"; }
  function normalizeFilter(value) { return ({ photos: "posts", all: "profile" })[value] || value; }
  function updateUrlForPost(post, push = true) {
    const u = new URL(location.href);
    if (post) { u.searchParams.set("post", post.id); u.searchParams.delete("filter"); }
    else { u.searchParams.delete("post"); if (filter === "posts") u.searchParams.delete("filter"); else u.searchParams.set("filter", filter); }
    if (push) history.pushState({ post: post ? post.id : null, filter }, "", u);
    else history.replaceState({ post: post ? post.id : null, filter }, "", u);
  }

  function makeThumbnail(post, index) {
    const file = post.files[0];
    const button = document.createElement("button");
    button.className = "grid-item"; button.type = "button"; button.dataset.id = post.id;
    button.setAttribute("aria-label", `Open ${post.type === "video" ? "reel" : post.files.length > 1 ? `photo group with ${post.files.length} photos` : "photo"} ${index + 1}`);
    const media = document.createElement(isVideo(file) ? "video" : "img");
    media.className = "grid-media";
    media.dataset.src = mediaUrl(file);
    if (isVideo(file)) media._urls = mediaUrls(file);
    if (media.tagName === "IMG") { media.alt = ""; media.decoding = "async"; media._file = file; }
    else {
      media.muted = true; media.defaultMuted = true; media.playsInline = true;
      media.preload = "none"; media.setAttribute("aria-label", "Video thumbnail");
      media.setAttribute("aria-hidden", "true");
    }
    button.append(media);
    if (post.type === "video") {
      const mark = document.createElement("span"); mark.className = "video-mark"; mark.setAttribute("aria-hidden", "true");
      mark.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"></rect><path d="M10 8.5v7l6-3.5z"></path></svg>'; button.append(mark);
    } else if (post.files.length > 1) {
      button.classList.add("has-carousel");
      const mark = document.createElement("span"); mark.className = "carousel-mark"; mark.setAttribute("aria-hidden", "true");
      mark.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><rect x="8" y="3" width="13" height="15" rx="2"></rect><rect x="3" y="7" width="13" height="14" rx="2"></rect></svg>'; button.append(mark);
      const count = document.createElement("span"); count.className = "group-count"; count.textContent = String(post.files.length); count.setAttribute("aria-hidden", "true"); button.append(count);
    }
    if (post.type === "video") {
      // Mouse hover only: on phones touch-scrolling would warm dozens of reels for nothing.
      button.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") warmPost(post); }, { once: true });
    }
    button.addEventListener("click", () => {
      openPost(post.id, true);
    });
    return button;
  }

  function loadThumbnail(el) { requestTile(el); }

  // ===========================================================================
  //  PRIORITY LOADER
  //  Rule: whatever the person is looking at loads first. Everything else waits, and anything that
  //  scrolls out of view (or is overtaken by something closer to the middle of the screen) is
  //  cancelled, then loaded again later if it comes back. Bad network / weak phone = lighter work.
  // ===========================================================================
  const conn = navigator.connection || {};
  const SLOW_NET = !!(conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""));
  const LOW_END = !!((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2));
  const THUMBW = 320, MIDW = (SLOW_NET || LOW_END) ? 560 : 720;
  const ALLOW_FULL = !SLOW_NET, FULL_ALL = !SLOW_NET && !LOW_END;
  const PREVIEW_OK = !SLOW_NET && !LOW_END && !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const HEAD_BYTES = 700 * 1024;             // a video thumbnail never downloads more than ~700 KB

  let tilePaused = false;
  const posterCache = new Map();             // post id -> dataURL (first frame of a reel)
  const headCache = new Map();               // post id -> Blob (first ~700 KB of a reel, used for previews)
  const tileId = el => el.closest(".grid-item")?.dataset.id;
  const centreDist = el => { const r = el.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - window.innerHeight / 2); };
  function rememberHead(id, blob) { headCache.delete(id); headCache.set(id, blob); if (headCache.size > 14) headCache.delete(headCache.keys().next().value); }

  function makePool(max, start) {
    const pool = { queue: [], loading: new Set(), max, start };
    pool.pump = () => {
      if (tilePaused) return;
      while (pool.queue.length) {
        let bi = -1, bd = Infinity;
        pool.queue.forEach((el, i) => { if (!el.isConnected) return; const d = centreDist(el); if (d < bd) { bd = d; bi = i; } });
        if (bi < 0) { pool.queue.forEach(el => { el._state = null; }); pool.queue.length = 0; break; }
        if (pool.loading.size >= pool.max) {
          // Full: if the best waiting tile is clearly closer to the middle than the farthest one in flight, swap them.
          let worst = null, wd = -1; pool.loading.forEach(el => { const d = centreDist(el); if (d > wd) { wd = d; worst = el; } });
          if (worst && bd + 160 < wd) { abortTile(worst); worst._state = "queued"; pool.queue.push(worst); } else break;
        }
        pool.start(pool.queue.splice(bi, 1)[0]);
      }
    };
    return pool;
  }
  const imgPool = makePool(SLOW_NET || LOW_END ? 4 : 8, el => startImageTile(el));
  const videoPool = makePool(SLOW_NET || LOW_END ? 2 : 3, el => startVideoTile(el));
  const poolFor = el => el.tagName === "VIDEO" ? videoPool : imgPool;

  function abortTile(el) {
    const pool = poolFor(el); pool.loading.delete(el); el._tok = (el._tok || 0) + 1;
    clearTimeout(el._timer); clearTimeout(el._seek);
    if (el.tagName === "VIDEO") { cleanupTileSource(el); try { el.pause(); } catch (_) {} el.removeAttribute("src"); try { el.load(); } catch (_) {} }
    else { el.onload = el.onerror = null; el.removeAttribute("src"); }
  }
  function requestTile(el) {
    if (el._state) return;
    const id = tileId(el);
    if (el.tagName === "VIDEO" && id && posterCache.has(id)) { el.poster = posterCache.get(id); el.classList.add("video-frame-ready"); el._state = "poster"; return; }
    el._state = "queued"; const pool = poolFor(el); pool.queue.push(el); pool.pump();
  }
  function releaseTile(el) {
    const pool = poolFor(el), qi = pool.queue.indexOf(el); if (qi >= 0) pool.queue.splice(qi, 1);
    if (el._previewing) stopPreview(el);
    const st = el._state;
    if (st === "loading") abortTile(el);
    else if (st === "ready" && el.tagName === "VIDEO") { el._tok = (el._tok || 0) + 1; try { el.pause(); } catch (_) {} el.removeAttribute("src"); try { el.load(); } catch (_) {} cleanupTileSource(el); }
    if (el.tagName === "VIDEO") { if (el.poster) el._state = "poster"; else { el._state = null; el.classList.remove("video-frame-ready"); } }
    else el._state = st === "done" ? "done" : null;
    if (st === "loading") pool.pump();
  }

  // ---- image tiles: small 320px WebP from an image CDN, original as fallback ----
  function startImageTile(el) {
    const file = el._file; if (!file) { el._state = null; return; }
    const urls = [imageVariant(file, THUMBW, 62), ...mediaUrls(file)]; let i = 0;
    const token = el._tok = (el._tok || 0) + 1;
    el._state = "loading"; imgPool.loading.add(el);
    const done = ok => {
      if (el._tok !== token) return;
      imgPool.loading.delete(el);
      if (ok) { el._state = "done"; el.classList.add("img-ready"); const st = photoState(file); st.loaded.thumb = true; st.url.thumb = el.currentSrc || el.src; }
      else { el._state = null; el.closest(".grid-item")?.classList.add("media-unavailable"); }
      imgPool.pump();
    };
    el.onload = () => done(true);
    el.onerror = () => { if (el._tok !== token) return; if (++i < urls.length) el.src = urls[i]; else done(false); };
    el.src = urls[0];
  }

  // ---- video tiles: only the first ~700 KB, turned into a poster image ----
  function cleanupTileSource(el) {
    if (el._abort) { try { el._abort.abort(); } catch (_) {} el._abort = null; }
    if (el._blobUrl) { try { URL.revokeObjectURL(el._blobUrl); } catch (_) {} el._blobUrl = null; }
  }
  async function fetchHead(url, bytes, signal) {
    const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const reader = res.body.getReader(), chunks = []; let got = 0;
    while (got < bytes) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
    try { await reader.cancel(); } catch (_) {}
    return new Blob(chunks, { type: "video/mp4" });
  }
  async function headBlob(el, signal) {
    const id = tileId(el), urls = el._urls || [el.dataset.src]; let blob = null;
    for (const u of urls) {
      try { blob = await fetchHead(u, HEAD_BYTES, signal); break; }
      catch (e) { if (signal && signal.aborted) throw e; }
    }
    if (blob && blob.size && id) rememberHead(id, blob);
    return blob;
  }
  function capturePoster(el) {
    const id = tileId(el);
    if (!id || !el.videoWidth) return;
    try {
      const c = document.createElement("canvas"), w = Math.min(420, el.videoWidth);
      c.width = w; c.height = Math.round(w * el.videoHeight / el.videoWidth);
      c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.75);
      posterCache.set(id, url); el.poster = url;
    } catch (_) {}
  }
  function startVideoTile(el) {
    const urls = el._urls || [el.dataset.src]; if (!urls[0]) { el._state = null; return; }
    const token = el._tok = (el._tok || 0) + 1;
    let done = false, mode = "head";
    el._state = "loading"; videoPool.loading.add(el);
    const stale = () => done || el._tok !== token;
    const finish = ok => {
      if (stale()) return;
      done = true; clearTimeout(el._timer); clearTimeout(el._seek); videoPool.loading.delete(el);
      if (ok) {
        el.classList.add("video-frame-ready"); capturePoster(el);
        if (el.poster) { el._state = "poster"; try { el.pause(); } catch (_) {} el.removeAttribute("src"); try { el.load(); } catch (_) {} cleanupTileSource(el); }
        else el._state = "ready";
      } else {
        cleanupTileSource(el); el._state = null; el.removeAttribute("src"); try { el.load(); } catch (_) {}
        if (!el._retried) { el._retried = true; setTimeout(() => { if (el.isConnected && !el._state && !tilePaused) requestTile(el); }, 2500); }
        else if (el.isConnected) el.closest(".grid-item")?.classList.add("media-unavailable");
      }
      videoPool.pump();
    };
    el._timer = setTimeout(() => finish(el.readyState >= 2), 12000);
    el.preload = "metadata"; el.removeAttribute("crossorigin");
    el.addEventListener("loadeddata", () => {
      if (stale()) return;
      if (el.currentTime === 0 && el.duration > 0.3) { try { el.currentTime = 0.1; el._seek = setTimeout(() => finish(true), 1200); return; } catch (_) {} }
      finish(true);
    }, { once: true });
    el.addEventListener("seeked", () => finish(true), { once: true });
    el.addEventListener("error", () => {
      if (stale()) return;
      cleanupTileSource(el);
      if (mode === "head") { mode = "direct"; el.crossOrigin = "anonymous"; el.src = urls[0] + "#t=0.1"; try { el.load(); } catch (_) {} }
      else if (mode === "direct") { mode = "plain"; el.removeAttribute("crossorigin"); el.src = (urls[1] || urls[0]) + "#t=0.1"; try { el.load(); } catch (_) {} }
      else finish(false);
    });
    const ctrl = new AbortController(); el._abort = ctrl;
    (async () => {
      let blob = null;
      try { blob = await headBlob(el, ctrl.signal); } catch (_) { return; }   // aborted
      if (stale()) return;
      if (!blob || !blob.size) { el.dispatchEvent(new Event("error")); return; }
      el._blobUrl = URL.createObjectURL(blob);
      el.src = el._blobUrl; try { el.load(); } catch (_) {}
    })();
  }

  // ---- live previews: the reel(s) in the middle of the screen play a muted clip, no tap needed ----
  const previews = new Set(); const PREVIEW_MAX = 2; let previewTimer = 0;
  function stopPreview(el) {
    previews.delete(el);
    if (!el._previewing) return;
    el._previewing = false; el.onended = el.onwaiting = null; clearTimeout(el._w);
    try { el.pause(); } catch (_) {}
    el.removeAttribute("src"); try { el.load(); } catch (_) {}
    if (el._prevUrl) { try { URL.revokeObjectURL(el._prevUrl); } catch (_) {} el._prevUrl = null; }
    el.classList.remove("previewing");
  }
  function stopAllPreviews() { [...previews].forEach(stopPreview); }
  function updatePreviews() {
    clearTimeout(previewTimer);
    for (const el of [...previews]) { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) stopPreview(el); }
    if (!PREVIEW_OK || tilePaused) return;
    previewTimer = setTimeout(choosePreviews, 450);       // wait until scrolling settles
  }
  function choosePreviews() {
    if (!PREVIEW_OK || tilePaused || document.hidden || previews.size >= PREVIEW_MAX) return;
    const cands = [...grid.querySelectorAll("video.grid-media")].filter(el => {
      if (el._state !== "poster" || el._previewing) return false;
      const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    }).sort((a, b) => centreDist(a) - centreDist(b));
    cands.slice(0, PREVIEW_MAX - previews.size).forEach(startPreview);
  }
  async function startPreview(el) {
    const id = tileId(el); if (!id) return;
    el._previewing = true; previews.add(el);
    let blob = headCache.get(id);
    if (!blob) { try { blob = await headBlob(el); } catch (_) {} }
    if (!el._previewing || !el.isConnected || tilePaused || !blob) { stopPreview(el); return; }
    el._prevUrl = URL.createObjectURL(blob); el.muted = true; el.playsInline = true;
    const restart = () => { try { el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} };
    el.onended = restart;                                   // the clip is a short head of the file: loop it
    el.onwaiting = () => { clearTimeout(el._w); el._w = setTimeout(() => { if (el._previewing) restart(); }, 350); };
    el.src = el._prevUrl; el.classList.add("previewing");
    const p = el.play(); if (p && p.catch) p.catch(() => stopPreview(el));
  }

  function pauseTileLoading() {
    tilePaused = true; clearTimeout(previewTimer); stopAllPreviews();
    for (const pool of [imgPool, videoPool]) for (const el of [...pool.loading]) { abortTile(el); el._state = null; }   // the post being opened gets the whole connection
  }
  function resumeTileLoading() {
    tilePaused = false;
    grid.querySelectorAll(".grid-media").forEach(el => {
      if (el._state) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > -150 && r.top < window.innerHeight + 150) requestTile(el);
    });
    imgPool.pump(); videoPool.pump(); updatePreviews();
  }

  // ===========================================================================
  //  PHOTO PIPELINE (inside an opened post)
  //  tiers: thumb (320px, ~10 KB) -> mid (720px) -> full (original). The WHOLE post gets its thumb and
  //  mid tiers at once, so swiping through a carousel is instant and never shows an empty screen.
  //  Switching photos cancels loads for the one you left and puts the new one first.
  // ===========================================================================
  const photoCache = new Map(), pendingLoads = new Map();
  let photoSession = null, viewerImg = null;
  function photoState(file) {
    let st = photoCache.get(file);
    if (!st) { st = { loaded: {}, url: {}, p: {}, imgs: {}, failed: {} }; photoCache.set(file, st); }
    return st;
  }
  function tierUrls(file, tier) {
    const orig = mediaUrls(file);
    if (tier === "thumb") return [imageVariant(file, THUMBW, 62), ...orig];
    if (tier === "mid") return [imageVariant(file, MIDW, 72), ...orig];
    return orig;
  }
  function loadTier(file, tier, prio = "auto") {
    const st = photoState(file);
    if (st.loaded[tier]) return Promise.resolve(true);
    if (st.p[tier]) return st.p[tier];
    const urls = tierUrls(file, tier), key = file + "|" + tier; let i = 0;
    const im = new Image(); im.decoding = "async"; try { im.fetchPriority = prio; } catch (_) {}
    const p = new Promise(resolve => {
      pendingLoads.set(key, { file, tier, im, st, resolve });
      const fin = ok => {
        pendingLoads.delete(key); st.p[tier] = null;
        if (ok) { st.loaded[tier] = true; st.url[tier] = im.currentSrc || im.src; st.imgs[tier] = im; } else st.failed[tier] = true;
        resolve(ok); if (ok) applyBest();
      };
      im.onload = () => fin(true);
      im.onerror = () => { if (++i < urls.length) im.src = urls[i]; else fin(false); };
      im.src = urls[0];
    });
    st.p[tier] = p; return p;
  }
  function cancelPhotoLoads(keep) {
    for (const [key, rec] of [...pendingLoads]) {
      if (keep(rec.file, rec.tier)) continue;
      rec.im.onload = rec.im.onerror = null; rec.im.removeAttribute("src");
      rec.st.p[rec.tier] = null; pendingLoads.delete(key); rec.resolve(false);
    }
  }
  const sessionLive = s => photoSession === s && opened;
  const byDistance = (files, idx) => files.map((f, i) => [f, i]).sort((a, b) => Math.abs(a[1] - idx) - Math.abs(b[1] - idx) || a[1] - b[1]).map(x => x[0]);

  function applyBest() {
    const v = viewerImg;
    if (!v || !opened || activeId !== v.postId || activeMediaIndex !== v.index) return;
    const st = photoState(v.file);
    const rank = st.loaded.full ? 3 : st.loaded.mid ? 2 : st.loaded.thumb ? 1 : 0;
    if (rank <= v.rank) return;
    const tier = rank === 3 ? "full" : rank === 2 ? "mid" : "thumb";
    v.rank = rank; v.el.classList.toggle("lowres", rank === 1); v.el.src = st.url[tier];
    if (!v.el.isConnected) {
      const post = byId.get(v.postId);
      const attach = () => {
        if (viewerImg !== v || !opened || activeId !== v.postId || activeMediaIndex !== v.index || v.el.isConnected) return;
        viewerMedia.replaceChildren(v.el); addCarouselControls(post, v.index);
      };
      (v.el.decode ? v.el.decode() : Promise.reject()).then(attach, attach);
    }
  }
  async function fullChain(post, session) {
    if (session.chaining) return;
    session.chaining = true;
    try {
      for (;;) {
        if (!sessionLive(session)) return;
        const cur = post.files[activeMediaIndex];
        const next = FULL_ALL ? byDistance(post.files, activeMediaIndex).find(f => !photoState(f).loaded.full && !photoState(f).failed.full)
                              : (!photoState(cur).loaded.full && !photoState(cur).failed.full ? cur : null);
        if (!next) return;
        if (SLOW_NET) {
          // Data saver / 2G: don't spend data right away. If the person stays on the same photo for a
          // few seconds, they are really looking at it, so the original size is loaded then.
          let seen;
          do { seen = activeMediaIndex; await new Promise(r => setTimeout(r, 4000)); if (!sessionLive(session)) return; }
          while (seen !== activeMediaIndex);
          if (post.files[activeMediaIndex] !== next) continue;   // moved to another photo meanwhile: re-pick
          if (photoState(next).loaded.full) continue;
        }
        await loadTier(next, "full", next === cur ? "high" : "low");
      }
    } finally { session.chaining = false; }
  }
  async function orchestratePost(post, idx, session) {
    const files = byDistance(post.files, idx), cur = files[0], rest = files.slice(1);
    const thumbs = [loadTier(cur, "thumb", "high")], curMid = loadTier(cur, "mid", "high");
    rest.forEach(f => thumbs.push(loadTier(f, "thumb", "low")));
    await Promise.all([...thumbs, curMid]);
    if (!sessionLive(session)) return;
    if (viewerImg && viewerImg.rank === 0 && !photoState(viewerImg.file).loaded.thumb && !photoState(viewerImg.file).loaded.mid) {
      const err = document.createElement("div"); err.className = "media-error";
      err.textContent = "This photo could not be loaded. Check that the filename exists in the repository.";
      viewerMedia.replaceChildren(err); return;
    }
    await Promise.all(rest.map(f => loadTier(f, "mid", "low")));
    if (!sessionLive(session)) return;
    fullChain(post, session);
    // Quietly warm the neighbouring posts so stepping up/down is instant.
    const list = navList(), i = list.findIndex(p => p.id === post.id);
    for (const n of [list[i + 1], list[i - 1]]) {
      if (!n || n.type !== "image" || !sessionLive(session)) continue;
      await loadTier(n.files[0], "thumb", "low"); if (sessionLive(session)) await loadTier(n.files[0], "mid", "low");
    }
  }
  function showPhoto(post, idx) {
    const file = post.files[idx];
    const el = new Image(); el.decoding = "async"; el.className = "opened-image";
    el.alt = `Hena post photograph${post.files.length > 1 ? ` ${idx + 1} of ${post.files.length}` : ""}`;
    viewerImg = { el, rank: 0, file, postId: post.id, index: idx };
    if (!photoSession || photoSession.postId !== post.id) {
      photoSession = { postId: post.id, chaining: false };
      post.files.forEach(f => { photoState(f).failed = {}; });
      cancelPhotoLoads(f => post.files.includes(f));
      orchestratePost(post, idx, photoSession);
    } else {
      // Moving inside the same post: stop the big download for the photo just left, favour this one.
      cancelPhotoLoads((f, t) => post.files.includes(f) && (t !== "full" || f === file));
      loadTier(file, "thumb", "high"); loadTier(file, "mid", "high");
      fullChain(post, photoSession);
    }
    applyBest();
  }

  // Pre-warm: next/previous reels while one is playing (never while the main video is still loading).
  const warmPool = new Map(); const WARM_MAX = LOW_END ? 1 : 3;
  function warmPost(post) {
    if (!post || post.type !== "video" || warmPool.has(post.id) || SLOW_NET) return;
    if (warmPool.size >= WARM_MAX) {
      const oldest = warmPool.keys().next().value, v = warmPool.get(oldest);
      try { v.removeAttribute("src"); v.load(); } catch (_) {}
      warmPool.delete(oldest);
    }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.src = mediaUrl(post.files[0]); try { v.load(); } catch (_) {}
    warmPool.set(post.id, v);
  }
  function warmNeighbours(post) {
    const list = navList(), i = list.findIndex(p => p.id === post.id);
    for (const p of [list[i + 1], list[i - 1], list[i + 2]]) warmPost(p);
  }

  let virtualStart = -1, virtualEnd = -1, virtualFrame = 0;
  const VIRTUAL_OVERSCAN_ROWS = 2;
  let virtualColumns = 3;

  function gridMetrics() {
    const css = getComputedStyle(grid);
    const profile = filter === "profile";
    const columns = profile && window.innerWidth > 760 ? 4 : 3;
    const gap = parseFloat(css.rowGap) || 0;
    const padTop = parseFloat(css.paddingTop) || 0;
    const padLeft = parseFloat(css.paddingLeft) || 0;
    const padRight = parseFloat(css.paddingRight) || 0;
    const usableWidth = Math.max(1, grid.clientWidth - padLeft - padRight);
    const colGap = parseFloat(css.columnGap) || 0;
    const tile = (usableWidth - (columns - 1) * colGap) / columns;
    return { columns, rowPitch: tile + gap, gap, padTop };
  }

  function ensureObserver() {
    if (gridObserver) return gridObserver;
    gridObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting) requestTile(el); else releaseTile(el);
      }
    }, { rootMargin: "140px 0px", threshold: 0.01 });
    return gridObserver;
  }
  function watchTile(button) {
    const media = button.querySelector(".grid-media");
    if (!media || !media.dataset.src) return;
    if (!("IntersectionObserver" in window)) { loadThumbnail(media, true); return; }
    ensureObserver().observe(media);
  }
  function unwatchTile(button) {
    const media = button.querySelector(".grid-media");
    if (!media) return;
    if (gridObserver) gridObserver.unobserve(media);
    releaseTile(media);
  }

  function makeSpacer(className, height) {
    const spacer = document.createElement("div");
    spacer.className = `virtual-spacer ${className}`;
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.gridColumn = "1 / -1";
    spacer.style.pointerEvents = "none";
    setSpacer(spacer, height);
    return spacer;
  }
  function setSpacer(spacer, height) {
    spacer.style.height = `${Math.max(0, height)}px`;
    spacer.style.display = height > 0 ? "" : "none";
  }

  // Sliding window: tiles scrolled out of range are removed (and their downloads cancelled);
  // new tiles are created only for rows entering the window, in either scroll direction.
  const tiles = new Map(); let topSpacer = null, bottomSpacer = null;
  function resetTiles() {
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
    for (const btn of tiles.values()) unwatchTile(btn);
    tiles.clear(); imgPool.queue.length = 0; videoPool.queue.length = 0; imgPool.loading.clear(); videoPool.loading.clear();
    topSpacer = bottomSpacer = null; grid.replaceChildren();
  }

  function renderVirtualWindow(force = false) {
    if (!grid.isConnected || !visiblePosts.length) { resetTiles(); virtualStart = virtualEnd = 0; return; }
    const { columns, rowPitch, gap, padTop } = gridMetrics();
    virtualColumns = columns;
    const gridTop = grid.getBoundingClientRect().top + window.scrollY + padTop;
    const relativeTop = Math.max(0, window.scrollY - gridTop);
    const relativeBottom = Math.max(0, window.scrollY + window.innerHeight - gridTop);
    const firstVisibleRow = Math.floor(relativeTop / Math.max(1, rowPitch));
    const lastVisibleRow = Math.ceil(relativeBottom / Math.max(1, rowPitch));
    const totalRows = Math.ceil(visiblePosts.length / columns);
    const startRow = Math.max(0, firstVisibleRow - VIRTUAL_OVERSCAN_ROWS);
    const endRow = Math.min(totalRows, lastVisibleRow + VIRTUAL_OVERSCAN_ROWS + 1);
    const start = startRow * columns;
    const end = Math.min(visiblePosts.length, endRow * columns);
    if (!force && topSpacer && start === virtualStart && end === virtualEnd) return;
    if (force || !topSpacer) {
      resetTiles();
      topSpacer = makeSpacer("virtual-spacer-top", 0); bottomSpacer = makeSpacer("virtual-spacer-bottom", 0);
      grid.append(topSpacer, bottomSpacer);
    }
    virtualStart = start; virtualEnd = end;
    for (const [i, btn] of tiles) if (i < start || i >= end) { unwatchTile(btn); btn.remove(); tiles.delete(i); }
    setSpacer(topSpacer, startRow > 0 ? startRow * rowPitch - gap : 0);
    const remainingRows = totalRows - endRow;
    setSpacer(bottomSpacer, remainingRows > 0 ? remainingRows * rowPitch - gap : 0);
    const have = [...tiles.keys()].sort((x, y) => x - y), firstHave = have.length ? have[0] : null;
    for (let i = start; i < end; i++) {
      if (tiles.has(i)) continue;
      const btn = makeThumbnail(visiblePosts[i], i);
      if (firstHave !== null && i < firstHave) grid.insertBefore(btn, tiles.get(firstHave));
      else grid.insertBefore(btn, bottomSpacer);
      tiles.set(i, btn); watchTile(btn);
    }
  }

  function scheduleVirtualRender(force = false) {
    if (virtualFrame) cancelAnimationFrame(virtualFrame);
    virtualFrame = requestAnimationFrame(() => {
      virtualFrame = 0;
      renderVirtualWindow(force);
    });
  }

  function renderGrid(nextFilter, updateUrl = true) {
    filter = ({ photos: "posts", all: "profile" })[nextFilter] || nextFilter;
    visiblePosts = filter === "videos" ? videos : filter === "profile" ? profileItems : posts;
    grid.classList.toggle("profile-grid", filter === "profile");
    virtualStart = virtualEnd = -1;
    renderVirtualWindow(true);
    document.querySelectorAll(".tab").forEach(tab => {
      const active = tab.dataset.filter === filter;
      tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active));
    });
    $("status").textContent = visiblePosts.length ? `${visiblePosts.length.toLocaleString()} ${filter === "videos" ? "reels" : filter === "profile" ? "individual photo profiles" : "posts"}` : "No media files in this section.";
    if (updateUrl) updateUrlForPost(null, true);
    if (opened) closeViewer(false);
    updatePreviews();
  }

  function cleanupViewerMedia() {
    viewerMedia.querySelectorAll("video").forEach(video => {
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
    });
    viewerMedia.replaceChildren();
  }

  function showLoading(message = "Loading media…") {
    const state = document.createElement("div"); state.className = "media-loading";
    const spinner = document.createElement("span"); spinner.className = "spinner"; spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.textContent = message;
    state.append(spinner, label); viewerMedia.replaceChildren(state);
  }

  function addCarouselControls(post, index) {
    if (post.type !== "image" || post.files.length < 2) return;
    const controls = document.createElement("div"); controls.className = "carousel-controls";
    const prev = document.createElement("button"); prev.type = "button"; prev.className = "carousel-step prev"; prev.setAttribute("aria-label", "Previous photo"); prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"></path></svg>'; prev.disabled = index <= 0;
    const next = document.createElement("button"); next.type = "button"; next.className = "carousel-step next"; next.setAttribute("aria-label", "Next photo"); next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"></path></svg>'; next.disabled = index >= post.files.length - 1;
    const count = document.createElement("span"); count.className = "carousel-counter"; count.textContent = `${index + 1} / ${post.files.length}`;
    prev.addEventListener("click", event => { event.stopPropagation(); showMedia(post, index - 1); });
    next.addEventListener("click", event => { event.stopPropagation(); showMedia(post, index + 1); });
    controls.append(prev, count, next); viewerMedia.append(controls);
  }

  function showMedia(post, fileIndex = 0) {
    if (fileIndex < 0 || fileIndex >= post.files.length) return;
    activeMediaIndex = fileIndex;
    cleanupViewerMedia();
    const file = post.files[fileIndex], url = mediaUrl(file), urls = mediaUrls(file);
    showLoading(isVideo(file) ? "Loading reel…" : post.files.length > 1 ? `Loading photo ${fileIndex + 1} of ${post.files.length}…` : "Loading photo…");
    if (isVideo(file)) {
      cancelPhotoLoads(() => false); photoSession = null; viewerImg = null;
      const video = document.createElement("video");
      video.controls = true; video.playsInline = true; video.preload = "auto"; video.controlsList = "nodownload";
      video.loop = true; video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", "");
      video.setAttribute("aria-label", "Reel video"); video.className = "opened-video"; video.style.objectFit = "contain";
      const poster = posterCache.get(post.id); if (poster) video.poster = poster;
      // Show the thumbnail (poster / first frame) at once instead of a blank spinner screen.
      const wrap = document.createElement("div"); wrap.className = "video-stage";
      const spin = document.createElement("div"); spin.className = "video-buffering"; spin.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="buffer-note"></span>';
      const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "video-bigplay"; playBtn.setAttribute("aria-label", "Play reel"); playBtn.hidden = true;
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
      wrap.append(video, spin, playBtn); viewerMedia.replaceChildren(wrap);
      const busy = on => { spin.style.display = on ? "flex" : "none"; };
      const current = () => video.isConnected && opened && activeId === post.id && activeMediaIndex === fileIndex;
      const tryPlay = () => {
        const p = video.play();
        if (p && p.catch) p.catch(() => {
          video.muted = true;
          const q = video.play(); if (q && q.catch) q.catch(() => { busy(false); playBtn.hidden = false; });
        });
      };
      playBtn.addEventListener("click", () => { playBtn.hidden = true; video.muted = false; tryPlay(); });
      video.addEventListener("waiting", () => busy(true));
      video.addEventListener("seeking", () => busy(true));
      for (const ev of ["playing", "canplay", "seeked"]) video.addEventListener(ev, () => busy(false));
      video.addEventListener("playing", () => { playBtn.hidden = true; });
      video.addEventListener("loadedmetadata", () => { if (current() && !poster) { try { if (video.paused && video.currentTime === 0) video.currentTime = 0.1; } catch (_) {} } }, { once: true });
      video.addEventListener("canplay", () => { if (current() && video.paused) tryPlay(); }, { once: true });
      let mirror = 0;
      video.addEventListener("error", () => {
        if (!current()) return;
        if (mirror < urls.length - 1) { mirror++; busy(true); video.src = urls[mirror]; try { video.load(); } catch (_) {} return; }  // try the other server
        const err = document.createElement("div"); err.className = "media-error";
        err.textContent = "This video could not be loaded. Check that the file exists in the repository and is supported by your browser.";
        viewerMedia.replaceChildren(err);
      });
      const warmed = warmPool.get(post.id); if (warmed) { try { warmed.removeAttribute("src"); warmed.load(); } catch (_) {} warmPool.delete(post.id); }
      const note = spin.querySelector(".buffer-note");
      const slow = setTimeout(() => { if (current() && video.paused && video.readyState < 3) note.textContent = "Slow connection \u2014 still loading\u2026"; }, 7000);
      video.addEventListener("canplay", () => { clearTimeout(slow); note.textContent = ""; }, { once: true });
      video.addEventListener("playing", () => { clearTimeout(slow); note.textContent = ""; }, { once: true });
      // Only after the main reel can play do we quietly pre-load the neighbours.
      video.addEventListener("canplay", () => { if (current()) setTimeout(() => current() && warmNeighbours(post), 600); }, { once: true });
      video.src = url; busy(true); try { video.load(); } catch (_) {}
    } else {
      showPhoto(post, fileIndex);
    }
  }

  function navList() {
    const list = filter === "videos" ? videos : filter === "profile" ? profileItems : posts;
    return list.some(p => p.id === activeId) ? list : posts;
  }
  function syncPostButtons() {
    const list = navList(), index = list.findIndex(item => item.id === activeId);
    $("previousPost").disabled = index <= 0;
    $("nextPost").disabled = index < 0 || index >= list.length - 1;
  }

  function openPost(id, updateUrl = true) {
    const post = byId.get(id); if (!post) return;
    activeId = id; activeMediaIndex = 0; opened = true; lastFocused = document.activeElement;
    viewer.hidden = false; document.body.classList.add("viewer-open"); pauseTileLoading();
    $("viewerCaption").replaceChildren(); $("viewerDate").textContent = post.timestamp || "";
    if (post.caption) {
      const username = document.createElement("span"); username.className = "caption-user"; username.textContent = "hennaah.11";
      $("viewerCaption").append(username, document.createTextNode(post.caption));
    }
    $("likeButton").classList.remove("liked"); $("likeButton").textContent = "♡";
    $("saveButton").classList.remove("liked");
    showMedia(post); syncPostButtons();
    if (updateUrl) updateUrlForPost(post, true); else updateUrlForPost(post, false);
    $("linkStatus").textContent = ""; $("closeViewer").focus();
  }

  function closeViewer(updateUrl = true) {
    if (!opened) return;
    opened = false; activeId = null; viewer.hidden = true; cleanupViewerMedia();
    cancelPhotoLoads(() => false); photoSession = null; viewerImg = null;
    document.body.classList.remove("viewer-open"); resumeTileLoading();
    if (updateUrl) updateUrlForPost(null, true);
    if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
  }

  // Up / down between posts (like Instagram reels). delta +1 = next post (swipe up), -1 = previous.
  function stepPost(delta) {
    const list = navList(), index = list.findIndex(post => post.id === activeId), next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) return;
    openPost(list[next].id, false);          // replace the URL instead of piling up history entries
    try { viewerMedia.animate([{ transform: `translateY(${delta * 56}px)`, opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" }); } catch (_) {}
  }

  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => renderGrid(tab.dataset.filter, true)));
  $("themeToggle").addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    applyTheme(next); try { localStorage.setItem("hena-theme", next); } catch (_) {}
  });
  $("closeViewer").addEventListener("click", () => closeViewer());
  $("previousPost").addEventListener("click", () => stepPost(-1));
  $("nextPost").addEventListener("click", () => stepPost(1));
  viewer.addEventListener("click", event => { if (event.target === viewer) closeViewer(); });
  $("likeButton").addEventListener("click", () => { const liked = $("likeButton").classList.toggle("liked"); $("likeButton").textContent = liked ? "♥" : "♡"; });
  $("saveButton").addEventListener("click", () => $("saveButton").classList.toggle("liked"));
  $("shareButton").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("linkStatus").textContent = "Post link copied"; }
    catch (_) { $("linkStatus").textContent = "Copy the address-bar link to share"; }
  });

  document.addEventListener("keydown", event => {
    if (!opened) return;
    if (event.key === "Escape") closeViewer();
    const post = byId.get(activeId), carousel = post?.type === "image" && post.files.length > 1;
    if (event.key === "ArrowDown" || event.key === "PageDown") { event.preventDefault(); stepPost(1); }
    if (event.key === "ArrowUp" || event.key === "PageUp") { event.preventDefault(); stepPost(-1); }
    if (carousel && event.key === "ArrowLeft" && activeMediaIndex > 0) showMedia(post, activeMediaIndex - 1);
    if (carousel && event.key === "ArrowRight" && activeMediaIndex < post.files.length - 1) showMedia(post, activeMediaIndex + 1);
  });
  // Touch: swipe UP = next post, swipe DOWN = previous (reels style). Swipe left/right only moves
  // inside a multi-photo post. Swipes that begin on the native video control bar are ignored.
  viewerMedia.addEventListener("touchstart", event => {
    const t = event.changedTouches[0], r = viewerMedia.getBoundingClientRect();
    pointerStartX = t.clientX; pointerStartY = t.clientY;
    if (event.target.closest("video") && t.clientY > r.bottom - 64) pointerStartX = pointerStartY = null;
  }, { passive: true });
  viewerMedia.addEventListener("touchend", event => {
    if (pointerStartX === null) return;
    const t = event.changedTouches[0], dx = t.clientX - pointerStartX, dy = t.clientY - pointerStartY;
    pointerStartX = pointerStartY = null;
    const post = byId.get(activeId), carousel = post?.type === "image" && post.files.length > 1;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.2) stepPost(dy < 0 ? 1 : -1);
    else if (carousel && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      const n = activeMediaIndex + (dx < 0 ? 1 : -1); if (n >= 0 && n < post.files.length) showMedia(post, n);
    }
  }, { passive: true });
  // Mouse wheel / trackpad: one post per scroll gesture.
  let wheelLock = 0;
  viewerMedia.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) < 20 || Date.now() < wheelLock) return;
    wheelLock = Date.now() + 650; event.preventDefault(); stepPost(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  window.addEventListener("popstate", () => {
    const url = new URL(location.href), postId = url.searchParams.get("post");
    if (postId && byId.has(postId)) {
      const post = byId.get(postId);
      const requestedFilter = normalizeFilter(url.searchParams.get("filter") || "posts");
      renderGrid(requestedFilter, false); openPost(postId, false);
    } else {
      if (opened) closeViewer(false);
      renderGrid(normalizeFilter(url.searchParams.get("filter") || "posts"), false);
    }
  });

  // Virtual scrolling: keep only visible rows plus a small buffer in the DOM.
  // Scrolling either direction replaces off-screen rows, releasing their video/media elements.
  window.addEventListener("scroll", () => { scheduleVirtualRender(false); updatePreviews(); }, { passive: true });
  window.addEventListener("resize", () => scheduleVirtualRender(true), { passive: true });

  const initialUrl = new URL(location.href);
  const initialPostId = initialUrl.searchParams.get("post");
  const initialFilter = normalizeFilter(initialUrl.searchParams.get("filter") || "posts");
  renderGrid(["posts", "videos", "profile"].includes(initialFilter) ? initialFilter : "posts", false);
  updatePreviews();
  if (initialPostId && byId.has(initialPostId)) openPost(initialPostId, false);
})();
