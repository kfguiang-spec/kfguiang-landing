#!/usr/bin/env python3
"""Regenerate books/data.js (and optionally covers) from a Goodreads library export.

Usage:
  python3 scripts/build_books.py path/to/goodreads_library_export.csv [--covers]

Inputs kept in the repo:
  scripts/book_categories.json  Goodreads Book Id -> category key (edit to recategorise;
                                new books default to "unsorted" and are listed on stdout)
  scripts/books_config.json     category names/colours and the hand-picked "currently reading" list

Privacy: only title, author, publication year, rating, dates and shelf are read from the CSV.
"My Review", "Private Notes" and other personal fields are never read or written.
The Goodreads "currently-reading" shelf is ignored on purpose (it is stale); the current
books come from books_config.json instead.

--covers downloads Open Library covers by ISBN (falling back to an Open Library title/author
search) and saves 240px-wide WebP files to books/covers/. Requires Pillow.
"""
import csv, json, re, sys, time, io, os, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "books" / "data.js"
COVERS = ROOT / "books" / "covers"
KEEP = ["Book Id", "Title", "Author", "ISBN", "ISBN13", "My Rating", "Year Published",
        "Original Publication Year", "Date Read", "Date Added", "Exclusive Shelf"]
UA = {"User-Agent": "kfguiang-landing books page builder (personal site)"}

def clean_isbn(s):
    return re.sub(r"[^0-9Xx]", "", s or "").upper()

def split_title(t):
    t = re.sub(r"\s+", " ", t).strip()
    series = ""
    m = re.search(r"\s*\(([^()]*#\d+)\)\s*$", t)
    if m:
        series, t = m.group(1), t[:m.start()]
    t = re.sub(r"\s*\((?:[^()]*\b(?:Classics|Press|Edition|Synthesis)\b[^()]*)\)\s*$", "", t)  # edition/imprint tags
    t = re.sub(r"\s+by [A-Z][\w.]+(?: [A-Z][\w.]+){0,2}$", "", t)  # "... by Dale Carnegie"
    if ": " in t:
        a, b = t.split(": ", 1)
        return a.strip(), b.strip(), series
    return t, "", series

def norm_author(a):
    return re.sub(r"\s+", " ", a).strip()

def fetch(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()

def get_cover(bid, isbns, title, author):
    from PIL import Image
    out = COVERS / f"{bid}.webp"
    if out.exists():
        return True
    urls = [f"https://covers.openlibrary.org/b/isbn/{i}-M.jpg?default=false" for i in isbns if i]
    try:
        q = urllib.parse.urlencode({"title": title, "author": author, "limit": 1, "fields": "cover_i"})
        docs = json.loads(fetch("https://openlibrary.org/search.json?" + q)).get("docs", [])
        if docs and docs[0].get("cover_i"):
            urls.append(f"https://covers.openlibrary.org/b/id/{docs[0]['cover_i']}-M.jpg")
    except Exception as e:
        print("  search failed:", title, e)
    for u in urls:
        try:
            data = fetch(u)
            im = Image.open(io.BytesIO(data)).convert("RGB")
            if im.width < 40 or im.height < 60:
                continue
            im.thumbnail((240, 360), Image.LANCZOS)
            im.save(out, "WEBP", quality=78, method=6)
            return True
        except Exception:
            continue
        finally:
            time.sleep(0.3)
    return False

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    csv_path, want_covers = sys.argv[1], "--covers" in sys.argv
    cats = json.load(open(ROOT / "scripts" / "book_categories.json"))
    cfg = json.load(open(ROOT / "scripts" / "books_config.json"))
    rows = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rows.append({k: r.get(k, "") for k in KEEP})   # drop every other column immediately
    if want_covers:
        COVERS.mkdir(parents=True, exist_ok=True)
    books, unsorted = [], []
    for r in rows:
        shelf = r["Exclusive Shelf"]
        if shelf not in ("read", "to-read"):
            continue  # the Goodreads currently-reading shelf is stale; see books_config.json
        bid = r["Book Id"]
        cat = cats.get(bid, "unsorted")
        if cat == "unsorted":
            unsorted.append(r["Title"])
        title, subtitle, series = split_title(r["Title"])
        rating = int(float(r["My Rating"] or 0))
        year = r["Original Publication Year"] or r["Year Published"]
        isbns = [clean_isbn(r["ISBN13"]), clean_isbn(r["ISBN"])]
        has_cover = (COVERS / f"{bid}.webp").exists()
        if want_covers and not has_cover:
            has_cover = get_cover(bid, isbns, title, norm_author(r["Author"]))
            print(("  cover  " if has_cover else "  none   ") + title)
        b = {"id": bid, "t": title, "a": norm_author(r["Author"]), "c": cat, "s": shelf}
        if subtitle: b["st"] = subtitle
        if series: b["se"] = series
        if year: b["y"] = int(year)
        if rating: b["r"] = rating
        if shelf == "read" and r["Date Read"]:
            b["d"] = r["Date Read"].replace("/", "-")
        if has_cover: b["cv"] = 1
        books.append(b)
    current = []
    for c in cfg["current"]:
        c = dict(c)
        c["cv"] = int((COVERS / f"{c['id']}.webp").exists() or
                      (want_covers and get_cover(c["id"], [c.get("isbn13")], c["title"], c["author"])))
        current.append(c)
    data = {"categories": cfg["categories"], "current": current, "books": books,
            "source": "Goodreads export", "generated": time.strftime("%Y-%m-%d")}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("/* Generated by scripts/build_books.py. Do not edit by hand. */\n"
                   "window.BOOKS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    n_read = sum(b["s"] == "read" for b in books)
    print(f"wrote {OUT.relative_to(ROOT)}: {n_read} read, {len(books) - n_read} to-read, "
          f"{len(current)} current, {sum('cv' in b for b in books)} covers")
    if unsorted:
        print("unsorted (add to scripts/book_categories.json):", *unsorted, sep="\n  ")

if __name__ == "__main__":
    main()
