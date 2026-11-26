import type { Game, GameState, HofLeague, HofPlacement, HofSeries, Player } from './types';
import {
  HALL_OF_FAME_TIER,
  HOF_REWARD_PREMIUM,
  ROSTER_MAX,
  ROSTER_MIN,
  STASH_LIMIT,
  TIER_BASE,
  tierName,
} from './data';
import { clubHwdBalance, devFundBalance, HWD_LEAGUE_ENTRY_FEE, hwdBalance } from './market';
import {
  ATTR_KEYS,
  acquisitionSeason,
  capFor,
  clamp,
  computeOverall,
  makeRewardPlayer,
  payrollOf,
  Rng,
  rosterOf,
  sanitizeLineup,
  simGame,
} from './engine';

/** Managers in the bracket: the user plus the nine strongest rival clubs. */
export const HOF_FIELD_SIZE = 10;
/** Games needed to take a best-of-three series. */
export const HOF_SERIES_WINS = 2;
/** Rotation size used to rate a club for seeding. */
export const HOF_SEED_ROTATION = 8;
/** Share of the entry fee burned; the rest is the prize pot. */
export const HOF_BURN_RATE = 0.1;
/** Burned per entry: a tenth of the 25 HWD fee. */
export const HOF_ENTRY_BURN = HWD_LEAGUE_ENTRY_FEE * HOF_BURN_RATE;
/** HWD the whole ten-manager bracket collects in entry fees. */
export const HOF_TOTAL_POOL = HOF_FIELD_SIZE * HWD_LEAGUE_ENTRY_FEE;
/** HWD burned out of the whole bracket's pool. */
export const HOF_TOTAL_BURN = HOF_FIELD_SIZE * HOF_ENTRY_BURN;

/**
 * Podium payouts for a full ten-manager bracket; they add up to the 225 HWD
 * prize pool left after the burn. A champion turns a 25 HWD entry into 120.
 */
export const HOF_PRIZES: Record<Exclude<HofPlacement, 'out'>, number> = {
  champion: 120,
  'runner-up': 70,
  third: 35,
};

/** Everything a full bracket pays back out to the podium. */
export const HOF_TOTAL_PAYOUT =
  HOF_PRIZES.champion + HOF_PRIZES['runner-up'] + HOF_PRIZES.third;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Scale the podium ladder to the pool a bracket actually holds, with third place
 * absorbing the rounding so the payouts never create or destroy HWD. A bracket
 * with a solvent field always pays the advertised ladder; this only bites when
 * the development fund cannot cover a rival's seat, or in a save carried over
 * from the older, treasury-capped fees.
 */
function podiumPayouts(pot: number): Record<Exclude<HofPlacement, 'out'>, number> {
  const champion = round2((pot * HOF_PRIZES.champion) / HOF_TOTAL_PAYOUT);
  const runnerUp = round2((pot * HOF_PRIZES['runner-up']) / HOF_TOTAL_PAYOUT);
  const third = round2(pot - champion - runnerUp);
  return { champion, 'runner-up': runnerUp, third };
}

/** Every Hall of Famer is raised to at least this overall (95 on the new curve). */
export const HOF_TIER_TARGET = TIER_BASE[HALL_OF_FAME_TIER] + HOF_REWARD_PREMIUM;

/**
 * The champion's single NFT drop. Tier 2 is the common result, tier 1 is hard
 * and the Hall of Fame tier is very hard, so a legendary player stays rare.
 */
export const HOF_REWARD_ODDS: { tier: Player['tier']; chance: number; label: string }[] = [
  { tier: 2, chance: 0.8, label: 'Tier 2' },
  { tier: 1, chance: 0.185, label: 'Tier 1' },
  { tier: 0, chance: 0.015, label: 'Hall of Fame' },
];

export function rollHofRewardTier(rng: Rng): Player['tier'] {
  const roll = rng.next();
  let edge = 0;
  for (const entry of HOF_REWARD_ODDS) {
    edge += entry.chance;
    if (roll < edge) return entry.tier;
  }
  return HOF_REWARD_ODDS[0].tier;
}

/** Standard eight-slot bracket: 1v8, 4v5, 3v6, 2v7. */
const BRACKET_ORDER = [0, 7, 3, 4, 2, 5, 1, 6];

export interface HofResult {
  state?: GameState;
  error?: string;
  /** The game just played, plus a display-only state that has it on the schedule. */
  replay?: { state: GameState; game: Game };
}

