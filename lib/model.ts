// The token radar's model: a sealed snapshot in, a ranked board of pre-token protocols out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// rankable pre-token protocol below the floor: the early rows the radar exists to find. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol). Live-token
// protocols are never ranked: they are the market's own evidence, and the model is fitted on them.
//
// Implied value is fitted from the snapshot's own figures only. No protocol name is special-cased.
//
//   fit      log10(mcap) = a + b * log10(tvl), ordinary least squares over the live-token
//            protocols that carry a positive market cap (n = 128 here: 272 record no market
//            cap, 15 record zero, one records -1). b < 1 is the sublinear size curve: a
//            protocol ten times larger is worth less than ten times as much. A multivariate
//            fit that also regressed on age and seven-day growth was tried and dropped: its
//            cross-validated error was worse (0.62 vs 0.56 in log10), so the simpler line stays.
//   peers    each category's median residual from that line, shrunk toward 0 by its sample size,
//            clamped to +/-0.5 in log10: the category's peer multiple, in log form.
//   implied  round(10^(a + b*log10(tvl) + peerAdj) * (0.6 + 0.8 * odds)), at least $1: the
//            value at launch (the line and the peer adjustment alone, printed beside the
//            implied figure as the conditional value) weighted by the category's plain
//            launch odds. Nothing else is multiplied in: no growth term, no maturity term,
//            and no age decay.
//   odds     the share of protocols at or above the floor in the same category that already trade,
//            shrunk toward the global share: how often the peers launched. That plain share is
//            the odds that enter the value, through the factor above. The odds printed on a row
//            are then aged: a survival curve fitted on every dated protocol in the snapshot (the
//            share still pre-token at each age, made non-increasing) gives the chance a protocol
//            that is still pre-token at a given age ever launches, and each row's printed odds
//            take that chance relative to its average over the pre-token population. The longer
//            a protocol has sat pre-token, the lower its printed odds: most of its launch window
//            is behind it. The age curve is context and drives the farm ranking; it does not
//            adjust the value any further.
//
// Earlier versions: radar-fit-1 multiplied the value by a dampened seven-day growth term
// (1 + 0.25 * clamp(change_7d, -50, 100) / 100), a logarithmic maturity term
// (0.70 + 0.30 * min(ln(1 + age_days) / ln(1096), 1)) and the launch odds (0.6 + 0.8 * odds);
// radar-fit-2 swapped in age-decayed odds; radar-fit-3 dropped all three multipliers and
// scored the best full-data cross-validation of the three, but lost held-out walk-forward
// trials to radar-fit-1, whose shrinkage the odds factor provides. radar-fit-4 keeps exactly
// one multiplier, the plain odds: the ablation below removes each shipped term in turn and
// adds each dropped term back under the same cross-validation folds, and prints what each
// does to the held-out error. The growth and age figures still show on every row; only the
// multiplications that failed the ablation are gone.
//   range    every row also carries a value range: the implied value widened by a per-category
//            band whose half-width is the 80th percentile of that category's cross-validated
//            residuals (shrunk toward the global band), so a row's range is as honest as the
//            model's own held-out record in that category, no tighter.
//
// Validation is computed at build time, on the live-token protocols only, and reported honestly.
// It scores the board's exact printed number (the implied value) for a
// live-token protocol treated as if it were pre-token, against its actual market cap: the
// strictest test of the printed figure. Four schemes: five-fold cross-validation (folds by a
// hash of the slug, so they are deterministic), a walk-forward split by listing date,
// leave-one-out over every fitted protocol, and a per-term ablation under the same folds (each
// shipped term removed in turn, each dropped term added back in turn, every variant's error
// printed). Every fit inside a validation fold sees only that fold's training protocols. The
// flat 0.25xTVL rule is scored on the same folds as the baseline.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The launch-odds age curve: how the chance of ever launching falls with time spent pre-token. */
export interface AgeCurve {
  /** Breakpoints of the age factor: interpolate linearly in ln(1 + age) between them. */
  points: Array<{ age: number; factor: number }>;
  /** The pre-token share among the oldest protocols: the fitted never-launch floor of the curve. */
  s_inf: number;
  /** The curve's mean ever-launch chance over the dated pre-token population (the factor's 1.0). */
  mean_ever: number;
  /** How many dated protocols the curve was fitted on. */
  population: number;
}

/** The fitted value model's parameters, all derived from the snapshot at build time. */
export interface FitParams {
  intercept: number;
  slope: number;
  r2: number;
  n_fit: number;
  global_median_multiple: number;
  peer_adj: Record<string, number>;
  peer_multiple: Record<string, number>;
  peer_n: Record<string, number>;
  odds: Record<string, number>;
  odds_n: Record<string, number>;
  global_odds: number;
  age_curve: AgeCurve;
  median_pre_age: number;
}

