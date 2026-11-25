// The 36-trial held-out gate for the token radar's v3 model.
//
//   node tools/validate36.mjs <snapshot.json> <v1-model.ts> <results.md>
//
// Runs 36 distinct held-out trials in three schemes of 12: repeated 5-fold cross-validation
// with distinct seeds, walk-forward splits at twelve listing-date cutoffs, and
// leave-one-category-out over the twelve largest fitted categories. On every trial, three
// models are fitted on the trial's training protocols alone and scored on identical held-out
// live-token protocols: the v3 model (this repository's lib/model.ts), the v1 model (the file
// named by the second argument, recovered from the v1 commit), and the flat 0.25xTVL rule.
// The scored prediction is each model's own printed board number for a held-out protocol
// treated as if it were pre-token, against its actual market cap: v1's full implied value
// (growth, maturity and odds multipliers included), v3's value at launch (the fitted line and
// the peer adjustment only; the odds are reported separately and never enter the value). The
// error is the median |log10 error| over the trial's held-out protocols. A trial is a win only
// when v3's error is strictly lower than both v1's and the baseline's.
//
// Nothing is tuned here: the splits are fixed by the seeds, percentiles and category sizes
// below (the same splits the v2 run used), and the models are fitted exactly as main.ts fits
// them, on training subsets.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [snapshotPath, v1Path, outPath] = process.argv.slice(2);
if (!snapshotPath || !v1Path || !outPath) {
  process.stderr.write('usage: node tools/validate36.mjs <snapshot.json> <v1-model.ts> <results.md>\n');
  process.exit(2);
}

const v3 = await import(pathToFileURL(new URL('../lib/model.ts', import.meta.url).pathname).href);
const v1 = await import(pathToFileURL(v1Path).href);
const snapshot = v3.parseSnapshot(readFileSync(snapshotPath, 'utf8'));

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
  const fit3 = v3.fitModel(trainSnap);
  const errs = { v1: [], v3: [], base: [] };
  for (const p of testRows) {
    const actual = Math.max(p.mcap_usd, 1);
    const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
    errs.v1.push(e(v1.scoreProtocol(p, snapshot, fit1).implied));
    errs.v3.push(e(v3.scoreProtocol(p, snapshot, fit3).implied));
    errs.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
  }
  return { n: testRows.length, v1: round4(median(errs.v1)), v3: round4(median(errs.v3)), base: round4(median(errs.base)) };
}

const trials = [];

// Scheme A: repeated 5-fold cross-validation, seeds 1..12. Each trial pools every fitted
// protocol's out-of-fold prediction; folds differ per seed, so no two trials share a split.
for (let seed = 1; seed <= 12; seed++) {
  const pooled = { v1: [], v3: [], base: [] };
  for (let fold = 0; fold < 5; fold++) {
    const train = snapshot.protocols.filter((p) => hash32(`${p.slug}#${seed}`) % 5 !== fold);
    const test = fitSet.filter((p) => hash32(`${p.slug}#${seed}`) % 5 === fold);
    const trainSnap = subSnapshot(train);
    const fit1 = v1.fitModel(trainSnap);
    const fit3 = v3.fitModel(trainSnap);
    for (const p of test) {
      const actual = Math.max(p.mcap_usd, 1);
      const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
      pooled.v1.push(e(v1.scoreProtocol(p, snapshot, fit1).implied));
      pooled.v3.push(e(v3.scoreProtocol(p, snapshot, fit3).implied));
      pooled.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
    }
  }
  trials.push({ scheme: 'repeated-cv', label: `5-fold CV, seed ${seed}`, n: pooled.v1.length, v1: round4(median(pooled.v1)), v3: round4(median(pooled.v3)), base: round4(median(pooled.base)) });
}

