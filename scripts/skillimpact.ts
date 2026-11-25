/**
 * A/B test for cash skill purchases.
 *
 * Two arms start from identical leagues (same seed) and train their rosters
 * identically for six seasons:
 *   control  — never buys a skill level
 *   academy  — spends available cash on the best value-per-dollar skill levels
 *
 * Because the two leagues diverge once results differ, the long-run arms are
 * reported with standard errors. Two deterministic checks pin down the effect:
 *   shadow    — every academy season is also replayed from the pre-purchase
 *               state with the same RNG, so the only difference is the levels
 *   ceiling   — the whole rotation maxed through the real buySkillLevel path
 *
 * Run with: npm run skillimpact
 */
import {
  buySkillLevel,
  capFor,
  championOf,
  createLeague,
  draftProspects,
  enterOffseason,
  letWalk,
  makeDraftPick,
  payrollOf,
  pendingContractPlayers,
  reSignPlayer,
  rosterOf,
  salaryDemand,
  signFreeAgent,
  simulatePlayoffs,
  simulateSeason,
  skillOffer,
  startNextSeason,
  trainPlayer,
  userOnTheClock,
} from '../src/game/engine';
import { CAP, CAP_GROWTH, MAX_LEVEL, SKILL_KEYS } from '../src/game/data';
import type { AttrKey, GameState } from '../src/game/types';

const SEEDS = [
  20261120, 424242, 777, 123456, 909090, 515151, 818181, 313131,
  2020, 99, 616161, 525252, 717171, 838383, 939393, 20261121,
];
const SEASONS = 6;
/** Kept on hand for in-season signings; not spent on skills. */
const SKILL_RESERVE = 2;

/**
 * How much each attribute lifts a team's simulated profile. Mirrors
 * teamProfile() in engine.ts: offense is 34% inside, 40% outside and 26%
 * playmaking; defense is 68% defense and 32% rebounding. Athleticism only
 * moves overall, so it is the last thing an optimizer buys.
 */
const ATTR_VALUE: Record<AttrKey, number> = {
  defense: 0.62,
  outside: 0.36,
  inside: 0.3,
  rebounding: 0.3,
  playmaking: 0.24,
  athleticism: 0.09,
};

interface SeasonRow {
  season: number;
  wins: number;
  losses: number;
  margin: number;
  ppg: number;
  oppPpg: number;
  topPpg: number;
  demand: number;
  payroll: number;
  cash: number;
  levels: number;
  spend: number;
  champion: boolean;
  playoffs: boolean;
  cashStart: number;
  cashEnd: number;
  prize: number;
  tax: number;
  bonus: number;
  tpEarned: number;
  tpSpent: number;
}

interface PurchaseResult {
  state: GameState;
  levels: number;
  spend: number;
  overallGain: number;
  demandGain: number;
}

interface ArmTotals {
  rows: SeasonRow[];
  shadows: { wins: number; margin: number; ppg: number; topPpg: number }[];
  spend: number;
  levels: number;
  overallGain: number;
  demandGain: number;
  titles: number;
  playoffTrips: number;
  finalOveralls: number[];
  league: { overCap: number; avgPayroll: number; maxPayroll: number; cap: number };
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sd = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1),
  );
};
const stderr = (values: number[]) => sd(values) / Math.sqrt(Math.max(1, values.length));

/** Buy the best value-per-dollar skill level until the cash runs out. */
function spendOnSkills(state: GameState): PurchaseResult {
  let s = state;
  let levels = 0;
  let overallGain = 0;
  let demandGain = 0;
  const uid = s.userTeamId;
  const startCash = s.teams[uid].cash;
  // Only the nine players who get minutes can change a result.
  const rotation = rosterOf(s, uid)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9);

  for (let guard = 0; guard < 200; guard++) {
    let best: { id: string; key: AttrKey; rate: number } | null = null;
    for (const player of rotation) {
      for (const key of SKILL_KEYS) {
        const live = s.players[player.id];
        const offer = skillOffer(s, live, key);
        if (offer.cost === null) continue;
        if (s.teams[uid].cash - offer.cost < SKILL_RESERVE) continue;
        const rate = ATTR_VALUE[key] / offer.cost;
        if (!best || rate > best.rate) best = { id: player.id, key, rate };
      }
    }
    if (!best) break;

    const before = s.players[best.id];
    const beforeOverall = before.overall;
    const beforeDemand = salaryDemand(before);
    const result = buySkillLevel(s, best.id, best.key);
    if (!result.state) break;
    s = result.state;
    levels += 1;
    overallGain += s.players[best.id].overall - beforeOverall;
    demandGain += salaryDemand(s.players[best.id]) - beforeDemand;
  }

  return { state: s, levels, spend: round1(startCash - s.teams[uid].cash), overallGain, demandGain };
}