/** Strength used for seeding: the club's best eight players. */
export function hofRating(state: GameState, teamId: string): number {
  const top = rosterOf(state, teamId)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, HOF_SEED_ROTATION);
  return top.length ? top.reduce((sum, player) => sum + player.overall, 0) / top.length : 0;
}

/**
 * This season's ten entrants, strongest seed first. The paying manager always
 * gets in, and matchmaking fills the other nine seats with the rival clubs
 * closest to their own best-eight rating: a strong club plays a strong field
 * and a rebuild is not fed to the contenders.
 */
export function hofField(state: GameState): string[] {
  const ranked = Object.values(state.teams)
    .map((team) => ({ id: team.id, rating: hofRating(state, team.id) }))
    .sort((a, b) => b.rating - a.rating);
  const ratingOf = new Map(ranked.map((entry) => [entry.id, entry.rating]));
  const mine = ratingOf.get(state.userTeamId) ?? 0;
  const rivals = ranked
    .filter((entry) => entry.id !== state.userTeamId)
    .sort(
      (a, b) =>
        Math.abs(a.rating - mine) - Math.abs(b.rating - mine) || b.rating - a.rating,
    )
    .slice(0, HOF_FIELD_SIZE - 1)
    .map((entry) => entry.id);
  return [state.userTeamId, ...rivals].sort(
    (a, b) => (ratingOf.get(b) ?? 0) - (ratingOf.get(a) ?? 0),
  );
}

/** The bracket for the season in progress, or null once the league year rolled over. */
export function activeHof(state: GameState): HofLeague | null {
  return state.hof && state.hof.season === state.season ? state.hof : null;
}

/**
 * Pay the entry fee and open this season's bracket. The bracket is played one
 * game at a time with simulateHofGame(); the champion, the podium payouts and
 * the NFT drop settle once the final and the third-place series are finished.
 */
export function enterHallOfFameLeague(state: GameState): HofResult {
  if (activeHof(state)) {
    return { error: 'You have already entered this season’s Hall of Fame league.' };
  }
  const balance = hwdBalance(state);
  if (balance < HWD_LEAGUE_ENTRY_FEE) {
    return { error: `Entry costs ${HWD_LEAGUE_ENTRY_FEE} HWD and you have ${balance}.` };
  }
  if (rosterOf(state, state.userTeamId).length < ROSTER_MIN) {
    return { error: `You need at least ${ROSTER_MIN} players under contract to enter.` };
  }

  const s = structuredClone(state);
  const seeds = hofField(s);

  // Every seat is charged the same fee: the user out of their wallet, each
  // rival out of its club treasury. A rival that cannot cover its seat does not
  // shrink the podium — the league tops that seat up out of the development
  // fund, which holds real marketplace fees — so the advertised prizes never
  // depend on which clubs the draw produced and no HWD is minted. If the fund
  // is short the podium scales down to the pool instead.
  let totalFees = 0;
  for (const id of seeds) {
    if (id === s.userTeamId) {
      totalFees += HWD_LEAGUE_ENTRY_FEE;
      continue;
    }
    const clubBalance = clubHwdBalance(s, id);
    const fee = Math.min(HWD_LEAGUE_ENTRY_FEE, clubBalance);
    totalFees += fee;
    s.clubHwd = { ...(s.clubHwd ?? {}), [id]: clubBalance - fee };
  }
  let fundUsed = 0;
  const shortfall = round2(HOF_TOTAL_POOL - totalFees);
  if (shortfall > 0) {
    fundUsed = Math.min(shortfall, devFundBalance(s));
    s.devFund = round2(devFundBalance(s) - fundUsed);
    totalFees = round2(totalFees + fundUsed);
  }
  const burn = round2(totalFees * HOF_BURN_RATE);
  const pot = round2(totalFees - burn);

  s.hwd = balance - HWD_LEAGUE_ENTRY_FEE;
  s.hof = {
    season: s.season,
    seeds,
    series: [],
    third: null,
    champion: null,
    userPlacement: 'out',
    prize: 0,
    rewardTier: null,
    rewardPlayerId: null,
    prizePool: pot,
  };

  s.log.unshift({
    id: `log_${s.season}_hof_entry`,
    season: s.season,
    text: `Hall of Fame league: ${round2(totalFees)} HWD pooled across ${HOF_FIELD_SIZE} seats${
      fundUsed > 0 ? ` (${round2(fundUsed)} topped up from the development fund)` : ''
    }, ${burn} burned, ${pot} to the podium.`,
  });

  return { state: s };
}

