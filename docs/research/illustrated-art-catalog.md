# Illustrated-art catalog for the client-only sticker editor

Research for issue #35 — a search-first sidebar panel in a 100% client-side
(no-backend) Fabric.js sticker editor. The editor embeds images as base64
data-URLs inside a JSON design file, so any provider must be callable from a
static site (real CORS on both search JSON and image bytes), keyless (or with
an embeddable key), and filterable to "free for commercial sale, no attribution".

Verified 2026-08-22 against primary sources only (provider API docs, API
endpoints hit live from a static-server context with an `Origin` header to
confirm CORS, provider license/terms pages). All endpoint/CORS/size facts were
confirmed with live requests, not assumed.

## Candidate matrix (summary)

| Candidate | Sticker-style transparent art | Client-callable + CORS | License filterable to no-attribution commercial | Verdict |
|-----------|-------------------------------|------------------------|------------------------------------------------|---------|
| **Wikimedia Commons** | Yes (full transparent-PNG) | Yes — keyless + CORS, search & image bytes | Yes — per-item `AttributionRequired` | **RECOMMEND** |
| Openverse | Mostly raster CC photos, line icons; thumb proxy small + fixed-size | Yes — keyless, CORS | Yes (`license=cc0,pdm`), but anonymous throttle + "may charge for commercial" | runner-up |
| Pixabay | Illustrations/vectors present, but aggregated/photo-heavy | Yes (CORS) / keyless | NO — license bars standalone merchandise (fails sale bar) | FAIL |
| Noun Project | Line icons only (not sticker art, no PNG transparency from API) | NO — OAuth1 client secret, must stay server-side | NO — free icons require attribution; forbids unmodified-icon export | FAIL |
| Flaticon | Vector icons/premium | NO — `Apikey` header + refresh-token flow, CORS only reflects a single origin | NO — premium in-app; attribution/commercial variation | FAIL |
| Iconscout | Premium vectors | NO — Client-ID/Secret on server, signed CDN URLs, "no real-time no server storage" | NO — paid premium tier for commercial no-attribution | FAIL |
| OpenClipart | Yes (SVG/PNG) | NO — search JSON returned HTTP 500 (no CORS) | n/a — endpoint unusable | FAIL |

---

## 1. Openverse

1. **Illustrated sticker art?** No reliable path. The catalog aggregates
   mostly raster photos (Flickr, etc.) and line-style icons from Iconmonstr/
   Giphy; per-item `filetype`/`mime` exist but there is no "transparent sticker
   PNG" content filter, and the auto thumbnails are JPEG, not transparent PNG.
2. **Client-callable search from a static site?** Yes, keyless + CORS. Live:
   `https://api.openverse.org/v1/images/?q=cookie` returns
   `Access-Control-Allow-Origin: *` and works anonymously. **Search** returns
   `url` (full-size, e.g. `live.staticflickr.com/...jpg`), `thumbnail`
   (a proxied URL on api.openverse.org), `license`, `license_version`,
   `license_url`, `source`. **Image bytes**: the thumbnail proxy
   `GET /v1/images/{id}/thumb/` is CORS-open and returns `image/jpeg`,
   but it serves a fixed ~480px (measured 480x360, ~35 KB) thumbnail only —
   **not full-resolution**. Anonymous auth facts (docs): anonymous is capped at
   **1 request/second** and **page_size ≤ 20** (above that → 401); registered
   OAuth2 raises the limit. Docs reserve the right to charge fees for
   commercial and/or heavy usage.
3. **License bar.** Server-filterable: `?license=cc0,pdm` (only `cc0`/`pdm`
   need no attribution; CC `by*` variants require attribution). Openverse marks
   `AttributionRequired` per item. `license_type` only takes `all`,
   `all-cc`, `commercial`, `modification` — the no-attribution filter is the
   `license=cc0,pdm` parameter.
4. **Self-containment.** The thumbnail proxy is CORS-fetchable → base64 works,
   but at fixed small resolution. Full-res images live on third-party
   origin hosts (`live.staticflickr.com`, etc.) with CORS that is not
   guaranteed by Openverse, and against those hosts' hotlinking terms.
5. **Size envelope.** Fixed ~35 KB thumb → trivial vs the ~3.5M-char ceiling;
   the full-res third-party origin is the uncertain variable.
   No hard per-file cap.

## 2. Wikimedia Commons (via MediaWiki API)