/**
 * Spend training points the way the CPU does: best player first. Promotion is
 * fusion-only for players, so both arms train identically and the only
 * difference is cash spending on skills.
 */
function trainRoster(input: GameState): GameState {
  let s = input;
  const uid = s.userTeamId;
  for (let guard = 0; guard < 500; guard++) {
    const roster = rosterOf(s, uid);
    const trainee = roster
      .filter((player) => player.level < MAX_LEVEL)
      .sort((a, b) => b.overall - a.overall)[0];
    if (trainee) {
      const next = trainPlayer(s, trainee.id);
      if (next !== s) {
        s = next;
        continue;
      }
    }
    return s;
  }
  return s;
}

/**
 * Paper over roster holes exactly like a careful player would. `capAware`
 * models a manager who lets the priciest expiring deals walk instead of
 * carrying a payroll far above the cap.
 */
function manageOffseason(state: GameState, capAware: boolean): GameState {
  let s = trainRoster(state);
  const uid = s.userTeamId;

  if (userOnTheClock(s)) {
    const prospect = draftProspects(s)[0];
    if (prospect) s = makeDraftPick(s, prospect.id);
  }
  const pending = pendingContractPlayers(s, uid).sort((a, b) => b.salary - a.salary);
  for (const player of pending) {
    const over = payrollOf(s, uid) - capFor(s);
    if (capAware && over > 4 && rosterOf(s, uid).length > 8) {
      s = letWalk(s, player.id);
    } else {
      s = reSignPlayer(s, player.id);
    }
  }

  let guard = 0;
  while (rosterOf(s, uid).length < 8 && guard++ < 25) {
    const candidates = s.freeAgents
      .map((id) => s.players[id])
      .filter((player) => player && player.salary <= 60)
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
  return s;
}

function regularRow(state: GameState, levels = 0, spend = 0): SeasonRow {
  const uid = state.userTeamId;
  const team = state.teams[uid];
  const roster = rosterOf(state, uid);
  const games = Math.max(1, team.wins + team.losses);
  return {
    season: state.season,
    wins: team.wins,
    losses: team.losses,
    margin: round1(team.ptsFor - team.ptsAgainst),
    ppg: round1(team.ptsFor / games),
    oppPpg: round1(team.ptsAgainst / games),
    topPpg: round1(Math.max(0, ...roster.map((p) => (p.stats.gp ? p.stats.pts / p.stats.gp : 0)))),
    demand: 0,
    payroll: payrollOf(state, uid),
    cash: round1(team.cash),
    levels,
    spend,
    champion: false,
    playoffs: false,
    cashStart: 0,
    cashEnd: 0,
    prize: 0,
    tax: 0,
    bonus: 0,
    tpEarned: 0,
    tpSpent: 0,
  };
}

/** Play one season, then (optionally) run the offseason and open the next. */
function playSeason(
  input: GameState,
  academy: boolean,
  advance: boolean,
  capAware = false,
): {
  state: GameState;
  row: SeasonRow;
  shadow: ArmTotals['shadows'][number] | null;
  overallGain: number;
  demandGain: number;
} {
  let state = input;
  let levels = 0;
  let spend = 0;
  let overallGain = 0;
  let demandGain = 0;
  const preBuy = state;

  if (academy) {
    const purchase = spendOnSkills(state);
    state = purchase.state;
    levels = purchase.levels;
    spend = purchase.spend;
    overallGain = purchase.overallGain;
    demandGain = purchase.demandGain;
  }

  const uid = state.userTeamId;
  const payroll = payrollOf(state, uid);
  const cashStart = round1(state.teams[uid].cash);
  const tpStart = state.teams[uid].trainingPoints;
  state = simulateSeason(state);

  // Same league, same RNG, no purchases: the clean on-court effect.
  const shadow = academy ? regularRow(simulateSeason(preBuy)) : null;
  const bought = regularRow(state, levels, spend);
  const row: SeasonRow = { ...bought, payroll };
  row.cashStart = cashStart;

  state = simulatePlayoffs(state);
  const championId = championOf(state);
  row.champion = championId === uid;
  row.playoffs = state.playoffs.some((series) => series.high === uid || series.low === uid);
  row.prize = round1(state.teams[uid].cash - cashStart);
  row.tpEarned = state.teams[uid].trainingPoints - tpStart;

  // Asking prices use the final stats, so capture them before the offseason
  // resets the stat line and re-prices expiring deals.
  const topSix = rosterOf(state, uid)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 6);
  row.demand = round1(mean(topSix.map(salaryDemand)));

  const cashBeforeOffseason = state.teams[uid].cash;
  state = enterOffseason(state);
  row.tax = round1(cashBeforeOffseason - state.teams[uid].cash);
  const cashBeforeManage = state.teams[uid].cash;
  const tpBeforeManage = state.teams[uid].trainingPoints;
  state = manageOffseason(state, capAware);
  row.bonus = round1(cashBeforeManage - state.teams[uid].cash);
  row.tpSpent = tpBeforeManage - state.teams[uid].trainingPoints;
  row.cashEnd = round1(state.teams[uid].cash);
  if (advance) state = startNextSeason(state);

  return {
    state,
    row,
    overallGain,
    demandGain,
    shadow: shadow
      ? {
          wins: bought.wins - shadow.wins,
          // Per-game point differential, so it lines up with the ceiling check.
          margin: round1(bought.ppg - bought.oppPpg - (shadow.ppg - shadow.oppPpg)),
          ppg: bought.ppg - shadow.ppg,
          topPpg: bought.topPpg - shadow.topPpg,
        }
      : null,
  };
}

