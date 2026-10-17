"""One-time import of the old WordPress site (tailbonetreatment.com) into the new site.

- Articles by Dr Rajveer Singh  -> content/blog/<old-slug>.md (+ images in public/assets/img/blog/)
- Newspaper coverage (clippings) -> content/press.json (+ images in public/assets/img/press/)
- Every old address              -> content/redirects.json (301s, used once the domain points here)

Usage: python3 resources/migration/import_old_site.py <folder with posts.txt and p1.html…>
Kept for the record; the old site may be gone later.
"""
import html, io, json, math, pathlib, re, sys, urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = pathlib.Path(sys.argv[1])
OLD = "https://tailbonetreatment.com"

PAGE_MAP = {
    "/": "/", "/faq/": "/faq", "/coccygodynia/": "/coccydynia", "/anatomy-of-coccyx/": "/coccydynia",
    "/symptoms-of-tailbone-pain/": "/coccydynia", "/dr-rajveer-singh/": "/doctor", "/about-us/": "/doctor",
    "/find-doctor/": "/doctor", "/contact-us/": "/locations", "/international-tailbone-patients/": "/locations",
    "/testimonials/": "/stories.html", "/appointment/": "/book", "/privacy-statement/": "/privacy.html",
    "/tail-bone-treatment/": "/treatment", "/tailbone-cushion/": "/treatment", "/blog/": "/blog/",
}
PUBLICATION = [("times of india", "The Times of India"), ("prajavani", "Prajavani"), ("deccan herald", "Deccan Herald"),
               ("kanada", "Kannada newspaper"), ("rajasthan patrika", "Rajasthan Patrika"), ("salar", "Salar"),
               ("hindustan", "Hindustan, Delhi")]

def fetch_image(url, dest, max_w):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA"); bg = Image.new("RGB", im.size, "white"); bg.paste(im, mask=im.split()[-1]); im = bg
    else:
        im = im.convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=82, optimize=True, progressive=True)
    return im.size

def local_link(href):
    if not href.startswith(OLD):
        return href
    path = href[len(OLD):] or "/"
    path = path if path.endswith("/") else path + "/"
    if path in PAGE_MAP:
        return PAGE_MAP[path]
    slug = path.strip("/")
    return f"/blog/{slug}.html" if slug in KNOWN else "/blog/"

def to_markdown(body, slug, images):
    out = body
    out = re.sub(r'\sdata-[\w-]+="[^"]*"', "", out)
    out = re.sub(r"<(script|style)\b.*?</\1>", "", out, flags=re.S)
    def img(m):
        src = re.search(r'src="([^"]+)"', m.group(0)).group(1)
        alt = html.unescape((re.search(r'alt="([^"]*)"', m.group(0)) or [None, ""])[1]).strip()
        name = f"{slug[:60]}-{len(images) + 1}.jpg"
        try:
            w, h = fetch_image(src, ROOT / "public/assets/img/blog" / name, 1000)
        except Exception as err:  # broken old image: skip it
            print("  image failed", src, err); return ""
        images.append(name)
        return f'\n\n![{alt or "Illustration"}](/assets/img/blog/{name} "{w}x{h}")\n\n'
    out = re.sub(r"<img[^>]*>", img, out)
    out = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f"[{re.sub('<[^>]+>', '', m.group(2)).strip()}]({local_link(m.group(1))})", out, flags=re.S)
    out = re.sub(r"<h[1-3][^>]*>(.*?)</h[1-3]>", r"\n\n## \1\n\n", out, flags=re.S)
    out = re.sub(r"<h[4-6][^>]*>(.*?)</h[4-6]>", r"\n\n### \1\n\n", out, flags=re.S)
    out = re.sub(r"<li[^>]*>(.*?)</li>", lambda m: "\n- " + re.sub(r"\s+", " ", m.group(1)).strip(), out, flags=re.S)
    out = re.sub(r"</?(ul|ol)[^>]*>", "\n\n", out)
    def bold(m):
        inner = m.group(2)
        core = inner.strip()
        if not core:
            return inner
        return f"{' ' if inner[:1].isspace() else ''}**{core}**{' ' if inner[-1:].isspace() else ''}"
    out = re.sub(r"<(strong|b)\b[^>]*>(.*?)</\1>", bold, out, flags=re.S)
    out = re.sub(r"<(em|i)>(.*?)</\1>", r"\2", out, flags=re.S)
    out = re.sub(r"<br\s*/?>", " ", out)
    out = re.sub(r"<p[^>]*>(.*?)</p>", r"\n\n\1\n\n", out, flags=re.S)
    out = re.sub(r"<[^>]+>", "", out)
    out = html.unescape(out).replace("\xa0", " ")
    out = re.sub(r"\*\*\s*\*\*", "", out)
    out = re.sub(r"(?m)^\s*\*\*\s*-?\s*By Dr\.? Rajveer Singh.*$", "", out)       # signature -> author field
    out = re.sub(r"(?m)^\s*-\s*By Dr\.? Rajveer Singh.*$", "", out)
    out = re.sub(r"(?m)^[ \t]+", "", out)
    out = re.sub(r"(?m)^## \*\*(.*)\*\*$", r"## \1", out)
    out = re.sub(r"(?m)^### \*\*(.*)\*\*$", r"### \1", out)
    out = re.sub(r"(?m)^\*\*([^*]{3,80})\*\*$", r"### \1", out)                     # bold-only lines were headings
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    if not re.search(r"(?m)^## ", out):  # keep the heading outline: the article title is the h1
        out = re.sub(r"(?m)^### ", "## ", out)
    return out

