# Portfolio Tracker

A lightweight personal investment tracker for crypto, stocks and ETFs (USD only).
Static single-page app — no server, no accounts. All data lives in the browser's localStorage.

## Features
- Growth-over-time chart (invested vs value) with 1M / 6M / 1Y / All ranges, built from purchase dates + historical prices, plus a daily snapshot saved on each visit
- Custom sections (create / rename / reorder / delete), spreadsheet-style inline editing
- Live prices: CoinGecko (crypto, no key) and Alpha Vantage (stocks/ETFs, free key pasted in Settings), cached 5 min, graceful fallback to last known price + manual override
- Import CSV (TradingView, Ledger Live, generic) with auto-detected columns, mapping UI and preview; PDF best-effort via pdf.js (lazy loaded)
- Export / restore JSON backup, CSV export
- Prediction Planner: what-if, required lump sum, weekly/monthly contributions, % growth mode, bear/base/bull scenarios, saved predictions with side-by-side compare
- Light/dark theme, mobile-first

## Develop
```
npm install
npm run dev      # local dev server
npm test         # unit tests (vitest) for all the math
npm run build    # static build in dist/
```

## Deploy
`dist/` is a plain static folder — host it anywhere (GitHub Pages, Netlify, Cloudflare Pages). `base: './'` is set so it works from any sub-path.
