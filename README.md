# Hena — Instagram-inspired profile

A lightweight, static profile site for **Hena** (`hennaah.11`) designed for GitHub Pages and mobile browsers.

## Included files

- `index.html` — profile layout, media filters, and opened-post viewer.
- `style.css` — responsive Instagram-inspired styling and persistent light/dark themes.
- `script.js` — filtering, lazy loading, viewer, direct links, theme control, and media cleanup.
- `posts.js` — all 485 exact filenames and generated post records.

## Dataset coverage

The supplied filename list contains 485 unique entries: 294 image files and 191 MP4 videos. Each filename is represented exactly once as an independent media item with a stable ID. The grid displays the source list in reverse order: newer-looking entries appear at the top and older-looking entries lower down. This is inferred from the filename-list order, not verified post timestamps. Similar-looking filenames are deliberately **not merged into carousels**, because filenames alone do not prove the files belong to the same Instagram post. This also ensures a photo and a video are never mixed inside one opened post.

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

- **Posts** — images only.
- **Videos** — videos only.
- **All profile** — every image and video, each as its own tile and its own post.

No inferred carousel grouping is applied. A photo and similarly named video remain separate posts.

## Loading and performance

The full selected grid is rendered without pagination, but thumbnails load only near the viewport using `IntersectionObserver`. The opened original media receives high loading priority; images use eager loading and `fetchPriority="high"` in the viewer. Videos in the grid use metadata-only loading, while a video opened in the viewer loads on demand with native browser controls. Closing a post pauses videos, removes their source, and calls `load()` to release active media references. Browser cache contents and memory reclamation remain controlled by the browser.

Opened photos and videos use `object-fit: contain` and preserve their aspect ratio. Grid thumbnails intentionally use `object-fit: cover` for the square grid.

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
