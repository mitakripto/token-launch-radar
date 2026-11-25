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
- **A fitted value model, not a flat multiple.** `log10(mcap) = a + b·log10(tvl) + peerAdj +
  c·growth + d·maturity`, fitted by least squares on the 128 live-token protocols with a
  positive market cap (slope 0.51, R² 0.35), with a per-category peer adjustment from median
  residuals entering as a fixed offset. The growth and maturity terms are fitted, not
  hand-set: growth is the seven-day TVL change clamped to [−50, 100] and scaled by 1/100,
  maturity is ln(1 + age)/ln(1096) capped at 1, and the regression sets their coefficients
  itself (c = −0.60, at the stated [−0.6, 0.6] bound; d = −0.37) — a hot week and a long
  listing both pull the fitted value down, by as much as the fit set supports. That
  regression is the value at launch — what the token would be worth if the protocol issued
  one — and the board's implied value weights it by the category's plain launch odds, the
  share of peers at the $50M floor that already trade, as a factor of 0.6 + 0.8 × odds. The
  odds printed on each row are then decayed by a survival curve over time spent pre-token
  (fitted on all 645 dated protocols: the longer a protocol has sat pre-token, the less of
  its launch window is left); that age curve is context and ranks the farms, and never
  adjusts the value beyond the plain factor. This is the synthesis of the model's four
  predecessors — hand-set growth and maturity multipliers first, then every multiplier out,
  then the odds factor alone — and the ablation on the page removes each shipped term and
  adds the one dropped variant back, printing what each does to the held-out error.
- **A value range on every row.** Each implied value carries an 80% band whose width is the
  category's own cross-validated residual spread (×/÷14.5 typical), so the page shows how far the
  model has actually been from the market in that category, not a false point precision. In
  cross-validation the band held 81% of held-out market caps.
- **Honest validation, computed at build time.** The printed number — the implied value — is
  scored against the market caps of live-token protocols it was not fitted on: 5-fold
  cross-validation (median error 3.9x, 30% within 2x) against a flat 0.25xTVL baseline (4.9x), a
  walk-forward split by listing date (3.2x), leave-one-out (4.1x), and a per-term ablation the
  dashboard prints in full: the five shipped terms removed in turn, the one dropped variant
  added back, every variant's error shown.
- **Concrete farm plans.** Six steps per protocol with sized capital (standard and minimum-viable),
  chain-aware gas costs, a hold period by age, a second qualifying action per category, and the
  plan's economics: total gas cost, total hours, and a scenario $/hour (a launch paying early
  users 5% of the value at launch, split over 10,000 wallets, weighted by the launch odds — a
  stated scenario, labelled as an estimate, never a promise).
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
- `tools/validate36.mjs` — a 36-trial held-out comparison of the v3 model against the v1 model and
  the flat baseline (repeated cross-validation, walk-forward and leave-one-category-out splits).
- `tools/validate24.mjs` — the 24-trial held-out gate for the v4 model: pre-declared
  subsets of the same splits, run once against v1 and the baseline.
- `tools/validate24v5.mjs` — the 24-trial held-out gate for the current (v5) model: the same
  pre-declared splits, run once against v1, v2, v3, v4 and the baseline.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`, `farm.js` (the farm-plan
  derivation, mirroring `lib/model.ts` so the page and `board.json` agree).
- `screenshots/` — the board, a protocol's detail view and a filtered view, taken of the real page.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit.

## License

MIT. See [LICENSE](LICENSE).

---

Built for [make.fun](https://make.fun/r/xavpy24p) — bounties for AI agents, paid in USDC.
