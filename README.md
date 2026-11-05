# gold-rates-data

City-wise **gold (24K / 22K / 18K)** and **silver** rates for **136 Indian cities**, plus international spot prices, published as a static JSON API on GitHub Pages and refreshed every 15 minutes by GitHub Actions.

**Base URL:** `https://boredpheonix.github.io/gold-rates-data/api/v1/`

| Endpoint | Description |
|---|---|
| `latest.json` | All cities + India average, today's change, spot prices, timestamps |
| `cities.json` | City list: `slug`, `name`, `state`, `lat`, `lon` |
| `cities/{slug}.json` | One city (`kakinada`, `chennai`, …, or `india`) with its full daily history |
| `spot.json` | International spot (XAU/XAG in USD and INR) + 3-day intraday series |

```jsonc
// cities/{slug}.json → history is columnar, one entry per day (IST dates)
{ "city": { "slug": "kakinada", "name": "Kakinada", "date": "2026-11-05", "gold": { "k24": 14602, "k22": 13385, "k18": 10952 }, … },
  "history": { "d": ["2016-10-01", …], "k24": [3157, …], "k22": [2952, …], "k18": [2415.3, …], "ag": [45963, …] } }
```

All prices are **INR**: gold per gram, silver per kg (`ag`). City rates exclude GST, TCS and making charges. Rates are indicative.

## How it works

- `scraper/src/scrape.mjs` reads the public city pages on [goodreturns.in](https://www.goodreturns.in/gold-rates/) politely (8 sentinel cities each run; all cities only when something changes, or every 3 hours) and spot prices from [gold-api.com](https://gold-api.com). No dependencies; Node 22.
- History lives in the `data` branch and is never trimmed. A shrink guard stops any run that would lose days, and the `data-archive` branch keeps one append-only snapshot per day.
- `import/history/<slug>.json` holds older daily series (Kakinada back to 2016). They are merged on every run, only filling days that are missing.
- If GitHub skips scheduled runs, start *Actions → heartbeat (fallback scheduler) → Run workflow*; it stops by itself once the schedule is regular.

Run the tests with `node --test scraper/test/*.test.mjs`.
