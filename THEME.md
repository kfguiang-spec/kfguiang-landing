# Site theme

Every page on the site shares **`assets/site.css`**. It takes the landing page's minimal look (white background, near-black text, Arial, underlined links, small grey uppercase labels) and turns it into tokens and a few components, plus one restrained accent colour.

Link it from any page (use a relative path so it works on the GitHub Pages project URL and on a custom domain):

```html
<link rel="stylesheet" href="assets/site.css">      <!-- from the root -->
<link rel="stylesheet" href="../assets/site.css">   <!-- from a page folder like books/ -->
```

The base rules are identical to the landing page's inline styles, so linking the stylesheet from `index.html` changes nothing visually (checked with a pixel diff). Put page-specific styles in the page's own `<style>` block and build them from the tokens below.

## Tokens (CSS custom properties)

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#fff` | page background |
| `--color-text` | `#111` | body text, links |
| `--color-subtle` | `#555` | secondary text (authors, notes) |
| `--color-muted` | `#888` | labels, captions, counts |
| `--color-line` | `#e6e6e6` | rules and borders |
| `--color-surface` | `#f6f6f4` | quiet panels, placeholders |
| `--color-accent` | `#b3402a` | **the one accent**: highlights (e.g. five-star books), active states. Use it sparingly |
| `--color-accent-soft` | `#f7e9e5` | tinted background behind accented content |
| `--font-sans` | Arial, Helvetica, sans-serif | everything |
| `--text-xs` / `sm` / `base` / `lg` / `xl` | 0.75 / 0.875 / 1 / 1.375 / 1.75rem | labels / meta / body / site name and section titles / page titles |
| `--leading` | 1.5 | body line height |
| `--tracking-label` | 0.08em | uppercase labels |
| `--space-1` … `--space-8` | 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4rem | margins, padding, gaps |
| `--content-width` | 68rem | max page width (`.container`) |
| `--measure` | 42rem | max width for paragraphs |
| `--radius` | 4px | cards |
| `--shadow-card` | subtle two-layer shadow | covers and images |

Headings stay at weight 400 (regular) to match the landing page. Use bold only for small item titles.

## Components (classes)

- **`.container`**: centred, max `--content-width`, side padding (smaller on mobile).
- **`.site-header`**: top bar on every inner page, with the name linking home on the left and `← Home` on the right:
  ```html
  <header class="site-header">
    <p class="site-name"><a href="../">Kevin Guiang</a></p>
    <a href="../">&larr; Home</a>
  </header>
  ```
- **`.page-intro`** containing `.section-label`, `h1.page-title` and `p.lede`: the page opener.
- **`.section-label`** (alias **`.group-label`**, the landing page's name): small grey uppercase label.
- **`.section`**, `h2.section-title`, `p.section-note`: page sections. Sections work as anchor targets under the sticky nav.
- **`.page-nav`**: sticky row of plain underlined links to the page's sections (scrolls sideways on mobile).
- **`.card`** (and **`.card--accent`**): bordered white panel.
- **`.chip`**: filter or toggle pill. Set `aria-pressed="true"` for the active chip, and put an optional `.count` inside.
- **`.badge`** (and **`.badge--accent`**): tiny label, e.g. `5★`.
- **`.stats`**: `<ul>` of `<li><span class="num">145</span><span class="lbl">read</span></li>`.
- **`.placeholder`**: typographic stand-in for a missing image. Always say it is a placeholder (e.g. "no cover").
- **`.site-footer`**: small grey footer with sources and notes, ending in a `← Back to home` link.
- Utilities: `.muted`, `.subtle`, `.accent`, `.visually-hidden`.

## Rules of thumb

- White page, black text, underlined links. Colour carries meaning, not decoration. The accent marks at most one kind of thing per page.
- Data colours (e.g. the book categories) belong to the page, not the theme. Keep them muted.
- Every inner page has the `.site-header` with `← Home` and a footer link back. Use relative links (`../`, `books/`).
- Plain HTML/CSS/JS with no build step. Check it at 1280px and 390px wide with no horizontal scroll.

## Status

| Page | Uses the theme |
|---|---|
| `index.html` (landing) | yes: links `assets/site.css`, keeps its own inline layout |
| `books/` | yes |
| `music/` record store (PR #1) | not yet, to be reworked to the theme later |