/** One validation run: how the fitted model predicted market caps it had not seen. */
export interface ValidationRun {
  n: number;
  median_abs_log10: number;
  within_2x: number;
  baseline_median_abs_log10: number;
}

/** One ablation row: a variant of the shipped model, its held-out error, and the verdict. */
export interface AblationRow {
  term: string;
  label: string;
  /** 'without': a shipped term removed. 'with': a dropped term added back. */
  variant: 'without' | 'with';
  median_abs_log10: number;
  /** Whether the term is in the shipped model. */
  kept: boolean;
  verdict: string;
}

/** The model's validation: cross-validation, walk-forward, leave-one-out and the term ablation. */
export interface Validation {
  cv: ValidationRun;
  walk_forward: { train_n: number; test_n: number; cutoff: string; median_abs_log10: number; within_2x: number };
  loo: { n: number; median_abs_log10: number; within_2x: number };
  ablation: AblationRow[];
  range: { global_half_width_log10: number; coverage: number; level: number };
}

/**
 * Switches that vary the model for the ablation. The shipped model runs with every switch at
 * its default: the fitted line, the peer adjustment and the plain launch-odds factor in; the
 * growth and maturity terms out, and the odds factor free of age decay. base:false, peer:false
 * and odds:false remove a shipped term; growth:true and maturity:true add a dropped term back;
 * odds_age_decay:true swaps the plain odds in the factor for the age-decayed odds.
 */