function runArm(seed: number, academy: boolean, capAware = false): ArmTotals {
  let state = createLeague('NYS', seed);
  const rows: SeasonRow[] = [];
  const shadows: ArmTotals['shadows'] = [];
  let spend = 0;
  let levels = 0;
  let overallGain = 0;
  let demandGain = 0;
  let titles = 0;
  let playoffTrips = 0;

  for (let season = 1; season <= SEASONS; season++) {
    const result = playSeason(state, academy, season < SEASONS, capAware);
    state = result.state;
    rows.push(result.row);
    if (result.shadow) shadows.push(result.shadow);
    spend += result.row.spend;
    levels += result.row.levels;
    overallGain += result.overallGain;
    demandGain += result.demandGain;
    titles += result.row.champion ? 1 : 0;
    playoffTrips += result.row.playoffs ? 1 : 0;
  }
  return {
    rows,
    shadows,
    spend,
    levels,
    overallGain,
    demandGain,
    titles,
    playoffTrips,
    finalOveralls: rosterOf(state, state.userTeamId).map((p) => p.overall),
    league: (() => {
      const payrolls = Object.values(state.teams).map((team) => payrollOf(state, team.id));
      const cap = capFor(state);
      return {
        overCap: payrolls.filter((payroll) => payroll > cap + 1e-9).length,
        avgPayroll: round1(mean(payrolls)),
        maxPayroll: round1(Math.max(...payrolls)),
        cap,
      };
    })(),
  };
}

/** Grant every rotation player the levels a maxed-out academy allows. */
function maxOutAcademy(input: GameState): GameState {
  let s = input;
  const uid = s.userTeamId;
  s.teams[uid].cash = 9999;
  s.facilities = { ...(s.facilities ?? {}), development: 3 };
  const rotation = rosterOf(s, uid)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9);

  for (let guard = 0; guard < 500; guard++) {
    let best: { id: string; key: AttrKey; value: number } | null = null;
    for (const player of rotation) {
      for (const key of SKILL_KEYS) {
        const offer = skillOffer(s, s.players[player.id], key);
        if (offer.cost === null) continue;
        const value = ATTR_VALUE[key];
        if (!best || value > best.value) best = { id: player.id, key, value };
      }
    }
    if (!best) break;
    const result = buySkillLevel(s, best.id, best.key);
    if (!result.state) break;
    s = result.state;
  }
  return s;
}

