// The 24-trial held-out gate for the token radar's v5 model.
//
//   node tools/validate24v5.mjs <snapshot.json> <results.md>
//
// Runs the same 24 pre-declared splits as the v4 gate (tools/validate24.mjs): repeated
// 5-fold cross-validation with seeds 1-8, walk-forward at the eight earliest listing-date
// cutoffs, and leave-one-category-out over the eight largest fitted categories. On every
// trial, six scorers are fitted on the trial's training protocols alone and scored on
// identical held-out live-token protocols: the v5 model (this repository's lib/model.ts),
// the v1-v4 models (recovered from their commits, in ~/workspace/makefun/swiss/models/),
// and the flat 0.25xTVL rule. The scored prediction is each model's own printed board
// number for a held-out protocol treated as if it were pre-token, against its actual
// market cap. The error is the median |log10 error| over the trial's held-out protocols.
// A trial is a win only when v5's error is strictly lower than every other scorer's.
//
// Integrity: the recomputed v1-v4 errors on these splits are checked against the Swiss
// tournament's per-split table (swiss-splits.csv, itself verified against the published
// v2/v3 gate tables), and the v1 and baseline errors against the published v4 gate table.
// Any mismatch is reported in the results file, not silently passed over.
//
// The gate is run once, on the committed v5 build; nothing is retuned after seeing it.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [snapshotPath, outPath] = process.argv.slice(2);
if (!snapshotPath || !outPath) {
  process.stderr.write('usage: node tools/validate24v5.mjs <snapshot.json> <results.md>\n');
  process.exit(2);
}

const SWISS_DIR = '/home/hatch/workspace/makefun/swiss';
const v5 = await import(pathToFileURL(new URL('../lib/model.ts', import.meta.url).pathname).href);
const engines = { v5 };
for (const v of ['v1', 'v2', 'v3', 'v4']) {
  engines[v] = await import(pathToFileURL(`${SWISS_DIR}/models/${v}.ts`).href);
}
const snapshot = v5.parseSnapshot(readFileSync(snapshotPath, 'utf8'));

const BASELINE_MULTIPLE = 0.25;
const VERSIONS = ['v1', 'v2', 'v3', 'v4', 'v5'];

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

/** Fit every engine on the training protocols and score them, plus the baseline, on the test rows. */
function runTrial(trainProtocols, testRows) {
  const trainSnap = subSnapshot(trainProtocols);
  const fits = {};
  for (const v of VERSIONS) fits[v] = engines[v].fitModel(trainSnap);
  const errs = { v1: [], v2: [], v3: [], v4: [], v5: [], base: [] };
  for (const p of testRows) {
    const actual = Math.max(p.mcap_usd, 1);
    const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
    for (const v of VERSIONS) errs[v].push(e(engines[v].scoreProtocol(p, snapshot, fits[v]).implied));
    errs.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
  }
  const out = { n: testRows.length };
  for (const k of Object.keys(errs)) out[k] = round4(median(errs[k]));
  return out;
}

const trials = [];

// Scheme A: repeated 5-fold cross-validation, seeds 1..8. Each trial pools every fitted
// protocol's out-of-fold prediction.
for (let seed = 1; seed <= 8; seed++) {
  const pooled = { v1: [], v2: [], v3: [], v4: [], v5: [], base: [] };
  for (let fold = 0; fold < 5; fold++) {
    const train = snapshot.protocols.filter((p) => hash32(`${p.slug}#${seed}`) % 5 !== fold);
    const test = fitSet.filter((p) => hash32(`${p.slug}#${seed}`) % 5 === fold);
    const trainSnap = subSnapshot(train);
    const fits = {};
    for (const v of VERSIONS) fits[v] = engines[v].fitModel(trainSnap);
    for (const p of test) {
      const actual = Math.max(p.mcap_usd, 1);
      const e = (pred) => Math.abs(Math.log10(Math.max(pred, 1) / actual));
      for (const v of VERSIONS) pooled[v].push(e(engines[v].scoreProtocol(p, snapshot, fits[v]).implied));
      pooled.base.push(e(p.tvl_usd * BASELINE_MULTIPLE));
    }
  }
  const row = { scheme: 'repeated-cv', label: `5-fold CV, seed ${seed}`, n: pooled.v1.length };
  for (const k of Object.keys(pooled)) row[k] = round4(median(pooled[k]));
  trials.push(row);
}