/** Play the next game of this season's Hall of Fame bracket. */
export function simulateHofGame(state: GameState): HofResult {
  const league = activeHof(state);
  if (!league) return { error: 'You are not in a Hall of Fame league this season.' };
  if (league.champion) return { error: 'This season’s bracket is already decided.' };

  const s = structuredClone(state);
  const hof = s.hof!;
  const rng = new Rng(s.rngState);

  let series = nextSeries(hof);
  if (!series) {
    if (!openNextRound(hof)) return { error: 'The bracket has no game left to play.' };
    series = nextSeries(hof);
  }
  if (!series) return { error: 'The bracket has no game left to play.' };

  const game = playHofGame(s, series, rng);

  const final = hof.series[hof.series.length - 1];
  if (hof.third?.winner && final?.winner) settleHofLeague(s, hof, rng);
  s.rngState = rng.state;

  // The bracket keeps only scorelines, so hand the overlay a copy of the state
  // with this game on the schedule. It is never saved.
  return { state: s, replay: { state: { ...s, schedule: [...s.schedule, game] }, game } };
}

function nextSeries(hof: HofLeague): HofSeries | null {
  // Third place is decided before the final so the title game settles the bracket.
  if (hof.third && !hof.third.winner) return hof.third;
  return hof.series.find((entry) => !entry.winner) ?? null;
}

/**
 * Play out any unfinished bracket. Used when the league year rolls over so a
 * paid entry is never orphaned without its payout and NFT.
 */
export function finishHofLeague(state: GameState): GameState {
  if (!activeHof(state) || state.hof!.champion) return state;
  let next = state;
  let guard = 0;
  while (!next.hof!.champion && guard++ < 200) {
    const step = simulateHofGame(next);
    if (!step.state) break;
    next = step.state;
  }
  return next;
}

function newSeries(round: number, high: string, low: string): HofSeries {
  return { round, high, low, highWins: 0, lowWins: 0, games: [], winner: null };
}

/**
 * Build the next round once every series so far is decided: play-in, then
 * quarterfinals, then semifinals, then the final and the third-place game.
 */
function openNextRound(hof: HofLeague): boolean {
  const { seeds, series } = hof;
  if (series.length === 0) {
    if (seeds.length > BRACKET_ORDER.length) {
      // Ten managers: seeds 7–10 play down to two places, the top six wait.
      const low = seeds.slice(BRACKET_ORDER.length - 2);
      for (let i = 0; i < low.length; i += 2) {
        const high = low[i];
        const underdog = low[low.length - 1 - i];
        if (!high || !underdog || high === underdog) continue;
        series.push(newSeries(1, high, underdog));
      }
      return series.length > 0;
    }
    const seeded = seeds.slice(0, BRACKET_ORDER.length);
    for (let i = 0; i < seeded.length; i += 2) {
      series.push(newSeries(1, seeded[i], seeded[i + 1]));
    }
    return series.length > 0;
  }

  const lastRound = Math.max(...series.map((entry) => entry.round));
  const roundSeries = series.filter((entry) => entry.round === lastRound);
  if (roundSeries.some((entry) => !entry.winner)) return false;

  const winners = roundSeries.map((entry) => entry.winner as string);

  // The play-in round is the only two-series round that is not the semifinals.
  if (lastRound === 1 && seeds.length > BRACKET_ORDER.length) {
    const field = [...seeds.slice(0, BRACKET_ORDER.length - 2), ...winners];
    const seeded = BRACKET_ORDER.map((index) => field[index]).filter(
      (id): id is string => Boolean(id),
    );
    for (let i = 0; i + 1 < seeded.length; i += 2) {
      series.push(newSeries(2, seeded[i], seeded[i + 1]));
    }
    return true;
  }

  if (roundSeries.length === 4) {
    series.push(newSeries(lastRound + 1, winners[0], winners[1]));
    series.push(newSeries(lastRound + 1, winners[2], winners[3]));
    return true;
  }

  if (roundSeries.length === 2) {
    const losers = roundSeries
      .map((entry) => (entry.winner === entry.high ? entry.low : entry.high))
      .sort((first, second) => seeds.indexOf(first) - seeds.indexOf(second));
    series.push(newSeries(lastRound + 1, winners[0], winners[1]));
    hof.third = newSeries(lastRound + 1, losers[0], losers[1]);
    return true;
  }

  return false;
}

