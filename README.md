# Kevin Guiang — personal landing

Minimal static landing page: name + three links (Blog, Wine, Music). Plain HTML and CSS — no build step.

## Open locally

1. Clone or download this repo.
2. Open `index.html` in a browser, **or** from the repo root:

   ```bash
   python3 -m http.server 8000
   ```

   Then visit [http://localhost:8000](http://localhost:8000).

## Site structure (intended)

| Path | Purpose |
|------|---------|
| `/` (document root) | This landing page (`index.html`, `style.css`) |
| `/blog/` | WordPress site (moved under `public_html/blog`) |
| `/music/` | Future page (placeholder; may 404 until built) |
| Wine link | External: [WSET tasting guide](https://kfguiang-spec.github.io/wset-tasting-guide/) |

Blog and Music use root-relative paths (`/blog/`, `/music/`) so the same files work on the custom domain document root.

## Deploy to GoDaddy (cPanel) — checklist

Do this in cPanel File Manager (or FTP). **Do not** skip the WordPress move if WordPress currently lives in `public_html`.

### A. Move WordPress into `/blog` (do this first)

1. Log in to GoDaddy → open **cPanel** → **File Manager**.
2. Go to `public_html`.
3. Confirm WordPress files are currently in `public_html` (e.g. `wp-admin`, `wp-content`, `wp-includes`, `wp-config.php`, etc.).
4. Create a new folder: `public_html/blog`.
5. Move **all** WordPress files and folders from `public_html` into `public_html/blog`  
   (leave `public_html` empty except for the new `blog` folder — or keep any unrelated files you intentionally need at the root).
6. Update WordPress URLs so the site works under `/blog`:
   - In `public_html/blog/wp-config.php`, you can temporarily add:
     ```php
     define('WP_HOME', 'https://YOURDOMAIN.com/blog');
     define('WP_SITEURL', 'https://YOURDOMAIN.com/blog');
     ```
   - Or use **Settings → General** in wp-admin after visiting `https://YOURDOMAIN.com/blog/wp-admin/` and set both WordPress Address and Site Address to `https://YOURDOMAIN.com/blog`.
7. If permalinks break, visit **Settings → Permalinks** in wp-admin and click **Save** (flush rewrite rules). You may also need a `.htaccess` inside `blog/` (WordPress usually regenerates it).
8. Test: open `https://YOURDOMAIN.com/blog/` and confirm the blog loads.

### B. Upload this landing page to document root

1. Still in File Manager, open `public_html` (now the site root for the landing page).
2. Upload the **contents** of this repo’s site root into `public_html`:
   - `index.html`
   - `style.css`
   - (Do **not** upload `README.md` unless you want it public.)
3. Confirm `public_html/index.html` exists alongside `public_html/blog/`.
4. Visit `https://YOURDOMAIN.com/` — you should see the landing page.
5. Click **Blog** → should go to `/blog/`.
6. Click **Wine** → external WSET guide.
7. Click **Music** → `/music/` (404 until you add that page — expected).

### C. Optional later

- Add a `public_html/music/index.html` when ready.
- Point DNS / domain as needed; no build or Node required for this page.

## GitHub Pages (optional)

This repo can be served at:

`https://kfguiang-spec.github.io/kfguiang-landing/`

**Note:** On GitHub Pages under a project path, root-relative links (`/blog/`, `/music/`) resolve against `github.io`, not the repo subpath. That is intentional: production target is the custom domain document root (`kfguiang.co`). Use custom domain / GoDaddy upload for correct Blog/Music paths; Pages is a preview of layout only, or enable a custom domain on Pages if desired.

## License

Personal site content — all rights reserved unless otherwise noted.
