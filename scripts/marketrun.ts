/**
 * Marketplace long-run: 100 seasons of a manager who uses the HWD market.
 *
 * The manager plays the base league normally (train, draft, re-sign, fill the
 * roster) and also:
 *   - sells one surplus, listable veteran at market value each season,
 *   - buys up to two affordable listings that crack his top six,
 *   - enters the Hall of Fame league every season he can afford the fee,
 *   - fuses three maxed tier-3 players whenever he can,
 *   - converts HWD into training points at the desk, once a day.
 *
 * The report answers two questions: can the starting HWD wallet buy a star too
 * early, and does the wallet run dry once marketplace fees, the league entry and
 * its podium prizes are all accounted for?
 *
 * Run with: npm run marketrun  (SEEDS=1,2 to override)
 */
import {
  askingSalary,
  buyMarketPlayer,
  capFor,
  championOf,
  convertHwdToTrainingPoints,
  convertPointsToCash,
  createLeague,
  draftProspects,
  enterOffseason,
  fusePlayers,
  letWalk,
  makeDraftPick,
  payrollOf,
  pendingContractPlayers,
  reSignPlayer,
  rosterOf,
  sellPlayerToMarket,
  signFreeAgent,
  signedPlayers,
  simulatePlayoffs,
  simulateSeason,
  spendTrainingPoints,
  startNextSeason,
  userOnTheClock,
} from '../src/game/engine';
import {
  canListOnMarket,
  CLUB_HWD_START,
  clubHwdBalance,
  devFundBalance,
  HWD_LEAGUE_ENTRY_FEE,
  HWD_STARTING,
  HWD_TP_DAILY_CAP,
  HWD_TP_SEASON_CAP,
  hwdBalance,
  hwdTpRemaining,
  marketFee,
  marketValue,
  openListings,
} from '../src/game/market';
import {
  HOF_ENTRY_BURN,
  HOF_PRIZES,
  enterHallOfFameLeague,
  hofField,
  simulateHofGame,
} from '../src/game/hof';
import { MAX_LEVEL, MIN_SALARY_EXCEPTION, POINTS_PER_CASH_BLOCK } from '../src/game/data';
import type { GameState, HofPlacement } from '../src/game/types';

declare const process: { env: Record<string, string | undefined> };

const SEEDS = process.env.SEEDS
  ? process.env.SEEDS.split(',').map(Number)
  : [20261120, 424242];
const SEASONS = process.env.SEASONS ? Number(process.env.SEASONS) : 100;
const CHECKPOINTS = [1, 2, 3, 5, 8, 10, 25, 50, 75, 100].filter((season) => season <= SEASONS);