/** Best of three; the higher seed hosts games one and three. */
function playHofGame(state: GameState, series: HofSeries, rng: Rng): Game {
  const gameNumber = series.games.length + 1;
  const highHome = gameNumber !== 2;
  const home = highHome ? series.high : series.low;
  const away = highHome ? series.low : series.high;
  // Simulate on a scratch copy so league stats and injuries stay untouched.
  const result = simGame(structuredClone(state), home, away, rng, false);
  series.games.push({ home, away, homeScore: result.homeScore, awayScore: result.awayScore });
  const highWon = (result.homeScore >= result.awayScore) === highHome;
  if (highWon) series.highWins += 1;
  else series.lowWins += 1;
  if (series.highWins >= HOF_SERIES_WINS || series.lowWins >= HOF_SERIES_WINS) {
    series.winner = series.highWins > series.lowWins ? series.high : series.low;
  }
  return {
    id: `hof_${state.season}_${series.round}_${series.high}_${series.low}_${gameNumber}`,
    round: -1,
    home,
    away,
    played: true,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    box: result.box ?? null,
  };
}

function payClub(state: GameState, teamId: string | null, amount: number): void {
  if (!teamId || amount <= 0) return;
  if (teamId === state.userTeamId) {
    state.hwd = round2((state.hwd ?? 0) + amount);
    return;
  }
  state.clubHwd = {
    ...(state.clubHwd ?? {}),
    [teamId]: round2(clubHwdBalance(state, teamId) + amount),
  };
}

/** Crown the champion, pay the podium and hand out the NFT drop. */
function settleHofLeague(state: GameState, hof: HofLeague, rng: Rng): void {
  const final = hof.series[hof.series.length - 1];
  const champion = final.winner;
  if (!champion) return;

  const payouts = podiumPayouts(hof.prizePool ?? 0);
  const userPlacement = placementOf(state.userTeamId, final, hof.third);
  const prize = userPlacement === 'out' ? 0 : payouts[userPlacement];
  const runnerUpId = final.high === champion ? final.low : final.high;

  payClub(state, champion, payouts.champion);
  payClub(state, runnerUpId, payouts['runner-up']);
  payClub(state, hof.third?.winner ?? null, payouts.third);

  const rewardTier = rollHofRewardTier(rng);
  const reward = awardHofNft(state, champion, rewardTier, rng);

  hof.champion = champion;
  hof.userPlacement = userPlacement;
  hof.prize = prize;
  hof.rewardTier = rewardTier;
  hof.rewardPlayerId = reward?.playerId ?? null;

  const club = state.teams[champion];
  state.log.unshift({
    id: `log_${state.season}_hof_champion`,
    season: state.season,
    text: `Hall of Fame league: the ${club.city} ${club.name} won the bracket and drew a ${tierName(rewardTier)} NFT.`,
  });
  if (prize > 0) {
    state.log.unshift({
      id: `log_${state.season}_hof_prize`,
      season: state.season,
      text: `Hall of Fame league: ${userPlacement} pays out ${prize} HWD.`,
    });
  }
}

function placementOf(
  userId: string,
  final: HofSeries | undefined,
  third: HofSeries | null,
): HofPlacement {
  if (!final?.winner) return 'out';
  if (final.winner === userId) return 'champion';
  if (final.high === userId || final.low === userId) return 'runner-up';
  if (third?.winner === userId) return 'third';
  return 'out';
}

/**
 * Place one dropped player with the champion. The drop never bypasses the cap:
 * it goes to the user's stored collection when their payroll cannot fit it, and
 * otherwise the club releases its weakest players to free the salary and a
 * roster spot, never cutting below the roster minimum.
 */
