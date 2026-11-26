import type { Difficulty, Scenario } from './data';
import type {
  AttrKey,
  Attrs,
  BoxLine,
  Conf,
  Game,
  GameState,
  Player,
  Pos,
  Series,
  StatLine,
  Team,
} from './types';
import {
  BUYOUT_RATE,
  CAP,
  CAP_GROWTH,
  LEAGUE_MIN_SALARY,
  CASH_PER_BLOCK,
  DIFFICULTY,
  DRAFT_TIER3_CHANCE,
  DRAFT_TIER3_LOTTERY_BONUS,
  DRAFT_TIER4_CHANCE,
  FACILITIES,
  FACILITY_MAX_LEVEL,
  FIRST_NAMES,
  INJURY_GRADES,
  INJURY_MAX_GAMES,
  INJURY_TEAM_CHANCE,
  HOF_REWARD_PREMIUM,
  LAST_NAMES,
  LOSS_TRAINING_POINTS,
  MAX_LEVEL,
  MIN_SALARY_EXCEPTION,
  OPERATIONS_RATE,
  PLAYOFF_ENTRY_FEE,
  PLAYOFF_LOSS_POINTS,
  PLAYOFF_TEAMS_PER_CONF,
  PLAYOFF_WIN_CASH,
  PLAYOFF_WIN_POINTS,
  POINTS_PER_CASH_BLOCK,
  POSITIONS,
  REVENUE_PER_WIN,
  REVENUE_RATE,
  ROSTER_MAX,
  RATINGS_VERSION,
  ROSTER_MIN,
  ROOKIE_YEARS,
  RUNNER_UP_CASH_PRIZE,
  SCOUT_COST,
  SKILLS,
  SKILL_ATTR_CAP,
  SKILL_ATTR_GAIN,
  SKILL_BASE_COSTS,
  SKILL_KEYS,
  SKILL_MAX_LEVEL,
  SKILL_TOTAL_CAP,
  SKILL_VETERAN_AGE,
  SKILL_VETERAN_CAP,
  SEASON_ROUNDS,
  STASH_LIMIT,
  STARTING_CASH,
  STARTING_LEVEL,
  STARTING_TIER,
  TEAM_BLUEPRINTS,
  TIER_BASE,
  TRAINING_ATTR_GAIN,
  TITLE_BONUS_POINTS,
  TITLE_CASH_PRIZE,
  WIN_TRAINING_POINTS,
  type FacilityKey,
} from './data';
import {
  accountSeasons,
  canListOnMarket,
  CLUB_HWD_START,
  clubHwdBalance,
  devFundBalance,
  FUSION_BOTTOM_TIER,
  FUSION_CARRY_LEVELS,
  FUSION_RATING_INHERITANCE,
  fusionCheck,
  fusionHwdCost,
  FUSION_MIN_PLAYERS,
  FUSION_SALARY_MULTIPLIER,
  FUSION_TOP_TIER,
  HWD_STARTING,
  HWD_TP_MIN,
  hwdBalance,
  hwdTpQuote,
  hwdTpRemaining,
  hwdTpRemainingToday,
  hwdTpSpent,
  hwdTpSpentToday,
  todayKey,
  marketBlockReason,
  marketFee,
  marketMaxBid,
  MARKET_MIN_PRICE,
  marketValue,
  refreshMarketListings,
  RENAME_PLAYER_HWD,
  RENAME_TEAM_HWD,
} from './market';

export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deep copy of plain game data; structuredClone is much faster than JSON. */
const clone = <T,>(value: T): T => structuredClone(value);

const POS_WEIGHTS: Record<Pos, Attrs> = {
  PG: { inside: 0.08, outside: 0.3, playmaking: 0.3, defense: 0.14, rebounding: 0.04, athleticism: 0.14 },
  SG: { inside: 0.12, outside: 0.34, playmaking: 0.16, defense: 0.16, rebounding: 0.06, athleticism: 0.16 },
  SF: { inside: 0.2, outside: 0.24, playmaking: 0.16, defense: 0.2, rebounding: 0.11, athleticism: 0.09 },
  PF: { inside: 0.3, outside: 0.14, playmaking: 0.07, defense: 0.21, rebounding: 0.23, athleticism: 0.05 },
  C: { inside: 0.34, outside: 0.08, playmaking: 0.06, defense: 0.24, rebounding: 0.24, athleticism: 0.04 },
};

const POS_OFFSETS: Record<Pos, Attrs> = {
  PG: { inside: -12, outside: 4, playmaking: 8, defense: -2, rebounding: -26, athleticism: 3 },
  SG: { inside: -6, outside: 7, playmaking: -2, defense: 0, rebounding: -18, athleticism: 4 },
  SF: { inside: 0, outside: 2, playmaking: -2, defense: 2, rebounding: -4, athleticism: 0 },
  PF: { inside: 5, outside: -8, playmaking: -10, defense: 3, rebounding: 7, athleticism: -4 },
  C: { inside: 7, outside: -16, playmaking: -14, defense: 4, rebounding: 10, athleticism: -8 },
};

export const ATTR_KEYS: (keyof Attrs)[] = [
  'inside',
  'outside',
  'playmaking',
  'defense',
  'rebounding',
  'athleticism',
];

export function computeOverall(pos: Pos, attrs: Attrs): number {
  const w = POS_WEIGHTS[pos];
  let total = 0;
  for (const key of ATTR_KEYS) total += attrs[key] * w[key];
  return clamp(Math.round(total), 25, 99);
}

function emptyStats(): StatLine {
  return { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
}

/**
 * Ratings at or above this point use the flattened star curve. Below it the
 * original market curve is untouched, so role players are priced as before.
 */
const STAR_CURVE_START = 70;

/** How much of the above-70 premium survives the star compression. */
const STAR_CURVE_COMPRESSION = 0.73;

/**
 * Share of the cap a player's rating alone commands. The curve keeps climbing
 * with rating, but from 70 up it is compressed so three 95 OVR stars can share
 * a roster with a supporting cast instead of eating the whole cap.
 */
export function talentShareOf(overall: number): number {
  const rating = clamp((overall - 48) / 51, 0, 1);
  const raw = 0.35 * Math.pow(rating, 2.2);
  if (overall <= STAR_CURVE_START) return raw;
  const atStart = 0.35 * Math.pow((STAR_CURVE_START - 48) / 51, 2.2);
  return atStart + (raw - atStart) * STAR_CURVE_COMPRESSION;
}

export function marketSalary(overall: number, rng: Rng): number {
  const share = talentShareOf(overall) * rng.range(0.9, 1.1);
  return Math.round(clamp(share * CAP, LEAGUE_MIN_SALARY, 0.35 * CAP) * 10) / 10;
}

/**
 * Age premium or discount on the open market. Young players cost more for
 * their upside; players past 30 lose value quickly as their ratings decline.
 */
export function ageSalaryFactor(age: number): number {
  if (age <= 22) return 1.12;
  if (age <= 25) return 1.05;
  if (age <= 29) return 1;
  if (age <= 32) return 0.9;
  if (age <= 35) return 0.78;
  return 0.62;
}

function uniqueName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    let name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (attempt > 30) name = `${name} ${rng.pick(['Jr.', 'II', 'III'])}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  let i = 2;
  const base = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  while (used.has(`${base} #${i}`)) i++;
  used.add(`${base} #${i}`);
  return `${base} #${i}`;
}

interface GenOptions {
  ageMin?: number;
  ageMax?: number;
  potentialBoost?: number;
  tier?: Player['tier'];
  /** Contract scale, so new deals keep pace with a growing salary cap. */
  salaryScale?: number;
}

function genPlayer(
  rng: Rng,
  id: string,
  pos: Pos,
  target: number,
  used: Set<string>,
  opts: GenOptions = {},
): Player {
  const offsets = POS_OFFSETS[pos];
  const attrs = {} as Attrs;
  for (const key of ATTR_KEYS) {
    attrs[key] = clamp(Math.round(target + offsets[key] + rng.range(-6, 6)), 25, 99);
  }
  const overall = computeOverall(pos, attrs);
  const ageMin = opts.ageMin ?? 21;
  const ageMax = opts.ageMax ?? 32;
  const age = ageMin + rng.int(ageMax - ageMin + 1);
  const tier = opts.tier ?? STARTING_TIER;
  // Lower tiers have more room to grow, so a raw tier-5 player is a project
  // rather than a finished product.
  const tierRoom = (tier - 1) * 3;
  const defaultGrowth =
    (age <= 22 ? rng.int(10) + 4 : age <= 25 ? rng.int(7) : rng.int(3)) + tierRoom;
  const growth = opts.potentialBoost ?? defaultGrowth;
  const potential = clamp(overall + growth, 25, 99);
  return {
    id,
    name: uniqueName(rng, used),
    pos,
    age,
    attrs,
    overall,
    potential,
    tier,
    level: STARTING_LEVEL,
          salary: Math.max(
        LEAGUE_MIN_SALARY * (opts.salaryScale ?? 1),
      Math.round(marketSalary(overall, rng) * ageSalaryFactor(age) * (opts.salaryScale ?? 1) * 10) / 10,
    ),
    years: rng.int(4) + 1,
    teamId: null,
    stats: emptyStats(),
    injuryGames: 0,
    injury: null,
  };
}

/**
 * Mint a brand-new NFT from a fusion: an 18-year-old with fresh ratings at the
 * target tier. He is unassigned until the caller signs him or stores him.
 * `baseRating` anchors the mint to the rating a fusion inherits; without it the
 * tier base is used. The fusion caller re-prices his three-year deal after the
 * carried levels land, so it reflects his inherited rating rather than the
 * pre-training base.
 */
export function makeFreshNft(
  state: GameState,
  rng: Rng,
  tier: Player['tier'],
  pos: Pos,
  potentialBonus = 0,
  potentialFloor = 0,
  baseRating?: number,
): Player {
  const used = usedNames(state);
  let id = `nft_${state.season}_${rng.int(1_000_000)}`;
  let guard = 0;
  while (state.players[id] && guard++ < 50) id = `nft_${state.season}_${rng.int(1_000_000)}`;
  const growth = rng.int(10) + 4 + (tier - 1) * 3 + potentialBonus;
  const rating = baseRating ?? TIER_BASE[tier] + rng.range(-3, 2);
  const player = genPlayer(rng, id, pos, rating, used, {
    ageMin: 18,
    ageMax: 18,
    potentialBoost: growth,
    tier,
  });
  // A fusion mint can always grow into the best player that was burned into
  // him, so the inputs' ratings raise his ceiling instead of being pure fuel.
  player.potential = clamp(Math.max(player.potential, potentialFloor), player.overall, 99);
  player.fused = true;
  // mintFusionPlayer prices the final deal after the carried levels land; this
  // placeholder keeps the fresh NFT legal in the meantime.
  player.salary = LEAGUE_MIN_SALARY;
  player.years = ROOKIE_YEARS;
  player.rookie = false;
  player.teamId = null;
  return player;
}

/**
 * Create an unassigned player for a league reward (the Hall of Fame league's
 * champion NFT). The caller signs him; ids and names are unique to the save.
 */
export function makeRewardPlayer(
  state: GameState,
  rng: Rng,
  tier: Player['tier'],
  target: number,
): Player {
  const used = usedNames(state);
  let id = `reward_${state.season}_${rng.int(1_000_000)}`;
  let guard = 0;
  while (state.players[id] && guard++ < 50) id = `reward_${state.season}_${rng.int(1_000_000)}`;
  const player = genPlayer(rng, id, rng.pick(POSITIONS), target, used, {
    tier,
    ageMin: 19,
    ageMax: 27,
  });
  // Keeps the league's premium over the normal tier curve across rating rebuilds.
  player.hofReward = true;
  return player;
}

/* ------------------------------------------------------------------ */
/* Injuries                                                            */
/* ------------------------------------------------------------------ */

export const isInjured = (player: Player): boolean => player.injuryGames > 0;

export function injuredPlayers(state: GameState, teamId: string): Player[] {
  return rosterOf(state, teamId).filter(isInjured).sort((a, b) => b.injuryGames - a.injuryGames);
}

/** Tick one game off every injured player's recovery clock. */
function recoverOneGame(player: Player) {
  if (player.injuryGames <= 0) return;
  player.injuryGames = Math.max(0, player.injuryGames - 1);
  if (player.injuryGames === 0) player.injury = null;
}

/**
 * Roll for one injury on a team after a game. Any rotation player who logged
 * minutes can be hurt, weighted toward the players who played the most.
 */
function rollInjury(
  state: GameState,
  teamId: string,
  roster: Player[],
  box: BoxLine[],
  rng: Rng,
) {
  // The user's medical center reduces both the chance and the recovery time.
  const medical = teamId === state.userTeamId ? facilityLevel(state, 'medical') : 0;
  if (!rng.chance(INJURY_TEAM_CHANCE * difficultyOf(state).injury * (1 - 0.1 * medical))) return;
  const minutes = new Map(
    box.filter((line) => line.teamId === teamId).map((line) => [line.playerId, line.min]),
  );
  const candidates = roster.filter(
    (player) => player.injuryGames <= 0 && (minutes.get(player.id) ?? 0) > 0,
  );
  if (!candidates.length) return;

  const weights = candidates.map((player) => 0.4 + (minutes.get(player.id) ?? 0) / 26);
  let ticket = rng.next() * weights.reduce((sum, weight) => sum + weight, 0);
  let victim = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i++) {
    ticket -= weights[i];
    if (ticket <= 0) {
      victim = candidates[i];
      break;
    }
  }

  let gradeTicket = rng.next();
  let grade = INJURY_GRADES[0];
  for (const option of INJURY_GRADES) {
    if (gradeTicket < option.weight) {
      grade = option;
      break;
    }
    gradeTicket -= option.weight;
  }
  const games = clamp(
    grade.minGames + rng.int(grade.maxGames - grade.minGames + 1),
    1,
    INJURY_MAX_GAMES,
  );
  const recovery = medical ? Math.max(1, games - medical) : games;
  victim.injury = rng.pick(grade.labels);
  victim.injuryGames = recovery;

  if (teamId === state.userTeamId) {
    state.log.unshift({
      id: `log_${state.season}_injury_${victim.id}_${Date.now()}`,
      season: state.season,
      text: `${victim.name} is out ${recovery} game${recovery === 1 ? '' : 's'} with a ${victim.injury.toLowerCase()}.`,
    });
  }
}

export function rosterOf(state: GameState, teamId: string): Player[] {
  return Object.values(state.players).filter((p) => p.teamId === teamId);
}

/** Players whose contract runs out when this season ends. */
export function expiringPlayers(state: GameState, teamId: string): Player[] {
  return rosterOf(state, teamId)
    .filter((player) => player.years === 1)
    .sort((a, b) => b.overall - a.overall);
}

/**
 * Expired contracts the user still controls. They stay on the roster during
 * the offseason until the user re-signs them or lets them walk.
 */
export function pendingContractPlayers(state: GameState, teamId: string): Player[] {
  return rosterOf(state, teamId)
    .filter((player) => player.years <= 0)
    .sort((a, b) => b.overall - a.overall);
}

/** Number of players actually under contract beyond this season. */
export function signedPlayers(state: GameState, teamId: string): Player[] {
  return rosterOf(state, teamId).filter((player) => player.years > 0);
}

export function payrollOf(state: GameState, teamId: string): number {
  const roster = rosterOf(state, teamId).reduce((sum, p) => sum + p.salary, 0);
  const dead = (state.teams[teamId]?.deadMoney ?? []).reduce((sum, deal) => sum + deal.salary, 0);
  return Math.round((roster + dead) * 10) / 10;
}

/** The cap grows with league revenue, so old saves stay playable. */
export function capFor(state: GameState): number {
  return CAP + (state.season - 1) * CAP_GROWTH;
}

/**
 * Season a player joining right now actually plays first. Offseason moves
 * (draft, free agency, trades, CPU roster filling) happen while the old season
 * is still on the calendar, so those players debut when the new year tips off.
 */
export function acquisitionSeason(state: GameState): number {
  return state.phase === 'offseason' ? state.season + 1 : state.season;
}

export function capSpaceOf(state: GameState, teamId: string): number {
  return Math.round((capFor(state) - payrollOf(state, teamId)) * 10) / 10;
}

/**
 * Progressive luxury tax on a season's overage. The first $5M costs 1.5×,
 * the next $10M costs 2× and anything beyond costs 3×. Each consecutive
 * tax season adds 25%, capped at +50% for a third straight year.
 */
export function luxuryTaxFor(over: number, strikes = 0): number {
  if (over <= 0) return 0;
  const first = Math.min(over, 5);
  const second = Math.min(Math.max(over - 5, 0), 10);
  const rest = Math.max(over - 15, 0);
  const base = first * 1.5 + second * 2 + rest * 3;
  const repeat = 1 + 0.25 * Math.min(strikes, 2);
  return Math.round(base * repeat * 10) / 10;
}

/** Facility levels with defaults, so older saves and new leagues behave the same. */
export function facilityLevels(state: GameState): Record<FacilityKey, number> {
  const stored = state.facilities ?? {};
  const read = (key: FacilityKey) => clamp(Math.round(stored[key] ?? 0), 0, FACILITY_MAX_LEVEL);
  return {
    training: read('training'),
    medical: read('medical'),
    scouting: read('scouting'),
    analytics: read('analytics'),
    development: read('development'),
  };
}

