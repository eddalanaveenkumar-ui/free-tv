# Free TV

Watch thousands of free live TV channels from around the world — no subscription, no signup.

- **14,000+ channels** across **180+ countries** (United States, India, United Kingdom, Brazil, Canada, and many more)
- Categories: News, Sports, Movies, Music, Kids, Religious, Shopping
- Search, country & category filters, favorites (stored locally)
- Works on desktop and mobile

Powered by the public [iptv-org/iptv](https://github.com/iptv-org/iptv) playlist (`index.m3u`), rebuilt every time the source playlists change.

## Demo

https://free-tv.vercel.app (if deployed)

## Tech

- Vanilla JavaScript (no build step)
- [hls.js](https://github.com/video-dev/hls.js) for HLS (.m3u8) playback in browsers without native HLS support
- Channel data generated from `iptv-org/iptv` country playlists (`streams/*.m3u`)
- Deployable on Vercel, Netlify, GitHub Pages, or any static host

## Local development

```bash
# serve the folder
python3 -m http.server 3000
# open http://localhost:3000
```

## Deployment

**Vercel:** push to GitHub, import the repo in Vercel — it's a static site, zero config.

## Disclaimer

This site does not host any streams. All channel URLs come from the public iptv-org playlist and are hosted by third parties. Stream availability and quality depend on the upstream sources; some streams are HTTP-only and may not play when the site is served over HTTPS.