interface MarketPoint {
  season: number;
  hwdStart: number;
  hwdEnd: number;
  buys: number;
  spend: number;
  sells: number;
  earned: number;
  fees: number;
  fusions: number;
  hofEntry: number;
  hofPrize: number;
  hofTier: number | null;
  hofPlacement: HofPlacement | null;
  /** Development fund when the bracket opened. */
  hofFund: number;
  /** Development-fund HWD the bracket had to put in for broke rivals. */
  hofTopUp: number;
  /** What the nine rival seats were short of the fee before the top-up. */
  hofSeatGap: number;
  /** True when the fund could not cover the whole gap, so the podium scaled. */
  hofFundShort: boolean;
  /** Entry fee collected from clubs and the fund, i.e. the advertised pool. */
  hofPool: number;
  devFund: number;
  /** Development fund when the season opened, so the season's fee inflow is known. */
  devFundStart: number;
  /** HWD paid on each fusion this season. */
  fusionCosts: number[];
  /** HWD converted at the desk this season, and the TP it bought. */
  deskHwd: number;
  deskTp: number;
  bestAsk: number;
  bestOvr: number;
  topAffordable: boolean;
  starAffordable: boolean;
  bestBoughtOvr: number;
  events: string[];
  wins: number;
  payroll: number;
  cap: number;
  champion: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function marketStep(state: GameState): {
  state: GameState;
  buys: number;
  spend: number;
  sells: number;
  earned: number;
  fees: number;
  bestBoughtOvr: number;
  events: string[];
} {
  let s = state;
  const uid = s.userTeamId;
  let buys = 0;
  let spend = 0;
  let sells = 0;
  let earned = 0;
  let fees = 0;
  let bestBoughtOvr = 0;
  const events: string[] = [];

  // Sell one surplus veteran (never below nine players).
  const roster = rosterOf(s, uid).sort((a, b) => b.overall - a.overall);
  if (roster.length > 9) {
    const core = new Set(roster.slice(0, 9).map((player) => player.id));
    const listable = roster.filter(
      (player) => !core.has(player.id) && canListOnMarket(s, player.id).eligible,
    );
    const surplus = listable[listable.length - 1];
    if (surplus) {
      const ask = marketValue(surplus);
      const before = hwdBalance(s);
      const result = sellPlayerToMarket(s, surplus.id, ask);
      if (result.state) {
        s = result.state;
        sells += 1;
        earned += hwdBalance(s) - before;
        fees += marketFee(ask);
        events.push(
          `sold ${surplus.name} (${surplus.overall} OVR) for ${ask} HWD, net ${hwdBalance(s) - before}`,
        );
      }
    }
  }

  // Buy up to two listings each season if they crack the top six.
  for (let guard = 0; guard < 2; guard++) {
    const squad = rosterOf(s, uid).sort((a, b) => b.overall - a.overall);
    if (squad.length >= 13) break;
    const floor = squad[5]?.overall ?? 0;
    const wallet = hwdBalance(s);
    const cap = capFor(s);
    const payroll = payrollOf(s, uid);
    const target = openListings(s)
      .filter((listing) => {
        const player = s.players[listing.playerId];
        return (
          player &&
          listing.price <= wallet &&
          player.overall > floor &&
          payroll + player.salary <= cap
        );
      })
      .sort(
        (a, b) =>
          s.players[b.playerId].overall - s.players[a.playerId].overall ||
          a.price - b.price,
      )[0];
    if (!target) break;
    const result = buyMarketPlayer(s, target.id);
    if (!result.state) break;
    const bought = s.players[target.playerId];
    bestBoughtOvr = Math.max(bestBoughtOvr, bought.overall);
    s = result.state;
    buys += 1;
    spend += target.price;
    events.push(`bought ${bought.name} (${bought.overall} OVR) for ${target.price} HWD`);
  }

  return { state: s, buys, spend, sells, earned, fees, bestBoughtOvr, events };
}

/** Base-league offseason management, kept lean: no academy spending. */
function manageOffseason(input: GameState): {
  state: GameState;
  fused: number;
  fusionCosts: number[];
} {
  let s = spendTrainingPoints(input);
  const uid = s.userTeamId;
  let fused = 0;
  const fusionCosts: number[] = [];

  // Fuse three maxed tier-3 players whenever the roster allows it.
  const fodder = rosterOf(s, uid)
    .filter((player) => player.tier === 3 && player.level >= MAX_LEVEL)
    .sort((a, b) => a.overall - b.overall);
  if (fodder.length >= 3 && rosterOf(s, uid).length > 8) {
    const paidBefore = hwdBalance(s);
    const result = fusePlayers(
      s,
      fodder.slice(0, 3).map((player) => player.id),
    );
    if (result.state) {
      s = result.state;
      fused = 1;
      fusionCosts.push(round1(paidBefore - hwdBalance(s)));
    }
  }

  const blocks = Math.floor(s.teams[uid].trainingPoints / POINTS_PER_CASH_BLOCK);
  if (blocks > 0) s = convertPointsToCash(s, blocks);

  if (userOnTheClock(s)) {
    const prospect = draftProspects(s)[0];
    if (prospect) s = makeDraftPick(s, prospect.id);
  }

  const pending = pendingContractPlayers(s, uid);
  const budget = capFor(s) * 1.08;
  const returning = rosterOf(s, uid).filter((player) => player.years > 0);
  let payroll = returning.reduce((sum, player) => sum + player.salary, 0);
  let count = returning.length;
  const keep = new Set<string>();
  for (const player of [...pending].sort((a, b) => b.overall - a.overall)) {
    if (count < 13 && payroll + player.salary <= budget) {
      keep.add(player.id);
      payroll += player.salary;
      count += 1;
    }
  }
  for (const player of pending) {
    if (!keep.has(player.id)) s = letWalk(s, player.id);
  }
  for (const player of pending) {
    if (keep.has(player.id)) s = reSignPlayer(s, player.id);
  }

  let guard = 0;
  while (signedPlayers(s, uid).length < 8 && guard++ < 30) {
    const candidates = s.freeAgents
      .map((id) => s.players[id])
      .filter(
        (player) =>
          player &&
          askingSalary(s, player) <= MIN_SALARY_EXCEPTION * capFor(s),
      )
      .sort((a, b) => b.overall - a.overall);
    let signed = false;
    for (const freeAgent of candidates) {
      const next = signFreeAgent(s, freeAgent.id);
      if (next !== s) {
        s = next;
        signed = true;
        break;
      }
    }
    if (!signed) break;
  }
  return { state: s, fused, fusionCosts };
}

/** Pay the 25 HWD entry whenever the manager can afford it and has a legal roster. */
function hofStep(state: GameState): {
  state: GameState;
  entry: number;
  prize: number;
  tier: number | null;
  placement: HofPlacement | null;
  fund: number;
  topUp: number;
  seatGap: number;
  fundShort: boolean;
  pool: number;
} {
  const skip = {
    entry: 0,
    prize: 0,
    tier: null,
    placement: null,
    fund: devFundBalance(state),
    topUp: 0,
    seatGap: 0,
    fundShort: false,
    pool: 0,
  };
  if (hwdBalance(state) < HWD_LEAGUE_ENTRY_FEE) return { state, ...skip };
  if (rosterOf(state, state.userTeamId).length < 8) return { state, ...skip };

  // What the draw asks of the fund, measured before the entry charges anyone.
  const fund = devFundBalance(state);
  const seatGap = hofField(state)
    .filter((id) => id !== state.userTeamId)
    .reduce(
      (sum, id) =>
        sum + Math.max(0, HWD_LEAGUE_ENTRY_FEE - clubHwdBalance(state, id)),
      0,
    );

  const result = enterHallOfFameLeague(state);
  if (!result.state) return { state, ...skip };
  let next = result.state;
  const topUp = round1(fund - devFundBalance(next));
  const pool = next.hof!.prizePool ?? 0;
  let guard = 0;
  while (!next.hof!.champion && guard++ < 200) {
    const step = simulateHofGame(next);
    if (!step.state) break;
    next = step.state;
  }
  const league = next.hof!;
  return {
    state: next,
    entry: HWD_LEAGUE_ENTRY_FEE,
    prize: league.prize,
    tier: league.rewardTier,
    placement: league.userPlacement,
    fund,
    topUp,
    seatGap,
    fundShort: fund < seatGap,
    pool,
  };
}

/**
 * Desk policy: sell HWD back at the cap, one day's worth at a time. With a
 * 5 HWD daily cap and a 20 HWD season cap a season takes four trades, so the
 * sim dates each one a day apart and reports the TP those tokens bought.
 */
function deskStep(
  state: GameState,
  day: (index: number) => Date,
): { state: GameState; hwd: number; tp: number } {
  let s = state;
  let hwd = 0;
  let tp = 0;
  for (let index = 0; index < HWD_TP_SEASON_CAP / HWD_TP_DAILY_CAP; index++) {
    const amount = Math.min(HWD_TP_DAILY_CAP, hwdTpRemaining(s), hwdBalance(s));
    if (amount < 1) break;
    const beforeHwd = hwdBalance(s);
    const beforeTp = s.teams[s.userTeamId].trainingPoints;
    const result = convertHwdToTrainingPoints(s, amount, day(index));
    if (!result.state) break;
    s = result.state;
    hwd += beforeHwd - hwdBalance(s);
    tp += s.teams[s.userTeamId].trainingPoints - beforeTp;
  }
  return { state: s, hwd, tp };
}

function run(seed: number): { points: MarketPoint[]; finalState: GameState; fusions: number } {
  let state = createLeague('NYS', seed);
  const points: MarketPoint[] = [];
  let fusions = 0;

  for (let season = 1; season <= SEASONS; season++) {
    if (season % 25 === 0) console.error(`  seed ${seed}: season ${season}`);
    const uid = state.userTeamId;
    const hwdStart = hwdBalance(state);
    const devFundStart = devFundBalance(state);
    const listings = openListings(state);
    const best = listings[0];
    const bestAsk = best ? best.price : 0;
    const bestOvr = best ? state.players[best.playerId].overall : 0;
    const starAffordable = listings.some((listing) => {
      const player = state.players[listing.playerId];
      return (
        player &&
        player.overall >= 85 &&
        listing.price <= hwdBalance(state) &&
        payrollOf(state, uid) + player.salary <= capFor(state)
      );
    });

    const market = marketStep(state);
    state = market.state;

    state = simulateSeason(state);
    state = simulatePlayoffs(state);
    const champion = championOf(state) ?? '';

    const hof = hofStep(state);
    state = hof.state;

    const desk = deskStep(state, (index) => new Date(2030, 0, 1 + season * 10 + index));
    state = desk.state;

    state = enterOffseason(state);
    const managed = manageOffseason(state);
    state = managed.state;
    fusions += managed.fused;

    points.push({
      season,
      hwdStart,
      hwdEnd: hwdBalance(state),
      buys: market.buys,
      spend: market.spend,
      sells: market.sells,
      earned: market.earned,
      fees: market.fees,
      fusions: managed.fused,
      hofEntry: hof.entry,
      hofPrize: hof.prize,
      hofTier: hof.tier,
      hofPlacement: hof.placement,
      hofFund: hof.fund,
      hofTopUp: hof.topUp,
      hofSeatGap: hof.seatGap,
      hofFundShort: hof.fundShort,
      hofPool: hof.pool,
      devFund: devFundBalance(state),
      devFundStart,
      fusionCosts: managed.fusionCosts,
      deskHwd: desk.hwd,
      deskTp: desk.tp,
      bestAsk,
      bestOvr,
      topAffordable: bestAsk > 0 && hwdStart >= bestAsk,
      starAffordable,
      bestBoughtOvr: market.bestBoughtOvr,
      events: market.events,
      wins: state.teams[uid].wins,
      payroll: round1(payrollOf(state, uid)),
      cap: capFor(state),
      champion,
    });

    if (season < SEASONS) {
      const next = startNextSeason(state);
      if (next === state) {
        throw new Error(`season ${season} stalled for seed ${seed}`);
      }
      state = next;
    }
  }
  return { points, finalState: state, fusions };
}

const runs = SEEDS.map((seed) => ({ seed, ...run(seed) }));
const fmt = (value: number, digits = 1) => value.toFixed(digits).padStart(7);
const pad = (text: string, width: number) => text.padEnd(width);

console.log(`\nHWD marketplace — ${SEEDS.length} leagues × ${SEASONS} seasons\n`);

console.log(
  `${pad('season', 8)}${pad('bestOVR', 9)}${pad('ask', 6)}${pad('afford', 8)}${pad('hwd', 8)}${pad('buys', 6)}${pad('spend', 7)}${pad('sells', 7)}${pad('earned', 8)}${pad('fee', 6)}${pad('fuse', 6)}`,
);
for (const checkpoint of CHECKPOINTS) {
  const rows = runs.map((entry) => entry.points[checkpoint - 1]);
  console.log(
    `${pad(String(checkpoint), 8)}${fmt(mean(rows.map((r) => r.bestOvr)), 0)}${fmt(mean(rows.map((r) => r.bestAsk)), 0)}${fmt(mean(rows.map((r) => (r.topAffordable ? 1 : 0))) * 100, 0)}%${fmt(mean(rows.map((r) => r.hwdEnd)), 0)}${fmt(mean(rows.map((r) => r.buys)), 1)}${fmt(mean(rows.map((r) => r.spend)), 1)}${fmt(mean(rows.map((r) => r.sells)), 1)}${fmt(mean(rows.map((r) => r.earned)), 1)}${fmt(mean(rows.map((r) => r.fees)), 1)}${fmt(mean(rows.map((r) => r.fusions)), 1)}`,
  );
}

const all = runs.flatMap((entry) => entry.points);
const firstBuys = runs.map((entry) => entry.points.find((point) => point.buys > 0));

console.log('\nOpening market (season 1)');
const opening = runs.map((entry) => entry.points[0]);
console.log(
  runs
    .map(
      (entry, index) =>
        `seed ${entry.seed}: best listing ${opening[index].bestOvr} OVR for ${opening[index].bestAsk} HWD (${opening[index].topAffordable ? 'affordable' : 'out of reach'} on the starting wallet)`,
    )
    .join('\n'),
);

console.log('\nHWD economy');
console.log(
  `starting balance ${runs.map((entry) => entry.points[0].hwdStart).join(', ')} HWD`,
);
console.log(
  `first purchase: ${firstBuys.map((point) => (point ? `season ${point.season}, ${point.bestBoughtOvr} OVR at ${point.spend} HWD` : 'none in 100 seasons')).join(' | ')}`,
);
console.log(
  `best player bought: ${runs.map((entry) => Math.max(0, ...entry.points.map((r) => r.bestBoughtOvr))).join(', ')} OVR; fusions: ${runs.map((entry) => entry.fusions).join(', ')}`,
);
console.log(
  `total HWD earned from sales: ${runs.map((entry) => entry.points.reduce((sum, r) => sum + r.earned, 0)).join(', ')}; spent: ${runs.map((entry) => entry.points.reduce((sum, r) => sum + r.spend, 0)).join(', ')}; fees: ${runs.map((entry) => entry.points.reduce((sum, r) => sum + r.fees, 0)).join(', ')}`,
);
console.log(
  `seasons at 0 HWD: ${runs.map((entry) => `${entry.points.filter((r) => r.hwdEnd <= 0).length}/${entry.points.length}`).join(', ')}; seasons that could afford the best listing: ${runs.map((entry) => `${entry.points.filter((r) => r.topAffordable).length}/${entry.points.length}`).join(', ')}`,
);

console.log('\nHWD → TP desk (100 TP per HWD, 5 HWD a day, 20 HWD a season)');
for (const entry of runs) {
  const points = entry.points;
  const converted = points.reduce((sum, point) => sum + point.deskHwd, 0);
  const bought = points.reduce((sum, point) => sum + point.deskTp, 0);
  const full = points.filter((point) => point.deskHwd >= HWD_TP_SEASON_CAP).length;
  const partial = points.filter(
    (point) => point.deskHwd > 0 && point.deskHwd < HWD_TP_SEASON_CAP,
  ).length;
  console.log(
    `seed ${entry.seed}: ${converted} HWD converted over ${points.length} seasons → ${bought} TP ` +
      `(${round1(converted / points.length)} HWD and ${round1(bought / points.length)} TP a season); ` +
      `${full} seasons at the full cap, ${partial} partial; wallet ends at ${hwdBalance(entry.finalState)} HWD`,
  );
}
console.log(`${pad('decade', 10)}${pad('deskHWD', 9)}${pad('deskTP', 9)}${pad('hwdEnd', 8)}${pad('bestOVR', 9)}`);
for (let start = 1; start <= SEASONS; start += 10) {
  const slice = all.filter((r) => r.season >= start && r.season < start + 10);
  console.log(
    `${pad(`${start}–${Math.min(SEASONS, start + 9)}`, 10)}${fmt(mean(slice.map((r) => r.deskHwd)), 1)}${fmt(mean(slice.map((r) => r.deskTp)), 1)}${fmt(mean(slice.map((r) => r.hwdEnd)), 0)}${fmt(mean(slice.map((r) => r.bestBoughtOvr)), 0)}`,
  );
}

console.log('\nHall of Fame league');
const advertisedPrize = (point: MarketPoint) => {
  const placement = point.hofPlacement;
  return placement && placement !== 'out' ? HOF_PRIZES[placement] : 0;
};
for (const entry of runs) {
  const entered = entry.points.filter((point) => point.hofEntry > 0);
  const paid = entered.length * HWD_LEAGUE_ENTRY_FEE;
  const back = entered.reduce((sum, point) => sum + point.hofPrize, 0);
  const missed = entry.points.length - entered.length;
  const tiers = [0, 1, 2].map(
    (tier) => entered.filter((point) => point.hofTier === tier).length,
  );
  console.log(
    `seed ${entry.seed}: entered ${entered.length}/${entry.points.length} (missed ${missed} for lack of HWD), paid ${paid} HWD, won back ${back} HWD, burned ${entered.length * HOF_ENTRY_BURN} HWD`,
  );
  console.log(
    `  champion drops: Hall of Fame ${tiers[0]}, tier 1 ${tiers[1]}, tier 2 ${tiers[2]}; wins ${entered.filter((point) => point.hofPrize === HOF_PRIZES.champion).length}, runners-up ${entered.filter((point) => point.hofPrize === HOF_PRIZES['runner-up']).length}, thirds ${entered.filter((point) => point.hofPrize === HOF_PRIZES.third).length}`,
  );
  const topped = entered.filter((point) => point.hofTopUp > 0);
  const fundShort = entered.filter((point) => point.hofFundShort);
  const scaled = entered.filter(
    (point) => advertisedPrize(point) > 0 && point.hofPrize < advertisedPrize(point),
  );
  const topUps = topped.map((point) => point.hofTopUp);
  const shortfallPaid = scaled.reduce(
    (sum, point) => sum + advertisedPrize(point) - point.hofPrize,
    0,
  );
  console.log(
    `  seat top-ups: ${topped.length}/${entered.length} brackets needed one (total ${round1(
      topUps.reduce((sum, value) => sum + value, 0),
    )} HWD, mean ${topUps.length ? round1(mean(topUps)) : 0}, max ${
      topUps.length ? round1(Math.max(...topUps)) : 0
    } of 225 possible); fund short in ${fundShort.length}; prizes scaled in ${scaled.length} (${round1(
      shortfallPaid,
    )} HWD unpaid to the podium)`,
  );
  console.log(
    `  development fund: ${entered.length ? `min at entry ${round1(Math.min(...entered.map((point) => point.hofFund)))}` : 'n/a'}, final ${devFundBalance(entry.finalState)} HWD; seasons at 0: ${entry.points.filter((point) => point.devFund <= 0).length}/${entry.points.length}; mean pool ${round1(mean(entered.map((point) => point.hofPool)))} HWD`,
  );
}
const everyEntry = runs.flatMap((entry) => entry.points.filter((point) => point.hofEntry > 0));
console.log(
  `all seeds: ${everyEntry.filter((point) => point.hofFundShort).length}/${everyEntry.length} brackets could not be fully topped up; ${everyEntry.filter((point) => point.hofPool < 225).length} brackets paid a scaled pool`,
);
console.log(
  `net league effect (prizes − entry): ${runs.map((entry) => entry.points.reduce((sum, r) => sum + r.hofPrize - r.hofEntry, 0)).join(', ')} HWD`,
);

const firstStar = runs.map((entry) => {
  const hit = entry.points.find((point) => point.starAffordable);
  return hit ? `season ${hit.season}` : 'never';
});
console.log(
  `first season a 90+ OVR was both affordable in HWD and under the cap: ${firstStar.join(', ')}`,
);

console.log('\nMarketplace moves');
for (const entry of runs) {
  const moves = entry.points.flatMap((point) =>
    point.events.map((event) => `S${point.season} ${event}`),
  );
  console.log(`seed ${entry.seed}: ${moves.length ? moves.join('; ') : 'no moves'}`);
}

console.log('\nOpening cap check (season 1: cheapest salary way onto the roster)');
for (const entry of runs) {
  const point = entry.points[0];
  console.log(
    `seed ${entry.seed}: best listing ${point.bestOvr} OVR at ${point.bestAsk} HWD, wallet ${point.hwdStart} HWD`,
  );
}

/* ------------------------------------------------------------------ */
/* Proposed HWD sinks, measured on the baseline path                   */
/* ------------------------------------------------------------------ */

/**
 * Modelled locker policy: while no lock is active, lock the largest tier the
 * wallet can carry without eating the entry fee and a buying reserve. A lock
 * runs five seasons, then a one-season cooldown before the next one.
 */
const LOCK_TIERS = [
  { lock: 25, discount: 0.1 },
  { lock: 75, discount: 0.3 },
  { lock: 200, discount: 0.6 },
];
const LOCK_SEASONS = 5;
const LOCK_RESERVE = 40;

function modelLocker(points: MarketPoint[]) {
  let lock: { until: number; amount: number; discount: number } | null = null;
  let cooldownUntil = 0;
  let feesKept = 0;
  let peak = 0;
  let lockedSeasons = 0;
  const locked: number[] = [];
  const kept: number[] = [];
  for (const point of points) {
    if (lock && point.season > lock.until) {
      cooldownUntil = lock.until + 1;
      lock = null;
    }
    if (!lock && point.season > cooldownUntil) {
      for (const tier of LOCK_TIERS) {
        if (point.hwdStart >= tier.lock + LOCK_RESERVE) {
          lock = {
            until: point.season + LOCK_SEASONS - 1,
            amount: tier.lock,
            discount: tier.discount,
          };
        }
      }
    }
    const amount = lock ? lock.amount : 0;
    const saved = lock ? point.fees * lock.discount : 0;
    locked.push(amount);
    kept.push(saved);
    peak = Math.max(peak, amount);
    if (lock) {
      lockedSeasons += 1;
      feesKept += saved;
    }
  }
  return { meanLocked: mean(locked), peak, lockedSeasons, feesKept, kept };
}

/**
 * Modelled forge fee: every fusion costs 25% more than the previous one on the
 * account, and half of the fee is burned instead of reaching the fund.
 */
function modelForge(points: MarketPoint[]) {
  let forged = 0;
  let paidToday = 0;
  let escalated = 0;
  const burned: number[] = [];
  const fundDelta: number[] = [];
  for (const point of points) {
    let seasonBurned = 0;
    let seasonFund = 0;
    for (const cost of point.fusionCosts) {
      const fee = round1(cost * (1 + 0.25 * forged));
      paidToday += cost;
      escalated += fee;
      seasonBurned += fee / 2;
      // The baseline sent the whole fee to the fund; the proposal sends half
      // of the (larger) fee and burns the rest.
      seasonFund += fee / 2 - cost;
      forged += 1;
    }
    burned.push(seasonBurned);
    fundDelta.push(seasonFund);
  }
  return {
    forged,
    paidToday,
    escalated,
    burned: escalated / 2,
    burnedBySeason: burned,
    fundDelta,
  };
}

/** Burn a share of the development fund each offseason, replayed on its inflow. */
function modelAudit(points: MarketPoint[], inflowDelta: number[] = [], rate = 0.1) {
  let fund = points.length ? points[0].devFundStart : 0;
  let burned = 0;
  let minFund = fund;
  for (const point of points) {
    const inflow =
      Math.max(0, point.devFund - point.devFundStart) +
      (inflowDelta[point.season - 1] ?? 0);
    fund += Math.max(0, inflow);
    const burn = fund * rate;
    fund -= burn;
    burned += burn;
    minFund = Math.min(minFund, fund);
  }
  return { burned, finalFund: fund, minFund };
}

console.log('\nProposed HWD sinks (modelled on this baseline path, 100 seasons)');
const supply =
  HWD_STARTING + (Object.keys(runs[0].finalState.teams).length - 1) * CLUB_HWD_START;
console.log(`fixed HWD supply: ${supply} (starting wallet + rival floats, no faucet)`);
for (const entry of runs) {
  const points = entry.points;
  const locker = modelLocker(points);
  const forge = modelForge(points);
  const audit = modelAudit(points);
  const combined = modelAudit(
    points,
    points.map((_point, index) => forge.fundDelta[index] - locker.kept[index]),
  );
  const destroyed = forge.burned + combined.burned;
  const baselineFund = points[points.length - 1].devFund;
  console.log(
    `\nseed ${entry.seed}` +
      `\n  forge fee + 50% burn : ${forge.forged} fusions, ${round1(forge.paidToday)} HWD paid today, ` +
      `${round1(forge.escalated)} with the per-account rise, ${round1(forge.burned)} burned ` +
      `(${((forge.burned / supply) * 100).toFixed(3)}% of supply)`,
  );
  console.log(
    `  dev-fund audit (10%)  : ${round1(audit.burned)} HWD burned, fund ends at ` +
      `${round1(audit.finalFund)} instead of ${round1(baselineFund)} ` +
      `(${round1(audit.burned / points.length)} per season)`,
  );
  console.log(
    `  HWD locker            : ${round1(locker.meanLocked)} HWD locked on average, peak ` +
      `${locker.peak}, ${locker.lockedSeasons}/${points.length} seasons locked, ` +
      `${round1(locker.feesKept)} HWD of seller fees kept`,
  );
  console.log(
    `  all three             : ${round1(destroyed)} HWD destroyed ` +
      `(${((destroyed / supply) * 100).toFixed(3)}% of supply), ` +
      `${round1(locker.meanLocked)} HWD locked on average, fund ends at ${round1(combined.finalFund)}`,
  );
}
console.log(
  '  note: the locker holds supply out of circulation for its term without destroying it; only the burn rows are permanent.',
);

console.log('\nBalance by decade (mean HWD, buys, sales income)');
console.log(`${pad('decade', 10)}${pad('hwd', 8)}${pad('buys', 7)}${pad('income', 8)}${pad('fee', 7)}${pad('bestOVR', 9)}`);
for (let start = 1; start <= SEASONS; start += 10) {
  const slice = all.filter((r) => r.season >= start && r.season < start + 10);
  console.log(
    `${pad(`${start}–${Math.min(SEASONS, start + 9)}`, 10)}${fmt(mean(slice.map((r) => r.hwdEnd)), 0)}${fmt(mean(slice.map((r) => r.buys)), 1)}${fmt(mean(slice.map((r) => r.earned)), 1)}${fmt(mean(slice.map((r) => r.fees)), 1)}${fmt(mean(slice.map((r) => r.bestBoughtOvr)), 0)}`,
  );
}