export function facilityLevel(state: GameState, key: FacilityKey): number {
  return facilityLevels(state)[key];
}

/** Cash price of the next level, or null when the facility is maxed out. */
export function facilityUpgradeCost(state: GameState, key: FacilityKey): number | null {
  const level = facilityLevel(state, key);
  if (level >= FACILITY_MAX_LEVEL) return null;
  return FACILITIES.find((entry) => entry.key === key)?.costs[level] ?? null;
}

export function upgradeFacility(
  state: GameState,
  key: FacilityKey,
): { state?: GameState; error?: string } {
  const def = FACILITIES.find((entry) => entry.key === key);
  const cost = facilityUpgradeCost(state, key);
  if (!def) return { error: 'Unknown facility.' };
  if (cost === null) return { error: `${def.name} is already maxed out.` };
  if (state.teams[state.userTeamId].cash + 1e-9 < cost) {
    return { error: `${def.name} level ${facilityLevel(state, key) + 1} costs $${cost.toFixed(1)}M in cash.` };
  }
  const s = clone(state);
  const level = facilityLevel(s, key) + 1;
  s.facilities = { ...facilityLevels(s), [key]: level };
  s.teams[s.userTeamId].cash = Math.round((s.teams[s.userTeamId].cash - cost) * 10) / 10;
  s.log.unshift({
    id: `log_${s.season}_facility_${key}_${level}`,
    season: s.season,
    text: `${def.name} upgraded to level ${level} for $${cost.toFixed(1)}M.`,
  });
  return { state: s };
}

/* ---------------- skill academy ---------------- */

export function skillLevelsFor(player: Player): Record<AttrKey, number> {
  const levels = {} as Record<AttrKey, number>;
  for (const key of SKILL_KEYS) {
    levels[key] = clamp(player.skillLevels?.[key] ?? 0, 0, SKILL_MAX_LEVEL);
  }
  return levels;
}

/** How many cash skill levels this player has already bought. */
export function skillLevelTotal(player: Player): number {
  return Object.values(skillLevelsFor(player)).reduce((sum, level) => sum + level, 0);
}

/** Level cap, including the development center's third-level bonus. */
export function skillCapFor(state: GameState, player: Player): number {
  const base = player.age >= SKILL_VETERAN_AGE ? SKILL_VETERAN_CAP : SKILL_TOTAL_CAP;
  return base + (facilityLevel(state, 'development') === 3 ? 1 : 0);
}

export type SkillOffer =
  | { level: number; cost: number }
  | { level: number; cost: null; blocked: 'maxed' | 'capped' };

/** The next level and its price, or why it cannot be bought. */
export function skillOffer(state: GameState, player: Player, key: AttrKey): SkillOffer {
  const level = skillLevelsFor(player)[key];
  if (level >= SKILL_MAX_LEVEL || player.attrs[key] >= SKILL_ATTR_CAP) {
    return { level, cost: null, blocked: 'maxed' };
  }
  if (skillLevelTotal(player) >= skillCapFor(state, player)) {
    return { level, cost: null, blocked: 'capped' };
  }
  const premium = player.attrs[key] >= 85 ? 1.25 : 1;
  const discount = 1 - facilityLevel(state, 'development') * 0.15;
  return { level, cost: Math.round(SKILL_BASE_COSTS[level] * premium * discount * 10) / 10 };
}

/** Buy one targeted attribute point for a player on the user's roster. */
export function buySkillLevel(
  state: GameState,
  playerId: string,
  key: AttrKey,
): { state?: GameState; error?: string } {
  if (hofRosterLocked(state)) return { error: HOF_ROSTER_LOCK };
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) {
    return { error: 'You can only train players on your own roster.' };
  }
  const offer = skillOffer(state, player, key);
  if (offer.cost === null) {
    return {
      error:
        offer.blocked === 'maxed'
          ? `${SKILLS[key].name} is already maxed out.`
          : `${player.name} has used every cash skill level available.`,
    };
  }
  if (state.teams[state.userTeamId].cash + 1e-9 < offer.cost) {
    return { error: `${SKILLS[key].name} level ${offer.level + 1} costs $${offer.cost.toFixed(1)}M in cash.` };
  }

  const s = clone(state);
  const live = s.players[playerId];
  const levels = skillLevelsFor(live);
  levels[key] += 1;
  live.skillLevels = levels;
  live.attrs[key] = Math.min(SKILL_ATTR_CAP, live.attrs[key] + SKILL_ATTR_GAIN);
  live.overall = computeOverall(live.pos, live.attrs);
  live.potential = Math.max(live.potential, live.overall);
  s.teams[s.userTeamId].cash = Math.round((s.teams[s.userTeamId].cash - offer.cost) * 10) / 10;
  s.log.unshift({
    id: `log_${s.season}_skill_${playerId}_${key}_${offer.level + 1}`,
    season: s.season,
    text: `${live.name} completed ${SKILLS[key].name} level ${offer.level + 1} (+${SKILL_ATTR_GAIN} ${key}) for $${offer.cost.toFixed(1)}M.`,
  });
  return { state: s };
}

/** Committed salary for the next four seasons (index 0 is this season). */
export function payrollByYear(state: GameState, teamId: string): number[] {
  const years = [0, 0, 0, 0];
  for (const player of rosterOf(state, teamId)) {
    if (player.years <= 0) continue;
    for (let year = 0; year < Math.min(4, player.years); year++) years[year] += player.salary;
  }
  for (const deal of state.teams[teamId]?.deadMoney ?? []) {
    for (let year = 0; year < Math.min(4, deal.years); year++) years[year] += deal.salary;
  }
  return years.map((value) => Math.round(value * 10) / 10);
}

function difficultyOf(state: GameState) {
  return DIFFICULTY[state.settings?.difficulty ?? 'standard'];
}

function tpMultiplier(state: GameState): number {
  return difficultyOf(state).tp;
}

/** Difficulty scales the user's rewards more than the CPUs'. */
function tpFor(state: GameState, teamId: string): number {
  const base = tpMultiplier(state);
  if (teamId !== state.userTeamId) return base * difficultyOf(state).cpuTraining;
  // The training complex only lifts the user's own program.
  return base * (1 + 0.06 * facilityLevel(state, 'training'));
}

/* ------------------------------------------------------------------ */
/* Player tiers, levels and the training economy                       */
/* ------------------------------------------------------------------ */

/** Cost in training points to add one level. Higher tiers train cheaper. */
export function trainingCost(player: Player): number {
  return 8 + player.level * 2 + (5 - player.tier) * 4;
}

/**
 * The lowest tier training alone can reach. Only the CPU still promotes this
 * way; players move up by fusing maxed NFTs.
 */
const CPU_TIER_CEILING: Player['tier'] = 2;

/** Cost in training points for the CPU to promote a max-level player a tier. */
function tierUpCost(player: Player): number {
  return 120 + (5 - player.tier) * 80;
}

/** Attribute points gained per training level. Uniform, so no tier stalls. */
export function trainingGain(_player: Player): number {
  return TRAINING_ATTR_GAIN;
}

export const isSuperstar = (player: Player) => player.overall >= 85;

function attrOrder(pos: Pos): (keyof Attrs)[] {
  return [...ATTR_KEYS].sort((a, b) => POS_WEIGHTS[pos][b] - POS_WEIGHTS[pos][a]);
}

function applyTrainingLevel(player: Player) {
  const order = attrOrder(player.pos);
  const gain = trainingGain(player);
  for (let i = 0; i < gain; i++) {
    const key = order[i % order.length];
    player.attrs[key] = clamp(player.attrs[key] + 1, 25, 99);
  }
  player.level = Math.min(MAX_LEVEL, player.level + 1);
  player.overall = Math.min(99, computeOverall(player.pos, player.attrs));
  player.potential = Math.max(player.potential, player.overall);
}

function applyTierUp(player: Player) {
  for (const key of ATTR_KEYS) player.attrs[key] = clamp(player.attrs[key] + 2, 25, 99);
  player.tier = (player.tier - 1) as Player['tier'];
  player.level = 1;
  player.overall = Math.min(99, computeOverall(player.pos, player.attrs));
  player.potential = Math.max(player.potential, player.overall);
}

function ratingsSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Rebuild every player's attributes from his tier and training level. Ratings
 * are deterministic per player, so a reset is stable across reloads. Used once
 * on older saves after the tier curve was rebalanced.
 */
export function resetPlayerRatings(players: Record<string, Player>): void {
  for (const player of Object.values(players)) {
    const rng = new Rng(ratingsSeed(`${player.id}:${player.tier}:${player.level}`));
    const target =
      TIER_BASE[player.tier] +
      (player.hofReward ? HOF_REWARD_PREMIUM : 0) +
      Math.max(0, player.level - 1);
    const offsets = POS_OFFSETS[player.pos];
    const attrs = {} as Attrs;
    for (const key of ATTR_KEYS) {
      attrs[key] = clamp(Math.round(target + offsets[key] + rng.range(-4, 4)), 25, 99);
    }
    // Cash-purchased skill points survive a ratings rebuild.
    const levels = skillLevelsFor(player);
    for (const key of ATTR_KEYS) attrs[key] = clamp(attrs[key] + levels[key] * SKILL_ATTR_GAIN, 25, 99);
    player.attrs = attrs;
    player.overall = computeOverall(player.pos, attrs);
    player.potential = clamp(Math.max(player.potential, player.overall), player.overall, 99);
  }
}

/**
 * The Hall of Fame bracket is priced on the roster that opened it, so a live
 * entry freezes the club: nothing may add or improve a player until the bracket
 * settles. Without this an owner could enter with a thin roster, draw a weak
 * field and call up stored stars or train before the games are played.
 */
export const HOF_ROSTER_LOCK =
  'Finish your Hall of Fame bracket before changing the roster.';

export function hofRosterLocked(state: GameState): boolean {
  return Boolean(state.hof && state.hof.season === state.season && !state.hof.champion);
}

/**
 * Spend every available training point in one pass. Clones once, so simulators
 * and any future auto-training do not pay for a full league copy per level.
 */
export function spendTrainingPoints(state: GameState, teamId = state.userTeamId): GameState {
  if (teamId === state.userTeamId && hofRosterLocked(state)) return state;
  const s = clone(state);
  trainCpuTeam(s, teamId);
  return s;
}

export function trainPlayer(state: GameState, playerId: string): GameState {
  if (hofRosterLocked(state)) return state;
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  if (player.level >= MAX_LEVEL) return state;
  if (state.teams[state.userTeamId].trainingPoints < trainingCost(player)) return state;

  const s = clone(state);
  const team = s.teams[s.userTeamId];
  const live = s.players[playerId];
  team.trainingPoints -= trainingCost(live);
  applyTrainingLevel(live);
  return s;
}

/**
 * Mint what a fusion buys: an 18-year-old a tier above the burned group whose
 * rating is inherited from the best burned player instead of the tier base, so
 * the trade returns a player priced against the material that made him rather
 * than a level-1 project far below it.
 */
function mintFusionPlayer(
  state: GameState,
  rng: Rng,
  inputTier: Player['tier'],
  pos: Pos,
  anchor: Player,
): Player {
  const target = clamp(Math.round(anchor.overall * FUSION_RATING_INHERITANCE), 25, 99);
  // The mint must be built from a base below the target so the carried levels
  // land on the inherited rating; the tier base stays a floor.
  const base = clamp(
    target - FUSION_CARRY_LEVELS,
    TIER_BASE[(inputTier - 1) as Player['tier']],
    99,
  );
  const nft = makeFreshNft(
    state,
    rng,
    (inputTier - 1) as Player['tier'],
    pos,
    4,
    anchor.overall,
    base,
  );
  for (let level = 0; level < FUSION_CARRY_LEVELS; level++) applyTrainingLevel(nft);
  // Price the finished mint off the rating he actually inherits, not his
  // pre-training base: a weak bench consolidation gets a cheap deal and a
  // star-level mint carries a star-level salary. salaryDemand already applies
  // the fused-player discount and the age curve; the league minimum keeps a low
  // target legal.
  nft.salary = Math.max(LEAGUE_MIN_SALARY, salaryDemand(nft, capFor(state)));
  return nft;
}

/**
 * Fuse 3 fully trained players into one brand-new NFT a tier above them. The
 * inputs are destroyed for good; the mint is a fresh 18-year-old with random
 * ratings on a fused-player deal. If his contract cannot fit on the roster or
 * under the cap he is stored in your collection instead of signed.
 */
export function fusePlayers(state: GameState, playerIds: string[]): MarketResult {
  if (hofRosterLocked(state)) return { error: HOF_ROSTER_LOCK };
  const check = fusionCheck(state, playerIds);
  if (!check.ok) return { error: check.reason ?? 'Those players cannot be fused.' };

  const inputs = playerIds.map((id) => state.players[id]);
  const anchor = [...inputs].sort((a, b) => b.overall - a.overall)[0];
  const cost = fusionHwdCost(anchor.overall);

  const s = clone(state);
  // The merge burns on-chain assets and pays for the mint in HWD. The fee is
  // moved to the development treasury, never minted or burned.
  s.hwd = hwdBalance(s) - cost;
  s.devFund = devFundBalance(s) + cost;
  const rng = new Rng(s.rngState);
  // The three burned inputs buy the mint a little extra room to grow, and the
  // best of them sets both the mint's inherited rating and a floor under his
  // ceiling.
  const nft = mintFusionPlayer(s, rng, inputs[0].tier, anchor.pos, anchor);

  for (const id of playerIds) {
    delete s.players[id];
  }
  if (s.lineup) s.lineup = s.lineup.filter((id) => !playerIds.includes(id));
  s.market = (s.market ?? []).filter((listing) => !playerIds.includes(listing.playerId));
  s.stash = (s.stash ?? []).filter((id) => !playerIds.includes(id));

  s.players[nft.id] = nft;
  const fitsRoster = rosterOf(s, s.userTeamId).length < ROSTER_MAX;
  const fitsCap = payrollOf(s, s.userTeamId) + nft.salary <= capFor(s) + 1e-9;
  const signed = fitsRoster && fitsCap;
  // The mint only replaces its inputs on the roster when it can be signed; a
  // mint that goes to the collection adds nobody. Either way the roster left
  // behind must be legal, which the old "inputs + 1" check got wrong.
  const rosterAfter = rosterOf(s, s.userTeamId).length + (signed ? 1 : 0);
  // A manager may dip below the eight-man floor in the offseason while fusing
  // and rebuilding; the new season cannot tip off until the roster is legal.
  if (rosterAfter < ROSTER_MIN && s.phase !== 'offseason') {
    return { error: `You must keep at least ${ROSTER_MIN} players on the roster.` };
  }
  // A stored mint needs a free slot in the collection; refuse before burning the inputs.
  if (!signed && (s.stash ?? []).length >= STASH_LIMIT) {
    return {
      error: `Your stored NFT collection is full (${STASH_LIMIT}). Sign or fuse a stored NFT first.`,
    };
  }
  if (signed) {
    nft.teamId = s.userTeamId;
    nft.joinedSeason = acquisitionSeason(s);
  } else {
    s.stash = [...(s.stash ?? []), nft.id];
  }
  sanitizeLineup(s);
  s.rngState = rng.state;

  s.log.unshift({
    id: `log_${s.season}_fusion_${nft.id}`,
    season: s.season,
    text: `Fusion: ${inputs.map((player) => player.name).join(', ')} burned into ${nft.name}, a new tier ${nft.tier} NFT at level ${nft.level} (${nft.overall} OVR, ${nft.potential} potential) for ${cost} HWD to the development fund.`,
  });
  if (!signed) {
    s.log.unshift({
      id: `log_${s.season}_fusion_stored_${nft.id}`,
      season: s.season,
      text: `${nft.name} was stored in your NFT collection: ${
        fitsRoster ? 'his contract does not fit under the cap' : 'the roster is full'
      }. Sign him when there is room.`,
    });
  }
  return { state: s };
}

/* ------------------------------------------------------------------ */
/* Stored NFTs                                                         */
/* ------------------------------------------------------------------ */

/** NFTs you own that are not on the active roster. */
export function stashPlayers(state: GameState): Player[] {
  return (state.stash ?? [])
    .map((id) => state.players[id])
    .filter((player): player is Player => Boolean(player) && player.teamId === null)
    .sort((a, b) => b.overall - a.overall);
}

