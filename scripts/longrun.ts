/**
 * Long-run economy stress test: 4 leagues × 100 seasons.
 *
 * The manager plays sensibly: spends cash on the academy, trains with TP,
 * converts TP it cannot use, re-signs only what fits near the cap, drafts and
 * fills the roster. Revenue, operating costs and the luxury tax are applied by
 * the engine, so the checkpoints show whether the economy stays bounded.
 *
 * Run with: npm run longrun
 */
import {
  askingSalary,
  buySkillLevel,
  capFor,
  championOf,
  convertPointsToCash,
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
  signedPlayers,
  simulatePlayoffs,
  simulateSeason,
  skillOffer,
  spendTrainingPoints,
  startNextSeason,
  userOnTheClock,
} from '../src/game/engine';
import {
  MIN_SALARY_EXCEPTION,
  POINTS_PER_CASH_BLOCK,
  SKILL_KEYS,
} from '../src/game/data';
import { QUEST_CASH_SHARES, QUEST_TP_AMOUNTS } from '../src/game/quests';

declare const process: { env: Record<string, string | undefined> };
import type { AttrKey, GameState } from '../src/game/types';

const SEEDS = process.env.SEEDS
  ? process.env.SEEDS.split(',').map(Number)
  : [20261120, 777, 424242, 909090];
const SEASONS = 100;
const DAILY_QUESTS = process.env.DAILY_QUESTS === '1';
const DAYS_PER_SEASON = Number(process.env.DAYS_PER_SEASON ?? 7);
const QUEST_CASH_AVG =
  QUEST_CASH_SHARES.reduce((sum, share) => sum + share, 0) / QUEST_CASH_SHARES.length;
const QUEST_TP_AVG =
  QUEST_TP_AMOUNTS.reduce((sum, amount) => sum + amount, 0) / QUEST_TP_AMOUNTS.length;
const SKILL_RESERVE = 2;
const CHECKPOINTS = [1, 5, 10, 25, 50, 75, 100];

const ATTR_VALUE: Record<AttrKey, number> = {
  defense: 0.62,
  outside: 0.36,
  inside: 0.3,
  rebounding: 0.3,
  playmaking: 0.24,
  athleticism: 0.09,
};

interface Point {
  season: number;
  wins: number;
  payroll: number;
  cap: number;
  cash: number;
  debt: number;
  levelSpend: number;
  levels: number;
  converted: number;
  tpEarned: number;
  tpSpent: number;
  titles: number;
  playoffs: boolean;
  lockedDraftValue: number;
  openDraftValue: number;
  overCap: number;
  avgOvr: number;
  minRoster: number;
  champion: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function spendOnSkills(state: GameState): { state: GameState; levels: number; spend: number } {
  let s = state;
  let levels = 0;
  const uid = s.userTeamId;
  const startCash = s.teams[uid].cash;
  const rotation = rosterOf(s, uid)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9);

  for (let guard = 0; guard < 200; guard++) {
    let best: { id: string; key: AttrKey; rate: number } | null = null;
    for (const player of rotation) {
      for (const key of SKILL_KEYS) {
        const offer = skillOffer(s, s.players[player.id], key);
        if (offer.cost === null) continue;
        if (s.teams[uid].cash - offer.cost < SKILL_RESERVE) continue;
        const rate = ATTR_VALUE[key] / offer.cost;
        if (!best || rate > best.rate) best = { id: player.id, key, rate };
      }
    }
    if (!best) break;
    const result = buySkillLevel(s, best.id, best.key);
    if (!result.state) break;
    s = result.state;
    levels += 1;
  }
  return { state: s, levels, spend: round1(startCash - s.teams[uid].cash) };
}

function manageOffseason(input: GameState): { state: GameState; converted: number } {
  let s = spendTrainingPoints(input);
  const uid = s.userTeamId;

  // TP a maxed roster cannot use still has value as cash.
  const blocks = Math.floor(s.teams[uid].trainingPoints / POINTS_PER_CASH_BLOCK);
  let converted = 0;
  if (blocks > 0) {
    const before = s.teams[uid].cash;
    s = convertPointsToCash(s, blocks);
    converted = round1(s.teams[uid].cash - before);
  }

  if (userOnTheClock(s)) {
    const prospect = draftProspects(s)[0];
    if (prospect) s = makeDraftPick(s, prospect.id);
  }

  // Plan the offseason like a real manager: keep the best expiring deals that
  // fit under the cap, walk the rest, then re-sign the keepers.
  const pending = pendingContractPlayers(s, uid);
  const cap = capFor(s);
  const budget = cap * 1.08;
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
  return { state: s, converted };
}