// Scheme B: walk-forward at the eight earliest listing-date cutoffs (the 30th through 65th
// percentiles of the dated fitted protocols).
const datedFit = fitSet.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at < b.listed_at ? -1 : 1));
for (const pct of [30, 35, 40, 45, 50, 55, 60, 65]) {
  const cutoff = datedFit[Math.floor((pct / 100) * datedFit.length)].listed_at;
  const train = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const test = datedFit.filter((p) => p.listed_at >= cutoff);
  trials.push({ scheme: 'walk-forward', label: `listed before ${cutoff}`, ...runTrial(train, test) });
}

// Scheme C: leave-one-category-out over the eight largest fitted categories.
const catCounts = new Map();
for (const p of fitSet) catCounts.set(catKey(p), (catCounts.get(catKey(p)) ?? 0) + 1);
const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([c]) => c);
for (const cat of topCats) {
  const train = snapshot.protocols.filter((p) => catKey(p) !== cat);
  const test = fitSet.filter((p) => catKey(p) === cat);
  trials.push({ scheme: 'leave-category-out', label: `without ${cat}`, ...runTrial(train, test) });
}

// ---------- integrity: the shared columns must reproduce the earlier tables ----------
const integrityProblems = [];
{
  const csvRows = new Map();
  for (const line of readFileSync(`${SWISS_DIR}/swiss-splits.csv`, 'utf8').trim().split('\n').slice(1)) {
    const m = line.match(/^(\d+),([^,]+),"([^"]+)",(\d+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/);
    if (m) csvRows.set(`${m[2]}|${m[3]}`, { v1: Number(m[5]), v2: Number(m[6]), v3: Number(m[7]), v4: Number(m[8]) });
  }
  const v4Rows = new Map();
  for (const line of readFileSync('/home/hatch/workspace/makefun/token-radar-v4-trials.md', 'utf8').split('\n')) {
    const m = line.match(/^\| (\d+) \| ([^|]+) \| ([^|]+) \| (\d+) \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|/);
    if (m) v4Rows.set(`${m[2].trim()}|${m[3].trim()}`, { v4: Number(m[5]), v1: Number(m[6]), base: Number(m[7]) });
  }
  for (const t of trials) {
    const key = `${t.scheme}|${t.label}`;
    const csv = csvRows.get(key);
    if (!csv) integrityProblems.push(`${key}: not found in swiss-splits.csv`);
    else for (const v of ['v1', 'v2', 'v3', 'v4']) if (t[v] !== csv[v]) integrityProblems.push(`${key}: ${v} recomputed ${t[v]} vs swiss table ${csv[v]}`);
    const pub = v4Rows.get(key);
    if (!pub) integrityProblems.push(`${key}: not found in token-radar-v4-trials.md`);
    else {
      if (t.v1 !== pub.v1) integrityProblems.push(`${key}: v1 recomputed ${t.v1} vs v4 gate table ${pub.v1}`);
      if (t.base !== pub.base) integrityProblems.push(`${key}: baseline recomputed ${t.base} vs v4 gate table ${pub.base}`);
    }
  }
}

for (const t of trials) {
  t.beatenBy = [...VERSIONS.slice(0, 4), 'base'].filter((k) => t[k] <= t.v5);
  t.win = t.beatenBy.length === 0;
}
const wins = trials.filter((t) => t.win).length;