/** Sign a stored NFT onto the roster; his contract starts counting against the cap. */
export function signStashedPlayer(state: GameState, playerId: string): MarketResult {
  if (hofRosterLocked(state)) return { error: HOF_ROSTER_LOCK };
  const player = state.players[playerId];
  if (!player || !(state.stash ?? []).includes(playerId) || player.teamId !== null) {
    return { error: 'That NFT is not in your collection.' };
  }
  if (rosterOf(state, state.userTeamId).length >= ROSTER_MAX) {
    return { error: 'Roster is full. Waive a player first.' };
  }
  if (payrollOf(state, state.userTeamId) + player.salary > capFor(state) + 1e-9) {
    return { error: `${player.name}'s $${player.salary.toFixed(1)}M deal does not fit under the cap.` };
  }

  const s = clone(state);
  const live = s.players[playerId];
  live.teamId = s.userTeamId;
  live.joinedSeason = acquisitionSeason(s);
  // An expired stored NFT arrives on a fresh minimum deal instead of an
  // already-finished contract.
  if (live.years <= 0) live.years = 1;
  s.stash = (s.stash ?? []).filter((id) => id !== playerId);
  sanitizeLineup(s);
  s.log.unshift({
    id: `log_${s.season}_stash_sign_${playerId}`,
    season: s.season,
    text: `Signed ${live.name} (tier ${live.tier}, ${live.overall} OVR) from your stored NFTs.`,
  });
  return { state: s };
}

/**
 * Sell HWD back to the league for training points. The desk is a sink, not a
 * market: the tokens leave the wallet and buy TP at HWD_TP_RATE with no cut.
 * A per-season and a per-day cap keep TP from being bought in bulk, and each
 * cap is stored with the season or day it belongs to, so both reopen on their
 * own clock.
 */
export function convertHwdToTrainingPoints(
  state: GameState,
  hwd: number,
  now = new Date(),
): { state?: GameState; error?: string } {
  if (hofRosterLocked(state)) {
    return { error: 'Your roster is locked until the Hall of Fame bracket finishes.' };
  }
  const amount = Math.floor(hwd);
  if (!Number.isFinite(amount) || amount < HWD_TP_MIN) {
    return { error: `The desk converts at least ${HWD_TP_MIN} HWD at a time.` };
  }
  const remaining = hwdTpRemaining(state);
  if (remaining <= 0) {
    return { error: 'You have already converted your HWD for this season.' };
  }
  if (amount > remaining) {
    return { error: `Only ${remaining} HWD can still be converted this season.` };
  }
  const remainingToday = hwdTpRemainingToday(state, now);
  if (remainingToday <= 0) {
    return { error: 'You have already converted your HWD for today.' };
  }
  if (amount > remainingToday) {
    return { error: `Only ${remainingToday} HWD can be converted today.` };
  }
  const balance = hwdBalance(state);
  if (amount > balance) {
    return { error: `That conversion costs ${amount} HWD and you have ${balance}.` };
  }

  const { tp } = hwdTpQuote(amount);
  const spent = hwdTpSpent(state);
  const spentToday = hwdTpSpentToday(state, now);
  const s = clone(state);
  s.hwd = balance - amount;
  s.teams[s.userTeamId].trainingPoints += tp;
  s.tpSwap = {
    season: s.season,
    hwd: spent + amount,
    day: todayKey(now),
    dayHwd: spentToday + amount,
  };
  s.log.unshift({
    id: `log_${s.season}_hwd_tp_${s.log.length}`,
    season: s.season,
    text: `Conversion desk: ${amount} HWD turned into ${tp} training points.`,
  });
  return { state: s };
}

export function convertPointsToCash(state: GameState, blocks = 1): GameState {
  const team = state.teams[state.userTeamId];
  const points = blocks * POINTS_PER_CASH_BLOCK;
  if (blocks < 1 || team.trainingPoints < points) return state;

  const s = clone(state);
  const next = s.teams[s.userTeamId];
  next.trainingPoints -= points;
  next.cash = Math.round((next.cash + blocks * CASH_PER_BLOCK) * 10) / 10;
  return s;
}

function tradeValue(p: Player): number {
  const base = Math.pow(Math.max(1, p.overall - 45), 1.85);
  const ageFactor = p.age <= 23 ? 1.35 : p.age <= 26 ? 1.2 : p.age <= 29 ? 1 : p.age <= 32 ? 0.8 : 0.55;
  const contractFactor = 1 + (3 - Math.min(3, p.years)) * 0.03;
  const salaryFactor = 1 - Math.min(0.25, p.salary / 400);
  return base * ageFactor * contractFactor * salaryFactor;
}