// Scheme B: walk-forward at twelve listing-date cutoffs. Training protocols are those listed
// before the cutoff (value fit, odds and age curve alike); the test rows are the fitted
// protocols listed on or after it.
const datedFit = fitSet.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at < b.listed_at ? -1 : 1));
for (const pct of [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]) {
  const cutoff = datedFit[Math.floor((pct / 100) * datedFit.length)].listed_at;
  const train = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const test = datedFit.filter((p) => p.listed_at >= cutoff);
  trials.push({ scheme: 'walk-forward', label: `listed before ${cutoff}`, ...runTrial(train, test) });
}

// Scheme C: leave-one-category-out over the twelve largest fitted categories. The held-out
// category's protocols are scored by models that never saw the category at all.
const catCounts = new Map();
for (const p of fitSet) catCounts.set(catKey(p), (catCounts.get(catKey(p)) ?? 0) + 1);
const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12).map(([c]) => c);
for (const cat of topCats) {
  const train = snapshot.protocols.filter((p) => catKey(p) !== cat);
  const test = fitSet.filter((p) => catKey(p) === cat);
  trials.push({ scheme: 'leave-category-out', label: `without ${cat}`, ...runTrial(train, test) });
}

for (const t of trials) t.win = t.v3 < t.v1 && t.v3 < t.base;
const wins = trials.filter((t) => t.win).length;

const schemeMedian = (scheme, key) => round4(median(trials.filter((t) => t.scheme === scheme).map((t) => t[key])));
const lines = [];
lines.push('# Token radar v3: 36-trial held-out validation');
lines.push('');
lines.push(`Result: **${wins} of 36 trials won** (a win needs v3's median |log10 error| strictly below both v1's and the flat 0.25xTVL baseline's on identical held-out protocols).`);
lines.push('');
lines.push('Method: three schemes of 12 distinct splits (repeated 5-fold CV with seeds 1-12, walk-forward at twelve listing-date cutoffs, leave-one-category-out over the twelve largest fitted categories) — the same splits the v2 run used. On every trial each model is fitted on the training protocols alone (value line, peer figures, launch odds and, for v1 and v3, the odds age curve) and scored on the same held-out live-token protocols. The scored prediction is each model\u2019s own printed board number against the actual market cap: v1\u2019s full implied value (radar-fit-1, growth, maturity and odds multipliers included), v3\u2019s value at launch (radar-fit-3, the fitted line and peer adjustment only, odds reported separately). The dashboard validation in lib/model.ts scores the same quantity for v3; v1\u2019s own published validation scored the conditional value only, so those numbers are not comparable to these.');
lines.push('');
lines.push('| Scheme | v3 median | v1 median | baseline median |');
lines.push('|---|---|---|---|');
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  lines.push(`| ${scheme} | ${schemeMedian(scheme, 'v3')} | ${schemeMedian(scheme, 'v1')} | ${schemeMedian(scheme, 'base')} |`);
}
lines.push(`| all 36 | ${round4(median(trials.map((t) => t.v3)))} | ${round4(median(trials.map((t) => t.v1)))} | ${round4(median(trials.map((t) => t.base)))} |`);
lines.push('');
lines.push('| # | Scheme | Split | n | v3 err | v1 err | baseline err | Win |');
lines.push('|---|---|---|---|---|---|---|---|');
trials.forEach((t, i) => {
  lines.push(`| ${i + 1} | ${t.scheme} | ${t.label} | ${t.n} | ${t.v3} | ${t.v1} | ${t.base} | ${t.win ? 'yes' : 'no'} |`);
});
lines.push('');
writeFileSync(outPath, lines.join('\n'));
process.stdout.write(`36 trials: ${wins} wins\n`);
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  process.stdout.write(`${scheme}: v3 ${schemeMedian(scheme, 'v3')} vs v1 ${schemeMedian(scheme, 'v1')} vs base ${schemeMedian(scheme, 'base')}\n`);
}
for (const t of trials) if (!t.win) process.stdout.write(`lost: ${t.scheme} ${t.label}: v3 ${t.v3} vs v1 ${t.v1} vs base ${t.base}\n`);
