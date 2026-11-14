// Token Radar model, version radar-2.
//
// One sealed snapshot in, one ranked board out. The board ranks protocols that
// record no token yet; protocols whose token already trades are set aside and
// shown with the market's own capitalisation, never mixed into the ranking.
//
// Implied value is derived only from the snapshot's own figures for each row:
// its TVL, its seven-day TVL change, how long it has been listed with no token
// recorded, how many chains it runs on, and its category. No protocol is ever
// special-cased by name or slug: the same function scores every row.
//
//   base      = tvl_usd * BASE_MULTIPLE
//   growth    = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) in per cent
//   growthMul = 1 + (growth / 100) * GROWTH_WEIGHT
//   maturity  = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS
//               * MATURITY_SPAN            (age unknown: UNKNOWN_AGE_DAYS)
//   breadth   = 1 + BREADTH_STEP * min(chains - 1, BREADTH_MAX), at least 1
//   category  = CATEGORY_FACTOR[category] or 1.00 when unlisted
//   implied   = max(1, round(base * growthMul * maturity * breadth * category))
//
// The constants below are the whole model. The dashboard prints them so a
// reader can re-derive any row's value from the snapshot by hand.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
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

/** The model's constants, printed in the dashboard and in data.js. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max: number;
  category_factor: Record<string, number>;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.32,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_span: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
  breadth_step: 0.03,
  breadth_max: 5,
  // A category factor is a coarse durability weight, not a verdict on any
  // single protocol: money-market and exchange venues hold value longest,
  // wrapped and bridged products hold the least because they mirror a token
  // that already trades elsewhere.
  category_factor: {
    Dexs: 1.0,
    Lending: 1.0,
    'Yield Aggregator': 0.99,
    Yield: 0.98,
    Derivatives: 0.97,
    RWA: 0.96,
    'Onchain Capital Allocator': 0.96,
    'Risk Curators': 0.95,
    'Leveraged Farming': 0.94,
    'Liquid Staking': 0.88,
    'Liquid Restaking': 0.88,
    Bridge: 0.85,
    'Canonical Bridge': 0.85,
    'Restaked BTC': 0.85,
    CEX: 0.8,
  },
};

/** The model's version label, shown in the dashboard header. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the radar adds, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the live-token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
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
  token_status: 'pre-token';
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    category_factor: number;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why a snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; categoryFactor: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_span;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max));
  const breadthMult = 1 + model.breadth_step * extraChains;
  const categoryFactor = protocol.category !== null && protocol.category in model.category_factor
    ? model.category_factor[protocol.category]!
    : 1;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult * categoryFactor));
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, breadthMult, categoryFactor, age };
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may be ranked: pre-token, not a centralised exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every watchlist slug, plus the strongest pre-token protocols below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    token_status: 'pre-token' as const,
    model: {
      base_usd: s.v.base,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      category_factor: s.v.categoryFactor,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, sized to the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger listings need a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's core farming action, in words a reader can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain}, borrow a small amount against it, then repay the borrow so both sides of the position are on record.`;
  }
  if (c.includes('dex')) {
    return `Add $${capital} of liquidity to the busiest ${name} pool on ${chain} in a tight range, and leave it earning fees instead of pulling it after a day.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Deposit $${capital} of USDC into the flagship ${name} vault on ${chain} and let it compound there rather than hopping between vaults.`;
  }
  if (c.includes('leveraged farm')) {
    return `Open a $${capital} leveraged position on ${name} on ${chain} at low leverage, and set a stop so a sharp move cannot liquidate the whole stake.`;
  }
  if (c.includes('bridge') || c.includes('canonical')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in one app on the destination chain.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the native asset through ${name} on ${chain} and keep the staking receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged trade, and close it after a few days rather than leaving it open.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} and take one small position in a market that settles within the week, so the trade resolves while you watch it.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Allocate $${capital} into a ${name} vault on ${chain} run by a curator with a published track record, and keep the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}, then use it once in the protocol's own app.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the yield-bearing asset on ${name} on ${chain} and hold it through at least one distribution cycle.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy active for the full term.`;
  }
  if (c.includes('options')) {
    return `Write or buy one small options position worth about $${capital} on ${name} on ${chain}, and let it settle instead of closing it early.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain}, use the protocol's main feature once, and keep the position open.`;
}

/** Trim a step to the gate's 20..600 characters without cutting mid-word badly. */
function fitStep(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  if (t.length > 600) t = `${t.slice(0, 597).replace(/\s+\S*$/, '')}...`;
  if (t.length < 20) t = `${t} Keep the receipt and check the protocol's own page before you move on.`;
  return t;
}

/**
 * A protocol's farm plan: six steps, each naming its action, what it costs and
 * how long it takes. Every figure comes from the protocol's own record
 * (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const name = p.name;
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 300 ? 9 : capital >= 150 ? 6 : 4;
  const steps = [
    `Set up a fresh wallet that holds only the $${capital} you plan to farm with, write its seed phrase on paper, and never paste it anywhere. Cost: nothing but the paper. Time: 10 minutes.`,
    `${action} Cost: $${capital} of capital plus about $${gas} of gas on ${chain}. Time: 20 minutes to set up.`,
    `Return once a week and do one real action on ${name} — a deposit, a swap, a vote or a claim — so the wallet shows steady use instead of a single burst. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so your activity spans more than one snapshot window and looks like a user, not a sniper. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Check ${name}'s own points or rewards page for your wallet, and claim only through a link the protocol itself publishes — never through a link from a chat or a search ad. Cost: free to check, never pay to claim. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, then decide in advance the day you will unwind the position if no token appears. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map(fitStep);
}

/** The live-token protocols, by market cap, for the dashboard's live-token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
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

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: a single global, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