function buildSchedule(teamIds: string[]): Game[] {
  const n = teamIds.length;
  const fixed = teamIds[0];
  const rot = teamIds.slice(1);
  const rounds: { home: string; away: string }[][] = [];

  for (let r = 0; r < n - 1; r++) {
    const circle = [fixed, ...rot];
    const pairs: { home: string; away: string }[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      const aHome = (r + i) % 2 === 0;
      pairs.push(aHome ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(pairs);
    rot.unshift(rot.pop() as string);
  }

  const games: Game[] = [];
  const pushRound = (pairs: { home: string; away: string }[], round: number) => {
    pairs.forEach((pair, i) => {
      games.push({
        id: `g${round}_${i}_${pair.home}_${pair.away}`,
        round,
        home: pair.home,
        away: pair.away,
        played: false,
        homeScore: 0,
        awayScore: 0,
        box: null,
      });
    });
  };

  rounds.forEach((pairs, r) => pushRound(pairs, r));
  rounds.slice(0, SEASON_ROUNDS - rounds.length).forEach((pairs, r) => {
    pushRound(
      pairs.map((p) => ({ home: p.away, away: p.home })),
      rounds.length + r,
    );
  });

  return games;
}

function defaultLineup(roster: Player[]): string[] {
  const chosen: string[] = [];
  for (const pos of POSITIONS) {
    const byPos = roster
      .filter((p) => p.pos === pos && !chosen.includes(p.id))
      .sort((a, b) => b.overall - a.overall)[0];
    const fallback = roster
      .filter((p) => !chosen.includes(p.id))
      .sort((a, b) => b.overall - a.overall)[0];
    const pick = byPos ?? fallback;
    if (pick) chosen.push(pick.id);
  }
  const bench = roster
    .filter((p) => !chosen.includes(p.id))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 4)
    .map((p) => p.id);
  return [...chosen, ...bench];
}

export function createLeague(
  userTeamId: string,
  seed: number,
  options: { difficulty?: Difficulty; scenario?: Scenario } = {},
): GameState {
  const rng = new Rng(seed);
  const difficulty = options.difficulty ?? 'standard';
  const scenario = options.scenario ?? 'rebuild';
  const teams: Record<string, Team> = {};
  for (const bp of TEAM_BLUEPRINTS) {
    teams[bp.id] = {
      id: bp.id,
      city: bp.city,
      name: bp.name,
      abbr: bp.abbr,
      color: bp.color,
      conference: bp.conference,
      wins: 0,
      losses: 0,
      ptsFor: 0,
      ptsAgainst: 0,
      trainingPoints: 0,
      cash: STARTING_CASH,
      taxDebt: 0,
    };
  }

  const players: Record<string, Player> = {};
  const used = new Set<string>();
  const starterPositions: Pos[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  let nextId = 0;

  // Every franchise opens with tier-5 talent: the weakest players in the league.
  for (const bp of TEAM_BLUEPRINTS) {
    for (let i = 0; i < 10; i++) {
      const pos = i < 5 ? starterPositions[i] : rng.pick(POSITIONS);
      const target = TIER_BASE[5] + rng.range(-4, 3);
      const player = genPlayer(rng, `p${nextId++}`, pos, target, used, { tier: 5 });
      player.teamId = bp.id;
      player.joinedSeason = 1;
      players[player.id] = player;
    }
  }

  const freeAgents: string[] = [];
  for (let i = 0; i < 18; i++) {
    const tier: Player['tier'] = rng.chance(0.4) ? 4 : 5;
    const player = genPlayer(
      rng,
      `p${nextId++}`,
      rng.pick(POSITIONS),
      TIER_BASE[tier] + rng.range(-4, 4),
      used,
      { ageMin: 22, ageMax: 34, tier },
    );
    players[player.id] = player;
    freeAgents.push(player.id);
  }

  // Headline superstars: elite talent that costs a serious cash signing bonus.
  const superstarTiers: Player['tier'][] = [2, 2, 1];
  for (let i = 0; i < 3; i++) {
    const tier = superstarTiers[i];
    const player = genPlayer(
      rng,
      `p${nextId++}`,
      rng.pick(POSITIONS),
      TIER_BASE[tier] + rng.range(-1, 2),
      used,
      { ageMin: 25, ageMax: 30, tier },
    );
    player.salary = salaryDemand(player);
    players[player.id] = player;
    freeAgents.push(player.id);
  }

  const team = teams[userTeamId] ?? teams[TEAM_BLUEPRINTS[0].id];

  // Starting scenarios change only the user's opening roster.
  const userRoster = Object.values(players)
    .filter((p) => p.teamId === team.id)
    .sort((a, b) => b.overall - a.overall);
  if (scenario === 'contender') {
    userRoster.slice(0, 3).forEach((p) => {
      p.tier = 4;
    });
    if (userRoster[3]) userRoster[3].tier = 3;
    resetPlayerRatings(Object.fromEntries(userRoster.map((p) => [p.id, p])));
  } else if (scenario === 'expansion') {
    // Shed two base players so the expansion club opens at the roster minimum.
    for (const player of userRoster.slice(-2)) {
      player.teamId = null;
      freeAgents.push(player.id);
    }
  }

  const state: GameState = {
    version: 1,
    ratingsVersion: RATINGS_VERSION,
    seed,
    rngState: rng.state,
    season: 1,
    phase: 'regular',
    userTeamId: team.id,
    teams,
    players,
    schedule: buildSchedule(TEAM_BLUEPRINTS.map((t) => t.id)),
    round: 0,
    playoffs: [],
    playoffRound: 0,
    freeAgents,
    draftClass: null,
    draftOrder: null,
    draftPickOrigins: null,
    pickOwners: Object.fromEntries(Object.keys(teams).map((id) => [id, id])),
    draftPickIndex: 0,
    lineup: defaultLineup(Object.values(players).filter((p) => p.teamId === team.id)),
    history: [],
    scouted: [],
    devReport: [],
    settings: { difficulty, scenario },
    hwd: HWD_STARTING,
    clubHwd: Object.fromEntries(
      Object.keys(teams)
        .filter((id) => id !== team.id)
        .map((id) => [id, CLUB_HWD_START]),
    ),
    clubHwdVersion: 1,
    devFund: 0,
    market: [],
    log: [
      {
        id: 'log-0',
        season: 1,
        text: `You take over the ${team.city} ${team.name} as general manager.`,
      },
    ],
  };
  state.market = refreshMarketListings(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Lineups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Set the user's starting five. The array order is PG, SG, SF, PF, C; every
 * player must be on the user's roster and match the slot's position.
 */
export function setStarters(state: GameState, ids: string[]): GameState {
  if (ids.length !== POSITIONS.length) return state;
  for (let i = 0; i < ids.length; i++) {
    const player = state.players[ids[i]];
    if (!player || player.teamId !== state.userTeamId) return state;
    if (player.pos !== POSITIONS[i]) return state;
  }
  const bench = (state.lineup ?? [])
    .filter((id) => !ids.includes(id))
    .concat(
      rosterOf(state, state.userTeamId)
        .filter((p) => !ids.includes(p.id) && !(state.lineup ?? []).includes(p.id))
        .sort((a, b) => b.overall - a.overall)
        .map((p) => p.id),
    )
    .slice(0, 4);
  const s = clone(state);
  s.lineup = [...ids, ...bench];
  return s;
}

/** Order the user's bench (the four players after the starters). */
export function setBenchOrder(state: GameState, ids: string[]): GameState {
  const starters = (state.lineup ?? []).slice(0, POSITIONS.length);
  const valid = ids.filter((id) => {
    const player = state.players[id];
    return player && player.teamId === state.userTeamId && !starters.includes(id);
  });
  const rest = rosterOf(state, state.userTeamId)
    .filter((p) => !starters.includes(p.id) && !valid.includes(p.id))
    .sort((a, b) => b.overall - a.overall)
    .map((p) => p.id);
  const s = clone(state);
  s.lineup = [...starters, ...valid, ...rest].slice(0, 9);
  return s;
}

/** A player's lineup role: starter slot, bench, or outside the rotation. */
export function lineupRole(state: GameState, playerId: string): 'starter' | 'bench' | 'reserve' {
  const index = (state.lineup ?? []).indexOf(playerId);
  if (index < 0) return 'reserve';
  return index < POSITIONS.length ? 'starter' : 'bench';
}

/** Default rotation for a team: position-correct starters, then the best bench. */
export function defaultLineupFor(state: GameState): string[] {
  return defaultLineup(rosterOf(state, state.userTeamId));
}

/**
 * Drop anyone who is no longer on the roster and make sure the five starters
 * are a legal PG/SG/SF/PF/C unit. A saved lineup is respected only when it is
 * still legal; otherwise the best available five take over, so a stronger
 * arrival is never left on the bench behind an invalid old lineup.
 */
export function sanitizeLineup(state: GameState): void {
  const roster = rosterOf(state, state.userTeamId);
  const ids = new Set(roster.map((p) => p.id));
  const saved = (state.lineup ?? []).filter((id) => ids.has(id));
  const legalStarters =
    saved.length >= POSITIONS.length &&
    POSITIONS.every((pos, index) => state.players[saved[index]]?.pos === pos);
  const fresh = defaultLineup(roster);
  const starters = legalStarters ? saved.slice(0, POSITIONS.length) : fresh.slice(0, POSITIONS.length);
  const benchPool = roster
    .filter((player) => !starters.includes(player.id))
    .sort((a, b) => b.overall - a.overall)
    .map((player) => player.id);
  const savedBench = saved
    .slice(POSITIONS.length)
    .filter((id) => !starters.includes(id));
  const bench = [...savedBench, ...benchPool.filter((id) => !savedBench.includes(id))].slice(0, 4);
  state.lineup = [...starters, ...bench];
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

function distribute(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const raw = weights.map((w) => total * (Math.max(0, w) / sum));
  const out = raw.map((v) => Math.floor(v));
  let remaining = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remaining > 0 && order.length) {
    out[order[k % order.length].i]++;
    remaining--;
    k++;
  }
  return out;
}

/**
 * Build the nine-man rotation. The user's saved lineup comes first (so chosen
 * starters and bench order are respected), then the best available players
 * fill the gaps. Injured players are skipped.
 */
function rotationOf(roster: Player[], preferred: string[] = []): Player[] {
  const healthy = roster.filter((player) => player.injuryGames <= 0);
  const pool = healthy.length ? healthy : roster;
  const chosen: Player[] = [];
  for (const id of preferred) {
    const player = pool.find((p) => p.id === id);
    if (player && !chosen.includes(player)) chosen.push(player);
  }
  const rest = [...pool].filter((p) => !chosen.includes(p)).sort((a, b) => b.overall - a.overall);
  return [...chosen, ...rest].slice(0, 9);
}

function teamProfile(roster: Player[], preferred: string[] = []) {
  const sorted = rotationOf(roster, preferred);
  const starters = sorted.slice(0, 5);
  const bench = sorted.slice(5, 9);
  const offenseOf = (p: Player) =>
    p.attrs.inside * 0.3 +
    p.attrs.outside * 0.36 +
    p.attrs.playmaking * 0.24 +
    p.attrs.athleticism * 0.1;
  const defenseOf = (p: Player) =>
    p.attrs.defense * 0.62 + p.attrs.rebounding * 0.3 + p.attrs.athleticism * 0.08;
  const avg = (arr: Player[], f: (p: Player) => number) =>
    arr.length ? arr.reduce((sum, p) => sum + f(p), 0) / arr.length : 52;
  const sOff = avg(starters, offenseOf);
  const bOff = bench.length ? avg(bench, offenseOf) : sOff - 6;
  const sDef = avg(starters, defenseOf);
  const bDef = bench.length ? avg(bench, defenseOf) : sDef - 6;
  return { off: sOff * 0.87 + bOff * 0.13, def: sDef * 0.87 + bDef * 0.13 };
}

function gauss(rng: Rng, sd: number): number {
  return (rng.next() + rng.next() + rng.next() - 1.5) * (sd * 2);
}

function teamBox(
  roster: Player[],
  score: number,
  rng: Rng,
  preferred: string[] = [],
): BoxLine[] {
  const players = rotationOf(roster, preferred);
  if (!players.length) return [];

  const minuteWeights = players.map((_, i) =>
    i < 5 ? 1.15 - i * 0.04 : Math.max(0.35, 0.7 - (i - 5) * 0.08),
  );
  const minutes = distribute(240, minuteWeights);

  const usage = players.map((p, i) => {
    const star = Math.pow(p.overall / 52, 2.4);
    const range = 0.85 + p.attrs.outside / 320;
    const roleFactor = i < 5 ? 1 : 0.72 - (i - 5) * 0.05;
    return star * range * roleFactor;
  });

  let tpm = clamp(Math.round(score * rng.range(0.09, 0.125)), 5, 20);
  let ftm = clamp(Math.round(score * rng.range(0.12, 0.16)), 4, 30);
  if ((score - tpm - ftm) % 2 !== 0) ftm = Math.min(30, ftm + 1);
  let fgm = (score - tpm - ftm) / 2;
  if (fgm < tpm) {
    tpm = Math.max(0, Math.floor(fgm));
    ftm = score - 2 * Math.floor((score - tpm) / 2) - tpm;
    fgm = (score - tpm - ftm) / 2;
  }
  fgm = Math.max(0, Math.round(fgm));

  const fga = Math.max(fgm, Math.round(fgm / rng.range(0.43, 0.49)));
  const tpa = clamp(Math.round(tpm / rng.range(0.32, 0.4)), tpm, fga);
  const ast = Math.round(fgm * rng.range(0.5, 0.66));
  const reb = 38 + rng.int(12);
  const stl = 5 + rng.int(6);
  const blk = 3 + rng.int(5);

  const fgmArr = distribute(fgm, usage);
  const tpmArr = distribute(
    tpm,
    players.map((p, i) => usage[i] * (0.4 + p.attrs.outside / 100)),
  );

  for (let i = 0; i < tpmArr.length; i++) {
    let guard = 0;
    while (tpmArr[i] > fgmArr[i] && guard++ < 20) {
      let moved = false;
      for (let j = 0; j < fgmArr.length; j++) {
        if (j !== i && fgmArr[j] > tpmArr[j]) {
          fgmArr[j]--;
          fgmArr[i]++;
          tpmArr[j]++;
          tpmArr[i]--;
          moved = true;
          break;
        }
      }
      if (!moved) {
        tpmArr[i]--;
        break;
      }
    }
  }

  const missArr = distribute(fga - fgm, usage);
  const miss3Arr = distribute(tpa - tpm, players.map((p) => 0.3 + p.attrs.outside / 120));
  const ftmArr = distribute(ftm, usage);
  const rebArr = distribute(reb, players.map((p) => Math.pow(p.attrs.rebounding / 50, 2.1)));
  const astArr = distribute(ast, players.map((p) => Math.pow(p.attrs.playmaking / 50, 2.1)));
  const stlArr = distribute(stl, players.map((p) => Math.pow(p.attrs.defense / 50, 1.8)));
  const blkArr = distribute(blk, players.map((p) => Math.pow((p.attrs.defense + p.attrs.inside) / 100, 2)));

  return players.map((p, i) => ({
    playerId: p.id,
    teamId: p.teamId as string,
    min: minutes[i],
    pts: 2 * fgmArr[i] + tpmArr[i] + ftmArr[i],
    reb: rebArr[i],
    ast: astArr[i],
    stl: stlArr[i],
    blk: blkArr[i],
    fgm: fgmArr[i],
    fga: fgmArr[i] + missArr[i],
    tpm: tpmArr[i],
    tpa: tpmArr[i] + miss3Arr[i],
    ftm: ftmArr[i],
    fta: ftmArr[i] + rng.int(2),
  }));
}

interface SimResult {
  homeScore: number;
  awayScore: number;
  box: BoxLine[];
}

export function simGame(
  state: GameState,
  homeId: string,
  awayId: string,
  rng: Rng,
  countStats = true,
): SimResult {
  const homeRoster = rosterOf(state, homeId);
  const awayRoster = rosterOf(state, awayId);
  // Snapshot who was already hurt at tip-off: they sit this game out and only
  // start ticking once the final buzzer sounds.
  const hurtAtTipOff = [...homeRoster, ...awayRoster].filter((player) => player.injuryGames > 0);
  const homeLineup = homeId === state.userTeamId ? state.lineup ?? [] : [];
  const awayLineup = awayId === state.userTeamId ? state.lineup ?? [] : [];
  const hp = teamProfile(homeRoster, homeLineup);
  const ap = teamProfile(awayRoster, awayLineup);

  const homeScore = clamp(
    Math.round(106 + (hp.off - ap.def) * 0.95 + 2.4 + gauss(rng, 7)),
    70,
    175,
  );
  const awayScore = clamp(Math.round(106 + (ap.off - hp.def) * 0.95 + gauss(rng, 7)), 70, 175);

  const box = [
    ...teamBox(homeRoster, homeScore, rng, homeLineup),
    ...teamBox(awayRoster, awayScore, rng, awayLineup),
  ];

  // Injuries land after the game, so the victim finishes the night he got hurt.
  for (const [teamId, roster] of [
    [homeId, homeRoster],
    [awayId, awayRoster],
  ] as const) {
    rollInjury(state, teamId, roster, box, rng);
  }

  // Recovery happens after the game, never before it, so a player listed
  // OUT 1 actually misses one more game.
  for (const player of hurtAtTipOff) recoverOneGame(player);

  if (countStats) {
    for (const line of box) {
      const player = state.players[line.playerId];
      if (!player) continue;
      const s = player.stats;
      s.gp += 1;
      s.min += line.min;
      s.pts += line.pts;
      s.reb += line.reb;
      s.ast += line.ast;
      s.stl += line.stl;
      s.blk += line.blk;
      s.fgm += line.fgm;
      s.fga += line.fga;
      s.tpm += line.tpm;
      s.tpa += line.tpa;
      s.ftm += line.ftm;
      s.fta += line.fta;
    }
  }

  return { homeScore, awayScore, box };
}

export function simulateNextRound(state: GameState): GameState {
  const s = clone(state);
  if (s.phase !== 'regular') return s;
  const rng = new Rng(s.rngState);
  const games = s.schedule.filter((g) => g.round === s.round && !g.played);
  if (!games.length) {
    s.round += 1;
    if (s.round >= SEASON_ROUNDS) buildPlayoffs(s);
    s.rngState = rng.state;
    return s;
  }

  for (const game of games) {
    const result = simGame(s, game.home, game.away, rng);
    game.played = true;
    game.homeScore = result.homeScore;
    game.awayScore = result.awayScore;
    game.box = result.box;

    const home = s.teams[game.home];
    const away = s.teams[game.away];
    home.ptsFor += result.homeScore;
    home.ptsAgainst += result.awayScore;
    away.ptsFor += result.awayScore;
    away.ptsAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.wins++;
      away.losses++;
      home.trainingPoints += Math.round(WIN_TRAINING_POINTS * tpFor(s, home.id));
      away.trainingPoints += Math.round(LOSS_TRAINING_POINTS * tpFor(s, away.id));
    } else {
      away.wins++;
      home.losses++;
      away.trainingPoints += Math.round(WIN_TRAINING_POINTS * tpFor(s, away.id));
      home.trainingPoints += Math.round(LOSS_TRAINING_POINTS * tpFor(s, home.id));
    }
  }

  s.round++;
  if (s.round >= SEASON_ROUNDS) buildPlayoffs(s);
  s.rngState = rng.state;
  return s;
}

export function simulateSeason(state: GameState): GameState {
  let s = clone(state);
  let guard = 0;
  while (s.phase === 'regular' && guard++ < 40) s = simulateNextRound(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* Standings & playoffs                                                */
/* ------------------------------------------------------------------ */

export function standingsOf(state: GameState, conference: Conf): Team[] {
  return Object.values(state.teams)
    .filter((t) => t.conference === conference)
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const diffA = a.ptsFor - a.ptsAgainst;
      const diffB = b.ptsFor - b.ptsAgainst;
      return diffB - diffA;
    });
}

export function conferenceRank(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  return standingsOf(state, team.conference).findIndex((t) => t.id === teamId) + 1;
}

function newSeries(
  state: GameState,
  round: number,
  label: string,
  high: string,
  low: string,
): Series {
  return {
    id: `s${state.season}_${state.playoffs.length}_${round}`,
    round,
    label,
    high,
    low,
    highWins: 0,
    lowWins: 0,
    games: [],
    winner: null,
  };
}

function gamesNeeded(round: number): number {
  return round === 3 ? 3 : 2;
}

function matchupsForRound(state: GameState, round: number): { high: string; low: string }[] {
  const pairs: { high: string; low: string }[] = [];
  if (round === 1) {
    for (const conf of ['East', 'West'] as Conf[]) {
      const seeds = standingsOf(state, conf).slice(0, PLAYOFF_TEAMS_PER_CONF);
      if (seeds.length >= 4) {
        pairs.push({ high: seeds[0].id, low: seeds[3].id });
        pairs.push({ high: seeds[1].id, low: seeds[2].id });
      }
    }
  }
  return pairs;
}

function buildPlayoffs(state: GameState) {
  state.playoffs = [];
  const qualifiers = new Set<string>();
  for (const pair of matchupsForRound(state, 1)) {
    state.playoffs.push(newSeries(state, 1, 'First Round', pair.high, pair.low));
    qualifiers.add(pair.high);
    qualifiers.add(pair.low);
  }
  for (const teamId of qualifiers) {
    const team = state.teams[teamId];
    const fee = Math.min(team.cash, PLAYOFF_ENTRY_FEE);
    team.cash = Math.round((team.cash - fee) * 10) / 10;
  }
  state.playoffRound = 1;
  state.phase = 'playoffs';
  state.log.unshift({
    id: `log_${state.season}_playoff_fee`,
    season: state.season,
    text: `Playoff qualifiers each pay a $${PLAYOFF_ENTRY_FEE.toFixed(1)}M entry fee.`,
  });
}

function advancePlayoffRound(state: GameState) {
  if (state.playoffRound >= 3) return;
  const current = state.playoffs.filter((s) => s.round === state.playoffRound);
  if (!current.length || current.some((s) => !s.winner)) return;
  const winners = current.map((s) => s.winner as string);
  const nextRound = state.playoffRound + 1;

  if (nextRound === 2) {
    for (const conf of ['East', 'West'] as Conf[]) {
      const confWinners = winners
        .filter((id) => state.teams[id].conference === conf)
        .sort((a, b) => state.teams[b].wins - state.teams[a].wins);
      if (confWinners.length === 2) {
        state.playoffs.push(
          newSeries(state, 2, 'Conference Finals', confWinners[0], confWinners[1]),
        );
      }
    }
  } else if (nextRound === 3) {
    const finalists = [...winners].sort((a, b) => state.teams[b].wins - state.teams[a].wins);
    if (finalists.length === 2) {
      state.playoffs.push(newSeries(state, 3, 'League Finals', finalists[0], finalists[1]));
    }
  }

  state.playoffRound = nextRound;
}

export function simulatePlayoffGame(state: GameState): GameState {
  const s = clone(state);
  if (s.phase !== 'playoffs') return s;
  const rng = new Rng(s.rngState);
  const series = s.playoffs.find((x) => x.round === s.playoffRound && !x.winner);

  if (!series) {
    if (s.playoffRound >= 3) return s;
    advancePlayoffRound(s);
    s.rngState = rng.state;
    return s;
  }

  const result = simGame(s, series.high, series.low, rng, true);
  series.games.push({
    home: series.high,
    away: series.low,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
  });
  const playoffWinner = result.homeScore > result.awayScore ? series.high : series.low;
  const playoffLoser = playoffWinner === series.high ? series.low : series.high;
  if (result.homeScore > result.awayScore) series.highWins++;
  else series.lowWins++;
  s.teams[playoffWinner].trainingPoints += Math.round(PLAYOFF_WIN_POINTS * tpFor(s, playoffWinner));
  s.teams[playoffLoser].trainingPoints += Math.round(PLAYOFF_LOSS_POINTS * tpFor(s, playoffLoser));
  s.teams[playoffWinner].cash =
    Math.round((s.teams[playoffWinner].cash + PLAYOFF_WIN_CASH) * 10) / 10;

  if (series.highWins >= gamesNeeded(series.round)) series.winner = series.high;
  else if (series.lowWins >= gamesNeeded(series.round)) series.winner = series.low;
  if (series.winner && series.round === 3) {
    const runnerUp = series.winner === series.high ? series.low : series.high;
    s.teams[series.winner].trainingPoints += Math.round(
      TITLE_BONUS_POINTS * tpFor(s, series.winner),
    );
    s.teams[series.winner].cash =
      Math.round((s.teams[series.winner].cash + TITLE_CASH_PRIZE) * 10) / 10;
    s.teams[runnerUp].cash =
      Math.round((s.teams[runnerUp].cash + RUNNER_UP_CASH_PRIZE) * 10) / 10;
    s.log.unshift({
      id: `log_${s.season}_title`,
      season: s.season,
      text: `${s.teams[series.winner].city} ${s.teams[series.winner].name} win the title and $${TITLE_CASH_PRIZE.toFixed(1)}M; ${s.teams[runnerUp].city} take home $${RUNNER_UP_CASH_PRIZE.toFixed(1)}M as runners-up.`,
    });
  }

  const roundDone = s.playoffs
    .filter((x) => x.round === s.playoffRound)
    .every((x) => Boolean(x.winner));
  if (roundDone) advancePlayoffRound(s);

  s.rngState = rng.state;
  return s;
}

export function simulatePlayoffs(state: GameState): GameState {
  let s = clone(state);
  let guard = 0;
  while (s.phase === 'playoffs' && guard++ < 120) {
    const before = JSON.stringify(s.playoffs);
    s = simulatePlayoffGame(s);
    if (JSON.stringify(s.playoffs) === before && s.playoffRound >= 3) break;
  }
  return s;
}

export function championOf(state: GameState): string | null {
  const finals = state.playoffs.filter((s) => s.round === 3);
  return finals.length && finals[0].winner ? finals[0].winner : null;
}

/* ------------------------------------------------------------------ */
/* Offseason                                                           */
/* ------------------------------------------------------------------ */

/**
 * Asking salary after a season: a convex share of the cap set by overall,
 * lifted by production and adjusted for age. Pricing in cap shares keeps a
 * league whose ratings rise over time inside the cap: the star curve tops a
 * 95 OVR talent share out at 23% of it, and even a young 26 PPG scorer is
 * capped at 26%, so three stars plus a minimum roster fit.
 */
export function salaryDemand(player: Player, cap = CAP): number {
  const talentShare = talentShareOf(player.overall);
  const ppg = player.stats.gp ? player.stats.pts / player.stats.gp : 0;
  const apg = player.stats.gp ? player.stats.ast / player.stats.gp : 0;
  // Production is an additive cap share, so it still matters for a player whose
  // talent share sits near the minimum.
  let production = 0;
  if (ppg >= 26) production = 0.1;
  else if (ppg >= 21) production = 0.08;
  else if (ppg >= 16) production = 0.05;
  else if (ppg >= 11) production = 0.02;
  if (apg >= 8) production += 0.02;
  const share = clamp((talentShare + production) * ageSalaryFactor(player.age), 0.016, 0.26);
  // A fused player is discounted once, on the freshly computed demand: the age
  // factor and the clamp have already done their work, and a later re-signing
  // starts from the rating again, so the discount can never compound. League
  // and Hall of Fame reward players are priced at the full market rate.
  const rate = player.fused ? FUSION_SALARY_MULTIPLIER : 1;
  return Math.round(cap * share * rate * 10) / 10;
}

/**
 * A Hall of Fame (tier 0) player who has reached his ceiling never ages again:
 * having hit his prime stats he holds his peak instead of declining, so the
 * owner keeps the player he paid for.
 */
function isImmortal(player: Player): boolean {
  return player.tier === 0 && player.overall >= player.potential;
}

function developPlayer(player: Player, rng: Rng) {
  player.age += 1;
  let delta = 0;
  const gap = Math.max(0, player.potential - player.overall);
  if (player.age <= 23) delta = Math.min(gap, rng.int(5) + 2);
  else if (player.age <= 26) delta = Math.min(gap, rng.int(4) + 1);
  else if (player.age <= 29) delta = rng.int(3) - 1;
  else if (player.age <= 33) delta = -(rng.int(3) + 1);
  else delta = -(rng.int(4) + 2);

  for (const key of ATTR_KEYS) {
    player.attrs[key] = clamp(player.attrs[key] + delta + rng.int(3) - 1, 25, 99);
  }
  player.overall = Math.min(player.potential + 2, computeOverall(player.pos, player.attrs));
  if (player.age >= 30) player.potential = Math.max(player.overall, player.potential - 2);
  player.stats = emptyStats();
}

function trainCpuTeam(state: GameState, teamId: string) {
  const team = state.teams[teamId];
  for (let guard = 0; guard < 500; guard++) {
    const roster = rosterOf(state, teamId);
    if (!roster.length) return;
    const trainee = roster
      .filter((p) => p.level < MAX_LEVEL)
      .sort((a, b) => b.overall - a.overall)[0];
    if (trainee && team.trainingPoints >= trainingCost(trainee)) {
      team.trainingPoints -= trainingCost(trainee);
      applyTrainingLevel(trainee);
      continue;
    }
    const promotable = roster
      .filter((p) => p.level >= MAX_LEVEL && p.tier > CPU_TIER_CEILING)
      .sort((a, b) => b.overall - a.overall)[0];
    if (promotable && team.trainingPoints >= tierUpCost(promotable)) {
      team.trainingPoints -= tierUpCost(promotable);
      applyTierUp(promotable);
      continue;
    }
    return;
  }
}

/**
 * A CPU club fuses on the same terms as an owner: three same-tier players at
 * max level are burned for good, the HWD fee leaves its club balance for the
 * development treasury, and the mint is a fresh 18-year-old a tier above them.
 *
 * A playoff club only spends players from the end of its bench; a club that just
 * missed the playoffs is rebuilding and may melt its supporting cast instead. It
 * always keeps its best player, needs depth to spare and one fusion per club per
 * offseason, so this is never a hidden way for the CPU to get better for free.
 */
function cpuFuse(state: GameState, teamId: string, rng: Rng): void {
  const roster = rosterOf(state, teamId);
  if (roster.length < CPU_FUSION_ROSTER_MIN) return;
  // A club that just missed the playoffs is rebuilding and will melt its
  // supporting cast; a playoff club only ever spends players from the end of its
  // bench, so a good team never fuses its way out of contention.
  const rebuilding = conferenceRank(state, teamId) > PLAYOFF_TEAMS_PER_CONF;
  const kept = [...roster].sort((a, b) => b.overall - a.overall);
  const spare = kept.slice(rebuilding ? 1 : 9);
  // Best tier first: 2 -> 1 is the move training cannot make for a CPU club.
  for (let tier = FUSION_TOP_TIER + 1; tier <= FUSION_BOTTOM_TIER; tier++) {
    const group = spare.filter(
      (p) => p.tier === tier && p.level >= MAX_LEVEL,
    );
    if (group.length < FUSION_MIN_PLAYERS) continue;
    const burned = group.sort((a, b) => a.overall - b.overall).slice(0, FUSION_MIN_PLAYERS);
    const anchor = burned[burned.length - 1];
    const fee = fusionHwdCost(anchor.overall);
    if (clubHwdBalance(state, teamId) < fee) continue;
    const probe = mintFusionPlayer(state, rng, tier as Player['tier'], anchor.pos, anchor);
    // The mint must fit the cap the three burned deals leave behind; a club that
    // cannot sign him does not burn three players for a prospect it cannot use.
    const payrollAfter = payrollOf(state, teamId) - burned.reduce((sum, p) => sum + p.salary, 0);
    if (payrollAfter + probe.salary > capFor(state) + 1e-9) return;

    state.clubHwd = {
      ...(state.clubHwd ?? {}),
      [teamId]: clubHwdBalance(state, teamId) - fee,
    };
    state.devFund = devFundBalance(state) + fee;
    for (const player of burned) {
      delete state.players[player.id];
    }
    state.market = (state.market ?? []).filter(
      (listing) => !burned.some((player) => player.id === listing.playerId),
    );
    probe.teamId = teamId;
    probe.joinedSeason = acquisitionSeason(state);
    state.players[probe.id] = probe;
    return;
  }
}

/** A CPU club needs this much depth before it will burn three players on a fusion. */
const CPU_FUSION_ROSTER_MIN = 13;

function fillCpuRosters(state: GameState, rng: Rng) {
  for (const team of Object.values(state.teams)) {
    // The user's roster is the user's job: no auto-signing and no free bonuses.
    if (team.id === state.userTeamId) continue;
    let guard = 0;
    while (rosterOf(state, team.id).length < 10 && guard++ < 20) {
      const space = capSpaceOf(state, team.id);
      const roster = rosterOf(state, team.id);
      const needs = POSITIONS.filter(
        (pos) => roster.filter((p) => p.pos === pos).length < 2,
      );
      let candidates = state.freeAgents
        .map((id) => state.players[id])
        .filter((p): p is Player => Boolean(p) && p.salary <= space && p.teamId === null)
        .sort((a, b) => {
          const needA = needs.includes(a.pos) ? 1 : 0;
          const needB = needs.includes(b.pos) ? 1 : 0;
          if (needA !== needB) return needB - needA;
          return tradeValue(b) - tradeValue(a);
        });
      if (!candidates.length) {
        // Minimum-salary fallback: a capped-out CPU team can still field eight.
        if (roster.length >= 8) break;
        candidates = state.freeAgents
          .map((id) => state.players[id])
          .filter((p): p is Player => Boolean(p) && p.teamId === null)
          .sort((a, b) => a.salary - b.salary);
      }
      if (!candidates.length) break;
      const pick = rng.chance(0.6) ? candidates[0] : candidates[Math.min(rng.int(3), candidates.length - 1)];
      pick.teamId = team.id;
      pick.years = Math.max(1, pick.years);
      state.freeAgents = state.freeAgents.filter((id) => id !== pick.id);
    }
  }
}

/** Talent value CPU teams use when deciding who to keep and who to chase. */
function cpuPriority(player: Player): number {
  return (
    player.overall +
    Math.min(8, Math.max(0, player.potential - player.overall)) * 0.6 +
    (player.age <= 24 ? 4 : 0) -
    (player.age >= 34 ? 6 : 0)
  );
}

/**
 * CPU teams negotiate with their own expiring players before free agency. They
 * keep what fits under the cap, reserve room for minimum deals, and let the
 * rest walk.
 */
function cpuResignPlayers(state: GameState) {
  const cap = capFor(state);
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    const roster = rosterOf(state, team.id);
    const pending = roster.filter((player) => player.years <= 0);
    if (!pending.length) continue;

    let count = roster.length - pending.length;
    let committed = roster
      .filter((player) => player.years > 0)
      .reduce((sum, player) => sum + player.salary, 0);

    pending.sort((a, b) => cpuPriority(b) - cpuPriority(a));
    for (const player of pending) {
      // Leave room for minimum deals and the incoming rookie, both priced as
      // a share of the cap so the reserve stays meaningful as the league grows.
      const reserve = Math.max(0, 9 - count) * 0.02 * cap + 0.1 * cap;
      // A first-time offender can stretch for a superstar; repeat offenders cannot.
      const starRoom =
        player.overall >= 84 && (team.taxStrikes ?? 0) === 0 ? 3 : 0;
      if (count < ROSTER_MAX && player.salary <= cap - committed - reserve + starRoom) {
        player.years = player.age <= 29 ? 3 : player.age <= 32 ? 2 : 1;
        player.rookie = false;
        committed += player.salary;
        count += 1;
        if (player.overall >= 82) {
          state.log.unshift({
            id: `log_${state.season}_cpu_resign_${player.id}`,
            season: state.season,
            text: `${team.city} ${team.name} re-sign ${player.name} for $${player.salary.toFixed(1)}M per year.`,
          });
        }
      } else {
        player.teamId = null;
        player.years = 0;
        player.option = null;
        if (!state.freeAgents.includes(player.id)) state.freeAgents.push(player.id);
      }
    }
  }
}

/**
 * Could this club make room for an incoming player by releasing the weakest
 * man on its roster? Only a clear upgrade is worth eating the rest of a deal
 * as dead money, and a club never cuts below the roster minimum.
 */
function canReleaseFor(state: GameState, teamId: string, incoming: Player): boolean {
  const roster = rosterOf(state, teamId);
  if (roster.length < ROSTER_MAX) return true;
  if (roster.length <= ROSTER_MIN) return false;
  const weakest = [...roster].sort((a, b) => cpuPriority(a) - cpuPriority(b))[0];
  return Boolean(weakest) && cpuPriority(incoming) >= cpuPriority(weakest) + 8;
}

/**
 * Open a roster spot by waiving the weakest player. The remaining salary stays
 * on the cap as dead money, exactly like a user waiver, so a rival cannot cut
 * its way out of a bad contract and the payroll never shrinks by the move.
 */
function releaseWeakest(state: GameState, teamId: string, incoming: Player): void {
  if (rosterOf(state, teamId).length < ROSTER_MAX) return;
  const cut = [...rosterOf(state, teamId)].sort((a, b) => cpuPriority(a) - cpuPriority(b))[0];
  if (!cut || cut === incoming) return;
  if (cut.years > 0) {
    state.teams[teamId].deadMoney = [
      ...(state.teams[teamId].deadMoney ?? []),
      { name: cut.name, salary: cut.salary, years: cut.years },
    ];
  }
  cut.teamId = null;
  cut.years = 0;
  cut.option = null;
  if (!state.freeAgents.includes(cut.id)) state.freeAgents.push(cut.id);
}

/**
 * CPU clubs spend their cap room on the open market, stars first. A rival signs
 * for one of two reasons: it still needs bodies to field a legal rotation, or
 * the player is a clear upgrade on the weakest man it already has. The second
 * reason is what makes a club with $50M of space chase a 94 OVR veteran instead
 * of parking the money. Deals are written at `askingSalary`, the same price the
 * user pays, so the CPU cannot hoover up stars at a stale bargain rate.
 */
function cpuSignFreeAgents(state: GameState, rng: Rng) {
  const teams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId);

  for (let round = 0; round < 2; round++) {
    // Shuffle each round so one club does not win every auction.
    const order = [...teams];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const team of order) {
      const roster = rosterOf(state, team.id);
      const full = roster.length >= ROSTER_MAX;
      const space = capSpaceOf(state, team.id);
      const target = Math.min(12, 10 + (space >= 20 ? 2 : space >= 10 ? 1 : 0));

      // Keep enough room for a legal nine-man roster and the rookie class.
      const slotsShort = Math.max(0, 9 - roster.length);
      const budget = space - slotsShort * 0.02 * capFor(state) - 0.1 * capFor(state);
              if (budget < LEAGUE_MIN_SALARY) continue;

      const weakest = roster.length
        ? Math.min(...roster.map((player) => cpuPriority(player)))
        : 0;
      const needs = POSITIONS.filter(
        (pos) => roster.filter((player) => player.pos === pos).length < 2,
      );
      const candidates = state.freeAgents
        .map((id) => state.players[id])
        .filter(
          (player): player is Player =>
            Boolean(player) &&
            player.teamId === null &&
            askingSalary(state, player) <= budget,
        )
        .sort((a, b) => {
          const needA = needs.includes(a.pos) ? 4 : 0;
          const needB = needs.includes(b.pos) ? 4 : 0;
          return cpuPriority(b) + needB - (cpuPriority(a) + needA);
        });
      if (!candidates.length) continue;
      const pick = rng.chance(0.8)
        ? candidates[0]
        : candidates[Math.min(rng.int(3), candidates.length - 1)];
      // Filling out the rotation is always worth a deal; beyond that a signing
      // has to beat the weakest man under contract by a clear margin, and a
      // full roster only opens up for a genuine upgrade.
      if (full && !canReleaseFor(state, team.id, pick)) continue;
      if (roster.length >= target && cpuPriority(pick) < weakest + 4) continue;
      // Rivals still shop free agency with cash and cap space only: the HWD
      // fee is a human-player rule, so a rival's token balance stays the
      // liquidity that buys from the user's marketplace.
      releaseWeakest(state, team.id, pick);
      pick.teamId = team.id;
      pick.rookie = false;
      pick.joinedSeason = acquisitionSeason(state);
      pick.salary = askingSalary(state, pick);
      pick.years = pick.age <= 25 ? 3 : pick.age <= 30 ? 2 : 1;
      pick.option = null;
      state.freeAgents = state.freeAgents.filter((id) => id !== pick.id);
      if (pick.overall >= 82 || pick.salary >= 12) {
        state.log.unshift({
          id: `log_${state.season}_cpu_signing_${pick.id}`,
          season: state.season,
          text: `Free agency: the ${team.city} ${team.name} sign ${pick.name} for $${pick.salary.toFixed(1)}M per year.`,
        });
      }
    }
  }
}

