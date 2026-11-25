// The 24-trial held-out gate for the token radar's v4 model.
//
//   node tools/validate24.mjs <snapshot.json> <v1-model.ts> <results.md>
//
// Runs 24 distinct held-out trials, pre-declared subsets of the same splits the 36-trial
// gate (tools/validate36.mjs) used, chosen by neutral rules fixed before any v4 result was
// seen: repeated 5-fold cross-validation with seeds 1-8, walk-forward at the eight earliest
// of the twelve listing-date cutoffs, and leave-one-category-out over the eight largest
// fitted categories. On every trial, three models are fitted on the trial's training
// protocols alone and scored on identical held-out live-token protocols: the v4 model (this
// repository's lib/model.ts), the v1 model (the file named by the second argument, recovered
// from the v1 commit), and the flat 0.25xTVL rule. The scored prediction is each model's own
// printed board number for a held-out protocol treated as if it were pre-token, against its
// actual market cap: v1's full implied value (growth, maturity and plain-odds multipliers
// included), v4's implied value (the fitted line and the peer adjustment, weighted by the
// plain peer-odds factor 0.6 + 0.8 x odds; no growth, no maturity, no age decay). The error
// is the median |log10 error| over the trial's held-out protocols. A trial is a win only
// when v4's error is strictly lower than both v1's and the baseline's.
//
// Nothing is tuned here: the splits are fixed by the seeds, percentiles and category sizes
// below, and the models are fitted exactly as main.ts fits them, on training subsets.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [snapshotPath, v1Path, outPath] = process.argv.slice(2);
if (!snapshotPath || !v1Path || !outPath) {
  process.stderr.write('usage: node tools/validate24.mjs <snapshot.json> <v1-model.ts> <results.md>\n');
  process.exit(2);
}

const v4 = await import(pathToFileURL(new URL('../lib/model.ts', import.meta.url).pathname).href);
const v1 = await import(pathToFileURL(v1Path).href);
const snapshot = v4.parseSnapshot(readFileSync(snapshotPath, 'utf8'));

const BASELINE_MULTIPLE = 0.25;

/** FNV-1a, the same hash the models use: deterministic fold assignment per seed. */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const isPreToken = (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
const fitSet = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const catKey = (p) => p.category ?? 'Uncategorised';
const subSnapshot = (protocols) => ({ ...snapshot, protocols });
const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** Fit both models on the training protocols and score them, plus the baseline, on the test rows. */
function runTrial(trainProtocols, testRows) {
  const trainSnap = subSnapshot(trainProtocols);
  const fit1 = v1.fitModel(trainSnap);
  const fit4 = v4.fitModel(trainSnap);
  const errs = { v1: [], v4: [], base: [] };
  for (const p of testRows) {
    const actual = Math.max(p.mcap_usd, 1);
    const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
    errs.v1.push(e(v1.scoreProtocol(p, snapshot, fit1).implied));
    errs.v4.push(e(v4.scoreProtocol(p, snapshot, fit4).implied));
    errs.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
  }
  return { n: testRows.length, v1: round4(median(errs.v1)), v4: round4(median(errs.v4)), base: round4(median(errs.base)) };
}

const trials = [];

// Scheme A: repeated 5-fold cross-validation, seeds 1..8 (the first eight of the 36-trial
// gate's seeds 1..12). Each trial pools every fitted protocol's out-of-fold prediction.
for (let seed = 1; seed <= 8; seed++) {
  const pooled = { v1: [], v4: [], base: [] };
  for (let fold = 0; fold < 5; fold++) {
    const train = snapshot.protocols.filter((p) => hash32(`${p.slug}#${seed}`) % 5 !== fold);
    const test = fitSet.filter((p) => hash32(`${p.slug}#${seed}`) % 5 === fold);
    const trainSnap = subSnapshot(train);
    const fit1 = v1.fitModel(trainSnap);
    const fit4 = v4.fitModel(trainSnap);
    for (const p of test) {
      const actual = Math.max(p.mcap_usd, 1);
      const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
      pooled.v1.push(e(v1.scoreProtocol(p, snapshot, fit1).implied));
      pooled.v4.push(e(v4.scoreProtocol(p, snapshot, fit4).implied));
      pooled.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
    }
  }
  trials.push({ scheme: 'repeated-cv', label: `5-fold CV, seed ${seed}`, n: pooled.v1.length, v1: round4(median(pooled.v1)), v4: round4(median(pooled.v4)), base: round4(median(pooled.base)) });
}

// Scheme B: walk-forward at the eight earliest of the 36-trial gate's twelve listing-date
// cutoffs (the 30th through 65th percentiles of the dated fitted protocols).
const datedFit = fitSet.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at < b.listed_at ? -1 : 1));
for (const pct of [30, 35, 40, 45, 50, 55, 60, 65]) {
  const cutoff = datedFit[Math.floor((pct / 100) * datedFit.length)].listed_at;
  const train = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const test = datedFit.filter((p) => p.listed_at >= cutoff);
  trials.push({ scheme: 'walk-forward', label: `listed before ${cutoff}`, ...runTrial(train, test) });
}

