# FreeTV

Watch thousands of free live TV channels from around the world — no signup, no subscription.
A premium OTT-style interface (Netflix / JioHotstar inspired) over the public
[iptv-org](https://github.com/iptv-org/iptv) playlists.

- **11,697 channels** from **169 countries**
- **Channel logos** for 77% of channels (from [iptv-org/database](https://github.com/iptv-org/database))
- News, Sports, Movies, Music, Kids, Religious, Shopping
- Favorites and "Continue watching" saved locally
- Full-screen player with mirror switching

## Interface

**Desktop** — fixed top bar with brand, category nav, and search; hero banner rotating
through featured channels; horizontal rails for Featured / Trending / Countries and one
rail per top market; infinite grid for the full catalog.

**Mobile** — 4-tab bottom navigation (Home · Search · Browse · Favorites). Search docks
under the logo when the Search tab is tapped, per the usual Hotstar-style pattern.
Player becomes a full-screen sheet with "More like this" below.

## Performance

Everything is bounded so the page never blocks:

| Area | Budget |
|---|---|
| Grid & search results | **30 channels** per page, grows on scroll |
| Rails | **20 tiles** per chunk, grows on horizontal scroll |
| First paint payload | 1.2 MB catalog (id, name, country, category, quality, logo) |
| Stream URLs | lazy per-country file, fetched on first play |
| Logo images | `loading="lazy"`, initials fallback on error |

## Data layout

| File | Size | Purpose |
|---|---|---|
| `public/data/catalog.json` | ~1.2 MB | compact index for the whole UI |
| `public/data/ch/<CC>.json` | 0.4–400 KB | full records with stream mirrors |
| `public/data/countries.json` | 16 KB | names, flags, counts |
| `public/data/categories.json` | 0.3 KB | category counts |
| `public/data/shelves.json` | 1 KB | curated hero + trending picks |

## Local development

```bash
python3 -m http.server 3000
# open http://localhost:3000
```

## Deployment

Pure static site — import the repo on Vercel (zero config), or host anywhere.

## Known limitations

- iptv-org streams are third-party and frequently go offline.
- On HTTPS pages browsers block `http://` media, so HTTP-only channels can't play there.
- Some channels are geo-restricted by their host.

This site hosts no streams. All URLs come from the public iptv-org playlist.