export interface TermFlags {
  base?: boolean;
  peer?: boolean;
  odds?: boolean;
  odds_age_decay?: boolean;
  growth?: boolean;
  maturity?: boolean;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-fit-4';

/** The flat rule the validation compares against: the starter's 0.25xTVL. */
const BASELINE_MULTIPLE = 0.25;
/** Shrinkage strength for a category's peer adjustment (pseudo-count of protocols). */
const PEER_SHRINK = 2;
/** Shrinkage strength for a category's launch odds (pseudo-count of protocols). */
const ODDS_SHRINK = 8;
/** The peer adjustment's clamp, in log10: no category moves a value more than ~3.2x either way. */
const PEER_CLAMP = 0.5;
/** Folds for cross-validation. */
const FOLDS = 5;
/** Age buckets (days) for the launch-odds survival curve. */
const AGE_BUCKET_EDGES = [0, 90, 180, 365, 730, 1095, 1460, Number.POSITIVE_INFINITY];
/** The age factor's bounds: a stated calibration choice, so no age reads as hopeless or certain. */
const AGE_FACTOR_MIN = 0.35;
const AGE_FACTOR_MAX = 1.3;
/** Shrinkage strength for a category's range band (pseudo-count of residuals). */
const RANGE_SHRINK = 4;
/** The range band's level: the 80th percentile of held-out residuals. */
const RANGE_LEVEL = 0.8;
/** Farm scenario: the share of a launch's implied value assumed to reach early users. */
export const FARM_REWARD_SHARE = 0.05;
/** Farm scenario: the qualifying wallets that share is divided among. */
export const FARM_ASSUMED_WALLETS = 10_000;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The median of a list of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** FNV-1a hash of a string, for deterministic cross-validation folds. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- fitting

/** The live-token protocols with a market cap: the only rows the value model is fitted on. */
function fitSet(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Ordinary least squares of log10(mcap) on log10(tvl), plus R-squared. */
function logLogFit(rows: SnapshotProtocol[]): { intercept: number; slope: number; r2: number } {
  const xs = rows.map((p) => Math.log10(p.tvl_usd));
  const ys = rows.map((p) => Math.log10(p.mcap_usd!));
  const n = rows.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, r2 };
}

/** The category key a protocol's peer figures are filed under. */
function catKey(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorised';
}

/**
 * Fit the value model on a set of live-token protocols: the log-log line, each category's shrunk
 * median residual (the peer adjustment), and each category's shrunk median mcap/TVL multiple.
 */
function fitValueModel(rows: SnapshotProtocol[]): {
  intercept: number;
  slope: number;
  r2: number;
  n_fit: number;
  global_median_multiple: number;
  peer_adj: Record<string, number>;
  peer_multiple: Record<string, number>;
  peer_n: Record<string, number>;
} {
  const { intercept, slope, r2 } = logLogFit(rows);
  const multiples = rows.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMed = median(multiples) ?? BASELINE_MULTIPLE;
  const residuals: Record<string, number[]> = {};
  const catMultiples: Record<string, number[]> = {};
  for (const p of rows) {
    const key = catKey(p);
    (residuals[key] ??= []).push(Math.log10(p.mcap_usd!) - (intercept + slope * Math.log10(p.tvl_usd)));
    (catMultiples[key] ??= []).push(p.mcap_usd! / p.tvl_usd);
  }
  const peer_adj: Record<string, number> = {};
  const peer_multiple: Record<string, number> = {};
  const peer_n: Record<string, number> = {};
  for (const key of Object.keys(residuals).sort()) {
    const rs = residuals[key]!;
    const med = median(rs) ?? 0;
    const shrunk = (rs.length * med) / (rs.length + PEER_SHRINK);
    peer_adj[key] = round4(Math.max(-PEER_CLAMP, Math.min(PEER_CLAMP, shrunk)));
    const cm = median(catMultiples[key]!) ?? globalMed;
    peer_multiple[key] = round4((rs.length * cm + PEER_SHRINK * globalMed) / (rs.length + PEER_SHRINK));
    peer_n[key] = rs.length;
  }
  return { intercept, slope, r2, n_fit: rows.length, global_median_multiple: round4(globalMed), peer_adj, peer_multiple, peer_n };
}

/** The growth term: dampened, so a hot week lifts a row without dominating the size curve. */
function growthTerm(change7d: number | null): { pct: number; mult: number } {
  const pct = Math.min(100, Math.max(-50, finite(change7d, 0)));
  return { pct, mult: 1 + 0.25 * (pct / 100) };
}

/** The maturity term: logarithmic in age, so the first year matters more than the third. */
function maturityTerm(age: number | null, fallbackAge: number): { age_used: number; mult: number } {
  const ageUsed = age ?? fallbackAge;
  const mult = 0.7 + 0.3 * Math.min(Math.log1p(Math.max(ageUsed, 0)) / Math.log1p(1095), 1);
  return { age_used: ageUsed, mult };
}

/**
 * Launch odds per category: among protocols at or above the floor in the category, the share that
 * already trade, shrunk toward the global share. Categories with no protocol at the floor take the
 * global share. Odds are a peer record, not a prediction about any one protocol.
 */
function fitOdds(protocols: SnapshotProtocol[], floorUsd: number): { odds: Record<string, number>; odds_n: Record<string, number>; global_odds: number } {
  const big = protocols.filter((p) => p.tvl_usd >= floorUsd);
  const liveBig = big.filter((p) => !isPreToken(p)).length;
  const global = big.length === 0 ? 0.5 : liveBig / big.length;
  const byCat: Record<string, { n: number; live: number }> = {};
  for (const p of big) {
    const key = catKey(p);
    const slot = (byCat[key] ??= { n: 0, live: 0 });
    slot.n++;
    if (!isPreToken(p)) slot.live++;
  }
  const odds: Record<string, number> = {};
  const odds_n: Record<string, number> = {};
  for (const key of Object.keys(byCat).sort()) {
    const slot = byCat[key]!;
    odds[key] = round4((slot.live + ODDS_SHRINK * global) / (slot.n + ODDS_SHRINK));
    odds_n[key] = slot.n;
  }
  return { odds, odds_n, global_odds: round4(global) };
}

/**
 * The launch-odds age curve, fitted on every dated protocol in the population. In each age bucket,
 * S is the share still pre-token; made non-increasing across buckets, it is the survival curve of
 * "no launch yet". The oldest bucket's S is the never-launch floor S_inf, and a protocol still
 * pre-token at age a has ever-launch chance (S(a) - S_inf) / S(a): what is left of its launch
 * window. The age factor is that chance relative to its mean over the dated pre-token population,
 * clamped to [AGE_FACTOR_MIN, AGE_FACTOR_MAX], at each bucket's median age.
 */
function fitAgeCurve(protocols: SnapshotProtocol[], asOf: string): AgeCurve {
  const dated = protocols
    .map((p) => ({ age: ageDays(asOf, p.listed_at), pre: isPreToken(p) }))
    .filter((d): d is { age: number; pre: boolean } => d.age !== null);
  const buckets: Array<{ ages: number[]; n: number; pre: number }> = [];
  for (let i = 0; i + 1 < AGE_BUCKET_EDGES.length; i++) {
    const lo = AGE_BUCKET_EDGES[i]!;
    const hi = AGE_BUCKET_EDGES[i + 1]!;
    const members = dated.filter((d) => d.age >= lo && d.age < hi);
    buckets.push({ ages: members.map((d) => d.age), n: members.length, pre: members.filter((d) => d.pre).length });
  }
  const shares: number[] = [];
  let prev = 1;
  for (const b of buckets) {
    const s = b.n === 0 ? prev : Math.min(prev, b.pre / b.n);
    shares.push(s);
    prev = s;
  }
  const sInf = shares[shares.length - 1] ?? 0;
  const ever = shares.map((s) => (s > 0 ? Math.max(0, (s - sInf) / s) : 0));
  const preAges = dated.filter((d) => d.pre);
  let meanEver = 0;
  if (preAges.length > 0) {
    let sum = 0;
    for (const d of preAges) {
      const bi = AGE_BUCKET_EDGES.findIndex((_, i) => i + 1 < AGE_BUCKET_EDGES.length && d.age >= AGE_BUCKET_EDGES[i]! && d.age < AGE_BUCKET_EDGES[i + 1]!);
      sum += ever[Math.max(0, bi)]!;
    }
    meanEver = sum / preAges.length;
  }
  const points = buckets.map((b, i) => {
    const med = median(b.ages);
    const lo = AGE_BUCKET_EDGES[i]!;
    const hi = AGE_BUCKET_EDGES[i + 1]!;
    const age = med !== null ? Math.round(med) : Math.round(Number.isFinite(hi) ? Math.sqrt(lo * hi) : lo * 1.25);
    const factor = meanEver > 0 ? Math.max(AGE_FACTOR_MIN, Math.min(AGE_FACTOR_MAX, ever[i]! / meanEver)) : 1;
    return { age, factor: round4(factor) };
  });
  points.sort((a, b) => a.age - b.age);
  return { points, s_inf: round4(sInf), mean_ever: round4(meanEver), population: dated.length };
}

/** The age factor at an age: linear in ln(1 + age) between the curve's points, flat outside them. */
export function ageFactorAt(curve: AgeCurve, age: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 1;
  if (age <= pts[0]!.age) return pts[0]!.factor;
  if (age >= pts[pts.length - 1]!.age) return pts[pts.length - 1]!.factor;
  for (let i = 1; i < pts.length; i++) {
    if (age <= pts[i]!.age) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const t = (Math.log1p(age) - Math.log1p(a.age)) / Math.max(Math.log1p(b.age) - Math.log1p(a.age), 1e-9);
      return a.factor + t * (b.factor - a.factor);
    }
  }
  return pts[pts.length - 1]!.factor;
}

