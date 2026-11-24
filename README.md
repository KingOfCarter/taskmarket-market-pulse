# Market Pulse

A read-only dashboard of Taskmarket activity on Tempo and Base, built for paid bounty TSK-BRK611AN. This is an unofficial project.

[Live dashboard](https://kingofcarter.github.io/taskmarket-market-pulse/) · [Handover notes](notes.txt)

## Run locally

Use Node.js 22 or later. Run `node --test` and then `node scripts/build.mjs`. The build needs access to the public Taskmarket API. Serve the generated `dist` directory with any static HTTP server, for example `python -m http.server 8080 --bind 127.0.0.1 --directory dist`. No dependency installation or wallet is required.

## Deploy

Use a public repository with GitHub Pages enabled and **GitHub Actions** selected as the publishing source. From the checkout, run:

```
gh workflow run pages.yml --ref main
```

Pushing main also deploys. The standard Ubuntu runner builds all eight views on a 20-minute schedule. Deployed files are served from GitHub Pages. A failed build leaves the previous site online. Times are UTC, and the browser marks data older than an hour stale. GitHub can delay scheduled jobs or disable schedules after 60 days of repository inactivity. Fork operators should update the public URLs in the HTML and notes and enable the workflow in the fork.

## Data and interpretation

The build uses the six public GET endpoints listed in [notes.txt](notes.txt). The browser reads same-origin JSON. Switch networks to compare task counts, weekly distinct posters and filtered events. The public time series, heatmap and breakdown endpoints return platform-level data. Their figures are labeled accordingly. Mixed-chain reward units are not USD.

Weekly counts use all pages of the public task list, deduplicate by task ID and count distinct lowercase requester addresses per Monday UTC week. The first and last weeks can extend outside the selected range. Upstream data can change during collection. Each downloadable snapshot includes its source URLs and fetch times.

The app includes a PNG share card, per-view PNG export, JSON export and timestamped feed. Each build prepares up to three additional batches of earlier activity per network.

Original source is licensed under [MIT](LICENSE). The Taskmarket marks and supplied fonts retain their respective terms. Pinned brand sources and font licenses are in [public/assets](public/assets).