/**
 * Salary-adding CPU trades: a club with room takes on a contract from a team
 * under payroll pressure, sending back a cheaper player or a first-rounder.
 */
function cpuTradeMarket(state: GameState, rng: Rng) {
  const cap = capFor(state);
  const cpuTeams = Object.values(state.teams).filter((team) => team.id !== state.userTeamId);
  let moves = 0;

  const buyers = [...cpuTeams].sort(
    (a, b) => capSpaceOf(state, b.id) - capSpaceOf(state, a.id),
  );
  for (const buyer of buyers) {
    if (moves >= 2) break;
    if (!rng.chance(0.65)) continue;
    const rosterB = rosterOf(state, buyer.id);
    const space = capSpaceOf(state, buyer.id);
    if (rosterB.length < 9 || rosterB.length >= ROSTER_MAX || space < 6) continue;

    let best:
      | { seller: Team; target: Player; outgoing: Player | null; gain: number }
      | null = null;
    for (const seller of cpuTeams) {
      if (seller.id === buyer.id) continue;
      const rosterS = rosterOf(state, seller.id);
      if (rosterS.length <= ROSTER_MIN) continue;
      // Only clubs with real payroll pressure sell, so contenders keep their cores.
      if (payrollOf(state, seller.id) <= cap * 0.72) continue;
      for (const target of rosterS) {
        if (target.years <= 0 || target.salary < 5) continue;

        const outgoing =
          rosterB
            .filter((player) => player.salary < target.salary - 0.5)
            .filter((player) => player.salary >= target.salary - space - 1e-9)
            .sort((a, b) => a.salary - b.salary)[0] ?? null;
        const pickOnly =
          !outgoing &&
          target.salary <= space &&
          state.pickOwners[buyer.id] === buyer.id &&
          rosterS.length > ROSTER_MIN + 1;
        if (!outgoing && !pickOnly) continue;

        const gain = target.overall - (outgoing ? outgoing.overall : 0);
        if (gain <= 0) continue;
        if (!best || gain > best.gain) best = { seller, target, outgoing, gain };
      }
    }
    if (!best) continue;

    const { seller, target, outgoing } = best;
    if (outgoing) {
      target.teamId = buyer.id;
      target.joinedSeason = acquisitionSeason(state);
      outgoing.teamId = seller.id;
      outgoing.joinedSeason = acquisitionSeason(state);
      // Leave a small cushion for the draft pick that follows the offseason.
      if (payrollOf(state, buyer.id) > cap - 2) {
        target.teamId = seller.id;
        outgoing.teamId = buyer.id;
        continue;
      }
    } else {
      target.teamId = buyer.id;
      state.pickOwners[buyer.id] = seller.id;
    }
    moves += 1;

    if (target.overall >= 80 || target.salary >= 15) {
      const outgoingName = outgoing ? outgoing.name : `${buyer.abbr}'s first-round pick`;
      state.log.unshift({
        id: `log_${state.season}_cpu_trade_${target.id}`,
        season: state.season,
        text: `Trade: ${seller.city} ${seller.name} send ${target.name} to the ${buyer.name} for ${outgoingName}.`,
      });
    }
  }
}

/** Rival market purchases per season, so an old board is never stripped in one go. */
const CPU_MARKET_MOVES = 6;

/** Overall of the weakest player in a club's nine-man rotation. */
function rotationFloor(state: GameState, teamId: string): number {
  const roster = rosterOf(state, teamId).sort((a, b) => b.overall - a.overall);
  return roster.length ? roster[Math.min(8, roster.length - 1)].overall : 0;
}

/** Overall of the weakest player on a club's roster. */
function rosterFloor(state: GameState, teamId: string): number {
  const roster = rosterOf(state, teamId);
  return roster.length ? Math.min(...roster.map((player) => player.overall)) : 0;
}

/**
 * Would this club actually use the player? A rival pays for a rotation upgrade,
 * or for depth that clearly beats the end of its bench while it still has room.
 * Without this test a rival waved through any signing that fit its cap.
 */
function wouldPlay(state: GameState, teamId: string, player: Player): boolean {
  if (player.overall > rotationFloor(state, teamId)) return true;
  return rosterOf(state, teamId).length < 13 && player.overall >= rosterFloor(state, teamId) + 4;
}

/**
 * Rival-to-rival marketplace activity, run when a new season is built. The
 * board that opened at the start of the season stood in front of the player for
 * a whole year, so its leftovers are fair game: a rival with HWD and cap room
 * buys the best one it would actually play, paying the ask out of its own
 * balance. Only listings older than the current season qualify, so a freshly
 * opened board is never raided before the player has seen it. This is what
 * circulates the rival HWD float and slowly lifts the weakest rotations.
 */
export function cpuMarketPass(state: GameState): void {
  const leftover = (state.market ?? [])
    .filter((listing) => listing.season < state.season)
    .filter((listing) => listing.sellerTeamId !== state.userTeamId)
    .filter((listing) => state.players[listing.playerId]?.teamId === listing.sellerTeamId)
    .sort(
      (a, b) =>
        (state.players[b.playerId]?.overall ?? 0) -
        (state.players[a.playerId]?.overall ?? 0),
    );
  if (!leftover.length) return;

  const cap = capFor(state);
  let moves = 0;
  for (const listing of leftover) {
    if (moves >= CPU_MARKET_MOVES) break;
    const player = state.players[listing.playerId];
    if (!player || player.teamId !== listing.sellerTeamId) continue;
    if (rosterOf(state, listing.sellerTeamId).length <= ROSTER_MIN) continue;
    // Never overpay an ask that has drifted past what the player is worth.
    if (listing.price > marketMaxBid(player)) continue;

    const buyer = Object.values(state.teams)
      .filter((team) => team.id !== state.userTeamId)
      .filter((team) => team.id !== listing.sellerTeamId)
      .filter((team) => canReleaseFor(state, team.id, player))
      .filter((team) => payrollOf(state, team.id) + player.salary <= cap + 1e-9)
      .filter((team) => clubHwdBalance(state, team.id) >= listing.price)
      // Only a club that would actually play him bids, and the weakest wins.
      .filter((team) => wouldPlay(state, team.id, player))
      .sort((a, b) => rotationFloor(state, a.id) - rotationFloor(state, b.id))[0];
    if (!buyer) continue;

    const fee = marketFee(listing.price);
    // A full roster can still improve: the weakest deal is waived to dead money.
    releaseWeakest(state, buyer.id, player);
    player.teamId = buyer.id;
    player.years = Math.max(1, player.years);
    player.joinedSeason = state.season;
    state.clubHwd = {
      ...(state.clubHwd ?? {}),
      [listing.sellerTeamId]:
        clubHwdBalance(state, listing.sellerTeamId) + listing.price - fee,
      [buyer.id]: clubHwdBalance(state, buyer.id) - listing.price,
    };
    state.devFund = devFundBalance(state) + fee;
    state.market = (state.market ?? []).filter((entry) => entry.id !== listing.id);
    moves += 1;

    if (player.overall >= 80 || listing.price >= 15) {
      state.log.unshift({
        id: `log_${state.season}_cpu_market_${player.id}`,
        season: state.season,
        text: `Marketplace: the ${buyer.city} ${buyer.name} bought ${player.name} (${player.overall} OVR) from the ${state.teams[listing.sellerTeamId].name} for ${listing.price} HWD.`,
      });
    }
  }
}

