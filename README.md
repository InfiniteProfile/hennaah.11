# Hena (@hennaah.11) – Instagram-style profile site

A static, dependency-free viewer for the photos and videos in
`github.com/InfiniteProfile/hennaah.11`. It is an independent website and is not connected to Instagram.
No build step, backend or database: upload the files and enable GitHub Pages.

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js` | Page, styling, behaviour |
| `posts.js` | Generated dataset (485 filenames → 226 posts) plus profile settings |
| `overrides.js` | Optional captions / dates / hidden flags, keyed by post id (empty by default) |
| `tools/filenames.txt`, `tools/make_posts.py` | Optional: your filename list and the script that regenerates `posts.js` |

## How media URLs are generated
`MEDIA_BASE + filename`, with each path segment passed through `encodeURIComponent` (so spaces and
parentheses are safe and filenames are never altered). Example:
`igexport-CqTGWgsINUl (1).jpg` → `…/main/igexport-CqTGWgsINUl%20(1).jpg`.
The profile photo uses `PROFILE_DIR` (`profile photo/`) + `PROFILE.photo`.

## What was read from `text.txt`
- 485 filenames: 294 `.jpg`, 191 `.mp4`. No blank lines, no duplicate filenames; every one is in `posts.js`.
- Video vs photo is decided by extension (`.mp4`, `.webm` = video).

## Grouping and order are inferred (please review)
The file is only a filename list, so **nothing here is confirmed Instagram metadata.**
- **Grouping:** names look like `igexport-<11-character code>[-N].ext`. Files sharing a code are grouped into one
  carousel (no suffix = item 1, then `-2`, `-3`…). This gives 59 carousels, 162 single videos and 5 single photos.
  Three `name (1).ext` files are kept as separate posts (`<code>-copy1`) rather than merged.
- **Order:** Instagram codes are encoded numeric IDs that increase over time, so posts are sorted newest first by
  decoding the code. This is a reasoned fallback, not a guarantee of the original order.
- **Not invented:** no captions, dates, likes, comments, followers or bio are shown. Fields appear only if you fill them in.

### Fix a grouping
Open `posts.js` and edit that post's `files` array: move a filename into another post's array to merge, or give it its own
object (with a unique `id`) to split. Keep `id`s unchanged so existing links keep working. A post with more than one file
is shown as a carousel; photos and videos can be mixed. Or edit `tools/filenames.txt` and run
`python3 tools/make_posts.py` (this overwrites `posts.js`).

### Add a photo or video
Upload the file to the repo root, then add a post to `posts.js`:
`{ "id": "my-new-post", "type": "video", "files": ["my video.mp4"], "caption": "", "timestamp": "" }`
(`type` is informational; it is recalculated from `files`.) New posts don't change existing ids or links.
Use WebM/MP4 (H.264) so browsers can play it.

### Add captions or dates
In `overrides.js`: `"DejBtLPDInv": { caption: "Text #tag @name", timestamp: "2024-05-12T18:30:00Z" }`.
Hashtags and mentions are highlighted. Followers, following and bio go in `PROFILE` in `posts.js` (`null`/empty = hidden).

## Behaviour
- **Grid:** 3 square, cropped thumbnails (cropping applies only here). Video and carousel badges, no text over images.
  Photo thumbnails use the original file with native lazy loading (no separate thumbnails exist in the repo); video
  thumbnails fetch only their first-frame metadata when scrolled near, via `IntersectionObserver`.
- **Post viewer:** `object-fit: contain`, never cropped, centred on a black background; side-by-side on desktop, full-screen
  on mobile. Carousel arrows, dots, `2/5` counter, touch swipe. Videos use native controls (play, volume, progress,
  full screen), load only when the post opens and are removed when you leave them or close the post. Missing or
  unsupported files show an error and are listed under the grid.
- **Buttons:** like and save are stored only in your browser (`localStorage`); share copies/shares the link; comments are disabled because there is no backend.
- **Direct links:** `?post=<id>` (plus `&page=N`, `&tab=videos`). Refresh keeps the post; with a direct link the grid is
  not loaded until you close the post.
- **Pagination:** `CONFIG.PAGE_SIZE = 50` in `script.js` (5 pages now). Changing page destroys the previous page's tiles and media.
  `?page=3` opens page 3. The *Videos* tab lists posts that are a single video.
- **Keys:** ←/→ carousel item, then previous/next post; PageUp/PageDown or K/J previous/next post; Esc closes.
  (Over a focused video, use Shift+←/→ so the arrows can still seek.)

## Deploy to GitHub Pages
Put all files in a repository (e.g. root of `InfiniteProfile/hennaah.11`, or a separate repo), then
**Settings → Pages → Deploy from a branch → main / (root)**. Keep the site's `index.html` and the media in one
repo if you like; media always loads from `MEDIA_BASE` regardless.

## Known limits
Not tested against the live repository from this environment, and no browser rendering was run here; the data/URL generation and page logic
were checked automatically. Please open the site once and check that portrait, landscape and video posts look right.