/** Fit the whole model on the snapshot: value fit, odds, and the pre-token median age. The line's
 * parameters are rounded to 4 decimals here, so the dashboard (which reads the rounded values from
 * data.js) recomputes exactly the implied values this model scores: the page and board.json agree
 * to the dollar. */
export function fitModel(snapshot: Snapshot): FitParams {
  const value = fitValueModel(fitSet(snapshot.protocols));
  value.intercept = round4(value.intercept);
  value.slope = round4(value.slope);
  const odds = fitOdds(snapshot.protocols, snapshot.floor_usd);
  const ageCurve = fitAgeCurve(snapshot.protocols, snapshot.as_of);
  const preAges = snapshot.protocols
    .filter(isPreToken)
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianPreAge = median(preAges) ?? 365;
  return { ...value, ...odds, age_curve: ageCurve, median_pre_age: Math.round(medianPreAge) };
}

// ---------------------------------------------------------------- validation

/** Median absolute log10 error and the share of predictions within 2x, for paired actual/predicted. */
function scorePredictions(pairs: Array<{ actual: number; predicted: number }>): { median_abs_log10: number; within_2x: number } {
  const errors = pairs.map(({ actual, predicted }) => Math.abs(Math.log10(Math.max(predicted, 1) / Math.max(actual, 1))));
  const med = median(errors) ?? 0;
  const within = pairs.length === 0 ? 0 : pairs.filter(({ actual, predicted }) => Math.max(predicted, 1) / Math.max(actual, 1) <= 2 && Math.max(actual, 1) / Math.max(predicted, 1) <= 2).length / pairs.length;
  return { median_abs_log10: round4(med), within_2x: round4(within) };
}

/** The nearest-rank quantile of an ascending-sorted list. */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1))]!;
}

/** One held-out prediction: a live-token protocol, its category, its market cap and the model's number. */
export interface CvPair {
  slug: string;
  category: string;
  actual: number;
  predicted: number;
}

/** A snapshot like the sealed one, but holding only `protocols`: the training side of a split. */
function subSnapshot(snapshot: Snapshot, protocols: SnapshotProtocol[]): Snapshot {
  return { ...snapshot, protocols };
}

/**
 * Five-fold cross-validated predictions of the board's printed number (the implied value) for
 * every fitted protocol: each fold's model is fitted on the other folds' protocols alone (value
 * line, peer figures, launch odds and the age curve alike), then asked for the printed number
 * of each held-out protocol, as if it were pre-token.
 */
