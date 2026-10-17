(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const grid = $("grid"), viewer = $("viewer"), viewerMedia = $("viewerMedia");
  const profilePhotoUrl = mediaUrl(PROFILE_PHOTO_PATH);
  $("profilePhoto").src = profilePhotoUrl;
  $("viewerAvatar").src = profilePhotoUrl;

  const photos = posts.filter(post => post.type === "image");
  const videos = posts.filter(post => post.type === "video");
  const byId = new Map(posts.map(post => [post.id, post]));
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
    else { media.muted = true; media.playsInline = true; media.preload = "none"; media.setAttribute("aria-label", "Reel preview"); }
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
    button.addEventListener("click", () => openPost(post.id, true));
    return button;
  }

  function loadThumbnail(el) {
    if (!el.isConnected || !el.dataset.src) return;
    const src = el.dataset.src; delete el.dataset.src;
    if (el.tagName === "VIDEO") {
      // A tiny muted preview is enough for the grid; full video loading waits until opening.
      el.src = src; el.preload = "metadata";
      el.addEventListener("error", () => { if (el.isConnected) el.classList.add("media-unavailable"); }, { once: true });
    } else {
      el.src = src;
      el.addEventListener("error", () => { if (el.isConnected) { el.closest(".grid-item")?.classList.add("media-unavailable"); el.removeAttribute("src"); } }, { once: true });
    }
  }

  function setupLazyMedia() {
    if (gridObserver) gridObserver.disconnect();
    const targets = grid.querySelectorAll("[data-src]");
    if (!("IntersectionObserver" in window)) { targets.forEach(loadThumbnail); return; }
    gridObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { loadThumbnail(entry.target); gridObserver.unobserve(entry.target); }
    }, { rootMargin: "120px 0px", threshold: 0.01 });
    targets.forEach(el => gridObserver.observe(el));
  }

  function renderGrid(nextFilter, updateUrl = true) {
    filter = ({ photos: "posts", all: "profile" })[nextFilter] || nextFilter;
    visiblePosts = filter === "videos" ? videos : posts;
    grid.classList.toggle("profile-grid", filter === "profile");
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
    grid.replaceChildren();
    const fragment = document.createDocumentFragment();
    visiblePosts.forEach((post, i) => fragment.append(makeThumbnail(post, i)));
    grid.append(fragment);
    setupLazyMedia();
    document.querySelectorAll(".tab").forEach(tab => {
      const active = tab.dataset.filter === filter;
      tab.classList.toggle("active", active); tab.setAttribute("aria-pressed", String(active));
    });
    $("status").textContent = visiblePosts.length ? `${visiblePosts.length.toLocaleString()} ${filter === "videos" ? "reels" : filter === "profile" ? "profile items" : "posts"}` : "No media files in this section.";
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
      video.setAttribute("aria-label", "Reel video"); video.className = "opened-video"; video.style.objectFit = "contain";
      video.addEventListener("loadeddata", () => { if (video.isConnected && opened && activeId === post.id) viewerMedia.replaceChildren(video); }, { once: true });
      video.addEventListener("error", () => {
        if (!video.isConnected || !opened || activeId !== post.id) return;
        const err = document.createElement("div"); err.className = "media-error";
        err.textContent = "This video could not be loaded. Check that the file exists in the repository and is supported by your browser.";
        viewerMedia.replaceChildren(err);
      }, { once: true });
      viewerMedia.querySelector(".media-loading")?.append(video);
      video.src = url; video.load();
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
    viewer.hidden = false; document.body.classList.add("viewer-open");
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
    document.body.classList.remove("viewer-open");
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

  // Render the complete filtered grid in one pass; only near-viewport thumbnails fetch media.
  const initialUrl = new URL(location.href);
  const initialPostId = initialUrl.searchParams.get("post");
  const initialFilter = normalizeFilter(initialUrl.searchParams.get("filter") || "posts");
  renderGrid(["posts", "videos", "profile"].includes(initialFilter) ? initialFilter : "posts", false);
  if (initialPostId && byId.has(initialPostId)) openPost(initialPostId, false);
})();