function generateVeteranPool(state: GameState, rng: Rng, used: Set<string>, count = 16) {
  const salaryScale = capFor(state) / CAP;
  // Keep the market stocked so every team (including the user) can fill a roster.
  for (let i = 0; i < count; i++) {
    const tier: Player['tier'] = rng.chance(0.3) ? 4 : 5;
    const player = genPlayer(
      rng,
      `v${state.season}_${i}`,
      rng.pick(POSITIONS),
      TIER_BASE[tier] + rng.range(-3, 4),
      used,
      { ageMin: 22, ageMax: 33, tier, salaryScale },
    );
    player.years = rng.int(3) + 1;
    state.players[player.id] = player;
    state.freeAgents.push(player.id);
  }
}

/**
 * Roll a prospect's tier. Tier 3 is a rare hit, so a class usually produces no
 * fusion-ready talent and the lottery picks only get a small edge.
 */
export function rollDraftTier(rng: Rng, pickIndex: number): Player['tier'] {
  const tier3 = DRAFT_TIER3_CHANCE + (pickIndex < 4 ? DRAFT_TIER3_LOTTERY_BONUS : 0);
  if (rng.chance(tier3)) return 3;
  return rng.chance(DRAFT_TIER4_CHANCE) ? 4 : 5;
}

function generateDraftClass(state: GameState, rng: Rng, used: Set<string>): string[] {
  const ids: string[] = [];
  let counter = 0;
  for (let i = 0; i < 14; i++) {
    const id = `d${state.season}_${counter++}`;
    // The draft is capped at tier 3, and a tier-3 prospect is a rare find:
    // tier 2 is reached by training or fusion and tier 0 only by a legendary
    // drop in the HWD Hall of Fame league. The worst record still picks first.
    const tier = rollDraftTier(rng, i);
    const player = genPlayer(
      rng,
      id,
      rng.pick(POSITIONS),
      TIER_BASE[tier] + rng.range(-3, 3),
      used,
      { ageMin: 19, ageMax: 21, potentialBoost: 8 + rng.int(15), tier },
    );
    player.years = ROOKIE_YEARS;
    player.rookie = true;
    player.draftSeason = state.season;
    player.salary = rookieSalary(i, capFor(state));
    state.players[player.id] = player;
    ids.push(id);
  }
  return ids;
}

/** Rookie deals are a share of the cap: 8% for the first pick down to 3%. */
function rookieSalary(pickIndex: number, cap: number): number {
  const pick = Math.min(13, Math.max(0, pickIndex));
  const share = 0.03 + ((13 - pick) / 13) * 0.05;
  return Math.round(cap * share * 10) / 10;
}

function usedNames(state: GameState): Set<string> {
  return new Set(Object.values(state.players).map((p) => p.name));
}

function cpuDraftPick(state: GameState, rng: Rng) {
  if (!state.draftOrder || !state.draftClass) return;
  const teamId = state.draftOrder[state.draftPickIndex];
  if (!teamId) return;
  // A full roster passes on the pick rather than carrying 16 players.
  if (rosterOf(state, teamId).length >= ROSTER_MAX) {
    state.draftPickIndex++;
    return;
  }
  const available = state.draftClass
    .map((id) => state.players[id])
    .filter((p): p is Player => Boolean(p) && p.teamId === null);
  if (!available.length) {
    state.draftPickIndex++;
    return;
  }
  available.sort(
    (a, b) => b.potential + b.overall * 0.5 - (a.potential + a.overall * 0.5),
  );
  const choice = rng.chance(0.75) ? available[0] : available[Math.min(1, available.length - 1)];
  choice.teamId = teamId;
  choice.draftedBy = teamId;
  choice.rookie = true;
  choice.draftSeason = state.season;
  choice.joinedSeason = acquisitionSeason(state);
  choice.years = ROOKIE_YEARS;
  choice.salary = rookieSalary(state.draftPickIndex, capFor(state));
  state.draftPickIndex++;
}

function runDraftUntilUser(state: GameState, rng: Rng) {
  while (
    state.draftOrder &&
    state.draftPickIndex < state.draftOrder.length &&
    state.draftOrder[state.draftPickIndex] !== state.userTeamId
  ) {
    cpuDraftPick(state, rng);
  }
}

const STAT_KEYS: (keyof StatLine)[] = [
  'gp',
  'min',
  'pts',
  'reb',
  'ast',
  'stl',
  'blk',
  'fgm',
  'fga',
  'tpm',
  'tpa',
  'ftm',
  'fta',
];

function addSeasonToCareer(player: Player) {
  const career = player.career ?? emptyStats();
  for (const key of STAT_KEYS) career[key] += player.stats[key] ?? 0;
  player.career = career;
}

interface Awards {
  mvpId: string | null;
  dpoyId: string | null;
  royId: string | null;
  finalsMvpId: string | null;
  allLeague: string[];
}

function awardScore(player: Player, winPct: number): number {
  const gp = Math.max(1, player.stats.gp);
  const per = (value: number) => value / gp;
  return (
    per(player.stats.pts) +
    per(player.stats.reb) * 0.6 +
    per(player.stats.ast) * 0.8 +
    per(player.stats.stl) * 1.2 +
    per(player.stats.blk) * 1.4 +
    winPct * 8
  );
}

function seasonAwards(state: GameState): Awards {
  const winPctOf = (teamId: string) => {
    const team = state.teams[teamId];
    const games = team.wins + team.losses;
    return games ? team.wins / games : 0;
  };
  const pool = Object.values(state.players).filter(
    (p) => p.teamId && p.stats.gp >= 6 && state.teams[p.teamId],
  );
  const scored = pool
    .map((player) => ({
      player,
      score: awardScore(player, winPctOf(player.teamId as string)),
    }))
    .sort((a, b) => b.score - a.score);
  const defender = [...pool].sort((a, b) => {
    const per = (p: Player, key: 'stl' | 'blk') => p.stats[key] / Math.max(1, p.stats.gp);
    const rating = (p: Player) =>
      per(p, 'stl') * 1.2 + per(p, 'blk') * 1.6 + p.attrs.defense * 0.02 + p.attrs.rebounding * 0.01;
    return rating(b) - rating(a);
  })[0];
  const rookie = [...pool]
    .filter((p) => p.age <= 22)
    .sort(
      (a, b) =>
        awardScore(b, winPctOf(b.teamId as string)) - awardScore(a, winPctOf(a.teamId as string)),
    )[0];
  const champion = championOf(state);
  const finalsMvp = champion
    ? [...pool]
        .filter((player) => player.teamId === champion)
        .sort(
          (a, b) =>
            awardScore(b, winPctOf(champion)) - awardScore(a, winPctOf(champion)),
        )[0]
    : null;
  return {
    mvpId: scored[0]?.player.id ?? null,
    dpoyId: defender?.id ?? null,
    royId: rookie?.id ?? null,
    finalsMvpId: finalsMvp?.id ?? null,
    allLeague: scored.slice(0, 5).map((entry) => entry.player.id),
  };
}

function userSeasonResult(state: GameState): { result: string; runnerUp: string } {
  const finals = state.playoffs.find((series) => series.round === 3);
  const champion = championOf(state);
  const runnerUp = finals ? (finals.winner === finals.high ? finals.low : finals.high) : '';
  if (!champion) return { result: 'Missed the playoffs', runnerUp };
  if (champion === state.userTeamId) return { result: 'Champions', runnerUp };
  for (const [round, label] of [
    [3, 'Lost in the Finals'],
    [2, 'Lost in the Conference Finals'],
    [1, 'Lost in the first round'],
  ] as const) {
    const inRound = state.playoffs.some(
      (series) =>
        series.round === round &&
        (series.high === state.userTeamId || series.low === state.userTeamId),
    );
    if (inRound) return { result: label, runnerUp };
  }
  return { result: 'Missed the playoffs', runnerUp };
}

export function enterOffseason(state: GameState): GameState {
  const s = clone(state);
  const rng = new Rng(s.rngState);
  s.phase = 'offseason';

  const used = usedNames(s);
  const retired: string[] = [];
  const storedIds = new Set(s.stash ?? []);
  const awards = seasonAwards(s);
  const outcome = userSeasonResult(s);
  const endPayrolls = Object.fromEntries(
    Object.values(s.teams).map((team) => [team.id, payrollOf(s, team.id)]),
  );
  s.devReport = [];
  s.scouted = [];

  for (const player of Object.values(s.players)) {
    // Capture the asking price and finish the career totals before development
    // resets the season stat line.
    const demand = Math.round(salaryDemand(player, capFor(s)) * 10) / 10;
    addSeasonToCareer(player);
    const before = player.overall;
    const wasUserPlayer = player.teamId === s.userTeamId;
    // Stored NFTs are frozen in the collection, and a career is frozen when it
    // ends: no aging, growth or decline for either. An immortal Hall of Famer
    // skips development as well, but still clears his season line.
    const immortal = isImmortal(player);
    if (!storedIds.has(player.id) && !player.retired && !immortal) developPlayer(player, rng);
    if (immortal) player.stats = emptyStats();
    // A stored NFT is frozen while it sits in the collection: no aging, no
    // development and no retirement, so the owner keeps it. Its contract years
    // still tick, but an expired stored NFT is kept (not deleted) and stays
    // in the collection rather than being lost.
    if (storedIds.has(player.id)) {
      player.years = Math.max(0, player.years - 1);
      continue;
    }
    if (wasUserPlayer) {
      const delta = player.overall - before;
      s.devReport.push({
        playerId: player.id,
        before,
        after: player.overall,
        note:
          delta >= 4
            ? 'Major leap'
            : delta > 0
              ? 'Improved'
              : delta === 0
                ? 'Held steady'
                : delta >= -3
                  ? 'Slight decline'
                  : 'Declined',
      });
    }
    player.years = Math.max(0, player.years - 1);

    if (
      !immortal &&
      (player.age >= 38 || (player.age >= 35 && player.overall < 62 && rng.chance(0.5)))
    ) {
      retired.push(player.id);
      continue;
    }

    // Contract options are settled before a deal can expire.
    if (player.years <= 0 && player.teamId && player.option) {
      const option = player.option;
      player.option = null;
      // A team option is only worth exercising at market rate; a player option
      // is accepted when the existing deal pays at least 95% of the demand.
      const stays =
        option === 'team' ? player.salary <= demand * 1.05 : player.salary >= demand * 0.95;
      if (stays) {
        player.years = 1;
        if (player.teamId === s.userTeamId) {
          s.log.unshift({
            id: `log_${s.season}_option_${player.id}`,
            season: s.season,
            text: `${player.name}'s ${option} option is exercised; he stays for one more season at $${player.salary.toFixed(1)}M.`,
          });
        }
        continue;
      }
    }

    if (player.years <= 0 && player.teamId) {
      // Production drives the asking price before the stat line is cleared.
      player.salary = demand;
      // Expired deals stay attached through the offseason. The user decides,
      // while CPU teams make their own calls after every roster is settled.
      player.years = 0;
      player.option = null;
    }
  }

  // Stored NFTs are frozen in the collection: they never age, expire or
  // disappear, and the owner keeps them indefinitely.

  // Record the season before retired players disappear from the league.
  s.history = [
    ...(s.history ?? []),
    {
      season: s.season,
      champion: championOf(s) ?? '',
      runnerUp: outcome.runnerUp,
      userWins: s.teams[s.userTeamId].wins,
      userLosses: s.teams[s.userTeamId].losses,
      userResult: outcome.result,
      mvpId: awards.mvpId,
      dpoyId: awards.dpoyId,
      royId: awards.royId,
      finalsMvpId: awards.finalsMvpId,
      allLeague: awards.allLeague,
    },
  ];

  // League revenue: a share of league income (tied to the cap) plus gate money
  // for every win. Unpaid tax is settled first, so over-cap spending follows a
  // club into the next season instead of disappearing with an empty wallet.
  for (const team of Object.values(s.teams)) {
    const share = Math.round(capFor(s) * REVENUE_RATE * 10) / 10;
    const gate = Math.round(team.wins * REVENUE_PER_WIN * 10) / 10;
    const income = Math.round((share + gate) * 10) / 10;
    let grant = income;
    const debt = team.taxDebt ?? 0;
    let settled = 0;
    if (debt > 0) {
      settled = Math.round(Math.min(grant, debt) * 10) / 10;
      grant = Math.round((grant - settled) * 10) / 10;
      team.taxDebt = Math.round((debt - settled) * 10) / 10;
    }
    team.cash = Math.round((team.cash + grant) * 10) / 10;
    if (team.id === s.userTeamId) {
      s.log.unshift({
        id: `log_${s.season}_revenue`,
        season: s.season,
        text: `League revenue: +$${income.toFixed(1)}M ($${share.toFixed(1)}M cap share, $${gate.toFixed(1)}M gate)${
          settled ? `; $${settled.toFixed(1)}M settled unpaid tax` : ''
        }.`,
      });
    }
  }

  // Luxury tax: a progressive cash penalty, heavier for repeat offenders. Any
  // part of the bill the wallet cannot cover becomes tax debt, paid out of
  // future revenue, so over-cap clubs cannot simply spend their way out.
  for (const team of Object.values(s.teams)) {
    const over = Math.round(((endPayrolls[team.id] ?? 0) - capFor(s)) * 10) / 10;
    if (over <= 0) {
      team.taxStrikes = 0;
      continue;
    }
    const strikes = team.taxStrikes ?? 0;
    // The user's analytics department models the tax code; rival clubs have no
    // such staff, so the discount applies only to the user's bill.
    const analytics = team.id === s.userTeamId ? facilityLevel(s, 'analytics') : 0;
    const due = Math.round(luxuryTaxFor(over, strikes) * (1 - analytics * 0.1) * 10) / 10;
    const paid = Math.min(team.cash, due);
    const deferred = Math.round((due - paid) * 10) / 10;
    team.cash = Math.round((team.cash - paid) * 10) / 10;
    team.taxStrikes = strikes + 1;
    if (deferred > 0) {
      // Debt is real but bounded: an over-cap club loses future revenue without
      // entering an infinite spiral it can never repay.
      const owed = Math.min((team.taxDebt ?? 0) + deferred, capFor(s) * 0.5);
      team.taxDebt = Math.round(owed * 10) / 10;
    }
    if (team.id === s.userTeamId) {
      s.log.unshift({
        id: `log_${s.season}_tax`,
        season: s.season,
        text: `Luxury tax: $${due.toFixed(1)}M on $${over.toFixed(1)}M over the cap; $${paid.toFixed(1)}M paid${
          deferred ? `, $${deferred.toFixed(1)}M deferred` : ''
        }${strikes ? ` (repeat offender: ${strikes + 1} straight seasons)` : ''}${
          analytics ? ` (analytics: −${analytics * 10}%)` : ''
        }.`,
      });
    }
  }

  // Basketball operations: a payroll-linked cash cost that keeps front-office
  // money a working budget rather than an ever-growing pile.
  for (const team of Object.values(s.teams)) {
    const payroll = endPayrolls[team.id] ?? 0;
    const ops = Math.round(payroll * OPERATIONS_RATE * 10) / 10;
    if (ops <= 0) continue;
    team.cash = Math.max(0, Math.round((team.cash - ops) * 10) / 10);
    if (team.id === s.userTeamId) {
      s.log.unshift({
        id: `log_${s.season}_operations`,
        season: s.season,
        text: `Basketball operations: −$${ops.toFixed(1)}M (${Math.round(
          OPERATIONS_RATE * 100,
        )}% of a $${payroll.toFixed(1)}M payroll).`,
      });
    }
  }

  // Retired players stay in the player list with no team so the record book
  // (career totals, awards) keeps their history, but they leave free agency.
  for (const id of retired) {
    const player = s.players[id];
    if (player) {
      player.teamId = null;
      player.years = 0;
      player.option = null;
      // Sealed so the buy-out pickup below cannot put a retired career back on
      // the open market, where it used to age into a 40-year-old 25 OVR.
      player.retired = true;
    }
    s.freeAgents = s.freeAgents.filter((fa) => fa !== id);
  }

  s.freeAgents = Array.from(new Set(s.freeAgents)).filter((id) => {
    const p = s.players[id];
    return p && p.teamId === null && !p.retired;
  });

  cpuResignPlayers(s);
  s.freeAgents = Array.from(new Set(s.freeAgents)).filter((id) => {
    const p = s.players[id];
    return p && p.teamId === null && !p.retired;
  });
  generateVeteranPool(s, rng, used);
  cpuSignFreeAgents(s, rng);
  fillCpuRosters(s, rng);
  for (const team of Object.values(s.teams)) {
    if (team.id !== s.userTeamId) trainCpuTeam(s, team.id);
  }
  // Clubs fuse spare maxed players into a tier above them, the same trade the
  // owner can make on the Roster tab.
  for (const team of Object.values(s.teams)) {
    if (team.id !== s.userTeamId) cpuFuse(s, team.id, rng);
  }

  // Worst winning percentage picks first; traded picks follow their new owner.
  // Repeat tax offenders who still own their first-rounder pick at the end.
  const worstFirst = Object.values(s.teams).sort(
    (a, b) => a.wins - b.wins || a.ptsFor - a.ptsAgainst - (b.ptsFor - b.ptsAgainst),
  );
  const slots = worstFirst.map((team) => {
    const owner = s.pickOwners[team.id] ?? team.id;
    return {
      origin: team.id,
      owner,
      demoted: (s.teams[team.id].taxStrikes ?? 0) >= 2 && owner === team.id,
    };
  });
  const ordered = [...slots.filter((slot) => !slot.demoted), ...slots.filter((slot) => slot.demoted)];
  s.draftPickOrigins = ordered.map((slot) => slot.origin);
  s.draftOrder = ordered.map((slot) => slot.owner);
  if (ordered.some((slot) => slot.demoted && slot.owner === s.userTeamId)) {
    s.log.unshift({
      id: `log_${s.season}_tax_pick`,
      season: s.season,
      text: 'Repeat luxury-tax offender: your first-round pick moves to the end of the draft.',
    });
  }
  s.draftClass = generateDraftClass(s, rng, used);
  s.draftPickIndex = 0;
  runDraftUntilUser(s, rng);

  const lapsed = pendingContractPlayers(s, s.userTeamId);
  if (lapsed.length) {
    s.log.unshift({
      id: `log_${s.season}_expired`,
      season: s.season,
      text: `Contract expired: ${lapsed.map((p) => p.name).join(', ')}. Re-sign them on the Offseason tab or they leave as free agents.`,
    });
  }

  sanitizeLineup(s);

  s.log.unshift({
    id: `log_${s.season}_offseason`,
    season: s.season,
    text: 'Offseason begins: contracts expire, prospects declare and the draft order is set.',
  });
  s.rngState = rng.state;
  return s;
}