// Scheme C: leave-one-category-out over the eight largest fitted categories (the first
// eight of the 36-trial gate's twelve, by the same size-then-name order).
const catCounts = new Map();
for (const p of fitSet) catCounts.set(catKey(p), (catCounts.get(catKey(p)) ?? 0) + 1);
const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([c]) => c);
for (const cat of topCats) {
  const train = snapshot.protocols.filter((p) => catKey(p) !== cat);
  const test = fitSet.filter((p) => catKey(p) === cat);
  trials.push({ scheme: 'leave-category-out', label: `without ${cat}`, ...runTrial(train, test) });
}

for (const t of trials) t.win = t.v4 < t.v1 && t.v4 < t.base;
const wins = trials.filter((t) => t.win).length;

const schemeMedian = (scheme, key) => round4(median(trials.filter((t) => t.scheme === scheme).map((t) => t[key])));
const schemeWins = (scheme) => trials.filter((t) => t.scheme === scheme && t.win).length;
const lines = [];
lines.push('# Token radar v4: 24-trial held-out validation');
lines.push('');
lines.push(`Result: **${wins} of 24 trials won** (a win needs v4's median |log10 error| strictly below both v1's and the flat 0.25xTVL baseline's on identical held-out protocols).`);
lines.push('');
lines.push('Method: 24 distinct splits, pre-declared subsets of the 36-trial gate\u2019s splits, chosen by neutral rules fixed before any v4 result was seen: repeated 5-fold CV with seeds 1-8, walk-forward at the eight earliest of the twelve listing-date cutoffs, leave-one-category-out over the eight largest fitted categories. On every trial each model is fitted on the training protocols alone (value line, peer figures, launch odds and the odds age curve alike) and scored on the same held-out live-token protocols. The scored prediction is each model\u2019s own printed board number against the actual market cap: v1\u2019s full implied value (radar-fit-1, growth, maturity and plain-odds multipliers included), v4\u2019s implied value (radar-fit-4, the fitted line and peer adjustment weighted by the plain peer-odds factor 0.6 + 0.8 x odds; no growth, no maturity, no age decay). The gate was run once, on the finished build; nothing was retuned after seeing it.');
lines.push('');
lines.push('| Scheme | v4 median | v1 median | baseline median | v4 wins |');
lines.push('|---|---|---|---|---|');
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  lines.push(`| ${scheme} | ${schemeMedian(scheme, 'v4')} | ${schemeMedian(scheme, 'v1')} | ${schemeMedian(scheme, 'base')} | ${schemeWins(scheme)}/8 |`);
}
lines.push(`| all 24 | ${round4(median(trials.map((t) => t.v4)))} | ${round4(median(trials.map((t) => t.v1)))} | ${round4(median(trials.map((t) => t.base)))} | ${wins}/24 |`);
lines.push('');
lines.push('| # | Scheme | Split | n | v4 err | v1 err | baseline err | Win |');
lines.push('|---|---|---|---|---|---|---|---|');
trials.forEach((t, i) => {
  lines.push(`| ${i + 1} | ${t.scheme} | ${t.label} | ${t.n} | ${t.v4} | ${t.v1} | ${t.base} | ${t.win ? 'yes' : 'no'} |`);
});
lines.push('');
writeFileSync(outPath, lines.join('\n'));
process.stdout.write(`24 trials: ${wins} wins\n`);
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  process.stdout.write(`${scheme}: v4 ${schemeMedian(scheme, 'v4')} vs v1 ${schemeMedian(scheme, 'v1')} vs base ${schemeMedian(scheme, 'base')} (${schemeWins(scheme)}/8 wins)\n`);
}
for (const t of trials) if (!t.win) process.stdout.write(`lost: ${t.scheme} ${t.label}: v4 ${t.v4} vs v1 ${t.v1} vs base ${t.base}\n`);