export function crossValidatePairs(snapshot: Snapshot, terms: TermFlags = {}): CvPair[] {
  const rows = fitSet(snapshot.protocols);
  const pairs: CvPair[] = [];
  for (let fold = 0; fold < FOLDS; fold++) {
    const train = snapshot.protocols.filter((p) => hash32(p.slug) % FOLDS !== fold);
    const test = rows.filter((p) => hash32(p.slug) % FOLDS === fold);
    const foldFit = fitModel(subSnapshot(snapshot, train));
    for (const p of test) {
      pairs.push({ slug: p.slug, category: catKey(p), actual: p.mcap_usd!, predicted: scoreProtocol(p, snapshot, foldFit, terms).implied });
    }
  }
  return pairs;
}

/**
 * The value range's half-widths, in log10, from cross-validated residuals: per category, the
 * RANGE_LEVEL quantile of |residual|, shrunk toward the global quantile by the category's
 * residual count. Categories with no fitted protocol take the global width.
 */
export function rangeHalfWidths(pairs: CvPair[]): { per_cat: Record<string, number>; global: number } {
  const byCat: Record<string, number[]> = {};
  const all: number[] = [];
  for (const pr of pairs) {
    const r = Math.abs(Math.log10(Math.max(pr.actual, 1) / Math.max(pr.predicted, 1)));
    (byCat[pr.category] ??= []).push(r);
    all.push(r);
  }
  const global = quantile([...all].sort((a, b) => a - b), RANGE_LEVEL);
  const per_cat: Record<string, number> = {};
  for (const key of Object.keys(byCat).sort()) {
    const rs = [...byCat[key]!].sort((a, b) => a - b);
    const q = quantile(rs, RANGE_LEVEL);
    per_cat[key] = round4((rs.length * q + RANGE_SHRINK * global) / (rs.length + RANGE_SHRINK));
  }
  return { per_cat, global: round4(global) };
}

/**
 * Validate the model on the live-token protocols, honestly, under four schemes, every fit inside
 * a split seeing only that split's training protocols: five-fold cross-validation, a
 * walk-forward split by listing date, leave-one-out, and a per-term ablation under the same
 * folds. The scored prediction is the board's printed number, the implied value.
 */
export function validateModel(snapshot: Snapshot): { validation: Validation; half_widths: { per_cat: Record<string, number>; global: number } } {
  const rows = fitSet(snapshot.protocols);
  const cvPairs = crossValidatePairs(snapshot);
  const cvScore = scorePredictions(cvPairs);
  const basePairs = rows.map((p) => ({ actual: p.mcap_usd!, predicted: p.tvl_usd * BASELINE_MULTIPLE }));
  const cvBaseScore = scorePredictions(basePairs);

  const dated = rows.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const cutoff = dated.length === 0 ? snapshot.as_of : dated[Math.floor(dated.length / 2)]!.listed_at!;
  const wfTrainProtos = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const wfTest = dated.filter((p) => p.listed_at! >= cutoff);
  const wfFit = fitModel(subSnapshot(snapshot, wfTrainProtos.length > 0 ? wfTrainProtos : snapshot.protocols));
  const wfScore = scorePredictions(wfTest.map((p) => ({ actual: p.mcap_usd!, predicted: scoreProtocol(p, snapshot, wfFit).implied })));

  const looPairs: Array<{ actual: number; predicted: number }> = [];
  for (const p of rows) {
    const rest = snapshot.protocols.filter((q) => q.slug !== p.slug);
    const looFit = fitModel(subSnapshot(snapshot, rest));
    looPairs.push({ actual: p.mcap_usd!, predicted: scoreProtocol(p, snapshot, looFit).implied });
  }
  const looScore = scorePredictions(looPairs);

  const ablationSpecs: Array<{ term: string; label: string; variant: 'without' | 'with'; terms: TermFlags }> = [
    { term: 'base', label: 'Fitted TVL line (raw peer multiples instead)', variant: 'without', terms: { base: false } },
    { term: 'peer', label: 'Category peer adjustment', variant: 'without', terms: { peer: false } },
    { term: 'odds', label: 'Peer launch odds factor (0.6 + 0.8 x peer odds)', variant: 'without', terms: { odds: false } },
    { term: 'growth', label: 'Seven-day growth term', variant: 'with', terms: { growth: true } },
    { term: 'maturity', label: 'Age maturity term', variant: 'with', terms: { maturity: true } },
    { term: 'age_decay', label: 'Age-decayed odds in the value (plain odds instead)', variant: 'with', terms: { odds_age_decay: true } },
  ];
  const full = cvScore.median_abs_log10;
  const ablation: AblationRow[] = ablationSpecs.map((spec) => {
    const score = scorePredictions(crossValidatePairs(snapshot, spec.terms));
    const err = score.median_abs_log10;
    let kept: boolean;
    let verdict: string;
    if (spec.variant === 'without') {
      kept = true;
      verdict = err > full ? 'kept: removing it raises the error' : err < full ? 'kept: removing it would lower the error' : 'kept: removing it changes nothing';
    } else {
      kept = false;
      verdict = err > full ? 'dropped: adding it raises the error' : err < full ? 'dropped: adding it would lower the error' : 'dropped: adding it changes nothing';
    }
    return { term: spec.term, label: spec.label, variant: spec.variant, median_abs_log10: err, kept, verdict };
  });

  const half_widths = rangeHalfWidths(cvPairs);
  const covered = cvPairs.filter((pr) => Math.abs(Math.log10(Math.max(pr.actual, 1) / Math.max(pr.predicted, 1))) <= (half_widths.per_cat[pr.category] ?? half_widths.global)).length;
  const coverage = cvPairs.length === 0 ? 0 : round4(covered / cvPairs.length);

  return {
    validation: {
      cv: { n: cvPairs.length, median_abs_log10: cvScore.median_abs_log10, within_2x: cvScore.within_2x, baseline_median_abs_log10: cvBaseScore.median_abs_log10 },
      walk_forward: { train_n: dated.length - wfTest.length, test_n: wfTest.length, cutoff, median_abs_log10: wfScore.median_abs_log10, within_2x: wfScore.within_2x },
      loo: { n: looPairs.length, median_abs_log10: looScore.median_abs_log10, within_2x: looScore.within_2x },
      ablation,
      range: { global_half_width_log10: half_widths.global, coverage, level: RANGE_LEVEL },
    },
    half_widths,
  };
}