export function makeDraftPick(state: GameState, prospectId: string): GameState {
  if (!state.draftClass || !state.draftOrder) return state;
  if (state.draftOrder[state.draftPickIndex] !== state.userTeamId) return state;
  if (rosterOf(state, state.userTeamId).length >= ROSTER_MAX) return state;
  const s = clone(state);
  if (!s.draftClass || !s.draftOrder) return state;
  const prospect = s.players[prospectId];
  if (!prospect || prospect.teamId !== null) return state;

  const pickNumber = s.draftPickIndex;
  prospect.teamId = s.userTeamId;
  prospect.draftedBy = s.userTeamId;
  prospect.rookie = true;
  prospect.draftSeason = s.season;
  prospect.joinedSeason = acquisitionSeason(s);
  prospect.years = ROOKIE_YEARS;
  prospect.salary = rookieSalary(pickNumber, capFor(s));
  s.draftPickIndex++;

  const rng = new Rng(s.rngState);
  while (s.draftPickIndex < s.draftOrder.length) cpuDraftPick(s, rng);
  s.rngState = rng.state;

  const round = pickNumber + 1;
  s.log.unshift({
    id: `log_${s.season}_pick`,
    season: s.season,
    text: `Draft: you selected ${prospect.name} (${prospect.pos}) with pick ${round}.`,
  });
  return s;
}

/** Pass on the user's pick so a full roster is never stuck on the clock. */
export function passDraftPick(state: GameState): GameState {
  if (!state.draftOrder || state.draftPickIndex >= state.draftOrder.length) return state;
  if (state.draftOrder[state.draftPickIndex] !== state.userTeamId) return state;
  const s = clone(state);
  const rng = new Rng(s.rngState);
  s.draftPickIndex += 1;
  runDraftUntilUser(s, rng);
  s.rngState = rng.state;
  s.log.unshift({
    id: `log_${s.season}_pass`,
    season: s.season,
    text: 'Draft: you passed on your pick.',
  });
  return s;
}

/** Rival clubs chase stars, which pushes their asking price up. */
export function hasRivalInterest(player: Player, season: number): boolean {
  if (player.overall < 80) return false;
  return ratingsSeed(`${player.id}:${season}:rival`) % 100 < 38;
}

export function askingSalary(state: GameState, player: Player): number {
  const bump = hasRivalInterest(player, state.season) ? 1.08 : 1;
  return Math.round(player.salary * bump * 10) / 10;
}

export interface FreeAgentTerms {
  asking: number;
  hwd: number;
  relief: boolean;
  affordable: boolean;
  reason: string | null;
}

/**
 * What a free agent would cost right now. The fee is HWD, never cash, and is
 * priced at the ceiling a rival would bid for him, so a signing can never be
 * turned around and sold at a profit. Roster relief is the exception: a club
 * below the eight-man minimum may sign a minimum-scale deal with no cap room
 * and no fee, so it can always be made legal. A live Hall of Fame bracket
 * freezes signings like every other roster move. Shared with the free-agent
 * table so the button and the engine agree.
 */
export function freeAgentTerms(state: GameState, player: Player): FreeAgentTerms {
  const asking = askingSalary(state, player);
  const relief =
    signedPlayers(state, state.userTeamId).length < ROSTER_MIN &&
    asking <= MIN_SALARY_EXCEPTION * capFor(state);
  const hwd = relief ? 0 : marketMaxBid(player);
  const rosterFull = rosterOf(state, state.userTeamId).length >= ROSTER_MAX;
  const capSpace = capSpaceOf(state, state.userTeamId);
  const balance = hwdBalance(state);
  const reason = hofRosterLocked(state)
    ? HOF_ROSTER_LOCK
    : rosterFull
      ? 'Roster is full. Waive a player first.'
      : !relief && asking > capSpace + 1e-9
        ? 'Not enough cap space'
        : !relief && hwd > balance
          ? `Not enough tokens: the signing fee is ${hwd} and you hold ${balance}.`
          : null;
  return { asking, hwd, relief, affordable: reason === null, reason };
}

export function signFreeAgent(
  state: GameState,
  playerId: string,
  years = 2,
  option: 'player' | 'team' | null = null,
): GameState {
  if (hofRosterLocked(state)) return state;
  const player = state.players[playerId];
  if (!player || player.teamId !== null || !state.freeAgents.includes(playerId)) return state;
  const terms = freeAgentTerms(state, player);
  if (!terms.affordable) return state;

  const s = clone(state);
  const live = s.players[playerId];
  live.salary = terms.asking;
  live.teamId = s.userTeamId;
  live.rookie = false;
  live.joinedSeason = acquisitionSeason(s);
  live.years = clamp(Math.round(years), 1, 4);
  live.option = option;
  // The fee is HWD, straight into the development treasury: free agency is a
  // sink, so signing a player can never create a token out of cash.
  s.hwd = hwdBalance(s) - terms.hwd;
  s.devFund = devFundBalance(s) + terms.hwd;
  s.freeAgents = s.freeAgents.filter((id) => id !== playerId);
  s.log.unshift({
    id: `log_${s.season}_fa_${playerId}`,
    season: s.season,
    text: `Signed ${live.name} (${live.pos}) for ${live.years} year${live.years === 1 ? '' : 's'} at $${live.salary.toFixed(1)}M per year${terms.hwd ? `, ${terms.hwd} HWD to the development fund` : ' on a minimum-scale deal'}.`,
  });
  sanitizeLineup(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* Draft scouting                                                      */
/* ------------------------------------------------------------------ */

export interface ProspectRange {
  ovr: [number, number];
  pot: [number, number];
  risk: string;
}

/** Unscouted prospects show ranges; scouting reveals the true ratings. */
export function prospectRange(state: GameState, player: Player): ProspectRange | null {
  if ((state.scouted ?? []).includes(player.id)) return null;
  const seed = ratingsSeed(`${player.id}:${state.season}:scout`);
  const tighten = [1, 0.8, 0.65, 0.5][facilityLevel(state, 'scouting')] ?? 1;
  const ovrSpread = Math.max(1, Math.round((2 + (seed % 5)) * tighten));
  const potSpread = Math.max(1, Math.round((4 + ((seed >>> 4) % 6)) * tighten));
  const riskRoll = seed % 3;
  return {
    ovr: [Math.max(25, player.overall - ovrSpread), Math.min(99, player.overall + ovrSpread)],
    pot: [Math.max(25, player.potential - potSpread), Math.min(99, player.potential + potSpread)],
    risk: riskRoll === 0 ? 'Boom potential' : riskRoll === 1 ? 'Steady' : 'Bust risk',
  };
}

/** Cash price of one scouting report, discounted by the scouting department. */
export function scoutCost(state: GameState): number {
  const level = facilityLevel(state, 'scouting');
  return level >= 3 ? 0 : level === 2 ? 0.5 : level === 1 ? 0.75 : SCOUT_COST;
}

export function scoutProspect(state: GameState, playerId: string): GameState {
  const player = state.players[playerId];
  if (!player || !state.draftClass?.includes(playerId)) return state;
  if ((state.scouted ?? []).includes(playerId)) return state;
  if (state.phase !== 'offseason') return state;
  const cost = scoutCost(state);
  if (state.teams[state.userTeamId].cash + 1e-9 < cost) return state;
  const s = clone(state);
  s.teams[s.userTeamId].cash = Math.round((s.teams[s.userTeamId].cash - cost) * 10) / 10;
  s.scouted = [...(s.scouted ?? []), playerId];
  s.log.unshift({
    id: `log_${s.season}_scout_${playerId}`,
    season: s.season,
    text: `Scouting report filed on ${player.name}: ${player.overall} OVR, ${player.potential} POT.`,
  });
  return s;
}

/** Re-sign one of the user's expired contracts during the offseason. */
export function reSignPlayer(
  state: GameState,
  playerId: string,
  years = 3,
  option: 'player' | 'team' | null = null,
): GameState {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  if (player.years > 0 || state.phase !== 'offseason') return state;
  // Bird rights are real but not unlimited: a club more than 10% over the cap
  // cannot keep adding salary. Roster relief only covers minimum-scale deals,
  // so it can keep a club legal without becoming a way to hoard max contracts.
  const relief =
    signedPlayers(state, state.userTeamId).length < ROSTER_MIN &&
    player.salary <= MIN_SALARY_EXCEPTION * capFor(state);
  if (!relief && payrollOf(state, state.userTeamId) > capFor(state) * 1.1 + 1e-9) {
    return state;
  }

  const s = clone(state);
  const live = s.players[playerId];
  live.rookie = false;
  live.years = clamp(Math.round(years), 1, 4);
  live.option = option;
  s.log.unshift({
    id: `log_${s.season}_resign_${playerId}_${Date.now()}`,
    season: s.season,
    text: `Re-signed ${live.name} for ${live.years} year${live.years === 1 ? '' : 's'} at $${live.salary.toFixed(1)}M per year${option ? ` with a ${option} option` : ''}.`,
  });
  return s;
}

/**
 * Keep an expired NFT in the stored collection instead of losing him. He comes
 * off the roster and the cap but stays yours on a fresh deal at his last
 * salary. The deal still counts down in storage, and an NFT whose deal runs out
 * there is lost, so the stored contract needs a real length.
 */
export function storeExpiredPlayer(
  state: GameState,
  playerId: string,
  years = 1,
): MarketResult {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) {
    return { error: 'That player is not on your roster.' };
  }
  if (player.years > 0 || state.phase !== 'offseason') {
    return { error: 'Only an expired contract can be stored.' };
  }
  if ((state.stash ?? []).length >= STASH_LIMIT) {
    return { error: `Your stored NFT collection is full (${STASH_LIMIT}).` };
  }

  const s = clone(state);
  const live = s.players[playerId];
  live.teamId = null;
  live.rookie = false;
  live.years = clamp(Math.round(years), 1, 4);
  live.option = null;
  s.stash = [...(s.stash ?? []), playerId];
  sanitizeLineup(s);
  s.log.unshift({
    id: `log_${s.season}_store_${playerId}`,
    season: s.season,
    text: `${live.name} was stored in your NFT collection on a ${live.years}-year deal after his contract expired.`,
  });
  return { state: s };
}

/** Let an expired contract walk into free agency. */
export function letWalk(state: GameState, playerId: string): GameState {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  if (player.years > 0 || state.phase !== 'offseason') return state;

  const s = clone(state);
  const live = s.players[playerId];
  live.teamId = null;
  live.years = 0;
  if (!s.freeAgents.includes(playerId)) s.freeAgents.push(playerId);
  s.log.unshift({
    id: `log_${s.season}_walk_${playerId}`,
    season: s.season,
    text: `${live.name} leaves as a free agent after his contract expired.`,
  });
  sanitizeLineup(s);
  return s;
}

export function waivePlayer(state: GameState, playerId: string): GameState {
  const s = clone(state);
  const player = s.players[playerId];
  if (!player || player.teamId !== s.userTeamId) return state;
  if (rosterOf(s, s.userTeamId).length <= ROSTER_MIN && s.phase !== 'offseason') return state;
  // Waiving is free, but the remaining salary stays on the cap as dead money.
  if (player.years > 0) {
    s.teams[s.userTeamId].deadMoney = [
      ...(s.teams[s.userTeamId].deadMoney ?? []),
      { name: player.name, salary: player.salary, years: player.years },
    ];
  }
  player.teamId = null;
  player.years = 0;
  s.freeAgents.push(playerId);
  s.log.unshift({
    id: `log_${s.season}_waive_${playerId}`,
    season: s.season,
    text: `Waived ${player.name}; the remaining salary stays on the cap as dead money.`,
  });
  sanitizeLineup(s);
  return s;
}

/** Cash it takes to clear a player's remaining cap hit. */
export function buyoutCost(player: Player): number {
  return Math.round(player.salary * Math.max(0, player.years) * BUYOUT_RATE * 10) / 10;
}

/**
 * Pay cash to erase the rest of a contract from the cap. The player leaves the
 * roster and reaches free agency when the new league year opens.
 */
export function buyoutPlayer(
  state: GameState,
  playerId: string,
): { state?: GameState; error?: string } {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) {
    return { error: 'That player is not on your roster.' };
  }
  if (player.years <= 0) return { error: 'Expired contracts do not need a buyout.' };
  if (rosterOf(state, state.userTeamId).length <= ROSTER_MIN && state.phase !== 'offseason') {
    return { error: `You must keep at least ${ROSTER_MIN} players.` };
  }
  const cost = buyoutCost(player);
  if (state.teams[state.userTeamId].cash + 1e-9 < cost) {
    return { error: `A buyout costs $${cost.toFixed(1)}M in cash.` };
  }

  const s = clone(state);
  const live = s.players[playerId];
  s.teams[s.userTeamId].cash = Math.round((s.teams[s.userTeamId].cash - cost) * 10) / 10;
  live.teamId = null;
  live.years = 0;
  live.option = null;
  s.log.unshift({
    id: `log_${s.season}_buyout_${playerId}`,
    season: s.season,
    text: `Bought out ${live.name} for $${cost.toFixed(1)}M; the rest of the contract is off the cap.`,
  });
  sanitizeLineup(s);
  return { state: s };
}

/* ------------------------------------------------------------------ */
/* HWD marketplace                                                     */
/* ------------------------------------------------------------------ */

export interface MarketResult {
  state?: GameState;
  error?: string;
}

function cleanRename(name: string): string | null {
  const clean = name.trim().replace(/\s+/g, ' ');
  return clean.length >= 2 && clean.length <= 24 ? clean : null;
}

/**
 * HWD sinks. Renaming charges tokens and moves them to the development
 * treasury, like fusion and season skips, so the float is never destroyed.
 */
export function renamePlayer(
  state: GameState,
  playerId: string,
  name: string,
): MarketResult {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) {
    return { error: 'You can only rename a player on your roster.' };
  }
  if (hofRosterLocked(state)) return { error: HOF_ROSTER_LOCK };
  const clean = cleanRename(name);
  if (!clean) return { error: 'Use a name between 2 and 24 characters.' };
  if (clean === player.name) return { error: 'That is already his name.' };
  const balance = hwdBalance(state);
  if (balance < RENAME_PLAYER_HWD) {
    return { error: `Renaming costs ${RENAME_PLAYER_HWD} HWD; you have ${balance}.` };
  }

  const s = clone(state);
  const previous = s.players[playerId].name;
  s.players[playerId].name = clean;
  s.hwd = balance - RENAME_PLAYER_HWD;
  s.devFund = devFundBalance(s) + RENAME_PLAYER_HWD;
  s.log.unshift({
    id: `log_${s.season}_rename_player_${playerId}_${s.log.length}`,
    season: s.season,
    text: `Renamed ${previous} to ${clean} for ${RENAME_PLAYER_HWD} HWD.`,
  });
  return { state: s };
}

