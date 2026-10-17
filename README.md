# Hena — Instagram-inspired profile

A static, GitHub Pages-compatible profile for **Hena** (`@hennaah.11`). No build tools, backend, database, or third-party JavaScript dependencies are required.

## Source inventory and grouping

- Read the entire uploaded list: **485 nonblank filename entries**.
- Supported files: **294 JPG images** and **191 MP4 videos**.
- Duplicate exact filename entries: **0**. All 485 entries are preserved in `MEDIA_FILES` in `posts.js`.
- The supplied list does not include captions, dates, engagement statistics, or confirmed Instagram carousel metadata. These fields are blank unless you edit them.
- Initial grouping is a heuristic: numbered variants (for example `name-2.jpg`) are grouped only when a filename with the unsuffixed base stem also exists. This is a convenient editable assumption, **not proof** that Instagram treated them as one carousel. Review the generated groupings before publishing if exact post relationships matter.

## Files

- `index.html` — profile structure and post viewer.
- `style.css` — responsive Instagram-inspired design.
- `script.js` — rendering, pagination, lazy loading, viewer, carousel and interactions.
- `posts.js` — all source filenames, URL builder and editable grouping configuration.

## Media URL generation

`MEDIA_BASE` points to the repository's `main/` directory. `mediaUrl(filename)` splits a filename into path components and URL-encodes each component separately, so spaces and parentheses work without encoding the entire URL. For example, `folder/my photo (1).jpg` becomes `.../folder/my%20photo%20(1).jpg`. The profile image uses `profile photo/igexport-DVY7NlejDJ9-6.jpg`. Ensure every file is actually committed to that repository at the matching path.

## Add a filename

1. Upload the image or video into the repository root (or its intended subdirectory).
2. Add the exact filename as a new string in `MEDIA_FILES` in `posts.js`. Preserve punctuation and capitalization.
3. Refresh the website. A new stable ID is derived from the filename, so unrelated additions do not renumber existing individual posts.
4. For a numbered variant that should join an existing group, check the grouping heuristic or add an explicit group as described below.

The dataset was generated from the uploaded 485-line filename list. If you add further files later, add those new filenames yourself to `MEDIA_FILES`; the browser cannot enumerate a GitHub directory automatically.

## Add a video

Upload an `.mp4` or `.webm` file and add its exact filename to `MEDIA_FILES`. The extension identifies it as a video. The viewer uses native HTML video controls and defers playback media until a post is opened. GitHub-hosted videos must be supported by the visitor's browser and available at the raw URL.

## Configure carousel groupings

In `posts.js`, edit `CAROUSEL_GROUPS`. Each array contains exact filenames that should be displayed as one post, for example:

```js
const CAROUSEL_GROUPS = [
  ["igexport-example.jpg", "igexport-example-2.jpg", "igexport-example-3.mp4"]
];
```

Explicit groups take priority over automatic grouping. Remove files from a group if you want them to be separate posts. The automatic rule groups a numbered file only when an unsuffixed sibling with the same base stem exists; it sorts numbered members numerically. Because filenames alone do not prove carousel relationships, inspect and adjust this configuration to match the source account.

## Add captions or timestamps

In `buildPosts()` inside `posts.js`, the resulting objects have `caption: ""` and `timestamp: ""`. For supplied information, add a metadata configuration keyed by stable post ID or edit the returned object to set those values. Do not infer captions or dates from filenames. The viewer hides dates when they are blank.

## Pagination and direct links

The profile displays at most **50 posts per page**. Page count is computed from the dataset. The `?page=2` parameter restores a page; `?post=post-id` opens an individual post and survives refresh. Post IDs are generated deterministically from a filename or group key. If you change the membership/key of an existing carousel, that group's ID may change; keep group membership stable to preserve its direct link.

## Performance notes

- Grid images are lazy-loaded with `loading=lazy` and an `IntersectionObserver`.
- Only the current page's grid elements are rendered.
- Original media is fetched only when a post opens; videos use native controls and are removed/reset when the viewer closes.
- Opened media uses `object-fit: contain` and keeps its original aspect ratio. Only square grid thumbnails use cropping.
- The browser controls its own cache and memory reclamation; the site does not claim to forcibly clear either.

## Deploy to GitHub Pages

1. Upload `index.html`, `style.css`, `script.js`, and `posts.js` to the root of `InfiniteProfile/hennaah.11` (add `README.md` too if desired).
2. Confirm the media files are committed to the repository's `main` branch at the paths represented by the filenames.
3. Open repository **Settings → Pages**.
4. Choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
5. Open the Pages URL after deployment. A public raw-media repository is required for visitors to load the files.

## Validation summary

- Profile name: `Hena`; username: `hennaah.11`.
- Profile image path: `profile photo/igexport-DVY7NlejDJ9-6.jpg`.
- Source coverage: all **485/485** nonblank filenames retained; no exact duplicates found.
- Type detection: JPG and MP4 supported for all source entries.
- No captions, timestamps, follower counts, or following counts are fabricated.