export function awardHofNft(
  state: GameState,
  teamId: string,
  tier: Player['tier'],
  rng: Rng,
): { playerId: string; name: string; overall: number; tier: Player['tier'] } | null {
  const team = state.teams[teamId];
  if (!team) return null;

  const target =
    tier === HALL_OF_FAME_TIER ? HOF_TIER_TARGET : TIER_BASE[tier] + HOF_REWARD_PREMIUM;
  const player = makeRewardPlayer(state, rng, tier, target);
  if (tier === HALL_OF_FAME_TIER) raiseToHallOfFame(player);

  // The drop must never force a signing the club cannot afford. When the user's
  // payroll cannot fit him the NFT goes to their collection, where he costs no
  // cap space until he is signed. A full collection (or a CPU champion, which
  // has no collection) instead releases the weakest players until the deal
  // fits, never cutting below the roster minimum.
  const cap = capFor(state);
  const payroll = payrollOf(state, teamId);
  const fitsCap = payroll + player.salary <= cap + 1e-9;
  const stored =
    teamId === state.userTeamId && !fitsCap && (state.stash ?? []).length < STASH_LIMIT;

  const roster = rosterOf(state, teamId);
  const cuttable = [...roster].sort((a, b) => a.overall - b.overall);
  // Signing him must leave ROSTER_MIN..ROSTER_MAX players, which bounds the cuts.
  const minCuts = Math.max(0, roster.length + 1 - ROSTER_MAX);
  const maxCuts = Math.max(0, roster.length + 1 - ROSTER_MIN);
  const payrollAfterCuts = (cuts: number) =>
    payroll - cuttable.slice(0, cuts).reduce((sum, entry) => sum + entry.salary, 0);
  const fitsWithCuts = (cuts: number) => payrollAfterCuts(cuts) + player.salary <= cap + 1e-9;
  let cuts = minCuts;
  while (cuts < maxCuts && !fitsWithCuts(cuts)) cuts++;
  // Even a legal minimum roster cannot fit him, so he cannot be signed at all.
  const canSign = cuttable.length >= cuts && fitsWithCuts(cuts);
  const unsigned = !stored && !canSign;

  // sanitizeLineup below drops any released player from the rotation.
  const released = stored || !canSign ? [] : cuttable.slice(0, cuts);
  for (const entry of released) {
    entry.teamId = null;
    entry.years = 0;
    if (!state.freeAgents.includes(entry.id)) state.freeAgents.push(entry.id);
  }

  player.years = 2;
  player.joinedSeason = acquisitionSeason(state);
  if (stored) {
    state.stash = [...(state.stash ?? []), player.id];
  } else if (unsigned) {
    // No cap-legal way to keep him, so the drop hits free agency instead.
    player.teamId = null;
    player.years = 0;
    if (!state.freeAgents.includes(player.id)) state.freeAgents.push(player.id);
  } else {
    player.teamId = teamId;
  }
  state.players[player.id] = player;
  sanitizeLineup(state);

  const releasedNames = released.map((entry) => entry.name).join(', ');
  state.log.unshift({
    id: `log_${state.season}_hof_reward_${player.id}`,
    season: state.season,
    text: stored
      ? `Hall of Fame league: the ${team.city} ${team.name} drew ${player.name} (${tierName(tier)}, ${player.overall} OVR) and stored him in the NFT collection: his $${player.salary.toFixed(1)}M deal does not fit under the cap.`
      : unsigned
        ? `Hall of Fame league: the ${team.city} ${team.name} drew ${player.name} (${tierName(tier)}, ${player.overall} OVR), but his $${player.salary.toFixed(1)}M deal could not fit under the cap without falling below ${ROSTER_MIN} players, so he became a free agent.`
        : released.length
          ? `Hall of Fame league: the ${team.city} ${team.name} signed ${player.name} (${tierName(tier)}, ${player.overall} OVR) and released ${releasedNames} to make room.`
          : `Hall of Fame league: the ${team.city} ${team.name} signed ${player.name} (${tierName(tier)}, ${player.overall} OVR) as their champion reward.`,
  });

  return { playerId: player.id, name: player.name, overall: player.overall, tier };
}

/** Raise a dropped player into the top Hall of Fame band at level 1. */
function raiseToHallOfFame(player: Player): void {
  let guard = 0;
  while (computeOverall(player.pos, player.attrs) < HOF_TIER_TARGET && guard++ < 60) {
    let raised = false;
    for (const key of ATTR_KEYS) {
      if (player.attrs[key] < 99) {
        player.attrs[key] = clamp(player.attrs[key] + 2, 25, 99);
        raised = true;
      }
    }
    if (!raised) break;
  }
  player.tier = HALL_OF_FAME_TIER;
  player.level = 1;
  player.overall = computeOverall(player.pos, player.attrs);
  player.potential = Math.max(player.potential, player.overall);
}