/** Same league, same RNG: only the academy levels differ. */
function ceilingCheck(seed: number): {
  margin: number;
  wins: number;
  ppg: number;
  levels: number;
  overall: number;
} | null {
  let state = createLeague('NYS', seed);
  for (let season = 1; season <= 2; season++) {
    state = playSeason(state, false, true).state;
  }
  const boosted = maxOutAcademy(state);
  const before = simulateSeason(state);
  const after = simulateSeason(boosted);
  const uid = state.userTeamId;
  const margin = (team: GameState) => {
    const t = team.teams[uid];
    return (t.ptsFor - t.ptsAgainst) / Math.max(1, t.wins + t.losses);
  };
  const ppg = (team: GameState) => {
    const t = team.teams[uid];
    return t.ptsFor / Math.max(1, t.wins + t.losses);
  };
  const levels = rosterOf(boosted, uid).reduce(
    (sum, player) => sum + Object.values(player.skillLevels ?? {}).reduce((a, b) => a + b, 0),
    0,
  );
  if (!levels) return null;
  const overall = mean(rosterOf(boosted, uid).map((p) => p.overall)) -
    mean(rosterOf(state, uid).map((p) => p.overall));
  return {
    margin: round1(margin(after) - margin(before)),
    wins: after.teams[uid].wins - before.teams[uid].wins,
    ppg: round1(ppg(after) - ppg(before)),
    levels,
    overall: Math.round(overall * 10) / 10,
  };
}

const controls = SEEDS.map((seed) => runArm(seed, false));
const academies = SEEDS.map((seed) => runArm(seed, true));
const fmt = (value: number, digits = 1) => value.toFixed(digits).padStart(8);
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
const pad = (text: string, width: number) => text.padEnd(width);

const totalsAcrossSeeds = (arm: ArmTotals) => ({
  levels: arm.levels,
  spend: arm.spend,
  titles: arm.titles,
  trips: arm.playoffTrips,
});

console.log(`\nSkill Academy impact — ${SEEDS.length} seeds × ${SEASONS} seasons\n`);

const controlsTotal = controls.map(totalsAcrossSeeds);
const academiesTotal = academies.map(totalsAcrossSeeds);
const totalLevels = academiesTotal.reduce((sum, arm) => sum + arm.levels, 0);
const totalSpend = academiesTotal.reduce((sum, arm) => sum + arm.spend, 0);
console.log('Long-run arms (identical training, academy arm also buys levels)');
console.log(`${pad('metric', 24)}${pad('control', 8)}${pad('academy', 8)}${pad('Δ', 8)}${pad('SE(Δ)', 8)}`);
const sixSeason = (arm: ArmTotals) => ({
  wins: mean(arm.rows.map((r) => r.wins)),
  margin: mean(arm.rows.map((r) => r.margin)),
  topPpg: mean(arm.rows.map((r) => r.topPpg)),
  demand: mean(arm.rows.map((r) => r.demand)),
  payroll: mean(arm.rows.map((r) => r.payroll)),
});
const ctlSix = controls.map(sixSeason);
const acadSix = academies.map(sixSeason);
const metricLine = (
  label: string,
  controlKey: keyof ReturnType<typeof sixSeason>,
  academyKey: keyof ReturnType<typeof sixSeason> = controlKey,
) => {
  const ctl = ctlSix.map((row) => row[controlKey]);
  const acad = acadSix.map((row) => row[academyKey]);
  const deltas = acad.map((value, i) => value - ctl[i]);
  console.log(
    `${pad(label, 24)}${fmt(mean(ctl), 2)}${fmt(mean(acad), 2)}${fmt(mean(deltas), 2)}${fmt(stderr(deltas), 2)}`,
  );
};
metricLine('wins / season', 'wins');
metricLine('season point diff', 'margin');
metricLine('top-scorer PPG', 'topPpg');
metricLine('top-6 salary demand', 'demand');
metricLine('payroll', 'payroll');
console.log(
  `levels bought: ${totalLevels} (${(totalLevels / (SEEDS.length * SEASONS)).toFixed(1)} per team-season); cash spent: $${totalSpend.toFixed(1)}M ($${(totalSpend / (SEEDS.length * SEASONS)).toFixed(1)}M per team-season)`,
);
console.log(
  `titles: control ${controlsTotal.reduce((s, a) => s + a.titles, 0)} / academy ${academiesTotal.reduce((s, a) => s + a.titles, 0)}; playoff trips: control ${controlsTotal.reduce((s, a) => s + a.trips, 0)} / academy ${academiesTotal.reduce((s, a) => s + a.trips, 0)} of ${SEEDS.length * SEASONS}`,
);
console.log(
  `cap: $${CAP}M → $${CAP + (SEASONS - 1) * CAP_GROWTH}M; final-year cash: control $${mean(controls.map((a) => a.rows[SEASONS - 1].cash)).toFixed(1)}M / academy $${mean(academies.map((a) => a.rows[SEASONS - 1].cash)).toFixed(1)}M`,
);
const totalOverallGain = academies.reduce((sum, arm) => sum + arm.overallGain, 0);
const totalDemandGain = academies.reduce((sum, arm) => sum + arm.demandGain, 0);
console.log(
  `per level bought: +${(totalOverallGain / totalLevels).toFixed(2)} OVR, +$${(totalDemandGain / totalLevels).toFixed(3)}M asking price at the moment of purchase`,
);
console.log(
  `final roster OVR (season 6): control ${mean(controls.map((a) => mean(a.finalOveralls))).toFixed(1)} (best ${mean(controls.map((a) => Math.max(...a.finalOveralls))).toFixed(1)}), academy ${mean(academies.map((a) => mean(a.finalOveralls))).toFixed(1)} (best ${mean(academies.map((a) => Math.max(...a.finalOveralls))).toFixed(1)})`,
);

