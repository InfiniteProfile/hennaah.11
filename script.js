(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const grid = $("grid"), viewer = $("viewer"), viewerMedia = $("viewerMedia");
  const profilePhotoUrl = mediaUrl(PROFILE_PHOTO_PATH);
  $("profilePhoto").src = profilePhotoUrl;
  $("viewerAvatar").src = profilePhotoUrl;

  const photos = posts.filter(post => post.type === "image");
  const videos = posts.filter(post => post.type === "video");
  const byId = new Map([...posts, ...profileItems].map(post => [post.id, post]));
  let filter = "posts", visiblePosts = posts, activeId = null, opened = false, activeMediaIndex = 0;
  let gridObserver = null, lastFocused = null, pointerStartX = null;

  const savedTheme = (() => { try { return localStorage.getItem("hena-theme"); } catch (_) { return null; } })();
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (prefersDark ? "dark" : "light"));

  $("postCount").textContent = posts.length.toLocaleString();
  $("videoCount").textContent = videos.length.toLocaleString();

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

  function isVideo(file) { return /\.(mp4|webm)$/i.test(file); }
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
    if (media.tagName === "IMG") { media.alt = ""; media.loading = "lazy"; media.decoding = "async"; media.fetchPriority = "low"; }
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
      const warm = () => warmPost(post);
      button.addEventListener("pointerenter", warm, { once: true });
      button.addEventListener("touchstart", warm, { once: true, passive: true });
      button.addEventListener("focus", warm, { once: true });
    }
    button.addEventListener("click", () => {
      // Promote the exact tile the viewer clicked, then prioritize its full-size original.
      const tileMedia = button.querySelector(".grid-media");
      if (tileMedia?.dataset.src) loadThumbnail(tileMedia, true);
      openPost(post.id, true);
    });
    return button;
  }

  function loadThumbnail(el, prioritize = false) {
    if (!el.isConnected || !el.dataset.src) return;
    if (el.tagName === "IMG") {
      el.fetchPriority = prioritize ? "high" : (el.fetchPriority || "low");
      el.loading = prioritize ? "eager" : "lazy";
    }
    const src = el.dataset.src; delete el.dataset.src;
    if (el.tagName === "VIDEO") {
      el._src = src;
      if (prioritize) startVideoTile(el); else { tileQueue.push(el); pumpTiles(); }
    } else {
      el.src = src;
      el.addEventListener("error", () => { if (el.isConnected) { el.closest(".grid-item")?.classList.add("media-unavailable"); el.removeAttribute("src"); } }, { once: true });
    }
  }


  // ---- Video loading engine -------------------------------------------------
  // Grid tiles: only a few videos fetch at once (first frame only), so the reel the person
  // is about to watch is never starved of bandwidth. Queue pauses while the viewer is open.
  const tileQueue = []; let tileActive = 0, tilePaused = false;
  const TILE_MAX = 4;
  const posterCache = new Map();           // post id -> dataURL of first frame
  function pumpTiles() {
    while (!tilePaused && tileActive < TILE_MAX && tileQueue.length) {
      const el = tileQueue.shift();
      if (el.isConnected && el._src) startVideoTile(el);
    }
  }
  function capturePoster(el) {
    const id = el.closest(".grid-item")?.dataset.id;
    if (!id || posterCache.has(id) || !el.videoWidth) return;
    try {
      const c = document.createElement("canvas"), w = Math.min(540, el.videoWidth);
      c.width = w; c.height = Math.round(w * el.videoHeight / el.videoWidth);
      c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
      posterCache.set(id, c.toDataURL("image/jpeg", 0.78));
    } catch (_) {}
  }
  function startVideoTile(el) {
    const src = el._src; if (!src) return; el._src = null;
    tileActive++;
    let finished = false, retried = false;
    const finish = () => { if (finished) return; finished = true; tileActive = Math.max(0, tileActive - 1); pumpTiles(); };
    const ready = () => {
      if (el.isConnected) { el.classList.add("video-frame-ready"); capturePoster(el); try { el.pause(); } catch (_) {} }
      el.preload = "metadata"; finish();
    };
    el.preload = "metadata";
    el.crossOrigin = "anonymous";            // lets us copy the frame to a poster image
    el.addEventListener("loadeddata", ready, { once: true });
    el.addEventListener("seeked", ready, { once: true });
    el.addEventListener("error", () => {
      if (!retried && el.crossOrigin) {      // CORS problem? retry plain, thumbnail still works
        retried = true; el.removeAttribute("crossorigin"); el.src = src + "#t=0.1"; try { el.load(); } catch (_) {}
        return;
      }
      if (el.isConnected) el.closest(".grid-item")?.classList.add("media-unavailable");
      finish();
    });
    setTimeout(finish, 9000);
    el.src = src + "#t=0.1";                 // #t=0.1 makes the browser show a real frame, not black
    try { el.load(); } catch (_) {}
  }

  // Pre-warm: the reels most likely to be watched next (hovered/touched tile, next and
  // previous reel in the viewer) get a hidden <video preload=auto> so bytes are cached.
  const warmPool = new Map(); const WARM_MAX = 3;
  function warmPost(post) {
    if (!post || post.type !== "video" || warmPool.has(post.id)) return;
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
    const list = filter === "videos" ? videos : posts, i = list.findIndex(p => p.id === post.id);
    for (const p of [list[i + 1], list[i + 2], list[i - 1]]) warmPost(p);
  }

  let virtualStart = -1, virtualEnd = -1, virtualFrame = 0;
  const VIRTUAL_OVERSCAN_ROWS = 3;
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

  function setupLazyMedia() {
    if (gridObserver) gridObserver.disconnect();
    const targets = grid.querySelectorAll("[data-src]");
    if (!("IntersectionObserver" in window)) { targets.forEach(el => loadThumbnail(el, true)); return; }
    gridObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        loadThumbnail(entry.target, entry.intersectionRatio > 0);
        gridObserver.unobserve(entry.target);
      }
    }, { rootMargin: "280px 0px", threshold: 0.01 });
    targets.forEach(el => gridObserver.observe(el));
  }

  function makeSpacer(className, height) {
    const spacer = document.createElement("div");
    spacer.className = `virtual-spacer ${className}`;
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = `${Math.max(0, height)}px`;
    spacer.style.gridColumn = "1 / -1";
    spacer.style.pointerEvents = "none";
    return spacer;
  }

  function renderVirtualWindow(force = false) {
    if (!grid.isConnected || !visiblePosts.length) {
      grid.replaceChildren(); virtualStart = virtualEnd = 0; return;
    }
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
    if (!force && start === virtualStart && end === virtualEnd) return;
    virtualStart = start; virtualEnd = end;
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
    const fragment = document.createDocumentFragment();
    if (startRow > 0) fragment.append(makeSpacer("virtual-spacer-top", startRow * rowPitch - gap));
    for (let i = start; i < end; i++) fragment.append(makeThumbnail(visiblePosts[i], i));
    const remainingRows = totalRows - endRow;
    if (remainingRows > 0) fragment.append(makeSpacer("virtual-spacer-bottom", remainingRows * rowPitch - gap));
    grid.replaceChildren(fragment);
    setupLazyMedia();
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
    const file = post.files[fileIndex], url = mediaUrl(file);
    showLoading(isVideo(file) ? "Loading reel…" : post.files.length > 1 ? `Loading photo ${fileIndex + 1} of ${post.files.length}…` : "Loading photo…");
    if (isVideo(file)) {
      const video = document.createElement("video");
      video.controls = true; video.playsInline = true; video.preload = "auto"; video.controlsList = "nodownload";
      video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", "");
      video.setAttribute("aria-label", "Reel video"); video.className = "opened-video"; video.style.objectFit = "contain";
      const poster = posterCache.get(post.id); if (poster) video.poster = poster;
      // Show the thumbnail (poster / first frame) at once instead of a blank spinner screen.
      const wrap = document.createElement("div"); wrap.className = "video-stage";
      const spin = document.createElement("div"); spin.className = "video-buffering"; spin.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
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
      video.addEventListener("error", () => {
        if (!current()) return;
        const err = document.createElement("div"); err.className = "media-error";
        err.textContent = "This video could not be loaded. Check that the file exists in the repository and is supported by your browser.";
        viewerMedia.replaceChildren(err);
      }, { once: true });
      const warmed = warmPool.get(post.id); if (warmed) { try { warmed.removeAttribute("src"); warmed.load(); } catch (_) {} warmPool.delete(post.id); }
      video.src = url; busy(true); try { video.load(); } catch (_) {}
      warmNeighbours(post);
    } else {
      const img = new Image();
      img.alt = `Hena post photograph${post.files.length > 1 ? ` ${fileIndex + 1} of ${post.files.length}` : ""}`;
      img.decoding = "async"; img.loading = "eager"; img.fetchPriority = "high"; img.className = "opened-image";
      img.addEventListener("load", () => { if (opened && activeId === post.id && activeMediaIndex === fileIndex) { viewerMedia.replaceChildren(img); addCarouselControls(post, fileIndex); } }, { once: true });
      img.addEventListener("error", () => {
        if (!opened || activeId !== post.id || activeMediaIndex !== fileIndex) return;
        const err = document.createElement("div"); err.className = "media-error";
        err.textContent = "This photo could not be loaded. Check that the filename exists at the expected GitHub raw URL.";
        viewerMedia.replaceChildren(err);
      }, { once: true });
      img.src = url;
    }
  }

  function syncPostButtons(post) {
    const index = posts.findIndex(item => item.id === post.id);
    $("previousPost").disabled = index <= 0;
    $("nextPost").disabled = index < 0 || index >= posts.length - 1;
  }

  function openPost(id, updateUrl = true) {
    const post = byId.get(id); if (!post) return;
    activeId = id; activeMediaIndex = 0; opened = true; lastFocused = document.activeElement;
    viewer.hidden = false; document.body.classList.add("viewer-open"); tilePaused = true;
    $("viewerCaption").replaceChildren(); $("viewerDate").textContent = post.timestamp || "";
    if (post.caption) {
      const username = document.createElement("span"); username.className = "caption-user"; username.textContent = "hennaah.11";
      $("viewerCaption").append(username, document.createTextNode(post.caption));
    }
    $("likeButton").classList.remove("liked"); $("likeButton").textContent = "♡";
    $("saveButton").classList.remove("liked");
    showMedia(post); syncPostButtons(post);
    if (updateUrl) updateUrlForPost(post, true); else updateUrlForPost(post, false);
    $("linkStatus").textContent = ""; $("closeViewer").focus();
  }

  function closeViewer(updateUrl = true) {
    if (!opened) return;
    opened = false; activeId = null; viewer.hidden = true; cleanupViewerMedia();
    document.body.classList.remove("viewer-open"); tilePaused = false; pumpTiles();
    if (updateUrl) updateUrlForPost(null, true);
    if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
  }

  function stepPost(delta) {
    const index = posts.findIndex(post => post.id === activeId), next = index + delta;
    if (next < 0 || next >= posts.length) return;
    const post = posts[next];
    // Switch the active filter only if needed, then prioritize the selected original media.
    const belongs = filter === "posts" || filter === "profile" || (filter === "videos" && post.type === "video");
    if (!belongs) renderGrid("posts", false);
    openPost(post.id, true);
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
    if (event.key === "ArrowLeft") { const post = byId.get(activeId); if (post?.type === "image" && post.files.length > 1 && activeMediaIndex > 0) showMedia(post, activeMediaIndex - 1); else stepPost(-1); }
    if (event.key === "ArrowRight") { const post = byId.get(activeId); if (post?.type === "image" && post.files.length > 1 && activeMediaIndex < post.files.length - 1) showMedia(post, activeMediaIndex + 1); else stepPost(1); }
  });
  viewerMedia.addEventListener("touchstart", event => { pointerStartX = event.changedTouches[0].clientX; }, { passive: true });
  viewerMedia.addEventListener("touchend", event => {
    if (pointerStartX === null) return;
    const dx = event.changedTouches[0].clientX - pointerStartX; pointerStartX = null;
    if (Math.abs(dx) > 80 && !event.target.closest("video")) { const post = byId.get(activeId); if (post?.type === "image" && post.files.length > 1) { const next = activeMediaIndex + (dx < 0 ? 1 : -1); if (next >= 0 && next < post.files.length) showMedia(post, next); else stepPost(dx < 0 ? 1 : -1); } else stepPost(dx < 0 ? 1 : -1); }
  }, { passive: true });

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
  window.addEventListener("scroll", () => scheduleVirtualRender(false), { passive: true });
  window.addEventListener("resize", () => scheduleVirtualRender(true), { passive: true });

  const initialUrl = new URL(location.href);
  const initialPostId = initialUrl.searchParams.get("post");
  const initialFilter = normalizeFilter(initialUrl.searchParams.get("filter") || "posts");
  renderGrid(["posts", "videos", "profile"].includes(initialFilter) ? initialFilter : "posts", false);
  if (initialPostId && byId.has(initialPostId)) openPost(initialPostId, false);
})();