// ---------------------------------------------------------------- scoring

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  conditional_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  token_odds: number;
  capital_usd: number;
  min_capital_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  farm_expected_usd: number;
  farm_value_per_hour_usd: number;
  model: {
    peer_multiple: number;
    peer_adj_log10: number;
    odds_base: number;
    odds_age_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  conditional_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  token_odds: number;
  odds_base: number;
  odds_age_factor: number;
  capital_usd: number;
  min_capital_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  farm_expected_usd: number;
  farm_value_per_hour_usd: number;
  peer_multiple: number;
  peer_adj_log10: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One category's peer figures, for the comps table. */
export interface PeerRow {
  category: string;
  n_live: number;
  median_multiple: number;
  peer_adj_log10: number;
  token_odds: number;
  odds_n: number;
}

/** One live-token comp for a category's detail view. */
export interface CompRow {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

/** How the snapshot's 758 protocols are accounted for. */
export interface Accounting {
  total: number;
  ranked: number;
  watchlist: number;
  early: number;
  live: number;
  excluded: { reason: string; count: number }[];
}

/** Everything the dashboard needs: the board, the live set, the fit and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: {
    intercept: number;
    slope: number;
    r2: number;
    n_fit: number;
    global_median_multiple: number;
    global_odds: number;
    median_pre_age: number;
    age_curve: AgeCurve;
  };
  validation: Validation;
  accounting: Accounting;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerRow[];
  comps: Record<string, CompRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** One protocol's full scoring: the implied value, its value-at-launch part, and the launch odds. */
export function scoreProtocol(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  fit: FitParams,
  terms: TermFlags = {},
): {
  implied: number;
  conditional: number;
  odds: number;
  oddsBase: number;
  oddsMult: number;
  ageFactor: number;
  age: number | null;
  peerMultiple: number;
  peerAdj: number;
} {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const key = catKey(p);
  const peerAdj = terms.peer === false ? 0 : (fit.peer_adj[key] ?? 0);
  const peerMultiple = fit.peer_multiple[key] ?? fit.global_median_multiple;
  const tvl = Math.max(p.tvl_usd, 1);
  const line = Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl) + peerAdj);
  const base = terms.base === false ? peerMultiple * tvl : line;
  let value = base;
  // The dropped terms: off in the shipped model, switched on only by the ablation, which adds
  // each back in turn and prints what it does to the held-out error.
  if (terms.growth === true) value *= growthTerm(p.change_7d).mult;
  if (terms.maturity === true) value *= maturityTerm(age, fit.median_pre_age).mult;
  const oddsBase = fit.odds[key] ?? fit.global_odds;
  const ageFactor = ageFactorAt(fit.age_curve, age ?? fit.median_pre_age);
  const odds = Math.min(0.97, Math.max(0.01, round4(oddsBase * ageFactor)));
  // The one shipped multiplier: the plain peer odds, exactly as radar-fit-1 had them. The
  // ablation's odds_age_decay switch swaps the age-decayed odds into the factor instead, and
  // odds:false removes the factor altogether; neither is the shipped model.
  const oddsForValue = terms.odds_age_decay === true ? odds : oddsBase;
  const oddsMult = terms.odds === false ? 1 : 0.6 + 0.8 * oddsForValue;
  const conditional = Math.max(1, Math.round(value));
  const implied = Math.max(1, Math.min(100_000_000_000_000, Math.round(value * oddsMult)));
  return {
    implied,
    conditional,
    odds,
    oddsBase: round4(oddsBase),
    oddsMult: round4(oddsMult),
    ageFactor: round4(ageFactor),
    age,
    peerMultiple,
    peerAdj,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: FitParams, halfWidths: { per_cat: Record<string, number>; global: number }): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever else the board holds.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, not just the largest.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot, fit) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => {
    const h = halfWidths.per_cat[catKey(p)] ?? halfWidths.global;
    const low = Math.min(s.implied, Math.max(1, Math.round(s.implied * Math.pow(10, -h))));
    const high = Math.max(s.implied, Math.min(100_000_000_000_000, Math.round(s.implied * Math.pow(10, h))));
    const econ = farmEconomics(p, s.age, s.conditional, s.odds);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      conditional_value_usd: s.conditional,
      value_low_usd: low,
      value_high_usd: high,
      token_odds: s.odds,
      capital_usd: capitalFor(p),
      min_capital_usd: minCapitalFor(p),
      farm_cost_usd: econ.cost_usd,
      farm_hours: econ.hours,
      farm_expected_usd: econ.expected_usd,
      farm_value_per_hour_usd: econ.value_per_hour_usd,
      model: {
        peer_multiple: s.peerMultiple,
        peer_adj_log10: s.peerAdj,
        odds_base: s.oddsBase,
        odds_age_factor: s.ageFactor,
        age_days: s.age,
      },
      farm_steps: farmSteps(p, s.age).map(stepText),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The smallest position still worth farming: a fifth of the standard size, at least $10. */
export function minCapitalFor(p: SnapshotProtocol): number {
  return Math.max(10, Math.round(capitalFor(p) / 5 / 5) * 5);
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas on the protocol's main chain: Ethereum is the expensive outlier, most chains are cheap. */
function gasFor(chain: string): { setup: string; weekly: string } {
  if (chain === 'Ethereum') return { setup: 'about $8 of gas', weekly: 'about $4 of gas a week' };
  if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos' || chain === 'Near' || chain === 'Sei') {
    return { setup: 'under $0.10 of gas', weekly: 'a few cents of gas a week' };
  }
  return { setup: 'under $1 of gas', weekly: 'under $0.50 of gas a week' };
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, minCapital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const size = `$${capital} (at least $${minCapital} to count)`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${size} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide ${size} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge ${size} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${size} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit ${size} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund ${size} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${size} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit ${size} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint ${size} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy ${size} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit ${size} of USDC into ${name}'s basis vault on ${chain} and keep the receipt.`;
  return `Deposit ${size} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a farm is more than one deposit. */
function secondActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.';
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity manager')) return 'Make one swap through the pool you provide to, so the wallet shows trading activity as well as liquidity.';
  if (c.includes('bridge')) return 'Bridge a small amount back through the same route, so the wallet shows a round trip rather than a single crossing.';
  if (c.includes('staking') || c.includes('restak')) return 'Claim or restake the staking rewards once, so the wallet shows ongoing participation.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'Close the hedge and open one more small trade, so the wallet shows repeat use rather than a single deposit.';
  if (c.includes('prediction')) return 'Settle or close the first position and place a second one, so the wallet shows repeat markets.';
  return 'Use the protocol a second way, such as a swap, a vote or a second deposit, so the wallet shows more than one kind of activity.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const minCapital = minCapitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, minCapital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p),
      cost: gas.setup,
      time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: `${gas.weekly}; the $${capital} stays in the position`,
      time: `10 minutes a week for ${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, and unwind in the reverse order you entered so nothing is left staked.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Gas in dollars, the numbers behind gasFor's words: the stated bound of each phrase. */
function gasUsdFor(chain: string): { setup: number; weekly: number } {
  if (chain === 'Ethereum') return { setup: 8, weekly: 4 };
  if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos' || chain === 'Near' || chain === 'Sei') return { setup: 0.1, weekly: 0.05 };
  return { setup: 1, weekly: 0.5 };
}

/**
 * A farm plan's economics, from the plan's own steps: the out-of-pocket cost (gas only; the
 * position capital stays in the position and is not a cost), the total hours of effort, and a
 * scenario expected value. The scenario is stated, not hidden: if the token launches at the
 * row's value at launch (its conditional value, before the odds factor), FARM_REWARD_SHARE
 * of that value reaches early
 * users, split evenly among FARM_ASSUMED_WALLETS qualifying wallets; the expected value weights
 * that by the row's printed (age-decayed) launch odds — where the age curve meets a value,
 * in a stated scenario — and $/hour divides it by
 * the plan's hours. An estimate under a stated scenario, never a promise: most launches pay
 * nothing like it, and many pay nothing at all.
 */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  valueAtLaunch: number,
  odds: number,
): { cost_usd: number; hours: number; expected_usd: number; value_per_hour_usd: number; hold_days: number; weeks: number } {
  const gas = gasUsdFor(chainOf(p));
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const cost = 2 * gas.setup + weeks * gas.weekly;
  const hours = (45 + 10 * weeks) / 60;
  const expected = (odds * FARM_REWARD_SHARE * valueAtLaunch) / FARM_ASSUMED_WALLETS;
  return {
    cost_usd: round2(cost),
    hours: round2(hours),
    expected_usd: round2(expected),
    value_per_hour_usd: round2(expected / hours),
    hold_days: hold,
    weeks,
  };
}

// ---------------------------------------------------------------- the radar

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round2(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The peer table: one row per category that has live-token protocols with a market cap. */
export function peerRows(fit: FitParams): PeerRow[] {
  return Object.keys(fit.peer_n)
    .sort()
    .map((category) => ({
      category,
      n_live: fit.peer_n[category]!,
      median_multiple: fit.peer_multiple[category]!,
      peer_adj_log10: fit.peer_adj[category]!,
      token_odds: fit.odds[category] ?? fit.global_odds,
      odds_n: fit.odds_n[category] ?? 0,
    }));
}

/** The top three live-token comps per category, by market cap, for the detail view. */
export function compMap(snapshot: Snapshot): Record<string, CompRow[]> {
  const byCat: Record<string, CompRow[]> = {};
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of live) {
    const key = catKey(p);
    const slot = (byCat[key] ??= []);
    if (slot.length < 3) slot.push({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, multiple: round2(p.mcap_usd! / p.tvl_usd) });
  }
  return byCat;
}

/** Why a pre-token protocol is not on the board: the exclusion reasons, counted. */
export function accounting(snapshot: Snapshot, board: BoardRow[]): Accounting {
  const ranked = new Set(board.map((r) => r.slug));
  const live = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const reasons: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (ranked.has(p.slug) || !isPreToken(p)) continue;
    const c = (p.category ?? '').toLowerCase();
    const name = p.name.toLowerCase();
    let reason: string;
    if (p.category === 'CEX') reason = 'centralised exchange';
    else if (VERSIONED.test(p.name)) reason = 'versioned pool of another protocol';
    else if (c.includes('bridge')) reason = 'bridge product';
    else if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked btc') || name.includes('staked') || name.includes('wrapped') || name.includes('staking')) reason = 'wrapped or staked product';
    else if (p.tvl_usd >= snapshot.floor_usd) reason = 'above the floor, not on the watchlist';
    else reason = 'other pre-token protocol';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const excluded = Object.keys(reasons)
    .sort()
    .map((reason) => ({ reason, count: reasons[reason]! }));
  return {
    total: snapshot.protocols.length,
    ranked: board.length,
    watchlist: snapshot.watchlist.length,
    early: board.length - snapshot.watchlist.length,
    live,
    excluded,
  };
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    conditional_value_usd: row.conditional_value_usd,
    value_low_usd: row.value_low_usd,
    value_high_usd: row.value_high_usd,
    token_odds: row.token_odds,
    odds_base: row.model.odds_base,
    odds_age_factor: row.model.odds_age_factor,
    capital_usd: row.capital_usd,
    min_capital_usd: row.min_capital_usd,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    farm_expected_usd: row.farm_expected_usd,
    farm_value_per_hour_usd: row.farm_value_per_hour_usd,
    peer_multiple: row.model.peer_multiple,
    peer_adj_log10: row.model.peer_adj_log10,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; fit: FitParams; validation: Validation } {
  const fit = fitModel(snapshot);
  const { validation, half_widths } = validateModel(snapshot);
  const board = buildBoard(snapshot, fit, half_widths);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: {
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      r2: round4(fit.r2),
      n_fit: fit.n_fit,
      global_median_multiple: fit.global_median_multiple,
      global_odds: fit.global_odds,
      median_pre_age: fit.median_pre_age,
      age_curve: fit.age_curve,
    },
    validation,
    accounting: accounting(snapshot, board),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    peers: peerRows(fit),
    comps: compMap(snapshot),
  };
  return { board, radar, fit, validation };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