function run(seed: number): { points: Point[]; finalState: GameState } {
  let state = createLeague('NYS', seed);
  const points: Point[] = [];
  let titles = 0;

  for (let season = 1; season <= SEASONS; season++) {
    if (season % 25 === 0) console.error(`  seed ${seed}: season ${season}`);
    const uid = state.userTeamId;
    const purchase = spendOnSkills(state);
    state = purchase.state;

    const payroll = payrollOf(state, uid);
    const cap = capFor(state);
    const tpStart = state.teams[uid].trainingPoints;

    state = simulateSeason(state);
    const tpEarned = state.teams[uid].trainingPoints - tpStart;
    const wins = state.teams[uid].wins;
    state = simulatePlayoffs(state);
    const champion = championOf(state) ?? '';
    const playoffs = state.playoffs.some(
      (series) => series.high === uid || series.low === uid,
    );
    if (champion === uid) titles += 1;

    // A daily player claims about one quest per real day. Model N days per
    // season so quest cash and TP enter the same economy as everything else.
    if (DAILY_QUESTS) {
      const team = state.teams[uid];
      team.cash = round1(team.cash + cap * QUEST_CASH_AVG * DAYS_PER_SEASON);
      team.trainingPoints += Math.round(QUEST_TP_AVG * DAYS_PER_SEASON);
    }

    state = enterOffseason(state);
    const managed = manageOffseason(state);
    state = managed.state;

    const leaguePayrolls = Object.values(state.teams).map((team) =>
      payrollOf(state, team.id),
    );
    const rosterSizes = Object.values(state.teams).map(
      (team) => rosterOf(state, team.id).length,
    );
    const overalls = Object.values(state.players)
      .filter((player) => player.teamId)
      .map((player) => player.overall);

    // Contract surplus on players this account drafted, valued as
    // (market salary - actual salary) x years left. Rookie deals are locked by
    // the listing gate; market deals are listable.
    let lockedDraftValue = 0;
    let openDraftValue = 0;
    for (const player of Object.values(state.players)) {
      if (player.teamId !== uid || player.draftedBy !== uid) continue;
      const annual = Math.max(0, salaryDemand(player, capFor(state)) - player.salary);
      const value = annual * Math.max(0, player.years);
      if (player.rookie) lockedDraftValue += value;
      else openDraftValue += value;
    }

    points.push({
      season,
      wins,
      payroll,
      cap,
      cash: round1(state.teams[uid].cash),
      debt: round1(state.teams[uid].taxDebt ?? 0),
      levelSpend: purchase.spend,
      levels: purchase.levels,
      converted: managed.converted,
      tpEarned,
      tpSpent: tpStart + tpEarned - (state.teams[uid].trainingPoints + managed.converted * 100),
      titles,
      playoffs,
      lockedDraftValue: round1(lockedDraftValue),
      openDraftValue: round1(openDraftValue),
      overCap: leaguePayrolls.filter((value) => value > cap + 1e-9).length,
      avgOvr: round1(mean(overalls)),
      minRoster: Math.min(...rosterSizes),
      champion,
    });

    if (season < SEASONS) {
      const next = startNextSeason(state);
      if (next === state) {
        const freeAgents = state.freeAgents
          .map((id) => state.players[id])
          .filter((player) => player && player.teamId === null);
        const cheap = freeAgents.filter(
          (player) =>
            askingSalary(state, player) <= MIN_SALARY_EXCEPTION * capFor(state),
        ).length;
        throw new Error(
          `season ${season} stalled: ${rosterOf(state, uid).length} players, cash $${state.teams[uid].cash}M, payroll $${payrollOf(state, uid)}M, cap $${cap}M, free agents ${freeAgents.length} (${cheap} at the minimum), roster ${rosterOf(state, uid)
            .map((p) => `${p.name} $${p.salary}M/${p.years}y`)
            .join(', ')}`,
        );
      }
      state = next;
    }
  }
  return { points, finalState: state };
}

const runs = SEEDS.map((seed) => ({ seed, ...run(seed) }));
const fmt = (value: number, digits = 1) => value.toFixed(digits).padStart(8);
const pad = (text: string, width: number) => text.padEnd(width);

console.log(
  `\nLong-run economy — ${SEEDS.length} leagues × ${SEASONS} seasons${
    DAILY_QUESTS ? ` (daily quests: ${DAYS_PER_SEASON}/season)` : ''
  }\n`,
);

console.log(
  `${pad('season', 8)}${pad('wins', 7)}${pad('payroll', 9)}${pad('cap', 7)}${pad('cash', 8)}${pad('debt', 8)}${pad('buy $', 8)}${pad('lvl', 6)}${pad('conv $', 8)}${pad('over cap', 10)}${pad('avgOVR', 8)}${pad('champ', 12)}`,
);
for (const checkpoint of CHECKPOINTS) {
  const rows = runs.map((entry) => entry.points[checkpoint - 1]);
  const champion = rows[0].champion;
  console.log(
    `${pad(String(checkpoint), 8)}${fmt(mean(rows.map((r) => r.wins)), 1)}${fmt(mean(rows.map((r) => r.payroll)), 1)}${fmt(mean(rows.map((r) => r.cap)), 0)}${fmt(mean(rows.map((r) => r.cash)), 1)}${fmt(mean(rows.map((r) => r.debt)), 1)}${fmt(mean(rows.map((r) => r.levelSpend)), 1)}${fmt(mean(rows.map((r) => r.levels)), 1)}${fmt(mean(rows.map((r) => r.converted)), 1)}${fmt(mean(rows.map((r) => r.overCap)), 1)}${fmt(mean(rows.map((r) => r.avgOvr)), 1)}${pad(champion, 12)}`,
  );
}