const shadows = academies.flatMap((arm) => arm.shadows);
console.log('\nSame-state replay of each academy season (identical rosters and RNG)');
console.log(
  `${pad('metric', 26)}${pad('effect', 9)}${pad('SE', 7)}${pad('improved', 10)}`,
);
const shadowLine = (label: string, values: number[], digits = 2) =>
  console.log(
    `${pad(label, 26)}${fmt(mean(values), digits)}${fmt(stderr(values), digits)}   ${values.filter((v) => v > 0).length}/${values.length}`,
  );
shadowLine('wins', shadows.map((s) => s.wins));
shadowLine('margin (pts/game)', shadows.map((s) => s.margin), 2);
shadowLine('points per game', shadows.map((s) => s.ppg), 2);
shadowLine('top-scorer PPG', shadows.map((s) => s.topPpg), 2);
const shadowMargin = mean(shadows.map((s) => s.margin));
console.log(
  `academy seasons averaged ${(totalLevels / shadows.length).toFixed(1)} levels and $${(totalSpend / shadows.length).toFixed(1)}M per team-season; $${(totalSpend / Math.max(1e-9, shadowMargin * 21 * shadows.length)).toFixed(2)}M per point of season point differential`,
);

const ceilings = SEEDS.map(ceilingCheck).filter(
  (entry): entry is NonNullable<ReturnType<typeof ceilingCheck>> => entry !== null,
);
console.log('\nCeiling check (season 3 cloned, whole rotation maxed, identical RNG)');
console.log(
  `+${mean(ceilings.map((c) => c.levels)).toFixed(0)} levels, +${mean(ceilings.map((c) => c.overall)).toFixed(1)} team OVR → Δmargin ${signed(mean(ceilings.map((c) => c.margin)))} pts/game, Δwins ${signed(mean(ceilings.map((c) => c.wins)))} per 21-game season, ΔPPG ${signed(mean(ceilings.map((c) => c.ppg)))}`,
);
console.log(
  `margin delta by seed: ${ceilings.map((c) => signed(c.margin)).join(', ')}; all positive: ${ceilings.every((c) => c.margin > 0)}; wins improved in ${ceilings.filter((c) => c.wins > 0).length}/${ceilings.length}`,
);

const economies = SEEDS.slice(0, 8).map((seed) => runArm(seed, false, true));
console.log('\nCash, payroll and TP economy — cap-aware manager (8 seeds, per team-season averages)');
console.log(
  `${pad('season', 8)}${pad('cash in', 9)}${pad('prizes', 9)}${pad('tax', 7)}${pad('bonus', 8)}${pad('cash out', 10)}${pad('TP earn', 9)}${pad('TP train', 10)}${pad('payroll', 9)}${pad('cap', 7)}`,
);
const econ = (key: keyof SeasonRow) =>
  mean(economies.map((arm) => mean(arm.rows.map((r) => r[key] as number))));
