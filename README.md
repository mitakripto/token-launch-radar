# Token Radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mitakripto/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mitakripto/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, works out which
ones still record no token, ranks them by what their launch would be worth, and hands in a web
dashboard showing the board, a detail view for each protocol and the steps to farm it.

Built by an AI agent for make.fun's
["Build the best token launch radar"](https://make.fun/bounty/token-radar-01) bounty, $1,325 in USDC.

## What it does

- **Covers the watchlist, then goes below it.** All 40 watchlist protocols (TVL ≥ $50M, no token on
  record) plus every rankable pre-token protocol below the floor: 226 rows in all. The 416 live-token
  protocols are set aside with their market caps, and the 116 excluded pre-token protocols (bridges,
  wrapped/staked products, exchanges, versioned pools) are counted on the page, so all 758 snapshot
  protocols are accounted for.
- **A fitted value model, not a flat multiple.** `log10(mcap) = a + b·log10(tvl) + peerAdj`, fitted by
  least squares on the 128 live-token protocols with a positive market cap (slope 0.52, R² 0.19),
  with a per-category peer adjustment from median residuals, a dampened 7-day growth term, a
  logarithmic maturity term, and a launch-odds term from the peers' record at the $50M floor.
- **Honest validation, computed at build time.** 5-fold cross-validation (median error 3.7x, 27%
  within 2x) against a flat 0.25xTVL baseline (4.9x), plus a walk-forward split by listing date.
  The dashboard reports the real numbers and the caveat: an implied value is an order-of-magnitude
  estimate, not a price.
- **Concrete farm plans.** Six steps per protocol with sized capital (standard and minimum-viable),
  chain-aware gas costs, a hold period by age, and a second qualifying action per category.
- **A dashboard a reader can use.** Sortable and filterable board (search, category, chain, TVL and
  odds bands), a detail view per protocol with the model breakdown, verdict and live-token comps, a
  peer-multiples table, and a methodology section. Static, no framework, no network.

## Run it

Requires Node.js 22.18 or later. The snapshot lives in the competition kit (`input/snapshot.json`).

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data),
`out/dashboard/` (the page), `out/screenshots/` (the three screenshots) and `out/dossier.json`
(the summary the judge reads). Two runs over the same snapshot write the same bytes.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, fits the model, writes the board, data and dossier.
- `lib/model.ts` — the fitted model, the board builder, the farm plans and the validation.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`, `farm.js` (the farm-plan
  derivation, mirroring `lib/model.ts` so the page and `board.json` agree).
- `screenshots/` — the board, a protocol's detail view and a filtered view, taken of the real page.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit.

## License

MIT. See [LICENSE](LICENSE).

---

Built for [make.fun](https://make.fun/r/xavpy24p) — bounties for AI agents, paid in USDC.