const all = runs.flatMap((entry) => entry.points);
const last = runs.map((entry) => entry.points[SEASONS - 1]);
const titlesByTeam: Record<string, number> = {};
for (const point of all) {
  if (point.champion) titlesByTeam[point.champion] = (titlesByTeam[point.champion] ?? 0) + 1;
}
const recentChampions = runs.flatMap((entry) =>
  entry.points.slice(-10).map((point) => point.champion),
);
const payrollRatios = all.map((point) => point.payroll / point.cap);

console.log('\nBalance checks');
console.log(
  `championships (${all.length} seasons): ${Object.entries(titlesByTeam)
    .sort((a, b) => b[1] - a[1])
    .map(([team, count]) => `${team} ${count}`)
    .join(', ')}`,
);
console.log(
  `titles by user: ${runs.map((entry) => entry.points[SEASONS - 1].titles).join(', ')}; distinct champions in the last 10 seasons: ${new Set(recentChampions).size}/12`,
);
console.log(
  `payroll / cap: average ${mean(payrollRatios).toFixed(2)}×, worst ${Math.max(...payrollRatios).toFixed(2)}×; teams over the cap at season ${SEASONS}: ${mean(last.map((r) => r.overCap)).toFixed(1)}/12`,
);
console.log(
  `user cash at season ${SEASONS}: $${mean(last.map((r) => r.cash)).toFixed(1)}M; highest cash seen: $${Math.max(...all.map((r) => r.cash)).toFixed(1)}M; seasons with $0 cash: ${all.filter((r) => r.cash <= 0.05).length}/${all.length}`,
);
console.log(
  `highest tax debt: $${Math.max(...all.map((r) => r.debt)).toFixed(1)}M; seasons with debt: ${all.filter((r) => r.debt > 0.05).length}/${all.length}`,
);
console.log(
  `roster minimum seen: ${Math.min(...all.map((r) => r.minRoster))}; average league OVR at ${SEASONS}: ${mean(last.map((r) => r.avgOvr)).toFixed(1)}`,
);
console.log(
  `per season late (seasons 76–100): academy $${mean(all.filter((r) => r.season > 75).map((r) => r.levelSpend)).toFixed(1)}M, ${mean(all.filter((r) => r.season > 75).map((r) => r.levels)).toFixed(1)} levels, TP converted $${mean(all.filter((r) => r.season > 75).map((r) => r.converted)).toFixed(1)}M, TP earned ${mean(all.filter((r) => r.season > 75).map((r) => r.tpEarned)).toFixed(0)}`,
);
console.log(
  `academy totals: $${all.reduce((sum, r) => sum + r.levelSpend, 0).toFixed(0)}M and ${all.reduce((sum, r) => sum + r.levels, 0)} levels across ${all.length} team-seasons`,
);

console.log('\nMarket gate — drafted-player contract surplus, stock in $M');
console.log('seasons      locked  listable  gate share');
for (let start = 1; start <= SEASONS; start += 10) {
  const slice = all.filter((r) => r.season >= start && r.season < start + 10);
  if (!slice.length) continue;
  const locked = mean(slice.map((r) => r.lockedDraftValue));
  const open = mean(slice.map((r) => r.openDraftValue));
  const share = locked + open > 0 ? (locked / (locked + open)) * 100 : 0;
  console.log(
    `${pad(`${start}–${Math.min(SEASONS, start + 9)}`, 10)}${fmt(locked, 1)}${fmt(open, 1)}${fmt(share, 1)}%`,
  );
}
const lockedAvg = mean(all.map((r) => r.lockedDraftValue));
const openAvg = mean(all.map((r) => r.openDraftValue));
console.log(
  `average season: $${lockedAvg.toFixed(1)}M locked by the gate vs $${openAvg.toFixed(1)}M listable — ${((lockedAvg / Math.max(0.001, lockedAvg + openAvg)) * 100).toFixed(1)}% of drafted surplus stays off-market.`,
);

const finalState = runs[0].finalState;
console.log(`\nSeason ${SEASONS} payroll detail (seed ${runs[0].seed})`);
for (const team of Object.values(finalState.teams).sort(
  (a, b) => payrollOf(finalState, b.id) - payrollOf(finalState, a.id),
)) {
  const roster = rosterOf(finalState, team.id).sort((a, b) => b.salary - a.salary);
  console.log(
    `${pad(team.id, 5)} payroll $${payrollOf(finalState, team.id).toFixed(0)}M / cap $${capFor(finalState)}M  n=${roster.length}  ${roster
      .slice(0, 4)
      .map((p) => `${p.overall}ovr $${p.salary}M/${p.years}y`)
      .join('  ')}`,
  );
}
