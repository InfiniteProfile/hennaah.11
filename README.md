# Hena — Instagram-inspired profile

A lightweight, static profile site for **Hena** (`hennaah.11`) designed for GitHub Pages and mobile browsers.

## Included files

- `index.html` — profile layout, media filters, and opened-post viewer.
- `style.css` — responsive Instagram-inspired styling and persistent light/dark themes.
- `script.js` — filtering, lazy loading, viewer, direct links, theme control, and media cleanup.
- `posts.js` — all 485 exact filenames and generated post records.

## Dataset coverage

The supplied filename list contains 485 unique entries: 294 image files and 191 MP4 videos. Every source filename is preserved exactly once. Images sharing the same export ID are grouped into one swipeable carousel (for example, `igexport-ABC.jpg`, `igexport-ABC-2.jpg`, and `igexport-ABC-3.jpg`). The unsuffixed image appears first, followed by numbered variants in numeric order. Videos always remain separate reel posts, even if a video shares an ID with a photo group. The grid reverses the supplied list so newer-looking entries appear at the top and older-looking entries lower down; this is inferred from list order, not verified timestamps.

Captions and timestamps remain empty because they were not provided. Follower/following counts and a biography are not fabricated.

## Media URL generation

`posts.js` defines this raw-media base:

```js
const MEDIA_BASE = "https://raw.githubusercontent.com/InfiniteProfile/hennaah.11/main/";
```

The `mediaUrl(filename)` helper encodes each path component independently, so spaces and parentheses are safe. The profile image uses `profile photo/igexport-DVY7NlejDJ9-6.jpg` under the same repository.

## Add a photo or video

1. Upload the media file to the root of the `hennaah.11` repository (or update its path if it is in a subdirectory).
2. Add the exact filename as a new string in the `MEDIA_FILES` array in `posts.js`.
3. Save and publish. The page automatically determines image/video type from the extension and creates a stable ID from the filename.
4. Supported formats include JPG/JPEG, PNG, WebP, GIF, MP4, and WebM. The supplied dataset currently contains JPG and MP4 files. Browser support for a video codec depends on the visitor's browser.

For a file in a subdirectory, include the path as part of the filename, for example `"album/photo (1).jpg"`.

## Captions and timestamps

The generated records have `caption: ""` and `timestamp: ""`. Display order is newest-looking first (top) to oldest-looking last (bottom), based on reversing the supplied filename list; filenames do not provide verified timestamps. To add verified information, add it to the corresponding record returned by `buildPosts()` or maintain a separate filename-to-metadata map keyed by the exact filename. Do not infer original captions or dates from filenames.

## Media sections

- **Posts** — image posts; related image variants appear as one grouped carousel tile.
- **Videos** — individual reel/video posts, never merged into photo carousels.
- **All profile** — every photo group and every reel together in the same profile-style grid. Photo groups display a stacked-photo marker and item count; reels display a custom reel/play marker.

Image groups use the filename export-ID pattern as a practical grouping rule. This is inferred from the filenames rather than verified Instagram carousel metadata. A similarly named video always remains a separate reel post.

## Loading and performance

The full selected grid is rendered without pagination, but thumbnails load only near the viewport using `IntersectionObserver`. The opened original media receives high loading priority; images use eager loading and `fetchPriority="high"` in the viewer. Videos in the grid use metadata-only loading, while a video opened in the viewer loads on demand with native browser controls. Closing a post pauses videos, removes their source, and calls `load()` to release active media references. Browser cache contents and memory reclamation remain controlled by the browser.

Opened photos and videos use `object-fit: contain` and preserve their aspect ratio. Grouped photos have on-image previous/next controls, a position counter, keyboard-arrow navigation, and mobile swipe support. Grid thumbnails intentionally use `object-fit: cover` for the square grid.

## Dark mode

Use the theme control in the top-right corner. The selected theme is saved in local storage where available; otherwise the site follows the system theme on first visit.

## Direct post links

Each item has a stable URL such as `?post=media-xxxxxxxx`. Opening a post preserves its ID in the address bar, and refreshing the URL reopens that post. The **All profile** section can display the complete media set in one continuous grid. Filter selection can be retained with `?filter=videos` or `?filter=all`.

## Deploy to GitHub Pages

1. Upload `index.html`, `style.css`, `script.js`, `posts.js`, and `README.md` to the root of `https://github.com/InfiniteProfile/hennaah.11` (or place the site files in the directory configured for Pages).
2. Confirm that the media files exist in the repository at the exact filenames and paths listed in `posts.js`.
3. Open **Settings → Pages** in GitHub.
4. Select the `main` branch and `/ (root)`, then save.
5. Visit the published Pages URL after the deployment completes.

No Node.js, build step, database, backend, or paid hosting is required.


## Updated Instagram-style sections

- **POSTS** mixes photo posts, grouped photo carousels, and individual videos in one feed, as on an Instagram profile.
- **REELS** filters to video posts only. Videos remain separate posts and are not merged into photo carousels even when the export ID matches.
- **PROFILE** shows the same posts in a round, cropped avatar-style gallery; open any circle to view the complete media without cropping.
- The source filenames do not provide verified publication timestamps, so the displayed order follows the supplied filename list in reverse rather than claiming exact posting dates.


## Latest performance and PROFILE behavior
- Visible and near-visible thumbnails are requested first; the intersection window is 500px to help scrolling feel more immediate.
- Clicking a tile promotes that exact thumbnail request and the viewer requests the selected original with high fetch priority.
- POSTS keeps related same-ID photos grouped into carousels and videos as independent posts.
- PROFILE is separate: every individual image file becomes one round, cropped photo tile. It does not group image variants, and it does not treat a multi-photo post as one profile.
- Video files are excluded from PROFILE because this section represents photo-based profile tiles; videos remain available in POSTS and REELS.
- Loading order is prioritized, but actual speed still depends on GitHub raw delivery, network quality, and the original media file sizes.


## Video thumbnails and virtual scrolling (latest update)

- Video tiles now request and decode a real frame after metadata is available, seek a tiny amount into the clip, then pause. Tiles are muted and use no native controls; the custom video icon remains overlaid. This makes actual thumbnail frames visible when the browser/CDN supports byte-range media access.
- The grid is virtualized: it renders only the rows near the viewport plus a small overscan buffer. Rows far above/below are removed from the DOM and rebuilt when scrolling back, reducing DOM size and releasing off-screen video elements. The same system works while scrolling down or up.
- Images and video thumbnails still use intersection-based loading, with a tighter near-viewport window. The clicked post viewer remains high priority.
- Some MP4s may still show a neutral tile if GitHub's raw delivery, a codec, or the browser prevents frame decoding; a static poster image is not available in the supplied filename-only dataset.