1. **Illustrated sticker art?** Yes. Search supports
   `filetype:bitmap` + `filemime:image/png`, which returns real
   transparent-PNG sticker/clipart art (verified live: "Emoticon smile.png",
   "Bright-orange sticker.png", "California Digital I Voted Sticker
   (transparent background).png", etc. — served as `image/png`). Non-photo
   sticker/illustration content is plentiful though mixed with photos; it is
   content-searchable, not a curated "sticker" catalog, so the app should
   layer a taste filter (query terms + PNG/mime + transparency).
2. **Client-callable search from a static site?** Yes — **keyless and CORS on
   both endpoints** (verified live): `api.php` returns
   `Access-Control-Allow-Origin: *`; `upload.wikimedia.org` (the image host)
   returns `Access-Control-Allow-Origin: *`. Standard anonymous request:
   `GET https://commons.wikimedia.org/w/api.php?action=query&generator=search`
   `&gsrsearch=filetype:bitmap filemime:image/png sticker`
   `&gsrnamespace=6&prop=imageinfo&iiprop=url|size|mime|extmetadata`
   `&iiurlwidth=512&format=json&origin=*`. Returns (a) `imageinfo[].url`
   full-resolution original and (b) the requested-width `thumburl` (both on
   the CORS-open upload host). User-Agent etiquette required (per mediawiki
   etiquette: meaningful UA, `Api-User-Agent` header from browsers, GET, gzip);
   no numeric read-rate limit, "in series rather than parallel" guidance.
3. **License bar.** Per-item machine-readable license metadata is reliably
   present in `extmetadata`: `LicenseShortName`, `LicenseUrl`, `UsageTerms`,
   `AttributionRequired`. Verified live across a 20-file sticker sample: every
   thumbnail returned `extmetadata`, and `Public domain` / `CC0` items returned
   `AttributionRequired: "false"`. Openverse-style server filter for the
   no-attribution subset is not first-class on MediaWiki, so the app filters
   **client-side**: keep the item only when
   `extmetadata.LicenseShortName` is one of `Public domain`, `CC0`,
   `CC0 1.0`, `PD`, ... (equivalently `AttributionRequired == "false"`) — this
   yields "free for commercial sale, no attribution". Excluding `by/by-sa/nc`
   via the same metadata drops everything that fails the bar.
4. **Self-containment.** Yes. Fetch the full-res `imageinfo[].url` (or a large
   `thumburl`) directly from `upload.wikimedia.org` under `mode:cors`/`origin=*`
   → `fetch` → `FileReader`/`createObjectURL` → base64 data-URL, matching the
   app's existing upload path. Wikimedia explicitly permits bulk downloads and
   hotlinking/embedding of files (no hotlink embargo; content is freely
   redistributeable under its per-file license). Only a meaningful UA is
   required.
5. **Size envelope.** Full-res originals can be large (multi-MB photos), so the
   app should fetch a bounded re-scaled `thumburl` (served PNGs stay `image/png`
   with transparency) rather than the original. Measured live: a transparent
   sticker PNG at 512px ≈ **228 KB** (≈305 K base64 chars) and at 256px ≈
   **52 KB** (~69 K chars); even at 512px the whole image fits in ~9% of the
   ~3.5M-char ceiling. Using the `iiurlwidth` thumbnail keeps every embed small.

## 3. Pixabay

1. **Illustrated sticker art?** Mixed. Pixabay carries illustrations and
   vectors but is photo-dominated; PNG transparency is not a first-class,
   filterable property and most content is photography.
2. **Client-callable?** CORS is open (verified: `Access-Control-Allow-Origin: *`
   on `/api/` and on `cdn.pixabay.com` image bytes, which also permits
   hotlinking in the API docs). Requires an API key, but the official JS example
   embeds the key client-side, so it is embeddable. Search returns
   `previewURL`, `webformatURL`, `largeImageURL`, `fullHDURL`, `imageURL`.
3. **License bar — FAILS.** The Pixabay Content License forbids selling or
   distributing the Content **on a Standalone basis** (merchandise and physical
   products are explicitly listed; "a filter, resize or crop still counts as
   standalone"), and commercial merchandise use is banned when trademarks appear.
   For an app whose whole point is selling/printing stickers, this is a
   non-starter regardless of the "no attribution" point. Not CC/public-domain
   upstream (pre-2019 is CC0, but post-2019 is the Pixabay license).
4. **Self-containment.** Yes (hotlinking/data-URL fetch allowed per docs), but
    license bars the commercial use case (#3 kills it).
5. **Size envelope.** Fine (`imageURL` original can be large; use
   `largeImageURL` ~1280px), irrelevant given the license fail.

## 4. Noun Project

1. **Illustrated sticker art?** No — line/symbol icons only, delivered as
   SVG (no transparent-PNG raster from the search API; vectors are the product).
2. **Client-callable?** **No.** Auth is **OAuth 1.0a** with a client key **and
   secret**; the docs explicitly say to treat the secret as a password and not
   expose it. CORS check on `api.thenounproject.com` returned
   `400 BAD REQUEST` (signed requests required). Not usable from a static site
   without a server.
3. **License bar — FAILS.** Free icons require **attribution** to the creator;
   license variants need CC BY credit. Avoiding attribution requires buying a
   paid Royalty-Free license. The API's prohibited-use list explicitly forbids
   tools that "let users export unmodified icons" — the exact behavior of a
   sticker catalog.
4. **Self-containment.** n/a — API unusable client-side.
5. **Size envelope.** n/a.

## 5. Flaticon

1. **Illustrated sticker art?** Vector icons/premium art; no transparent-PNG
   free raster path.
2. **Client-callable?** **No.** Search requires an `Apikey`/`Authorization`
   header with a refresh-token flow; the CORS response only reflects a single
   preconfigured origin (`Access-Control-Allow-Origin: https://example.com`,
   `Access-Control-Allow-Credentials: true`) — i.e. per-origin allowlisting, not
   `*`. Client-side static usage is not supported.
3. **License bar.** n/a (unusable client-side); free tier licensing varies and
   premium/conmercial-no-attribution is paid and managed in-app.
4. **Self-containment.** n/a.
5. **Size envelope.** n/a.

## 6. Iconscout

1. **Illustrated sticker art?** Mostly premium vector icons; free assets are
   limited.
2. **Client-callable?** **No.** Auth is Client-ID + Client-Secret (downloads
   need the secret) served server-side via signed CDN URLs; the API docs model
   credentials as server environment variables (`ICONSCOUT_CLIENT_ID` /
   `ICONSCOUT_CLIENT_SECRET`). My live probe of `api.iconscout.com` returned
   HTTP 500 (auth required).
3. **License bar.** Premium tier is paid; "assets must not be stored on your
   servers" (contradicts base64-embed-into-JSON self-containment) and no
   client-side anonymous path.
4. **Self-containment.** No — real-time signed-URL access is mandated.
5. **Size envelope.** n/a.

## 7. OpenClipart

1. **Illustrated sticker art?** Yes — vector/PNG clipart, public domain.
2. **Client-callable?** No reliable public JSON search; `GET /search/json/`
   returned **HTTP 500** with HTML (no CORS). Endpoint is not stable for a
   static client.
3. **License bar.** Public domain by design, but the API surface is unusable
   (#2).
4. **Self-containment.** n/a.
5. **Size envelope.** n/a.

---

## Recommendation: **Wikimedia Commons** (MediaWiki API)

The only candidate that satisfies the full client-only bar on the facts:

- **Search REST shape (keyless, CORS-open):**
  `GET https://commons.wikimedia.org/w/api.php?action=query&generator=search`
  `&gsrsearch=filetype:bitmap filemime:image/png sticker`
  `&gsrnamespace=6&prop=imageinfo&iiprop=url|size|mime|extmetadata`
  `&iiurlwidth=512&format=json&origin=*`
  → each `imageinfo[0]` yields `thumburl` (512px), `url` (full-res),
  `extmetadata.LicenseShortName`, `extmetadata.AttributionRequired`, `mime`.
- **Image fetch REST shape (keyless, CORS-open):**
  `fetch(thumburl, { mode: 'cors'})` on `upload.wikimedia.org` → bytes →
  `FileReader` → base64 data-URL (exact match to the app's upload path).
- **CORS facts (verified live):** both `commons.wikimedia.org/w/api.php` and
  `upload.wikimedia.org` return `Access-Control-Allow-Origin: *`; search is
  anonymous and keyless; per MediaWiki etiquette set a meaningful
  User-Agent (or `Api-User-Agent` from browsers) and keep reads serial.
- **License-filter expression (client-side, per item):**
  ```js
  const keep = em.LicenseShortName &&  // 'Public domain' | 'CC0' | 'CC0 1.0' | ...
      /public ?domain|cc-?0|pd/i.test(em.LicenseShortName) &&
      String(em.AttributionRequired) === 'false';
  ```
  (equivalently require `AttributionRequired == "false"`). Drop `CC BY*`,
  `by-sa`, `nc` via the same metadata. This yields exactly "free for commercial
  sale, no attribution".
- **Sample live query** (run 2026-08-22 from a static context with an Origin
  header): the API above returned 50 transparent-PNG sticker/clipart results
  with CORS `*`; a 20-file sample all carried `extmetadata` and the CC0/PD items
  reported `AttributionRequired: "false"`.
- **Downsides (provider-specific):**
  - Not a curated "catalog" — it is a best-effort content search, so the app
    should add a taste/quality filter on top (query term + PNG + transparency)
    to keep sticker-appropriate art.
  - Some sticker-relevant files are `CC BY-SA` (attribution required); the
    client filter above cleanly excludes them.
  - Full-resolution originals can be multi-MB; pull the bounded `thumburl` for
    embeds to stay well under the ~3.5M-char ceiling (512px ≈ 228 KB raw /
    ~305 K base64 chars).
  - Commons content is user-contributed; a given result is a real image for a
    given query. Rate etiquette applies (no hard limit; be serial, use gzip).

## Runner-up: **Openverse**

Satisfies CORS + keyless search + server-side `license=cc0,pdm` no-attribution
filter, but (a) its CORS-safe thumbnail proxy delivers only a fixed ~480px
JPEG (not a transparent full-res PNG), (b) full-res images live on
third-party origins with unguaranteed CORS/hotlinking terms, and (c) docs
reserve the right to charge for commercial/anonymous heavy use. Fine as a
secondary browse source; weaker than Commons for transparent sticker art embed.

## Rejected outright

- **Noun Project** — OAuth1 secret (server-only), attribution required on free
  icons, and explicitly forbids exporting unmodified icons (the sticker-catalog
  use case).
- **Pixabay** — license bars standalone/commercial merchandise sale (the app's
  core purpose).
- **Flaticon / Iconscout** — server-side auth (per-origin CORS / Client-Secret),
  no keyless client path; Iconscout also forbids storing assets.
- **OpenClipart** — public-domain data but the search endpoint 500s (unusable).

---

## Sources

- Openverse API docs — authentication & throttling (anonymous 1 req/s,
  page_size ≤ 20, registered tiers, commercial-fee reservation):
  https://docs.openverse.org/api/reference/authentication_and_throttling.html
- Openverse image-search reference (`license` values incl. `cc0`, `pdm`; search
  response fields):
  https://docs.openverse.org/api/reference/index.html
- Live Openverse search + thumb endpoints (`api.openverse.org/v1/images/`),
  probed 2026-08-22.
- MediaWiki API: Imageinfo (`iiprop=url|size|mime|extmetadata`, `iiurlwidth`,
  `origin=*`, thumburl/url fields):
  https://www.mediawiki.org/wiki/API:Imageinfo
- MediaWiki API etiquette (keyless reads, User-Agent/`Api-User-Agent`,
  serial reads): https://www.mediawiki.org/wiki/API:Etiquette
- Live Commons `api.php` + `upload.wikimedia.org` CORS and license-metadata
  probes, probed 2026-08-22.
- Pixabay API docs (key, client-side example, image URL fields, CORS/hotlinking):
  https://pixabay.com/api/docs/
- Pixabay Terms — Content License (standalone merchandise sale prohibited,
  no-attribution): https://pixabay.com/service/terms/
- Noun Project API getting-started (OAuth 1.0a key+secret, treat as password):
  https://api.thenounproject.com/getting_started.html
- Noun Project — crediting creators (free icons require CC BY attribution):
  https://help.thenounproject.com/hc/en-us/articles/200509928
- Noun Project — prohibited use cases (no unmodified-icon export tools):
  https://help.thenounproject.com/hc/en-us/articles/47964341999131
- Flaticon — live endpoint probe (`api.flaticon.com/v3`, per-origin CORS reply).
- Iconscout API docs (Client-ID/Client-Secret, signed CDN URLs, no asset
  storage): https://api-docs.iconscout.com/ and https://iconscout.com/api
- OpenClipart search JSON — live probe (`/search/json/` → HTTP 500).