export function renameTeam(
  state: GameState,
  teamId: string,
  name: string,
): MarketResult {
  const team = state.teams[teamId];
  if (!team || teamId !== state.userTeamId) {
    return { error: 'You can only rename your own club.' };
  }
  const clean = cleanRename(name);
  if (!clean) return { error: 'Use a name between 2 and 24 characters.' };
  if (clean === team.name) return { error: 'That is already the club name.' };
  const balance = hwdBalance(state);
  if (balance < RENAME_TEAM_HWD) {
    return { error: `Renaming the club costs ${RENAME_TEAM_HWD} HWD; you have ${balance}.` };
  }

  const s = clone(state);
  s.teams[teamId].name = clean;
  s.hwd = balance - RENAME_TEAM_HWD;
  s.devFund = devFundBalance(s) + RENAME_TEAM_HWD;
  s.log.unshift({
    id: `log_${s.season}_rename_team_${teamId}`,
    season: s.season,
    text: `Renamed the club to the ${s.teams[teamId].city} ${clean} for ${RENAME_TEAM_HWD} HWD.`,
  });
  return { state: s };
}

/**
 * Rival club that can take on this contract and pay the price in HWD. The
 * marketplace is peer-to-peer, so the buyer must hold the tokens it spends, and
 * a club only pays for a player it would actually use.
 */
function marketBuyer(
  state: GameState,
  salary: number,
  price: number,
  player?: Player,
): Team | null {
  const cap = capFor(state);
  return (
    Object.values(state.teams)
      .filter((team) => team.id !== state.userTeamId)
      .filter((team) => rosterOf(state, team.id).length < ROSTER_MAX)
      .filter((team) => payrollOf(state, team.id) + salary <= cap + 1e-9)
      .filter((team) => clubHwdBalance(state, team.id) >= price)
      .filter((team) => !player || wouldPlay(state, team.id, player))
      .sort((a, b) => capSpaceOf(state, b.id) - capSpaceOf(state, a.id))[0] ?? null
  );
}

/**
 * Sell a player NFT to another club for HWD. The owner names the price — the
 * valuation is only a guideline — and the buyer pays from the HWD it already
 * holds, so the sale only moves tokens: the seller gets the price net of the
 * fee and the fee goes to the development fund. Returns an error instead of a
 * state when the gate blocks the sale or no club can pay.
 */
export function sellPlayerToMarket(
  state: GameState,
  playerId: string,
  price: number,
): MarketResult {
  const player = state.players[playerId];
  const eligibility = canListOnMarket(state, playerId);
  if (!player || !eligibility.eligible) {
    return { error: marketBlockReason(eligibility.reasons) };
  }
  if (rosterOf(state, state.userTeamId).length <= ROSTER_MIN && state.phase !== 'offseason') {
    return { error: `You must keep at least ${ROSTER_MIN} players.` };
  }
  const ask = Math.round(price);
  if (!Number.isFinite(ask) || ask < MARKET_MIN_PRICE) {
    return { error: `The market pays at least ${MARKET_MIN_PRICE} HWD.` };
  }
  // The owner names the price; rivals simply refuse an ask far past valuation.
  if (ask > marketMaxBid(player)) {
    return {
      error: `${player.name} is valued at about ${marketValue(player)} HWD; no club will pay ${ask}.`,
    };
  }
  const buyer = marketBuyer(state, player.salary, ask, player);
  if (!buyer) {
    const canAffordContract = marketBuyer(state, player.salary, 0, player);
    return {
      error: canAffordContract
        ? `No club holds ${ask} HWD to buy him right now. Lower your ask or wait for the market to refill.`
        : `No rival has the cap room and the need for ${player.name} right now.`,
    };
  }

  const s = clone(state);
  const live = s.players[playerId];
  live.teamId = buyer.id;
  live.rookie = false;
  live.joinedSeason = acquisitionSeason(s);
  live.years = Math.max(1, live.years);
  const fee = marketFee(ask);
  // Pay the seller from the buyer's balance; the fee is set aside, not minted.
  s.clubHwd = {
    ...(s.clubHwd ?? {}),
    [buyer.id]: clubHwdBalance(s, buyer.id) - ask,
  };
  s.hwd = (s.hwd ?? 0) + ask - fee;
  s.devFund = devFundBalance(s) + fee;
  s.market = (s.market ?? []).filter((listing) => listing.playerId !== playerId);
  s.log.unshift({
    id: `log_${s.season}_market_sale_${playerId}`,
    season: s.season,
    text: `Marketplace: sold ${player.name} to the ${buyer.city} ${buyer.name} for ${ask} HWD, paid from their balance (${fee} HWD to the development fund).`,
  });
  sanitizeLineup(s);
  return { state: s };
}

/** Buy a listed player NFT with HWD; the tokens go to the selling club. */
export function buyMarketPlayer(state: GameState, listingId: string): MarketResult {
  const listing = (state.market ?? []).find((entry) => entry.id === listingId);
  if (!listing) return { error: 'That listing is no longer available.' };
  const player = state.players[listing.playerId];
  if (!player || player.teamId !== listing.sellerTeamId) {
    return { error: 'That player is no longer for sale.' };
  }
  const balance = Math.max(0, Math.round(state.hwd ?? 0));
  if (balance < listing.price) {
    return { error: `That signing costs ${listing.price} HWD and you have ${balance}.` };
  }
  if (rosterOf(state, state.userTeamId).length >= ROSTER_MAX) {
    return { error: 'Roster is full. Waive a player first.' };
  }
  if (payrollOf(state, state.userTeamId) + player.salary > capFor(state) + 1e-9) {
    return {
      error: `${player.name}'s $${player.salary.toFixed(1)}M contract does not fit under the cap.`,
    };
  }

  if (hofRosterLocked(state)) return { error: HOF_ROSTER_LOCK };

  const s = clone(state);
  const live = s.players[listing.playerId];
  live.teamId = s.userTeamId;
  live.rookie = false;
  live.joinedSeason = acquisitionSeason(s);
  live.years = Math.max(1, live.years);
  const fee = marketFee(listing.price);
  // The price moves to the selling club; only the fee is withheld.
  s.hwd = balance - listing.price;
  s.clubHwd = {
    ...(s.clubHwd ?? {}),
    [listing.sellerTeamId]: clubHwdBalance(s, listing.sellerTeamId) + listing.price - fee,
  };
  s.devFund = devFundBalance(s) + fee;
  s.market = (s.market ?? []).filter((entry) => entry.id !== listingId);
  s.log.unshift({
    id: `log_${s.season}_market_buy_${listing.playerId}`,
    season: s.season,
    text: `Marketplace: bought ${player.name} from the ${s.teams[listing.sellerTeamId].name} for ${listing.price} HWD (${fee} HWD fee to the development fund).`,
  });
  sanitizeLineup(s);
  return { state: s };
}

/* ------------------------------------------------------------------ */
/* Season clock: the 24-hour wait and the HWD that clears it           */
/* ------------------------------------------------------------------ */

/**
 * The 24-hour season clock is switched off while long seasons are being
 * tested. Flip this back to true to restore the wait and paid skips.
 */
export const SEASON_COOLDOWN_ENABLED = false;
/** Real time between season tips, so a league year is one day. */
export const SEASON_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Paid skips a manager may buy in one calendar day. */
export const SEASON_SKIP_MAX_PER_DAY = 3;
/** Completed seasons before paid skips unlock, mirroring the marketplace gate. */
export const SEASON_SKIP_MIN_ACCOUNT_SEASONS = 6;
/** First-skip price at the opening cap; a low test price for now. */
export const SEASON_SKIP_BASE = 10;
/** Each later skip in the same day costs this much more. */
export const SEASON_SKIP_ESCALATION = 1.6;

/** When the next season may open, in epoch milliseconds; 0 means it is open now. */
export function seasonReadyAt(state: GameState): number {
  const at = state.seasonReadyAt ? Date.parse(state.seasonReadyAt) : 0;
  return Number.isFinite(at) ? at : 0;
}

/** Milliseconds left on the season wait. */
export function seasonCooldownRemaining(state: GameState, now = new Date()): number {
  if (!SEASON_COOLDOWN_ENABLED) return 0;
  return Math.max(0, seasonReadyAt(state) - now.getTime());
}

export function seasonReady(state: GameState, now = new Date()): boolean {
  return seasonCooldownRemaining(state, now) === 0;
}

/** Paid skips already bought today. */
export function seasonSkipsUsedToday(state: GameState, now = new Date()): number {
  return state.seasonSkip?.day === todayKey(now) ? Math.max(0, state.seasonSkip.count) : 0;
}

export function seasonSkipsLeft(state: GameState, now = new Date()): number {
  return Math.max(0, SEASON_SKIP_MAX_PER_DAY - seasonSkipsUsedToday(state, now));
}

/**
 * Price of the next skip. The live base (10) is a low test price; the formula
 * stays the same so the real base can be restored without touching callers. It
 * scales with the square root of the cap so it follows the economy without
 * outrunning income late in a career, and each later skip in a day costs more.
 */
export function seasonSkipCost(state: GameState, now = new Date()): number {
  if (seasonReady(state, now)) return 0;
  const scale = Math.sqrt(Math.max(1, capFor(state) / CAP));
  const used = seasonSkipsUsedToday(state, now);
  return Math.ceil(SEASON_SKIP_BASE * scale * SEASON_SKIP_ESCALATION ** used);
}

export interface SeasonSkipQuote {
  /** Milliseconds left on the free wait. */
  remainingMs: number;
  /** HWD the next skip costs; 0 when the season is already open. */
  cost: number;
  /** Skips still available today. */
  skipsLeft: number;
  /** Why a skip cannot be bought right now. */
  blocked?: string;
}

/** What clearing the season wait costs, and whether it can be bought. */
export function seasonSkipQuote(state: GameState, now = new Date()): SeasonSkipQuote {
  const remainingMs = seasonCooldownRemaining(state, now);
  const skipsLeft = seasonSkipsLeft(state, now);
  const cost = seasonSkipCost(state, now);
  if (remainingMs === 0) {
    return { remainingMs, cost: 0, skipsLeft, blocked: 'The next season is already ready.' };
  }
  if (accountSeasons(state) < SEASON_SKIP_MIN_ACCOUNT_SEASONS) {
    return {
      remainingMs,
      cost,
      skipsLeft,
      blocked: `Paid skips unlock after ${SEASON_SKIP_MIN_ACCOUNT_SEASONS} completed seasons.`,
    };
  }
  if (skipsLeft <= 0) {
    return { remainingMs, cost, skipsLeft, blocked: 'You have already bought every skip for today.' };
  }
  const balance = hwdBalance(state);
  if (cost > balance) {
    return { remainingMs, cost, skipsLeft, blocked: `A skip costs ${cost} HWD; you have ${balance}.` };
  }
  return { remainingMs, cost, skipsLeft };
}

/** Open the next season and start its 24-hour wait. */
export function advanceSeason(state: GameState, now = new Date()): GameState {
  const next = startNextSeason(state);
  if (next === state) return state;
  next.seasonReadyAt = SEASON_COOLDOWN_ENABLED
    ? new Date(now.getTime() + SEASON_COOLDOWN_MS).toISOString()
    : undefined;
  return next;
}

/**
 * Pay HWD to open the next season without waiting. The fee goes to the
 * development fund and never burns: the rival float is a closed pool, so
 * destroying tokens would starve later players. It is charged only after the
 * season actually advances, so a refused advance can never take a token.
 */
export function skipSeasonWait(
  state: GameState,
  now = new Date(),
): { state?: GameState; error?: string } {
  const quote = seasonSkipQuote(state, now);
  if (quote.blocked) return { error: quote.blocked };
  const next = advanceSeason(state, now);
  if (next === state) return { error: 'You need a legal roster first.' };
  next.hwd = hwdBalance(next) - quote.cost;
  next.devFund = devFundBalance(next) + quote.cost;
  next.seasonSkip = { day: todayKey(now), count: seasonSkipsUsedToday(state, now) + 1 };
  next.log.unshift({
    id: `log_${next.season}_season_skip_${next.log.length}`,
    season: next.season,
    text: `Cleared the season wait: ${quote.cost} HWD to the development fund.`,
  });
  return { state: next };
}

export function startNextSeason(state: GameState): GameState {
  if (signedPlayers(state, state.userTeamId).length < ROSTER_MIN) return state;
  const s = clone(state);
  const rng = new Rng(s.rngState);

  // Unresolved expired deals leave before the new season tips off.
  const lapsed = rosterOf(s, s.userTeamId).filter((player) => player.years <= 0);
  for (const player of lapsed) {
    player.teamId = null;
    player.years = 0;
    if (!s.freeAgents.includes(player.id)) s.freeAgents.push(player.id);
  }
  if (lapsed.length) {
    s.log.unshift({
      id: `log_${s.season}_lapsed`,
      season: s.season,
      text: `${lapsed.map((p) => p.name).join(', ')} left as free agents when their contracts expired.`,
    });
  }

  if (s.draftClass) {
    for (const id of s.draftClass) {
      const p = s.players[id];
      if (p && p.teamId === null) {
        p.years = 4;
        s.freeAgents.push(id);
      }
    }
  }
  s.draftClass = null;
  s.draftOrder = null;
  s.draftPickOrigins = null;
  s.draftPickIndex = 0;
  s.pickOwners = Object.fromEntries(Object.keys(s.teams).map((id) => [id, id]));

  for (const team of Object.values(s.teams)) {
    team.wins = 0;
    team.losses = 0;
    team.ptsFor = 0;
    team.ptsAgainst = 0;
    if (team.deadMoney?.length) {
      team.deadMoney = team.deadMoney
        .map((deal) => ({ ...deal, years: deal.years - 1 }))
        .filter((deal) => deal.years > 0);
    }
  }
  for (const player of Object.values(s.players)) {
    player.stats = emptyStats();
    player.injuryGames = 0;
    player.injury = null;
    // Players bought out last season hit the open market with the new league
    // year. Retired careers live in the record book, not in free agency.
    if (
      player.teamId === null &&
      player.years === 0 &&
      !player.retired &&
      !s.freeAgents.includes(player.id)
    ) {
      s.freeAgents.push(player.id);
    }
  }

  // The market reopens for one last wave once expired deals have actually left
  // their rosters. Until this point those players were still under the user's
  // control, so the CPU's earlier free-agency pass could never bid on a star
  // who walked and he lost a whole season waiting for an offer.
  cpuSignFreeAgents(s, rng);
  fillCpuRosters(s, rng);
  cpuTradeMarket(s, rng);
  fillCpuRosters(s, rng);
  sanitizeLineup(s);
  s.devReport = [];
  s.season += 1;
  s.round = 0;
  s.playoffs = [];
  s.playoffRound = 0;
  s.schedule = buildSchedule(Object.keys(s.teams));
  s.phase = 'regular';
  // Clear last season's leftover listings before the new board opens: the
  // player had the whole year to buy them, and the rival purchases circulate
  // the HWD float and lift the weakest rotations.
  cpuMarketPass(s);
  s.market = refreshMarketListings(s);
  s.rngState = rng.state;
  s.log.unshift({
    id: `log_${s.season}_start`,
    season: s.season,
    text: `Season ${s.season} tips off.`,
  });
  s.rngState = rng.state;
  return s;
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function userTeam(state: GameState): Team {
  return state.teams[state.userTeamId];
}

export function nextUserGame(state: GameState): Game | null {
  if (state.phase !== 'regular') return null;
  return (
    state.schedule.find(
      (g) => g.round === state.round && !g.played && (g.home === state.userTeamId || g.away === state.userTeamId),
    ) ?? null
  );
}

export function userGames(state: GameState): Game[] {
  return state.schedule.filter(
    (g) => g.home === state.userTeamId || g.away === state.userTeamId,
  );
}

export function recentResults(state: GameState, count = 5): Game[] {
  return userGames(state)
    .filter((g) => g.played)
    .sort((a, b) => b.round - a.round)
    .slice(0, count);
}

export function teamLeaders(state: GameState, teamId: string, stat: keyof StatLine, count = 5) {
  return rosterOf(state, teamId)
    .filter((p) => p.stats.gp > 0)
    .sort((a, b) => b.stats[stat] / b.stats.gp - a.stats[stat] / a.stats.gp)
    .slice(0, count);
}

export function ppg(p: Player): number {
  return p.stats.gp ? p.stats.pts / p.stats.gp : 0;
}
export function rpg(p: Player): number {
  return p.stats.gp ? p.stats.reb / p.stats.gp : 0;
}
export function apg(p: Player): number {
  return p.stats.gp ? p.stats.ast / p.stats.gp : 0;
}

export function draftProspects(state: GameState): Player[] {
  if (!state.draftClass) return [];
  return state.draftClass
    .map((id) => state.players[id])
    .filter((p): p is Player => Boolean(p) && p.teamId === null);
}

export function userOnTheClock(state: GameState): boolean {
  return Boolean(
    state.draftOrder &&
      state.draftPickIndex < state.draftOrder.length &&
      state.draftOrder[state.draftPickIndex] === state.userTeamId,
  );
}