for (let i = 0; i < SEASONS; i++) {
  const rows = economies.map((arm) => arm.rows[i]);
  const avg = (key: keyof SeasonRow) => mean(rows.map((r) => r[key] as number));
  console.log(
    `${pad(String(i + 1), 8)}${fmt(avg('cashStart'), 2)}${fmt(avg('prize'), 2)}${fmt(avg('tax'), 2)}${fmt(avg('bonus'), 2)}${fmt(avg('cashEnd'), 2)}${fmt(avg('tpEarned'), 0)}${fmt(avg('tpSpent'), 0)}${fmt(avg('payroll'), 1)}${fmt(CAP + i * CAP_GROWTH, 0)}`,
  );
}
console.log(
  `six-season averages: prizes +$${econ('prize').toFixed(1)}M, tax -$${econ('tax').toFixed(1)}M, bonuses -$${econ('bonus').toFixed(1)}M, TP earned ${econ('tpEarned').toFixed(0)}, TP trained ${econ('tpSpent').toFixed(0)}, payroll $${econ('payroll').toFixed(1)}M`,
);
const tpCost = (level: number) => 8 + level * 2;
const maxOnePlayer = Array.from({ length: MAX_LEVEL - 1 }, (_, i) => tpCost(i + 1)).reduce(
  (a, b) => a + b,
  0,
) + [120, 200, 280, 360].reduce((a, b) => a + b, 0);
console.log(
  `one player tier 5 → tier 1 costs ~${maxOnePlayer} TP; the same TP converted is $${(maxOnePlayer / 100).toFixed(1)}M; $1M of cash = 100 TP = ${(100 / tpCost(MAX_LEVEL - 1)).toFixed(1)}–${(100 / tpCost(1)).toFixed(0)} training levels (+1 OVR each)`,
);
console.log(
  `star signing bonus at 75% of salary: $${(0.75 * 25).toFixed(1)}M on a $25M deal; buyout at 60% of a 3-year, $20M deal: $${(0.6 * 60).toFixed(0)}M cash`,
);
const league = economies.map((arm) => arm.league);
console.log(
  `season-${SEASONS} league (cap-aware): ${mean(league.map((l) => l.overCap)).toFixed(1)}/12 teams over the $${league[0].cap}M cap, average payroll $${mean(league.map((l) => l.avgPayroll)).toFixed(1)}M, highest $${mean(league.map((l) => l.maxPayroll)).toFixed(1)}M`,
);
const loyalLast = (arm: ArmTotals) => arm.rows[SEASONS - 1];
const cumulative = (arm: ArmTotals, key: 'tax' | 'prize') =>
  arm.rows.reduce((sum, row) => sum + row[key], 0);
console.log(
  `loyal-manager comparison (16 seeds): season-${SEASONS} payroll $${mean(controls.map((a) => loyalLast(a).payroll)).toFixed(1)}M, cumulative tax $${mean(controls.map((a) => cumulative(a, 'tax'))).toFixed(1)}M, cash left $${mean(controls.map((a) => loyalLast(a).cash)).toFixed(1)}M; cap-aware cumulative tax $${mean(economies.map((a) => cumulative(a, 'tax'))).toFixed(1)}M`,
);

function taxProbe(cash: number) {
  let probe = createLeague('NYS', 4242);
  probe.teams[probe.userTeamId].cash = cash;
  for (const player of rosterOf(probe, probe.userTeamId)) player.salary = 12;
  // 10 players at $12M = $120M payroll against a $70M cap.
  probe = enterOffseason(probe);
  return {
    paid: round1(cash - probe.teams[probe.userTeamId].cash),
    strikes: probe.teams[probe.userTeamId].taxStrikes ?? 0,
  };
}
const probes = [0, 5, 20].map((cash) => ({ cash, ...taxProbe(cash) }));
console.log(
  `\nluxury-tax probe (payroll $120M vs $70M cap): ${probes.map((p) => `$${p.cash}M cash → pays $${p.paid}M`).join(', ')}; strikes ${probes[0].strikes} each`,
);
console.log(
  'a tax larger than the wallet is written off, and cash spent before the offseason (skills, facilities, scouting) is never assessed',
);

console.log('\nPer-season shadow (that season\'s purchases only, pts/game)');
console.log(`${pad('season', 8)}${pad('wins', 8)}${pad('margin', 9)}${pad('PPG', 8)}`);
for (let i = 0; i < SEASONS; i++) {
  const rows = academies.map((arm) => arm.shadows[i]);
  console.log(
    `${pad(String(i + 1), 8)}${fmt(mean(rows.map((r) => r.wins)), 2)}${fmt(mean(rows.map((r) => r.margin)), 1)}${fmt(mean(rows.map((r) => r.ppg)), 2)}`,
  );
}
