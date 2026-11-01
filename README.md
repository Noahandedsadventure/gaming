# Gaming channel website

A standalone, responsive website for **Noah and Ed's Train Adventures Gaming** using plain HTML, CSS, and JavaScript. It follows the dark, red-accented, Roboto/Oswald visual style of the reference website while keeping this project independent. No framework or package installation is needed.

## Run locally

Serve this folder with a static file server, then open its local URL. For example:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The channel data is loaded from `channel-data.json`, so opening the HTML directly as a `file:` URL will not load dynamic data.

## Pages

The homepage is `index.html`; each navigation page has its own folder and `index.html`:

- `videos/index.html` — recent short-form and long-form uploads
- `mods/index.html` — mod requirements and downloads
- `about/index.html` — channel introduction
- `live/index.html` — live status and upcoming streams

This folder layout publishes clean URLs such as `/mods/` on static hosts that serve directory index files.

## Configure private API access

Recent videos, subscriber count, live status, and scheduled streams are refreshed by `.github/workflows/update-channel-data.yml`. The workflow calls the YouTube Data API from GitHub Actions and writes the public results to `channel-data.json`; the browser never receives the API key.

1. Create a YouTube Data API v3 key in Google Cloud.
2. Restrict the key to the YouTube Data API v3.
3. Add it to this GitHub repository under **Settings → Secrets and variables → Actions** as `YOUTUBE_API_KEY`.
4. Run **Actions → Update gaming channel data → Run workflow** once to populate the data. Future runs are scheduled every 30 minutes.

The workflow requests live status every 30 minutes and refreshes the upcoming schedule only when it is at least six hours old to limit API quota use. If the secret is missing, the workflow reports a warning and skips the update without failing; dynamic channel data remains unchanged until the secret is configured. It also requires Actions to have permission to write repository contents.

## Personalize the site

Update the page that owns the content:

- Replace `[CHANNEL INTRODUCTION]` in `about/index.html` with an introduction you want to share.
- Replace `[LOGO/ARTWORK]` and the original decorative controller illustration in `index.html` with your own artwork if wanted.
- Add any upload schedule or additional channel details you want to share. No games, upload cadence, or social accounts have been assumed. The site currently has no social links.
- `mods/index.html` includes Immersive Railroading (IR) and the first Defect Detectors release, version 1.0.0, with its CurseForge page. Duplicate the `<article class="mod-card">` for each additional mod, and verify its requirements and download link before publishing.

The YouTube channel links already use `https://www.youtube.com/channel/UCMxGPWLjDHRQ9xoLHCXd45g`.

## Validation

This is a static site with no build command or dependency-based test suite. Validate `script.js` and `scripts/update_channel_data.py`, check the page links, and run the GitHub Actions workflow after adding its API secret.