KNOWN = set()

def main():
    urls = (SRC / "posts.txt").read_text().split()
    KNOWN.update(u.rstrip("/").rsplit("/", 1)[-1] for u in urls)
    press, redirects = [], dict(PAGE_MAP)
    for i, url in enumerate(urls, 1):
        h = (SRC / f"p{i}.html").read_text(encoding="utf-8", errors="ignore")
        a = h[h.find("<article"):h.find("</article>")]
        title = html.unescape(re.sub(r"<[^>]+>", "", re.search(r"<h1[^>]*>(.*?)</h1>", a, re.S).group(1))).strip()
        date = (re.search(r'"datePublished":"([^"]+)"', h) or re.search(r'published_time" content="([^"]+)"', h)).group(1)[:10]
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        body = a[a.find("</h1>") + 5:]
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body))).strip()
        thumb = re.search(r'<img[^>]+src="([^"]+)"', a).group(1)
        if len(text.split()) < 40:   # a newspaper clipping
            name = f"{slug[:60]}.jpg"
            w, hgt = fetch_image(thumb, ROOT / "public/assets/img/press" / name, 1400)
            pub = next((p for k, p in PUBLICATION if k in title.lower()), "Newspaper")
            press.append({"slug": slug, "title": title, "publication": pub, "date": date, "image": f"/assets/img/press/{name}", "width": w, "height": hgt,
                          "language": "Hindi" if "hindi" in title.lower() else ("Kannada" if pub in ("Prajavani", "Kannada newspaper") else "")})
            redirects[f"/{slug}/"] = f"/press.html#{slug}"
            print("press", date, pub, title)
            continue
        images = []
        cover = f"{slug[:60]}-cover.jpg"
        try:
            fetch_image(thumb, ROOT / "public/assets/img/blog" / cover, 1000)
        except Exception:
            cover = None
        md = to_markdown(body, slug, images)
        author = "Dr Rajveer Singh"
        sig = re.search(r"(?m)^Dr\.? Mubashira.*$", md)
        if sig:  # guest article; drop the old Bangalore address and personal phone number
            author = "Dr Mubashira (PT)"
            md = md[:sig.start()].rstrip()
        clean_title = re.split(r"\s+\|\s+", title)[0].strip()
        first = next((p for p in md.split("\n\n") if not p.startswith(("#", "!", "-")) and len(p) > 60), clean_title)
        summary = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", first).replace("**", "")
        summary = summary if len(summary) <= 160 else summary[:157].rsplit(" ", 1)[0] + "…"
        tags = [t.replace("-", " ").capitalize() for t in re.findall(r"\btag-([a-z0-9-]+)", a)[:3]] or ["Tailbone pain"]
        words = len(re.sub(r"[#*\[\]()!-]", " ", md).split())
        front = [
            "---", f"title: {clean_title}", f"slug: {slug}", f"date: {date}", f"summary: {summary}",
            f"tags: {', '.join(tags)}", f"readMinutes: {max(2, math.ceil(words / 200))}", f"author: {author}",
            *( [f"image: /assets/img/blog/{cover}"] if cover else [] ), f"originalUrl: {url}", "---", "",
        ]
        (ROOT / "content/blog" / f"{slug}.md").write_text("\n".join(front) + md + "\n")
        redirects[f"/{slug}/"] = f"/blog/{slug}.html"
        print("post ", date, clean_title)
    press.sort(key=lambda p: p["date"], reverse=True)
    (ROOT / "content/press.json").write_text(json.dumps(press, indent=2, ensure_ascii=False) + "\n")
    redirects.update({"/category/*": "/blog/", "/tag/*": "/blog/", "/author/*": "/doctor", "/feed/": "/blog/"})
    (ROOT / "content/redirects.json").write_text(json.dumps(redirects, indent=2) + "\n")

main()