const schemeMedian = (scheme, key) => round4(median(trials.filter((t) => t.scheme === scheme).map((t) => t[key])));
const schemeWins = (scheme) => trials.filter((t) => t.scheme === scheme && t.win).length;
const lines = [];
lines.push('# Token radar v5: 24-trial held-out validation');
lines.push('');
lines.push(`Result: **${wins} of 24 trials won** (a win needs v5's median |log10 error| strictly below every other scorer's — v1, v2, v3, v4 and the flat 0.25xTVL baseline — on identical held-out protocols).`);
lines.push('');
lines.push('Method: the same 24 pre-declared splits as the v4 gate: repeated 5-fold CV with seeds 1-8, walk-forward at the eight earliest listing-date cutoffs, leave-one-category-out over the eight largest fitted categories. On every trial each model is fitted on the training protocols alone (value fit, peer figures, launch odds and the odds age curve alike) and scored on the same held-out live-token protocols. The scored prediction is each model\u2019s own printed board number against the actual market cap: v5\u2019s implied value (radar-fit-5, the fitted regression — line, peer adjustment and the fitted growth and maturity coefficients — weighted by the plain peer-odds factor 0.6 + 0.8 x odds; no age decay). The gate was run once, on the committed v5 build; nothing was retuned after seeing it.');
lines.push('');
lines.push(`Integrity: ${integrityProblems.length === 0 ? 'passed — the recomputed v1-v4 errors match the Swiss tournament\u2019s per-split table on all 24 splits, and the v1 and baseline errors match the published v4 gate table.' : 'FAILED — ' + integrityProblems.join('; ')}`);
lines.push('');
lines.push('| Scheme | v5 median | v1 median | v2 median | v3 median | v4 median | baseline median | v5 wins |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  lines.push(`| ${scheme} | ${schemeMedian(scheme, 'v5')} | ${schemeMedian(scheme, 'v1')} | ${schemeMedian(scheme, 'v2')} | ${schemeMedian(scheme, 'v3')} | ${schemeMedian(scheme, 'v4')} | ${schemeMedian(scheme, 'base')} | ${schemeWins(scheme)}/8 |`);
}
lines.push(`| all 24 | ${round4(median(trials.map((t) => t.v5)))} | ${round4(median(trials.map((t) => t.v1)))} | ${round4(median(trials.map((t) => t.v2)))} | ${round4(median(trials.map((t) => t.v3)))} | ${round4(median(trials.map((t) => t.v4)))} | ${round4(median(trials.map((t) => t.base)))} | ${wins}/24 |`);
lines.push('');
lines.push('| # | Scheme | Split | n | v5 err | v1 err | v2 err | v3 err | v4 err | baseline err | Win | Beaten by |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
trials.forEach((t, i) => {
  lines.push(`| ${i + 1} | ${t.scheme} | ${t.label} | ${t.n} | ${t.v5} | ${t.v1} | ${t.v2} | ${t.v3} | ${t.v4} | ${t.base} | ${t.win ? 'yes' : 'no'} | ${t.win ? '—' : t.beatenBy.join(', ')} |`);
});
lines.push('');
writeFileSync(outPath, lines.join('\n'));
process.stdout.write(`24 trials: ${wins} wins; integrity problems: ${integrityProblems.length}\n`);
for (const p of integrityProblems) process.stdout.write(`integrity: ${p}\n`);
for (const scheme of ['repeated-cv', 'walk-forward', 'leave-category-out']) {
  process.stdout.write(`${scheme}: v5 ${schemeMedian(scheme, 'v5')} vs v1 ${schemeMedian(scheme, 'v1')} vs v2 ${schemeMedian(scheme, 'v2')} vs v3 ${schemeMedian(scheme, 'v3')} vs v4 ${schemeMedian(scheme, 'v4')} vs base ${schemeMedian(scheme, 'base')} (${schemeWins(scheme)}/8 wins)\n`);
}
for (const t of trials) if (!t.win) process.stdout.write(`lost: ${t.scheme} ${t.label}: v5 ${t.v5}, beaten by ${t.beatenBy.map((k) => `${k} ${t[k]}`).join(', ')}\n`);
