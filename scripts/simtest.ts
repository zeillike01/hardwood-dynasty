import {
  championOf,
  convertHwdToTrainingPoints,
  convertPointsToCash,
  cpuMarketPass,
  createLeague,
  draftProspects,
  enterOffseason,
  capFor,
  capSpaceOf,
  facilityLevels,
  freeAgentTerms,
  luxuryTaxFor,
  injuredPlayers,
  letWalk,
  makeDraftPick,
  passDraftPick,
  pendingContractPlayers,
  prospectRange,
  reSignPlayer,
  rosterOf,
  scoutProspect,
  setBenchOrder,
  setStarters,
  signFreeAgent,
  signedPlayers,
  sellPlayerToMarket,
  storeExpiredPlayer,
  buyMarketPlayer,
  buySkillLevel,
  fusePlayers,
  hofRosterLocked,
  HOF_ROSTER_LOCK,
  payrollOf,
  signStashedPlayer,
  spendTrainingPoints,
  stashPlayers,
  salaryDemand,
  simulateNextRound,
  simulatePlayoffs,
  simulateSeason,
  startNextSeason,
  advanceSeason,
  seasonReady,
  seasonSkipQuote,
  skipSeasonWait,
  seasonSkipsLeft,
  seasonSkipsUsedToday,
  SEASON_COOLDOWN_ENABLED,
  SEASON_COOLDOWN_MS,
  SEASON_SKIP_BASE,
  SEASON_SKIP_MAX_PER_DAY,
  SEASON_SKIP_MIN_ACCOUNT_SEASONS,
  trainPlayer,
  userOnTheClock,
  Rng,
  rollDraftTier,
} from '../src/game/engine';
import { importSave } from '../src/game/store';
import {
  accountSeasons,
  canListOnMarket,
  HWD_LEAGUE_ENTRY_FEE,
  HWD_STARTING,
  hwdBalance,
  marketAsk,
  marketMaxBid,
  marketFee,
  marketValue,
  openListings,
  MARKET_MIN_ACCOUNT_SEASONS,
  CLUB_HWD_START,
  clubHwdBalance,
  fusionHwdCost,
  FUSION_CARRY_LEVELS,
  FUSION_RATING_INHERITANCE,
  FUSION_SALARY_MULTIPLIER,
  devFundBalance,
  HWD_TP_MIN,
  HWD_TP_RATE,
  HWD_TP_SEASON_CAP,
  hwdTpQuote,
  hwdTpRemaining,
  hwdTpRemainingToday,
  hwdTpSpent,
} from '../src/game/market';
import {
  activeHof,
  awardHofNft,
  enterHallOfFameLeague,
  finishHofLeague,
  hofField,
  hofRating,
  simulateHofGame,
  HOF_ENTRY_BURN,
  HOF_FIELD_SIZE,
  HOF_PRIZES,
  HOF_TOTAL_BURN,
  HOF_TOTAL_PAYOUT,
  HOF_TOTAL_POOL,
  HOF_REWARD_ODDS,
  HOF_SERIES_WINS,
  rollHofRewardTier,
} from '../src/game/hof';
import type { GameState } from '../src/game/types';
import {
  CAP,
  CAP_GROWTH,
  INJURY_MAX_GAMES,
  MAX_LEVEL,
  POINTS_PER_CASH_BLOCK,
  ROOKIE_YEARS,
  STARTING_CASH,
  DRAFT_TIER3_CHANCE,
  DRAFT_TIER3_LOTTERY_BONUS,
  STASH_LIMIT,
  TIER_BASE,
  MIN_SALARY_EXCEPTION,
  LEAGUE_MIN_SALARY,
  ROSTER_MAX,
  ROSTER_MIN,
} from '../src/game/data';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

let state = createLeague('NYS', 20261120);

assert(
  Object.values(state.players)
    .filter((p) => p.teamId)
    .every((p) => p.tier === 5 && p.level === 1),
  'every other rostered player should start at tier 5, level 1',
);
assert(
  Object.values(state.teams).every((t) => t.trainingPoints === 0 && t.cash === STARTING_CASH),
  'teams should start with no training points and the standard cash budget',
);
assert(
  state.freeAgents.some((id) => state.players[id].tier <= 2),
  'the free-agent pool should include superstar-calibre talent',
);
assert(
  Math.max(
    ...Object.values(state.players)
      .filter((p) => p.teamId && p.tier === 5)
      .map((p) => p.overall),
  ) < TIER_BASE[3],
  'tier-5 players should be clearly weaker than tier-3 prospects',
);

// Injuries: hurt players miss games, recover by the game, and sit out the box score.
let hurtLab = createLeague('PHI', 909090);
const hurtTeam = hurtLab.userTeamId;
const hurtStar = rosterOf(hurtLab, hurtTeam).sort((a, b) => b.overall - a.overall)[0];
const hurtStarId = hurtStar.id;
hurtLab.players[hurtStarId].injury = 'Hamstring strain';
hurtLab.players[hurtStarId].injuryGames = 2;
assert(
  injuredPlayers(hurtLab, hurtTeam).some((p) => p.id === hurtStarId),
  'an injured player should show up on the injury report',
);
const firstUserGame = hurtLab.schedule.find(
  (g) => g.round === 0 && (g.home === hurtTeam || g.away === hurtTeam),
)!;
hurtLab = simulateNextRound(hurtLab);
const firstPlayed = hurtLab.schedule.find((g) => g.id === firstUserGame.id)!;
assert(firstPlayed.played, 'the first user game should be played');
assert(
  firstPlayed.box?.every((line) => line.playerId !== hurtStarId),
  'an injured player should not appear in the box score',
);
assert(
  hurtLab.players[hurtStarId].injuryGames === 1,
  'one game should come off the recovery clock',
);
const secondUserGame = hurtLab.schedule.find(
  (g) => g.round === hurtLab.round && (g.home === hurtTeam || g.away === hurtTeam),
)!;
hurtLab = simulateNextRound(hurtLab);
const secondPlayed = hurtLab.schedule.find((g) => g.id === secondUserGame.id)!;
assert(
  secondPlayed.box?.every((line) => line.playerId !== hurtStarId),
  'a player listed OUT 1 should sit that game rather than be healed at tip-off',
);
assert(
  hurtLab.players[hurtStarId].injuryGames === 0 && hurtLab.players[hurtStarId].injury === null,
  'a player should heal once the recovery clock runs out',
);

// Salary demands rise with production.
const demandBase = { ...rosterOf(state, state.userTeamId)[0], stats: { ...rosterOf(state, state.userTeamId)[0].stats } };
demandBase.stats.gp = 20;
demandBase.stats.pts = 500;
assert(
  salaryDemand(demandBase) > salaryDemand(rosterOf(state, state.userTeamId)[0]),
  'a 25 PPG scorer should demand more than an identical player with no production',
);

// Saves from before the trade desk was removed still load, minus its leftovers.
const legacySave = createLeague('SAC', 777) as unknown as Record<string, unknown>;
legacySave.tradeOffers = [{ id: 'legacy', teamId: 'BOS' }];
legacySave.tradeBlock = ['legacy-player'];
const loadedLegacy = importSave(JSON.stringify(legacySave));
assert(loadedLegacy, 'a save carrying the old trade desk should still load');
assert(
  !('tradeOffers' in loadedLegacy!) && !('tradeBlock' in loadedLegacy!),
  'loading should strip the removed trade desk from saved state',
);

// A fused deal priced before the discount is cut on load, after the ratings
// rebuild, to the discounted demand.
const fusedSave = createLeague('DEN', 5150);
fusedSave.ratingsVersion = 0;
const overpaid = rosterOf(fusedSave, fusedSave.userTeamId)[0];
overpaid.fused = true;
overpaid.salary = 40;
overpaid.overall = 99; // the ratings rebuild must re-rate him before the re-pricing
overpaid.tier = 1;
overpaid.level = MAX_LEVEL;
const fusedLoaded = importSave(JSON.stringify(fusedSave))!;
const repriced = fusedLoaded.players[overpaid.id];
const fusedDemand = Math.max(LEAGUE_MIN_SALARY, salaryDemand(repriced, capFor(fusedLoaded)));
assert(repriced.overall !== 99, 'the fixture save should have its ratings rebuilt on load');
assert(repriced.salary === fusedDemand, 'loading should cut a fused deal to the discounted demand');
assert(
  repriced.salary < salaryDemand({ ...repriced, fused: false }, capFor(fusedLoaded)),
  'the cut should land on the discounted demand, not the open market',
);
assert(repriced.salary < 40, 'the migration should lower the over-market salary');
assert(fusedLoaded.fusedSalaryVersion === 1, 'the re-pricing should mark the save');
const fusedReloaded = importSave(JSON.stringify(fusedLoaded))!;
assert(
  fusedReloaded.players[overpaid.id].salary === fusedDemand,
  'a merged save should not be re-priced again',
);

// A fused deal at or below today's demand is left alone, and non-fused deals
// are never touched.
const cheapSave = createLeague('DEN', 5151);
const cheapRoster = rosterOf(cheapSave, cheapSave.userTeamId);
const cheapFused = cheapRoster[0];
const normalDeal = cheapRoster[1];
cheapFused.fused = true;
cheapFused.salary = LEAGUE_MIN_SALARY;
normalDeal.salary = 12.3;
const cheapLoaded = importSave(JSON.stringify(cheapSave))!;
assert(
  cheapLoaded.players[cheapFused.id].salary === LEAGUE_MIN_SALARY,
  'loading should never raise a fused deal already inside the discount',
);
assert(
  cheapLoaded.players[normalDeal.id].salary === 12.3,
  'loading should leave non-fused deals alone',
);

// Training economy: level to 25, promote a tier, then convert points to cash.
let lab = createLeague('BOS', 424242);
const traineeId = rosterOf(lab, lab.userTeamId)[0].id;
const startOvr = lab.players[traineeId].overall;
lab.teams[lab.userTeamId].trainingPoints = 100_000;
for (let i = 0; i < 30; i++) lab = trainPlayer(lab, traineeId);
assert(lab.players[traineeId].level === MAX_LEVEL, `training should stop at level ${MAX_LEVEL}`);
assert(lab.players[traineeId].overall >= startOvr, 'training should develop the player');
assert(lab.players[traineeId].tier === 5, 'training alone should not change tier');
assert(
  lab.players[traineeId].overall >= Math.min(99, startOvr + MAX_LEVEL - 2),
  'a maxed tier-5 player should gain about one overall per training level, not stall out',
);
assert(
  freeAgentTerms(
    lab,
    lab.freeAgents.map((id) => lab.players[id]).sort((a, b) => b.overall - a.overall)[0],
  ).hwd > 0,
  'free agents should cost HWD to sign',
);

/* CPU promotion: the only TP tier-up left, capped at tier 2 */
let cpuLab = createLeague('SEA', 313131);
const cpuClubId = Object.values(cpuLab.teams).find((club) => club.id !== cpuLab.userTeamId)!.id;
for (const player of rosterOf(cpuLab, cpuClubId)) {
  player.level = MAX_LEVEL;
  player.tier = 3;
}
cpuLab.teams[cpuClubId].trainingPoints = 1_000_000;
const cpuCeiling = spendTrainingPoints(cpuLab, cpuClubId);
assert(
  rosterOf(cpuCeiling, cpuClubId).every((player) => player.tier === 2),
  'CPU clubs should promote maxed players up to tier 2 and stop there',
);

/* Tier fusion: burn 2-3 fully trained same-tier players into a brand-new NFT */
let fusionLab = createLeague('PHX', 616161);
const fusionRoster = rosterOf(fusionLab, fusionLab.userTeamId)
  .slice(0, 3);
for (const player of fusionRoster) {
  player.tier = 5;
  player.level = MAX_LEVEL;
}
const fusionFee = fusionHwdCost(Math.max(...fusionRoster.map((player) => player.overall)));
const fusionHwdBefore = fusionLab.hwd ?? 0;
const fusionFundBefore = fusionLab.devFund ?? 0;
const rosterBefore = Object.keys(fusionLab.players).length;
const idsBefore = new Set(Object.keys(fusionLab.players));
assert(Boolean(fusePlayers(fusionLab, []).error), 'fusion should refuse an empty selection');
assert(
  Boolean(fusePlayers(fusionLab, [fusionRoster[0].id, fusionRoster[0].id]).error),
  'fusion should refuse duplicate players',
);

const fused = fusePlayers(fusionLab, fusionRoster.map((player) => player.id));
assert(fused.state, fused.error ?? 'three maxed tier-5 players should fuse');
fusionLab = fused.state!;
assert(
  fusionLab.hwd === fusionHwdBefore - fusionFee,
  'fusion should pay its HWD price',
);
assert(
  (fusionLab.devFund ?? 0) === fusionFundBefore + fusionFee,
  'the fusion fee should land in the development treasury',
);
const minted = Object.values(fusionLab.players).find((player) => !idsBefore.has(player.id));
assert(minted, 'fusion should mint a brand-new NFT');
assert(
  fusionRoster.every((player) => !fusionLab.players[player.id]),
  'every fused input should be permanently removed',
);
assert(
  Object.keys(fusionLab.players).length === rosterBefore - 2,
  'three inputs should leave exactly one new player behind',
);
assert(minted!.tier === 4, 'three tier-5 players should mint a tier-4 NFT');
assert(minted!.age === 18, 'the minted NFT should start at 18');
assert(
  minted!.level === FUSION_CARRY_LEVELS + 1,
  'the mint should carry the configured training levels',
);
const burnedAnchor = [...fusionRoster].sort((a, b) => b.overall - a.overall)[0];
assert(
  minted!.overall >=
    Math.min(99, Math.round(burnedAnchor.overall * FUSION_RATING_INHERITANCE)) - 2,
  'the mint should inherit the best burned rating, not the tier base',
);
assert(minted!.salary > 0 && minted!.years >= 1, 'the minted NFT should carry a three-year deal');
const mintDemand = salaryDemand(minted!, capFor(fusionLab));
assert(
  Math.abs(minted!.salary - Math.max(LEAGUE_MIN_SALARY, mintDemand)) < 1e-9,
  'a fused player should be minted at his rating-based demand, floored at the league minimum',
);
assert(
  minted!.overall < 70 || minted!.salary > LEAGUE_MIN_SALARY,
  'a rated fusion mint should be paid above the league minimum',
);
const fusedAsk = salaryDemand(minted!, capFor(fusionLab));
const openAsk = salaryDemand({ ...minted!, fused: false }, capFor(fusionLab));
assert(
  fusedAsk < openAsk &&
    Math.abs(fusedAsk - openAsk * FUSION_SALARY_MULTIPLIER) <= 0.1,
  'a fused player should re-sign below the open market',
);
assert(
  minted!.teamId === fusionLab.userTeamId,
  'the minted NFT should join the roster when it fits',
);
assert(
  fusionLab.log.some((entry) => entry.text.includes('Fusion')),
  'a fusion should be reported in the log',
);

// Three tier-2 inputs reach tier 1, the fusion ceiling.
const topLab = createLeague('CHI', 717171);
const topTrio = rosterOf(topLab, topLab.userTeamId)
  .slice(0, 3);
for (const player of topTrio) {
  player.tier = 2;
  player.level = MAX_LEVEL;
  player.overall = 88;
  player.potential = 88;
}
const topBefore = new Set(Object.keys(topLab.players));
const topFused = fusePlayers(topLab, topTrio.map((player) => player.id));
assert(topFused.state, topFused.error ?? 'three maxed tier-2 players should fuse');
const tierOne = Object.values(topFused.state!.players).find(
  (player) => !topBefore.has(player.id),
)!;
assert(tierOne.tier === 1, 'fusion should top out at tier 1');
assert(
  tierOne.potential >= 88,
  'the mint should inherit the best burned player as its ceiling',
);
assert(
  Math.abs(
    tierOne.salary - Math.max(LEAGUE_MIN_SALARY, salaryDemand(tierOne, capFor(topFused.state!))),
  ) < 1e-9 && tierOne.salary > LEAGUE_MIN_SALARY,
  'a star-level mint should be paid above the minimum on the rating curve',
);

// Fusion takes exactly three players, never two.
const pairLab = createLeague('CHI', 717172);
const pairPlayers = rosterOf(pairLab, pairLab.userTeamId)
  .slice(0, 2);
for (const player of pairPlayers) {
  player.tier = 5;
  player.level = MAX_LEVEL;
}
assert(
  Boolean(fusePlayers(pairLab, pairPlayers.map((player) => player.id)).error),
  'fusion should require exactly three players',
);

// Tier 1 and Hall of Fame inputs, mixed tiers, untrained players and rival clubs are refused.
const guardLab = createLeague('CHI', 727272);
const guardRoster = rosterOf(guardLab, guardLab.userTeamId);
const [g1, g2, g3] = guardRoster;
g1.tier = 1;
g1.level = MAX_LEVEL;
g2.tier = 1;
g2.level = MAX_LEVEL;
g3.tier = 1;
g3.level = MAX_LEVEL;
assert(
  Boolean(fusePlayers(guardLab, [g1.id, g2.id, g3.id]).error),
  'tier-1 players cannot be fused',
);
g1.tier = 0;
g2.tier = 0;
g3.tier = 0;
assert(
  Boolean(fusePlayers(guardLab, [g1.id, g2.id, g3.id]).error),
  'Hall of Fame players cannot be fused',
);
g1.tier = 3;
g2.tier = 4;
g3.tier = 3;
g1.level = MAX_LEVEL;
g2.level = MAX_LEVEL;
g3.level = MAX_LEVEL;
assert(
  Boolean(fusePlayers(guardLab, [g1.id, g2.id, g3.id]).error),
  'fusion requires inputs of the same tier',
);
g2.tier = 3;
g1.level = 10;
assert(
  Boolean(fusePlayers(guardLab, [g1.id, g2.id, g3.id]).error),
  'fusion requires every input at max level',
);
const rivalPlayer = Object.values(guardLab.players).find(
  (player) => player.teamId && player.teamId !== guardLab.userTeamId,
)!;
rivalPlayer.level = MAX_LEVEL;
rivalPlayer.tier = 3;
g1.level = MAX_LEVEL;
assert(
  Boolean(fusePlayers(guardLab, [g1.id, g2.id, rivalPlayer.id]).error),
  'fusion cannot touch another club\'s players',
);

/* Stored NFTs: off the cap until signed */
const stashLab = createLeague('DAL', 818181);
const stashTarget = rosterOf(stashLab, stashLab.userTeamId)[0]!;
const payrollBeforeStash = payrollOf(stashLab, stashLab.userTeamId);
stashLab.players[stashTarget.id].teamId = null;
stashLab.players[stashTarget.id].years = 2;
stashLab.stash = [...(stashLab.stash ?? []), stashTarget.id];
assert(
  Math.abs(payrollOf(stashLab, stashLab.userTeamId) - (payrollBeforeStash - stashTarget.salary)) <
    0.11,
  'a stored NFT should not count against the cap',
);
assert(
  stashPlayers(stashLab).some((player) => player.id === stashTarget.id),
  'the collection should list owned NFTs',
);
const stashSigned = signStashedPlayer(stashLab, stashTarget.id);
assert(stashSigned.state, stashSigned.error ?? 'a stored NFT should be signable when it fits');
assert(
  stashSigned.state!.players[stashTarget.id].teamId === stashLab.userTeamId,
  'signing a stored NFT should add him to the roster',
);
assert(
  !(stashSigned.state!.stash ?? []).includes(stashTarget.id),
  'signing should empty him from the collection',
);

/* A mint whose contract cannot fit under the cap is stored automatically */
const capLab = createLeague('DEN', 919191);
// Extra bodies so burning three inputs cannot break the roster minimum alone.
for (const id of capLab.freeAgents.slice(0, 3)) capLab.players[id].teamId = capLab.userTeamId;
const anchor = rosterOf(capLab, capLab.userTeamId)[0]!;
const capInputs = rosterOf(capLab, capLab.userTeamId)
  .filter((player) => player.id !== anchor.id)
  .slice(0, 3);
for (const player of capInputs) {
  player.tier = 5;
  player.level = MAX_LEVEL;
}
capLab.players[anchor.id].salary = capFor(capLab) - 1;
const capIds = new Set(Object.keys(capLab.players));
const storedFusion = fusePlayers(capLab, capInputs.map((player) => player.id));
assert(storedFusion.state, storedFusion.error ?? 'the fusion itself should succeed');
const storedNft = Object.values(storedFusion.state!.players).find(
  (player) => !capIds.has(player.id),
)!;
assert(storedNft.teamId === null, 'an unaffordable mint should be stored, not signed');
assert(
  (storedFusion.state!.stash ?? []).includes(storedNft.id),
  'the stored mint should appear in the collection',
);

/* The stored collection is capped at three NFTs */
const fullStashLab = createLeague('DEN', 929292);
// Extra bodies so the refused fusion fails on the collection, not the minimum.
for (const id of fullStashLab.freeAgents.slice(0, 3)) {
  fullStashLab.players[id].teamId = fullStashLab.userTeamId;
}
const fullAnchor = rosterOf(fullStashLab, fullStashLab.userTeamId)[0]!;
const fullInputs = rosterOf(fullStashLab, fullStashLab.userTeamId)
  .filter((player) => player.id !== fullAnchor.id)
  .slice(0, 3);
for (const player of fullInputs) {
  player.tier = 5;
  player.level = MAX_LEVEL;
}
fullStashLab.players[fullAnchor.id].salary = capFor(fullStashLab) - 1;
// Only the number of stored NFTs matters here, so any owned ids fill the slots.
fullStashLab.stash = Object.values(fullStashLab.players)
  .filter((player) => player.teamId && player.teamId !== fullStashLab.userTeamId)
  .slice(0, STASH_LIMIT)
  .map((player) => player.id);
assert(
  fullStashLab.stash.length === STASH_LIMIT,
  'the test should start with a full collection',
);
assert(
  Boolean(
    fusePlayers(fullStashLab, fullInputs.map((player) => player.id)).error?.includes(
      'collection is full',
    ),
  ),
  'a fusion whose mint must be stored should be refused when the collection is full',
);

/* Stored NFTs are frozen: no aging, no development */
const frozenLab = createLeague('SEA', 616263);
const frozenPlayer = rosterOf(frozenLab, frozenLab.userTeamId)[0]!;
frozenLab.players[frozenPlayer.id].teamId = null;
frozenLab.players[frozenPlayer.id].years = 3;
frozenLab.stash = [...(frozenLab.stash ?? []), frozenPlayer.id];
const frozenAge = frozenLab.players[frozenPlayer.id].age;
const frozenOvr = frozenLab.players[frozenPlayer.id].overall;
const afterFreeze = enterOffseason(frozenLab);
assert(
  afterFreeze.players[frozenPlayer.id].age === frozenAge,
  'a stored NFT should not age while it sits in the collection',
);
assert(
  afterFreeze.players[frozenPlayer.id].overall === frozenOvr,
  'a stored NFT should not develop while it sits in the collection',
);
assert(
  afterFreeze.players[frozenPlayer.id].years === 2,
  'a stored NFT contract should still tick down',
);

// Contracts: expired user deals wait for a decision instead of vanishing.
let contractLab = createLeague('DAL', 515151);
const keeperId = rosterOf(contractLab, contractLab.userTeamId)[0].id;
const leaverId = rosterOf(contractLab, contractLab.userTeamId)[1].id;
const storedId = rosterOf(contractLab, contractLab.userTeamId)[2].id;
contractLab.players[keeperId].years = 1;
contractLab.players[leaverId].years = 1;
contractLab.players[storedId].years = 1;
contractLab.players[storedId].rookie = true;
contractLab = enterOffseason(contractLab);
assert(
  contractLab.players[keeperId].teamId === contractLab.userTeamId,
  'an expired user contract should stay on the roster during the offseason',
);
assert(contractLab.players[keeperId].years === 0, 'an expired contract should show zero years');
assert(
  !contractLab.freeAgents.includes(keeperId),
  'expired user players should not hit the open market without a decision',
);
contractLab = reSignPlayer(contractLab, keeperId);
assert(
  contractLab.players[keeperId].teamId === contractLab.userTeamId &&
    contractLab.players[keeperId].years === 3,
  're-signing should keep the player on a new three-year deal',
);
contractLab = letWalk(contractLab, leaverId);
assert(
  contractLab.players[leaverId].teamId === null &&
    contractLab.freeAgents.includes(leaverId),
  'letting an expired player walk should put him on the free-agent market',
);

// An expired NFT can be stored instead of walking: off the roster and cap, still owned.
const storedSalary = contractLab.players[storedId].salary;
const payrollBeforeStore = payrollOf(contractLab, contractLab.userTeamId);
const stored = storeExpiredPlayer(contractLab, storedId, 3);
assert(stored.state, stored.error ?? 'an expired NFT should be storable');
contractLab = stored.state!;
assert(contractLab.players[storedId].teamId === null, 'storing should take him off the roster');
assert((contractLab.stash ?? []).includes(storedId), 'storing should add him to the collection');
assert(
  !contractLab.freeAgents.includes(storedId),
  'a stored NFT should not reach free agency',
);
assert(
  contractLab.players[storedId].years === 3 && !contractLab.players[storedId].rookie,
  'storing should start a fresh deal of the chosen length and clear the rookie tag',
);
assert(
  Math.abs(
    payrollOf(contractLab, contractLab.userTeamId) - (payrollBeforeStore - storedSalary),
  ) < 0.11,
  'a stored expired NFT should come off the cap',
);
assert(
  Boolean(storeExpiredPlayer(contractLab, keeperId).error),
  'a player under contract cannot be stored',
);
const storedSigned = signStashedPlayer(contractLab, storedId);
assert(storedSigned.state, storedSigned.error ?? 'a stored expired NFT should be signable');
contractLab = storedSigned.state!;
assert(
  contractLab.players[storedId].years === 3,
  'signing a stored NFT should keep the stored contract length',
);

// Anything still unresolved leaves when the next season opens.
let lapseLab = createLeague('SEA', 616161);
const walkerId = rosterOf(lapseLab, lapseLab.userTeamId)[0].id;
for (const player of rosterOf(lapseLab, lapseLab.userTeamId)) player.years = 3;
lapseLab.players[walkerId].years = 1;
lapseLab = enterOffseason(lapseLab);
assert(
  rosterOf(lapseLab, lapseLab.userTeamId).some((p) => p.id === walkerId),
  'the expired player should still be available to re-sign in the offseason',
);
lapseLab = startNextSeason(lapseLab);
assert(
  lapseLab.players[walkerId].teamId !== lapseLab.userTeamId,
  'unresolved expired contracts should leave the user team when the season opens',
);
assert(
  signedPlayers(lapseLab, lapseLab.userTeamId).length >= 8,
  'the user should still have a legal roster after contracts lapse',
);

// Options: a team only exercises a team option at market rate, while a player
// opts in when the existing salary pays at least 95% of his demand.
let optionLab = enterOffseason(createLeague('UTA', 909091));
const optionRoster = rosterOf(optionLab, optionLab.userTeamId).slice(0, 4);
optionRoster.forEach((player) => { player.age = 27; });
const overpaidOption = optionRoster[0];
const bargainOption = optionRoster[1];
const paidPlayerOption = optionRoster[2];
const cheapPlayerOption = optionRoster[3];
overpaidOption.option = 'team';
overpaidOption.salary = 40;
overpaidOption.years = 1;
bargainOption.option = 'team';
bargainOption.salary = 0.5;
bargainOption.years = 1;
paidPlayerOption.option = 'player';
paidPlayerOption.salary = 40;
paidPlayerOption.years = 1;
cheapPlayerOption.option = 'player';
cheapPlayerOption.salary = 0.5;
cheapPlayerOption.years = 1;
optionLab = enterOffseason(optionLab);
assert(
  optionLab.players[overpaidOption.id].years === 0 &&
    optionLab.players[overpaidOption.id].option === null &&
    optionLab.players[overpaidOption.id].salary < 40,
  'a team option above market should be declined into a cheaper expired deal',
);
assert(
  optionLab.players[bargainOption.id].years === 1 &&
    optionLab.players[bargainOption.id].option === null,
  'a team option below market should be exercised for one more year',
);
assert(
  optionLab.players[paidPlayerOption.id].years === 1,
  'a player option paying market rate should be accepted',
);
assert(
  optionLab.players[cheapPlayerOption.id].years === 0 &&
    optionLab.players[cheapPlayerOption.id].salary > 0.5,
  'a player option below market should be declined for a raise',
);

// Roster relief: a club below eight players can sign a minimum-scale free
// agent with no cap room and no cash, and the shared terms helper says so.
let reliefLab = enterOffseason(createLeague('ORL', 909092));
const reliefRoster = rosterOf(reliefLab, reliefLab.userTeamId);
reliefRoster.forEach((player, index) => {
  player.years = index < 7 ? 3 : 0;
  player.salary = 5;
});
reliefRoster[0].salary =
  Math.round((capFor(reliefLab) - 5 * (reliefRoster.length - 1)) * 10) / 10;
reliefLab.teams[reliefLab.userTeamId].cash = 0;
const reliefFa = reliefLab.freeAgents
  .map((id) => reliefLab.players[id])
  .filter(Boolean)
  .find((player) => freeAgentTerms(reliefLab, player!).relief);
assert(reliefFa, 'the market should offer a minimum-scale free agent');
const reliefTerms = freeAgentTerms(reliefLab, reliefFa);
assert(
  reliefTerms.relief && reliefTerms.affordable && reliefTerms.hwd === 0,
  `relief terms should waive cap room and the HWD fee: ${JSON.stringify(reliefTerms)}`,
);
assert(
  reliefTerms.asking <= MIN_SALARY_EXCEPTION * capFor(reliefLab),
  'relief should only cover minimum-scale deals',
);
const reliefSigned = signFreeAgent(reliefLab, reliefFa.id, 2);
assert(reliefSigned !== reliefLab, 'relief should let a capped-out club reach the minimum');
assert(
  reliefSigned.teams[reliefSigned.userTeamId].cash === 0 &&
    reliefSigned.hwd === reliefLab.hwd &&
    reliefSigned.players[reliefFa.id].salary === reliefTerms.asking,
  'a relief signing should charge no cash or HWD and pay the asking salary',
);
assert(
  signedPlayers(reliefSigned, reliefSigned.userTeamId).length === 8,
  'the relief signing should make the roster legal',
);
const secondRelief = freeAgentTerms(
  reliefSigned,
  reliefSigned.freeAgents.map((id) => reliefSigned.players[id]).filter(Boolean)[0]!,
);
assert(
  !secondRelief.relief && !secondRelief.affordable,
  'relief should end once the club has eight signed players',
);
const reliefOpened = startNextSeason(reliefSigned);
assert(
  reliefOpened !== reliefSigned &&
    signedPlayers(reliefOpened, reliefOpened.userTeamId).length >= 8,
  'a club rescued through relief should be able to open the next season',
);

// A free agent is signed with HWD, and the fee goes to the development
// treasury: cash buys no player NFT, so a cheap signing can never be resold
// for tokens at a profit.
let feeLab = createLeague('MIA', 909094);
const feeFa = feeLab.freeAgents
  .map((id) => feeLab.players[id])
  .filter(Boolean)
  .sort((a, b) => b.overall - a.overall)[0];
const feeTerms = freeAgentTerms(feeLab, feeFa);
assert(
  feeTerms.hwd >= marketMaxBid(feeFa),
  'a free agent should cost at least what a rival would bid for him',
);
const feeCash = feeLab.teams[feeLab.userTeamId].cash;
const feeSigned = signFreeAgent(feeLab, feeFa.id, 3);
assert(feeSigned !== feeLab, 'an affordable free agent should sign');
assert(feeSigned.hwd === (feeLab.hwd ?? 0) - feeTerms.hwd, 'signing should charge the fee in HWD');
assert(
  feeSigned.devFund === (feeLab.devFund ?? 0) + feeTerms.hwd,
  'the signing fee should go to the development treasury',
);
assert(feeSigned.teams[feeSigned.userTeamId].cash === feeCash, 'a signing should cost no cash');

// A full roster cannot draft a sixteenth player, but the pick can be passed so
// the draft never stalls with the user on the clock.
let draftCapLab = enterOffseason(createLeague('NOP', 909093));
const draftUser = draftCapLab.userTeamId;
const draftMine = rosterOf(draftCapLab, draftUser);
for (const player of Object.values(draftCapLab.players)
  .filter((player) => player.teamId && player.teamId !== draftUser)
  .slice(0, ROSTER_MAX - draftMine.length)) {
  player.teamId = draftUser;
}
draftCapLab.draftOrder = [
  draftUser,
  ...draftCapLab.draftOrder!.filter((id) => id !== draftUser),
];
draftCapLab.draftPickIndex = 0;
const draftProspect = draftProspects(draftCapLab)[0];
assert(
  rosterOf(draftCapLab, draftUser).length === ROSTER_MAX,
  'the draft fixture should start with a full roster',
);
assert(
  makeDraftPick(draftCapLab, draftProspect.id) === draftCapLab,
  'a full roster should not be able to draft a sixteenth player',
);
const passedDraft = passDraftPick(draftCapLab);
assert(passedDraft !== draftCapLab, 'passing should advance the draft');
assert(
  rosterOf(passedDraft, draftUser).length === ROSTER_MAX &&
    passedDraft.draftPickIndex === passedDraft.draftOrder!.length,
  'passing should complete the draft without adding a player',
);

const cashBefore = lab.teams[lab.userTeamId].cash;
const tpBefore = lab.teams[lab.userTeamId].trainingPoints;
lab = convertPointsToCash(lab, 2);
assert(
  lab.teams[lab.userTeamId].cash === cashBefore + 2 &&
    lab.teams[lab.userTeamId].trainingPoints === tpBefore - 2 * POINTS_PER_CASH_BLOCK,
  'converting training points should add $1M cash per block',
);

// Lineups: position-correct starters are stored, invalid ones rejected, and the
// chosen bench order is what the simulation uses.
let lineupLab = createLeague('ATL', 313131);
const lineupPositions = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const starters = lineupPositions.map(
  (pos) => rosterOf(lineupLab, lineupLab.userTeamId).find((p) => p.pos === pos)!.id,
);
lineupLab = setStarters(lineupLab, starters);
assert(
  lineupLab.lineup?.slice(0, 5).join('|') === starters.join('|'),
  'the starting five should be stored in position order',
);
assert(
  setStarters(lineupLab, [starters[1], starters[0], starters[2], starters[3], starters[4]]) ===
    lineupLab,
  'an out-of-position starting five should be rejected',
);
const weakBench = rosterOf(lineupLab, lineupLab.userTeamId)
  .filter((p) => !starters.includes(p.id))
  .sort((a, b) => a.overall - b.overall)[0];
lineupLab = setBenchOrder(lineupLab, [weakBench.id]);
assert(lineupLab.lineup?.[5] === weakBench.id, 'the chosen bench order should be stored');
lineupLab = simulateNextRound(lineupLab);
const lineupGame = lineupLab.schedule.find(
  (g) =>
    g.played && (g.home === lineupLab.userTeamId || g.away === lineupLab.userTeamId),
)!;
assert(
  Boolean(lineupGame.box?.some((line) => line.playerId === weakBench.id)),
  'a player promoted on the bench should actually get minutes',
);

// History, awards, career totals and the growing salary cap.
let recordLab = createLeague('PHX', 818181);
recordLab = simulateSeason(recordLab);
recordLab = simulatePlayoffs(recordLab);
recordLab = enterOffseason(recordLab);
assert((recordLab.history ?? []).length === 1, 'a completed season should enter the record book');
const record = recordLab.history![0];
assert(Boolean(record.champion) && record.season === 1, 'the record should name a champion');
assert(
  Boolean(record.mvpId && recordLab.players[record.mvpId]),
  'award winners should remain available to the record book',
);
assert(
  Object.values(recordLab.players).some((p) => (p.career?.gp ?? 0) > 0),
  'career totals should accumulate at the season rollover',
);
assert(
  capFor(recordLab) === CAP + (recordLab.season - 1) * CAP_GROWTH,
  'the salary cap should grow with league revenue',
);

// Draft scouting: ranges first, exact ratings after paying for a report.
let scoutLab = createLeague('DEN', 525252);
scoutLab = enterOffseason(scoutLab);
const prospect = draftProspects(scoutLab)[0];
assert(Boolean(prospectRange(scoutLab, prospect)), 'unscouted prospects should show ranges');
const allRanges = draftProspects(scoutLab).map((p) => prospectRange(scoutLab, p)!);
assert(
  allRanges.every(
    (range) =>
      range.ovr[0] <= range.ovr[1] &&
      range.pot[0] <= range.pot[1] &&
      range.pot[1] <= 99 &&
      range.ovr[0] >= 25,
  ),
  'prospect ranges should be ordered and capped',
);
const scoutCash = scoutLab.teams[scoutLab.userTeamId].cash;
scoutLab = scoutProspect(scoutLab, prospect.id);
assert(!prospectRange(scoutLab, prospect), 'scouting should reveal exact ratings');
assert(
  scoutLab.teams[scoutLab.userTeamId].cash < scoutCash,
  'scouting should cost front-office cash',
);

// Difficulty and starting scenarios.
const relaxedRound = simulateNextRound(createLeague('BOS', 2020, { difficulty: 'relaxed' }));
const hardRound = simulateNextRound(createLeague('BOS', 2020, { difficulty: 'hard' }));
assert(
  relaxedRound.teams['BOS'].trainingPoints > hardRound.teams['BOS'].trainingPoints,
  'relaxed difficulty should award more training points',
);
const contenderLab = createLeague('BOS', 99, { scenario: 'contender' });
const rebuildLab = createLeague('BOS', 99);
const averageOverall = (state: GameState) => {
  const roster = rosterOf(state, state.userTeamId);
  return roster.reduce((sum, p) => sum + p.overall, 0) / roster.length;
};
assert(
  averageOverall(contenderLab) > averageOverall(rebuildLab) + 3,
  'the contender start should be meaningfully stronger',
);
const expansionLab = createLeague('BOS', 99, { scenario: 'expansion' });
assert(
  rosterOf(expansionLab, expansionLab.userTeamId).length === 8,
  'the expansion start should begin with eight players',
);

// Chosen contract lengths, and the luxury tax.
let lengthLab = createLeague('NYS', 838383);
lengthLab.teams[lengthLab.userTeamId].cash = 50;
const affordable = lengthLab.freeAgents
  .map((id) => lengthLab.players[id])
  .filter((p) => p.salary < 10)
  .sort((a, b) => a.overall - b.overall)[0];
lengthLab = signFreeAgent(lengthLab, affordable.id, 4);
assert(
  lengthLab.players[affordable.id].years === 4,
  'the chosen free-agent contract length should apply',
);

let taxLab = createLeague('CHI', 939393);
taxLab.teams[taxLab.userTeamId].cash = 5;
for (const player of rosterOf(taxLab, taxLab.userTeamId)) player.salary = 20;
taxLab = enterOffseason(taxLab);
assert(
  taxLab.teams[taxLab.userTeamId].cash < 5,
  'payroll above the cap should trigger a luxury tax',
);

// The analytics department cuts the user's luxury tax bill, and saved levels
// keep working after a reload.
const taxBaseLab = createLeague('CHI', 939393);
taxBaseLab.teams[taxBaseLab.userTeamId].cash = 1000;
for (const player of rosterOf(taxBaseLab, taxBaseLab.userTeamId)) player.salary = 20;
const baseTax = luxuryTaxFor(
  payrollOf(taxBaseLab, taxBaseLab.userTeamId) - capFor(taxBaseLab),
  taxBaseLab.teams[taxBaseLab.userTeamId].taxStrikes ?? 0,
);
const noAnalytics = enterOffseason(taxBaseLab);
const analyticsLab = createLeague('CHI', 939393);
analyticsLab.teams[analyticsLab.userTeamId].cash = 1000;
for (const player of rosterOf(analyticsLab, analyticsLab.userTeamId)) player.salary = 20;
analyticsLab.facilities = { ...(analyticsLab.facilities ?? {}), analytics: 3 };
const withAnalytics = enterOffseason(analyticsLab);
const taxSaving =
  withAnalytics.teams[withAnalytics.userTeamId].cash -
  noAnalytics.teams[noAnalytics.userTeamId].cash;
assert(
  taxSaving > 0,
  'the analytics department should reduce the luxury tax bill',
);
assert(
  Math.abs(taxSaving - (baseTax - Math.round(baseTax * 0.7 * 10) / 10)) < 0.2,
  `analytics should save 30% of the tax bill (saved ${taxSaving}, base ${baseTax})`,
);
const facilitySave = createLeague('CHI', 939394) as unknown as Record<string, unknown>;
facilitySave.facilities = { training: 0, medical: 0, scouting: 0, analytics: 2, development: 0 };
const loadedFacility = importSave(JSON.stringify(facilitySave));
assert(
  loadedFacility && facilityLevels(loadedFacility).analytics === 2,
  'saved analytics levels should keep their effect after a reload',
);

let sawInjury = false;
for (let season = 1; season <= 6; season++) {
  assert(state.phase === 'regular', `season ${season} should start in the regular season`);
  assert(state.season === season, `season counter should be ${season}`);

  state = simulateSeason(state);
  assert(state.phase === 'playoffs', `season ${season} should reach the playoffs`);

  const hurt = Object.values(state.players).filter((p) => p.injuryGames > 0);
  sawInjury = sawInjury || hurt.length > 0;
  for (const player of hurt) {
    assert(player.injury, `${player.name} should have an injury name`);
    assert(
      player.injuryGames >= 1 && player.injuryGames <= INJURY_MAX_GAMES,
      `${player.name} has an invalid recovery time`,
    );
  }

  const games = state.schedule.filter((g) => g.played);
  assert(games.length === 126, `expected 126 regular season games, got ${games.length}`);

  for (const team of Object.values(state.teams)) {
    assert(team.wins + team.losses === 21, `${team.abbr} should play 21 games, played ${team.wins + team.losses}`);
  }

  const roundCounts = new Map<number, number>();
  for (const game of games) roundCounts.set(game.round, (roundCounts.get(game.round) ?? 0) + 1);
  for (const [round, count] of roundCounts) {
    assert(count === 6, `round ${round} should have 6 games, has ${count}`);
  }

  let checkedBoxes = 0;
  for (const game of games.slice(0, 20)) {
    assert(game.box && game.box.length > 0, 'played game should have a box score');
    const home = game.box.filter((line) => line.teamId === game.home);
    const away = game.box.filter((line) => line.teamId === game.away);
    const homePts = home.reduce((sum, line) => sum + line.pts, 0);
    const awayPts = away.reduce((sum, line) => sum + line.pts, 0);
    assert(homePts === game.homeScore, `home box ${homePts} should equal score ${game.homeScore}`);
    assert(awayPts === game.awayScore, `away box ${awayPts} should equal score ${game.awayScore}`);
    for (const line of game.box) {
      assert(line.fgm >= line.tpm, 'made field goals should include made threes');
      assert(line.fga >= line.fgm, 'attempts should exceed makes');
      assert(line.tpa >= line.tpm, 'three point attempts should exceed makes');
      assert(line.fta >= line.ftm, 'free throw attempts should exceed makes');
      assert(line.pts >= 0 && line.min >= 0, 'no negative stat lines');
    }
    checkedBoxes++;
  }
  assert(checkedBoxes === 20, 'should have validated 20 box scores');

  state = simulatePlayoffs(state);
  const champion = championOf(state);
  assert(champion, `season ${season} should produce a champion`);
  assert(state.playoffs.filter((s) => s.round === 3).length === 1, 'exactly one finals series');

  state = enterOffseason(state);
  assert(state.phase === 'offseason', 'should enter the offseason');
  assert(state.draftOrder && state.draftOrder.length === 12, 'draft order should contain 12 teams');
  assert(state.draftClass && state.draftClass.length === 14, 'draft class should contain 14 prospects');
  const ranked = Object.values(state.teams).sort(
    (a, b) => a.wins - b.wins || a.ptsFor - a.ptsAgainst - (b.ptsFor - b.ptsAgainst),
  );
  const penalized = (teamId: string) =>
    (state.teams[teamId].taxStrikes ?? 0) >= 2 &&
    (state.pickOwners[teamId] ?? teamId) === teamId;
  const expectedOrigins = [
    ...ranked.filter((team) => !penalized(team.id)),
    ...ranked.filter((team) => penalized(team.id)),
  ].map((team) => team.id);
  assert(
    JSON.stringify(state.draftPickOrigins) === JSON.stringify(expectedOrigins),
    'draft order should rank non-offenders by record and move repeat tax offenders to the end',
  );
  for (const id of state.draftClass) {
    const prospect = state.players[id];
    assert(
      prospect.tier >= 3 && prospect.tier <= 5,
      `${prospect.name} should be a tier 3-5 prospect (tier 1, 2 and Hall of Fame are HWD league only)`,
    );
  }

  if (userOnTheClock(state)) {
    const prospects = draftProspects(state);
    assert(prospects.length > 0, 'user on the clock should have prospects available');
    if (rosterOf(state, state.userTeamId).length >= ROSTER_MAX) {
      // A full roster passes on the pick; the full-roster case has its own
      // scenario above, so assert the join path only when there is room.
      state = passDraftPick(state);
    } else {
      const targetId = prospects[0].id;
      const targetTier = prospects[0].tier;
      state = makeDraftPick(state, targetId);
      assert(
        state.players[targetId].teamId === state.userTeamId,
        'drafted player should join user team',
      );
      assert(targetTier >= 3 && targetTier <= 5, 'drafted player should come from tier 3-5');
      assert(state.players[targetId].years >= 2, 'rookie contracts should run at least two years');
      assert(state.players[targetId].years === ROOKIE_YEARS, 'rookies should sign the standard deal');
    }
  }

  for (const player of pendingContractPlayers(state, state.userTeamId)) {
    state = reSignPlayer(state, player.id);
  }
  assert(
    pendingContractPlayers(state, state.userTeamId).length === 0,
    'the user should decide on every expired contract during the offseason',
  );

  const wallet = state.teams[state.userTeamId];
  if (wallet.cash < 20) {
    const blocks = Math.min(Math.floor(wallet.trainingPoints / POINTS_PER_CASH_BLOCK), 30);
    if (blocks > 0) state = convertPointsToCash(state, blocks);
  }

  let guard = 0;
  while (rosterOf(state, state.userTeamId).length < 8 && guard++ < 30) {
    const candidates = state.freeAgents
      .map((id) => state.players[id])
      .filter((player) => player && player.salary <= 60)
      .sort((a, b) => b.overall - a.overall);
    let signed = false;
    for (const fa of candidates) {
      const next = signFreeAgent(state, fa.id);
      if (next !== state) {
        state = next;
        signed = true;
        break;
      }
    }
    if (!signed) break;
  }
  assert(rosterOf(state, state.userTeamId).length >= 8, 'user roster should be legal before next season');
  for (const player of Object.values(state.players)) {
    assert(player.level >= 1 && player.level <= MAX_LEVEL, `${player.name} has an invalid level`);
    assert(player.tier >= 0 && player.tier <= 5, `${player.name} has an invalid tier`);
  }

  if (season < 6) {
    const next = startNextSeason(state);
    assert(next !== state, 'startNextSeason should advance the game');
    assert(
      Object.values(next.players).every((p) => p.injuryGames === 0 && p.injury === null),
      'the offseason should heal every player',
    );
    state = next;
  }
}

assert(
  Object.values(state.players).some((p) => p.tier < 5 || p.level > 1),
  'CPU teams should also spend training points over the years',
);

assert(sawInjury, 'injuries should occur across six simulated seasons');

/* Marketplace listing gate */
const gate = createLeague('NYS', 4242);
const gatePlayer = Object.values(gate.players).find((p) => p.teamId === gate.userTeamId);
assert(gatePlayer, 'the user should have a player to test listing eligibility');

// Six completed seasons means state.season is 7.
gate.season = MARKET_MIN_ACCOUNT_SEASONS + 1;
assert(
  accountSeasons(gate) === MARKET_MIN_ACCOUNT_SEASONS,
  'six completed seasons should read as a six-season-old account',
);

gatePlayer.rookie = false;
gatePlayer.joinedSeason = 1;
const eligible = canListOnMarket(gate, gatePlayer.id);
assert(eligible.eligible, 'a veteran held for a full season on an aged account should be listable');
assert(eligible.reasons.length === 0, 'an eligible player should have no blocking reasons');

gatePlayer.rookie = true;
const onRookieDeal = canListOnMarket(gate, gatePlayer.id);
assert(!onRookieDeal.eligible, 'a player still on his rookie deal should not be listable');
assert(onRookieDeal.reasons.includes('rookie-deal'), 'the rookie deal should be reported as the block');

gatePlayer.rookie = false;
gatePlayer.joinedSeason = gate.season;
const justArrived = canListOnMarket(gate, gatePlayer.id);
assert(!justArrived.eligible, 'a newly acquired player should not be listable immediately');
assert(justArrived.reasons.includes('ownership'), 'the ownership period should be reported as the block');

gatePlayer.joinedSeason = 1;
gate.season = MARKET_MIN_ACCOUNT_SEASONS;
const youngAccount = canListOnMarket(gate, gatePlayer.id);
assert(!youngAccount.eligible, 'an account with fewer than six completed seasons should not list');
assert(youngAccount.reasons.includes('account-age'), 'the account age should be reported as the block');

const notOnRoster = Object.values(gate.players).find((p) => p.teamId !== gate.userTeamId);
assert(notOnRoster, 'the league should have players outside the user roster');
assert(
  canListOnMarket(gate, notOnRoster.id).reasons.includes('not-on-roster'),
  'players outside the user roster cannot be listed',
);

/* HWD marketplace */
let marketLab = createLeague('NYS', 454545);
marketLab.season = MARKET_MIN_ACCOUNT_SEASONS + 1;
// Every token in play: the user, the rival clubs and the development fund.
const totalHwd = (state: GameState) =>
  hwdBalance(state) +
  devFundBalance(state) +
  Object.keys(state.clubHwd ?? {}).reduce((sum, id) => sum + clubHwdBalance(state, id), 0);
assert(
  Object.keys(marketLab.clubHwd ?? {}).length === Object.keys(marketLab.teams).length - 1,
  'every rival club should start with a marketplace HWD balance',
);
assert(
  Object.keys(marketLab.clubHwd ?? {}).every(
    (id) => clubHwdBalance(marketLab, id) === CLUB_HWD_START,
  ),
  'every CPU manager should get the full HWD airdrop',
);
assert(hwdBalance(marketLab) === HWD_STARTING, 'a new career should start with HWD tokens');
assert(openListings(marketLab).length > 0, 'rival clubs should list players on the marketplace');

const buyable = openListings(marketLab).find(
  (listing) =>
    marketLab.players[listing.playerId].salary <=
    capSpaceOf(marketLab, marketLab.userTeamId),
);
assert(buyable, 'at least one listing should fit under the cap');
marketLab.hwd = buyable.price + 5;
const sellerClub = buyable.sellerTeamId;
const sellerClubBefore = clubHwdBalance(marketLab, sellerClub);
const devFundBeforeBuy = devFundBalance(marketLab);
const supplyBeforeBuy = totalHwd(marketLab);
const afterBuy = buyMarketPlayer(marketLab, buyable.id);
assert(afterBuy.state, afterBuy.error ?? 'the listing should be purchasable');
marketLab = afterBuy.state!;
assert(
  marketLab.players[buyable.playerId].teamId === marketLab.userTeamId,
  'buying a listing should add the player to the user roster',
);
assert(hwdBalance(marketLab) === 5, 'buying should spend the HWD price');
assert(
  clubHwdBalance(marketLab, sellerClub) === sellerClubBefore + buyable.price - marketFee(buyable.price),
  'the selling club should receive the price net of the fee',
);
assert(
  devFundBalance(marketLab) === devFundBeforeBuy + marketFee(buyable.price),
  'the buying fee should land in the development fund',
);
assert(
  totalHwd(marketLab) === supplyBeforeBuy,
  'a marketplace buy must move HWD, never mint it',
);

const seller = rosterOf(marketLab, marketLab.userTeamId).find(
  (player) => !player.rookie && player.id !== buyable.playerId,
);
assert(seller, 'the user should have a sellable veteran');
// Rivals judge the price: a wild ask over the valuation is refused outright.
const greedy = sellPlayerToMarket(marketLab, seller.id, marketValue(seller) + 25);
assert(
  Boolean(greedy.error) && greedy.error!.includes('valued at about'),
  'a rival should refuse an ask far past the valuation',
);
assert(
  marketLab.players[seller.id].teamId === marketLab.userTeamId,
  'a refused ask must leave the player on the user roster',
);

// A proven starter draws a premium, and the owner still names the price.
const proven = Object.values(marketLab.players)
  .filter(
    (player) =>
      player.teamId &&
      player.teamId !== marketLab.userTeamId &&
      !player.rookie 
  )
  .sort((a, b) => b.overall - a.overall)[0];
assert(proven, 'a rival should own a player worth buying');
// Guarantee one club can absorb the salary so the sale has a legal buyer.
const richest = Object.values(marketLab.teams)
  .filter((team) => team.id !== marketLab.userTeamId && team.id !== proven.teamId)
  .sort((a, b) => capSpaceOf(marketLab, b.id) - capSpaceOf(marketLab, a.id))[0];
for (const player of rosterOf(marketLab, richest.id)) player.salary = 1;
proven.teamId = marketLab.userTeamId;
proven.joinedSeason = marketLab.season - 2;
proven.years = 2;
const saleAsk = marketMaxBid(proven);
const walletBefore = hwdBalance(marketLab);
const supplyBeforeSale = totalHwd(marketLab);
const soldState = sellPlayerToMarket(marketLab, proven.id, saleAsk);
assert(soldState.state, soldState.error ?? 'a proven starter should sell at the owner\'s ask');
marketLab = soldState.state!;
assert(
  totalHwd(marketLab) === supplyBeforeSale,
  'a marketplace sale must move HWD, never mint it',
);
assert(
  marketLab.players[proven.id].teamId !== marketLab.userTeamId,
  'a sold player should leave the user roster',
);
assert(
  hwdBalance(marketLab) === walletBefore + saleAsk - marketFee(saleAsk),
  'a sale should pay the owner\'s ask, net of the marketplace fee',
);
assert(
  marketLab.log.some((entry) => entry.text.includes('HWD')),
  'a marketplace sale should be reported in the log',
);

// A peer-to-peer sale needs a club that actually holds the tokens.
const anotherSeller = rosterOf(marketLab, marketLab.userTeamId).find(
  (player) => !player.rookie && canListOnMarket(marketLab, player.id).eligible,
);
assert(anotherSeller, 'the user should still have a sellable veteran');
const anotherValue = marketValue(anotherSeller);
const drained: GameState = { ...marketLab, clubHwd: {} };
// With no HWD anywhere, the sale cannot happen today and becomes a listing.
const listed = sellPlayerToMarket(drained, anotherSeller.id, anotherValue);
assert(listed.state, listed.error ?? 'a sale with no buyer should list the player instead');
const escrowLab = listed.state!;
assert(
  escrowLab.players[anotherSeller.id].teamId === null,
  'an unsold listing should take the player off the roster',
);
assert(
  (escrowLab.market ?? []).some(
    (entry) => entry.playerId === anotherSeller.id && entry.sellerTeamId === escrowLab.userTeamId,
  ),
  'an unsold player should stay on the market board',
);
assert(
  hwdBalance(escrowLab) === hwdBalance(drained),
  'listing a player must not credit the owner anything',
);
assert(
  Boolean(sellPlayerToMarket(escrowLab, anotherSeller.id, anotherValue).error),
  'a player already on the board cannot be listed a second time',
);
// Frozen exactly like a stored NFT: no aging and no contract clock.
const escrowAge = escrowLab.players[anotherSeller.id].age;
const escrowYears = escrowLab.players[anotherSeller.id].years;
const escrowOffseason = enterOffseason(escrowLab);
assert(
  escrowOffseason.players[anotherSeller.id].age === escrowAge,
  'a listed player should not age',
);
assert(
  escrowOffseason.players[anotherSeller.id].years === escrowYears,
  'a listing should not run down the player\'s contract',
);
assert(
  !escrowOffseason.freeAgents.includes(anotherSeller.id),
  'a listed player should never drift into free agency',
);
// Even a listing whose deal has run out waits on the board: free agency is for
// players with no owner, and a listing still has a seller.
const expiringListing = structuredClone(escrowOffseason);
expiringListing.players[anotherSeller.id].years = 0;
const nextYear = startNextSeason(expiringListing);
assert(
  !nextYear.freeAgents.includes(anotherSeller.id),
  'an expired listing should stay on the board instead of reaching free agency',
);
assert(
  (nextYear.market ?? []).some((entry) => entry.playerId === anotherSeller.id),
  'an expired listing should still be on the market board',
);

/* The escrowed listing is fair game for a rival once the new year opens. */
escrowLab.players[anotherSeller.id].overall = 90;
const escrowBuyer = Object.values(escrowLab.teams)
  .filter((team) => team.id !== escrowLab.userTeamId)
  .sort((a, b) => capSpaceOf(escrowLab, b.id) - capSpaceOf(escrowLab, a.id))[0];
for (const player of rosterOf(escrowLab, escrowBuyer.id)) player.salary = 1;
escrowLab.clubHwd = { [escrowBuyer.id]: 500 };
escrowLab.market = (escrowLab.market ?? []).map((entry) =>
  entry.playerId === anotherSeller.id ? { ...entry, season: escrowLab.season - 1 } : entry,
);
const escrowPrice = (escrowLab.market ?? []).find(
  (entry) => entry.playerId === anotherSeller.id,
)!.price;
const escrowWalletBefore = hwdBalance(escrowLab);
const escrowSupplyBefore = totalHwd(escrowLab);
cpuMarketPass(escrowLab);
assert(
  escrowLab.players[anotherSeller.id].teamId === escrowBuyer.id,
  'a rival should buy a listed player once the new year opens',
);
assert(
  hwdBalance(escrowLab) === escrowWalletBefore + escrowPrice - marketFee(escrowPrice),
  'a rival buying a listing should pay the owner, net of the fee',
);
assert(
  totalHwd(escrowLab) === escrowSupplyBefore,
  'a listing sale must move HWD, never mint it',
);
assert(
  !(escrowLab.market ?? []).some((entry) => entry.playerId === anotherSeller.id),
  'a sold listing should come off the board',
);
const escrowWalletAfterSale = hwdBalance(escrowLab);
cpuMarketPass(escrowLab);
assert(
  hwdBalance(escrowLab) === escrowWalletAfterSale,
  'a sold listing must never be paid out twice',
);

/* Rival clubs buy each other's leftovers at season start, never a fresh board. */
let passLab = createLeague('SAC', 741852);
const passUser = passLab.userTeamId;
const bestOf = (teamId: string) =>
  rosterOf(passLab, teamId).sort((a, b) => b.overall - a.overall)[0]?.overall ?? 0;
const floorOf = (teamId: string) => {
  const roster = rosterOf(passLab, teamId).sort((a, b) => b.overall - a.overall);
  return roster.length ? roster[Math.min(8, roster.length - 1)].overall : 0;
};
const passSeller = Object.values(passLab.teams)
  .filter((team) => team.id !== passUser)
  .sort((a, b) => bestOf(b.id) - bestOf(a.id))[0];
const passTarget = rosterOf(passLab, passSeller.id).sort((a, b) => b.overall - a.overall)[0];
const passOther = Object.values(passLab.teams).find(
  (team) => team.id !== passUser && team.id !== passSeller.id,
)!;
const passFresh = rosterOf(passLab, passOther.id).sort((a, b) => b.overall - a.overall)[0];
// Guarantee one club can fit the salary, so the pass has a legal buyer.
const passNeediest = Object.values(passLab.teams)
  .filter((team) => team.id !== passUser && team.id !== passSeller.id)
  .sort((a, b) => floorOf(a.id) - floorOf(b.id))[0];
for (const player of rosterOf(passLab, passNeediest.id)) player.salary = 1;
assert(
  passTarget.overall > floorOf(passNeediest.id),
  'the leftover star should be an upgrade for the neediest club',
);
const passPrice = marketAsk(passTarget);
const passUserPlayer = rosterOf(passLab, passUser)[0];
passLab.market = [
  {
    id: 'mkt_old_pass',
    playerId: passTarget.id,
    sellerTeamId: passSeller.id,
    price: passPrice,
    season: passLab.season - 1,
  },
  {
    id: 'mkt_fresh_pass',
    playerId: passFresh.id,
    sellerTeamId: passOther.id,
    price: marketAsk(passFresh),
    season: passLab.season,
  },
  {
    id: 'mkt_user_pass',
    playerId: passUserPlayer.id,
    sellerTeamId: passUser,
    price: 10,
    season: passLab.season - 1,
  },
];
const passBefore = structuredClone(passLab);
cpuMarketPass(passLab);
const passBuyerId = passLab.players[passTarget.id].teamId ?? '';
assert(
  passBuyerId && passBuyerId !== passUser && passBuyerId !== passSeller.id,
  'a leftover listing should be bought by another rival club',
);
assert(
  clubHwdBalance(passLab, passBuyerId) ===
    clubHwdBalance(passBefore, passBuyerId) - passPrice,
  'the buying club should pay the asking price out of its HWD',
);
assert(
  clubHwdBalance(passLab, passSeller.id) ===
    clubHwdBalance(passBefore, passSeller.id) + passPrice - marketFee(passPrice),
  'the selling club should receive the price net of the marketplace fee',
);
assert(
  devFundBalance(passLab) === devFundBalance(passBefore) + marketFee(passPrice),
  'the marketplace fee should fund development',
);
assert(
  passLab.market!.some((listing) => listing.id === 'mkt_fresh_pass') &&
    passLab.players[passFresh.id].teamId === passOther.id,
  'a board opened this season should not be raided before the player sees it',
);
assert(
  passLab.market!.some((listing) => listing.id === 'mkt_user_pass'),
  'rivals should not buy a user listing whose player is still on the user roster',
);
const passTotal = (state: GameState) =>
  hwdBalance(state) +
  Object.keys(state.clubHwd ?? {}).reduce((sum, id) => sum + clubHwdBalance(state, id), 0) +
  devFundBalance(state);
assert(
  Math.abs(passTotal(passLab) - passTotal(passBefore)) < 0.01,
  'the rival market pass should move HWD, never mint it',
);

/* HWD conversion desk: HWD buys training points, capped every season */
const deskLab = createLeague('NYS', 787878);
deskLab.season = MARKET_MIN_ACCOUNT_SEASONS + 1;
deskLab.hwd = 100;
deskLab.devFund = 0;
deskLab.tpSwap = undefined;
const deskTpBefore = deskLab.teams[deskLab.userTeamId].trainingPoints;
const deskFundBefore = devFundBalance(deskLab);
const deskTotalBefore = totalHwd(deskLab);
const minQuote = hwdTpQuote(HWD_TP_MIN);
assert(
  minQuote.tp === HWD_TP_MIN * HWD_TP_RATE,
  'the desk pays straight through: every token is worth exactly its rate',
);
assert(
  Boolean(convertHwdToTrainingPoints(deskLab, HWD_TP_MIN - 1).error),
  'the desk refuses a conversion below its minimum',
);

const day1 = new Date(2030, 0, 1);
const firstConvert = convertHwdToTrainingPoints(deskLab, HWD_TP_MIN, day1);
assert(firstConvert.state, firstConvert.error ?? 'HWD should convert into training points');
const afterConvert = firstConvert.state!;
assert(
  hwdBalance(afterConvert) === hwdBalance(deskLab) - HWD_TP_MIN,
  'a conversion spends HWD from the wallet',
);
assert(
  afterConvert.teams[afterConvert.userTeamId].trainingPoints === deskTpBefore + minQuote.tp,
  'the converted HWD is credited as training points',
);
assert(
  devFundBalance(afterConvert) === deskFundBefore,
  'the desk takes no fee, so the development fund is untouched',
);
assert(
  totalHwd(afterConvert) === deskTotalBefore - HWD_TP_MIN,
  'all the converted HWD leaves circulation instead of moving to a rival',
);
assert(hwdTpSpent(afterConvert) === HWD_TP_MIN, 'the season cap tracks HWD spent at the desk');
assert(
  hwdTpRemainingToday(afterConvert, day1) === 0,
  'the daily cap is spent by one minimum trade',
);
assert(
  Boolean(convertHwdToTrainingPoints(afterConvert, HWD_TP_MIN, day1).error),
  'the desk refuses a second trade on the same day',
);

const day2 = new Date(2030, 0, 2);
const day3 = new Date(2030, 0, 3);
const day4 = new Date(2030, 0, 4);
const day5 = new Date(2030, 0, 5);
const nextDay = convertHwdToTrainingPoints(afterConvert, HWD_TP_MIN, day2);
assert(nextDay.state, nextDay.error ?? 'the daily cap resets on the next day');
const day3Convert = convertHwdToTrainingPoints(nextDay.state!, HWD_TP_MIN, day3);
assert(day3Convert.state, day3Convert.error ?? 'the third day should convert');
const day4Convert = convertHwdToTrainingPoints(day3Convert.state!, HWD_TP_MIN, day4);
assert(day4Convert.state, day4Convert.error ?? 'the fourth day fills the season cap');
const deskCapped = day4Convert.state!;
assert(
  hwdTpRemaining(deskCapped) === 0 && hwdTpSpent(deskCapped) === HWD_TP_SEASON_CAP,
  'four daily trades use up the season cap',
);
assert(
  Boolean(convertHwdToTrainingPoints(deskCapped, HWD_TP_MIN, day5).error),
  'no HWD converts once the season cap is spent',
);
assert(
  Boolean(convertHwdToTrainingPoints(afterConvert, HWD_TP_SEASON_CAP, day2).error),
  'a single trade cannot jump the daily cap',
);
const nextTpSeason: GameState = { ...deskCapped, season: deskCapped.season + 1 };
assert(
  hwdTpRemaining(nextTpSeason) === HWD_TP_SEASON_CAP,
  'a new season resets the conversion cap',
);
assert(
  Boolean(convertHwdToTrainingPoints(nextTpSeason, HWD_TP_MIN, day5).state),
  'the desk opens again in the next season',
);
const shortWallet: GameState = { ...deskLab, hwd: HWD_TP_MIN - 1 };
assert(
  Boolean(convertHwdToTrainingPoints(shortWallet, HWD_TP_MIN, day1).error),
  'the desk refuses a trade the wallet cannot cover',
);
const lockedDesk = createLeague('NYS', 121212);
lockedDesk.hwd = 100;
const enteredBracket = enterHallOfFameLeague(lockedDesk);
assert(enteredBracket.state, enteredBracket.error ?? 'the test bracket should open');
assert(
  Boolean(convertHwdToTrainingPoints(enteredBracket.state!, HWD_TP_MIN, day1).error),
  'the desk is closed while the Hall of Fame roster is locked',
);

/* Season clock: a 24-hour wait, cleared with HWD a limited number of times */
const clockLab = createLeague('NYS', 909090);
clockLab.season = SEASON_SKIP_MIN_ACCOUNT_SEASONS + 1;
clockLab.hwd = 5000;
clockLab.devFund = 0;
clockLab.seasonReadyAt = undefined;
clockLab.seasonSkip = undefined;
assert(seasonReady(clockLab, day1), 'a save with no wait opens the season immediately');
const opened = advanceSeason(clockLab, day1);
assert(opened !== clockLab, 'advancing should open the next season');
if (SEASON_COOLDOWN_ENABLED) {
  assert(
    Math.abs(Date.parse(opened.seasonReadyAt!) - (day1.getTime() + SEASON_COOLDOWN_MS)) < 1000,
    'a new season should start the 24-hour wait',
  );
  assert(
    !seasonReady(opened, day1),
    'the next season should be cooling down right after it opens',
  );
  assert(
    seasonReady(opened, new Date(day1.getTime() + SEASON_COOLDOWN_MS)),
    'the wait should open the season for free once it expires',
  );
  const firstQuote = seasonSkipQuote(opened, day1);
  assert(!firstQuote.blocked, firstQuote.blocked ?? 'a skip should be available on a cooling season');
  const expectedSkip = Math.ceil(SEASON_SKIP_BASE * Math.sqrt(capFor(opened) / CAP));
  assert(firstQuote.cost === expectedSkip, 'the first skip should cost the base rate');
  const skipped = skipSeasonWait(opened, day1);
  assert(skipped.state, skipped.error ?? 'paying should open the season');
  const afterSkip = skipped.state!;
  // The rollover itself runs the CPU market, so compare against a free advance
  // from the same state: only the fee may differ.
  const advancedOnly = advanceSeason(opened, day1);
  assert(afterSkip.season === opened.season + 1, 'a skip should open exactly one season');
  assert(
    hwdBalance(afterSkip) === hwdBalance(advancedOnly) - expectedSkip,
    'the skip fee should leave the wallet',
  );
  assert(
    devFundBalance(afterSkip) === devFundBalance(advancedOnly) + expectedSkip,
    'the skip fee should fund development',
  );
  assert(
    seasonSkipsUsedToday(afterSkip, day1) === 1,
    'the daily skip counter should track the purchase',
  );
  assert(
    seasonSkipQuote(afterSkip, day1).cost ===
      Math.ceil(SEASON_SKIP_BASE * Math.sqrt(capFor(afterSkip) / CAP) * 1.6),
    'the second skip of the day should cost more',
  );
  let skipLab = afterSkip;
  for (let index = 1; index < SEASON_SKIP_MAX_PER_DAY; index += 1) {
    const step = skipSeasonWait(skipLab, day1);
    assert(step.state, step.error ?? 'another skip should be allowed the same day');
    skipLab = step.state!;
  }
  assert(
    Boolean(seasonSkipQuote(skipLab, day1).blocked),
    'the daily skip cap should refuse one more',
  );
  assert(
    seasonSkipsLeft(skipLab, day2) === SEASON_SKIP_MAX_PER_DAY,
    'the daily skip cap should reset the next day',
  );
  const shortSkip = skipSeasonWait({ ...opened, hwd: 1 }, day1);
  assert(Boolean(shortSkip.error) && !shortSkip.state, 'a skip should be refused without the HWD');
  const youngLab = createLeague('NYS', 919191);
  youngLab.season = 3;
  youngLab.hwd = 1000;
  youngLab.seasonReadyAt = new Date(day1.getTime() + SEASON_COOLDOWN_MS).toISOString();
  assert(
    Boolean(seasonSkipQuote(youngLab, day1).blocked),
    'skips should unlock only after the account gate',
  );
  assert(Boolean(skipSeasonWait(youngLab, day1).error), 'a young account should not buy a skip');
} else {
  assert(
    seasonReady(opened, day1),
    'the season clock is off, so the next season should be ready at once',
  );
}

/* Hall of Fame league: 10% burn, podium prizes and a random champion NFT */
const hofTotal = (state: GameState) =>
  hwdBalance(state) +
  Object.keys(state.clubHwd ?? {}).reduce((sum, id) => sum + clubHwdBalance(state, id), 0);

const brokeHof = { ...marketLab, hwd: HWD_LEAGUE_ENTRY_FEE - 1 };
assert(
  Boolean(enterHallOfFameLeague(brokeHof).error),
  'entry should be refused without the full HWD fee',
);
assert(
  !enterHallOfFameLeague(brokeHof).state,
  'a refused entry should not touch the save',
);

const hofLab: GameState = { ...marketLab, hwd: HWD_LEAGUE_ENTRY_FEE + 5, hof: null };

// A draw of poor clubs must not shrink the podium or mint HWD: a seat the rival
// cannot cover is topped up from the development fund, which holds real fees.
const poorSeat = hofField(hofLab).find((id) => id !== hofLab.userTeamId)!;
const poorLab: GameState = {
  ...hofLab,
  clubHwd: { ...(hofLab.clubHwd ?? {}), [poorSeat]: 0 },
  devFund: 500,
};
const poorEntry = enterHallOfFameLeague(poorLab);
assert(poorEntry.state, poorEntry.error ?? 'a bracket should open with a broke rival');
assert(
  clubHwdBalance(poorEntry.state!, poorSeat) === 0 &&
    devFundBalance(poorEntry.state!) === 500 - HWD_LEAGUE_ENTRY_FEE,
  'a rival that cannot cover its seat should be topped up by the development fund',
);
assert(
  poorEntry.state!.hof!.prizePool === HOF_TOTAL_PAYOUT,
  'a funded bracket should always seed the advertised podium pool',
);
const poorSettled = finishHofLeague(poorEntry.state!);
const poorBurned =
  hofTotal(poorLab) +
  devFundBalance(poorLab) -
  hofTotal(poorSettled) -
  devFundBalance(poorSettled);
assert(
  Math.abs(poorBurned - HOF_TOTAL_BURN) < 0.01,
  'a topped-up bracket should burn only its tenth and create no HWD',
);

const hofEntry = enterHallOfFameLeague(hofLab);
assert(hofEntry.state, hofEntry.error ?? 'a funded manager should be able to enter');

// Matchmaking: the nine seats go to the clubs nearest the paying manager, not
// simply to the nine strongest, so a strong club cannot farm weak opponents.
const hofUserRating = hofRating(hofLab, hofLab.userTeamId);
const hofRivals = hofField(hofLab).filter((id) => id !== hofLab.userTeamId);
const hofDrawn = new Set(hofRivals);
const hofWidestGap = Math.max(
  ...hofRivals.map((id) => Math.abs(hofRating(hofLab, id) - hofUserRating)),
);
assert(
  hofRivals.length === HOF_FIELD_SIZE - 1 &&
    Object.keys(hofLab.teams)
      .filter((id) => id !== hofLab.userTeamId && !hofDrawn.has(id))
      .every((id) => Math.abs(hofRating(hofLab, id) - hofUserRating) >= hofWidestGap),
  'matchmaking should draw the nine clubs closest to the paying manager',
);

let hofState = hofEntry.state!;
// The bracket is played with the roster that opened it: adding a player or a
// level after the draw would let an owner enter thin and upgrade into a soft field.
assert(hofRosterLocked(hofState), 'a live bracket should freeze the roster');
assert(
  fusePlayers(hofState, ['not', 'a', 'fusion']).error === HOF_ROSTER_LOCK,
  'fusion should be blocked while a Hall of Fame bracket is live',
);
assert(
  buySkillLevel(hofState, rosterOf(hofState, hofState.userTeamId)[0].id, 'inside').error ===
    HOF_ROSTER_LOCK,
  'the skill academy should be frozen while a Hall of Fame bracket is live',
);
const hofFreeAgent = hofState.freeAgents.map((id) => hofState.players[id]).filter(Boolean)[0];
assert(hofFreeAgent, 'the market should still field free agents during a bracket');
assert(
  freeAgentTerms(hofState, hofFreeAgent).reason === HOF_ROSTER_LOCK,
  'free agency should be frozen while a Hall of Fame bracket is live',
);
assert(
  signFreeAgent(hofState, hofFreeAgent.id) === hofState,
  'a free-agent signing should be refused while a Hall of Fame bracket is live',
);
let hofGames = 0;
while (!hofState.hof!.champion && hofGames++ < 200) {
  const step = simulateHofGame(hofState);
  assert(step.state, step.error ?? 'every bracket game should simulate');
  assert(
    step.replay?.game.box?.length &&
      step.replay.state.schedule.some((game) => game.id === step.replay!.game.id),
    'every Hall of Fame game should carry a replay box on the display schedule',
  );
  hofState = step.state!;
}
const league = hofState.hof!;
assert(!hofRosterLocked(hofState), 'the roster should unfreeze once the bracket settles');
assert(
  league && league.season === hofState.season,
  'the bracket should be dated to the current season',
);
assert(
  league.seeds.length === HOF_FIELD_SIZE && league.seeds.includes(hofState.userTeamId),
  'the bracket should seed ten managers and always include the paying manager',
);
assert(
  [2, 4, 2, 1].every(
    (count, index) => league.series.filter((s) => s.round === index + 1).length === count,
  ),
  'a ten-manager bracket should play in 7-10 and 8-9, then shrink 4-2-1',
);
assert(
  league.series.every((s) => s.winner && s.games.length >= HOF_SERIES_WINS),
  'every series should be resolved',
);
assert(Boolean(league.champion), 'the bracket should crown a champion');
assert(
  Boolean(league.third?.winner) && league.third!.high !== league.third!.low,
  'the semifinal losers should play a third-place series',
);
assert(
  HOF_PRIZES.champion + HOF_PRIZES['runner-up'] + HOF_PRIZES.third === HOF_TOTAL_PAYOUT &&
    HOF_TOTAL_PAYOUT === HOF_TOTAL_POOL - HOF_TOTAL_BURN,
  'the podium payouts should add up to the whole prize pool',
);
assert(
  HOF_ENTRY_BURN === HWD_LEAGUE_ENTRY_FEE * 0.1 &&
    HOF_ENTRY_BURN < HWD_LEAGUE_ENTRY_FEE,
  'only a tenth of the entry should be burned',
);
assert(
  league.prize ===
    (league.userPlacement === 'out' ? 0 : HOF_PRIZES[league.userPlacement]),
  'the recorded prize should match the user placement',
);
assert(
  hofState.hwd === 5 + league.prize,
  'entry should burn only the fee share and pay the podium prize',
);
assert(
  Math.abs(hofTotal(hofLab) - hofTotal(hofState) - HOF_TOTAL_BURN) < 0.01,
  'the bracket should remove exactly the burned tenth and pay the rest to the clubs',
);
assert(league.prize <= HOF_TOTAL_PAYOUT, 'no finish can pay more than the pool');
assert(
  (league.userPlacement === 'champion') === (league.champion === hofState.userTeamId),
  'winning the bracket should record a champion finish',
);
if (league.userPlacement === 'out') {
  assert(league.prize === 0, 'a finish outside the podium should pay nothing');
}
/* A bracket left unplayed when the league year rolls over still settles. */
const pendingEntry = enterHallOfFameLeague({
  ...hofLab,
  hof: null,
  hwd: HWD_LEAGUE_ENTRY_FEE + 5,
});
assert(pendingEntry.state, pendingEntry.error ?? 'a fresh bracket should accept an entry');
const finishedPending = finishHofLeague(pendingEntry.state!);
assert(finishedPending.hof!.champion, 'an unfinished bracket should settle before rollover');
assert(
  finishHofLeague(finishedPending) === finishedPending,
  'finishing a settled bracket should be a no-op',
);

assert(
  Boolean(enterHallOfFameLeague(hofState).error),
  'a manager should only enter once per season',
);
assert(
  activeHof({ ...hofState, season: hofState.season + 1 }) === null,
  'a new season should open a fresh entry',
);

const reward = league.rewardPlayerId ? hofState.players[league.rewardPlayerId] : null;
assert(reward, 'the champion should receive one player NFT');
assert(reward!.teamId === league.champion, 'the NFT should join the champion');
assert(reward!.tier === league.rewardTier, 'the recorded drop tier should match the player');
assert([0, 1, 2].includes(reward!.tier), 'the drop should be tier 2, tier 1 or Hall of Fame');
assert(reward!.years >= 1, 'the dropped player should arrive on a real contract');
assert(
  Object.keys(hofState.players).length === Object.keys(hofLab.players).length + 1,
  'the league should create exactly one new player',
);
assert(
      hofState.log.some((entry) => entry.text.includes('pooled across')) &&
    hofState.log.some(
      (entry) =>
        entry.text.includes('champion reward') ||
        entry.text.includes('to make room') ||
        entry.text.includes('stored him in the NFT collection'),
    ),
  'the entry and the drop should be reported in the log',
);

/* Drop table: tier 2 common, tier 1 hard, legendary very hard */
const odds = (tier: number) => HOF_REWARD_ODDS.find((entry) => entry.tier === tier)!.chance;
assert(
  Math.abs(HOF_REWARD_ODDS.reduce((sum, entry) => sum + entry.chance, 0) - 1) < 1e-9,
  'the drop table should sum to 100%',
);
assert(
  odds(2) > odds(1) && odds(1) > odds(0),
  'tier 2 should be the most common drop and the legendary the rarest',
);
assert(odds(0) <= 0.03, 'the legendary drop should be very hard to get');

const rollRng = new Rng(24680);
const rolls: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
const ROLLS = 20_000;
for (let i = 0; i < ROLLS; i++) rolls[rollHofRewardTier(rollRng)]++;
assert(Math.abs(rolls[2] / ROLLS - odds(2)) < 0.02, 'tier 2 should land near its stated rate');
assert(Math.abs(rolls[1] / ROLLS - odds(1)) < 0.02, 'tier 1 should land near its stated rate');
assert(rolls[0] > 0 && rolls[0] / ROLLS < 0.04, 'the legendary drop should be rare but real');

/* A forced legendary drop is a 95+ tier-0 player; a forced tier 2 is not */
const dropLab = createLeague('BOS', 13579);
const dropClub = Object.values(dropLab.teams).find(
  (club) => club.id !== dropLab.userTeamId,
)!.id;
const legend = awardHofNft(dropLab, dropClub, 0, new Rng(13579));
assert(legend, 'a legendary drop should create a player');
const legendPlayer = dropLab.players[legend!.playerId];
assert(legendPlayer.tier === 0, 'a legendary drop should be Hall of Fame tier');
assert(
  legendPlayer.overall >= TIER_BASE[0] && legendPlayer.level === 1,
  'a legendary drop should sit in the 95+ band at level 1',
);
assert(legendPlayer.teamId === dropClub, 'the dropped player should join the champion');
assert(legendPlayer.years === 2, 'the champion NFT should arrive on a two-year deal');
const common = awardHofNft(dropLab, dropClub, 2, new Rng(97531));
assert(
  common && dropLab.players[common.playerId].tier === 2,
  'a tier-2 drop should be a tier-2 player, not a Hall of Famer',
);
assert(
  Object.values(dropLab.players).filter((p) => p.tier === 0).length === 1,
  'only the legendary drop should create a tier-0 player',
);

/* A drop the champion's payroll cannot fit is stored, not forced onto the cap. */
const storeLab = createLeague('BOS', 424242);
const storeRoster = rosterOf(storeLab, storeLab.userTeamId);
const cappedPlayers = { ...storeLab.players };
storeRoster.forEach((entry, index) => {
  cappedPlayers[entry.id] = { ...entry, salary: index === 0 ? capFor(storeLab) : 0 };
});
const cappedLab: GameState = { ...storeLab, players: cappedPlayers, stash: [] };
const cappedBefore = rosterOf(cappedLab, cappedLab.userTeamId).length;
const storedDrop = awardHofNft(cappedLab, cappedLab.userTeamId, 2, new Rng(424242));
assert(storedDrop, 'a drop that does not fit the cap should still be drawn');
const storedDropPlayer = cappedLab.players[storedDrop!.playerId];
assert(
  storedDropPlayer.teamId === null && (cappedLab.stash ?? []).includes(storedDropPlayer.id),
  'a champion drop that cannot fit the payroll should be stored in the collection',
);
assert(
  rosterOf(cappedLab, cappedLab.userTeamId).length === cappedBefore &&
    payrollOf(cappedLab, cappedLab.userTeamId) <= capFor(cappedLab) + 1e-9,
  'storing the drop should leave the champion roster and payroll untouched',
);
assert(
  stashPlayers(cappedLab).some((entry) => entry.id === storedDropPlayer.id),
  'a stored champion drop should be signable from the collection',
);

/* A full collection cannot absorb the drop, so the club sheds salary instead. */
const fullCollectionLab = createLeague('BOS', 515151);
const fullCollectionIds = new Set(
  rosterOf(fullCollectionLab, fullCollectionLab.userTeamId).map((entry) => entry.id),
);
const fullCollectionWeakest = rosterOf(fullCollectionLab, fullCollectionLab.userTeamId)
  .sort((a, b) => a.overall - b.overall);
const fullCollectionPlayers = { ...fullCollectionLab.players };
fullCollectionWeakest.forEach((entry, index) => {
  // The weakest players carry the big deals, so a cap-clearing cut is possible.
  fullCollectionPlayers[entry.id] = { ...entry, salary: index < 3 ? 20 : 1.1 };
});
const fullCollectionState: GameState = {
  ...fullCollectionLab,
  players: fullCollectionPlayers,
  stash: fullCollectionLab.freeAgents.slice(0, STASH_LIMIT),
};
assert(
  payrollOf(fullCollectionState, fullCollectionState.userTeamId) <=
    capFor(fullCollectionState) + 1e-9 &&
    (fullCollectionState.stash ?? []).length === STASH_LIMIT,
  'the full-collection lab should start under the cap with no storage left',
);
const fullCollectionDrop = awardHofNft(
  fullCollectionState,
  fullCollectionState.userTeamId,
  2,
  new Rng(515151),
);
assert(fullCollectionDrop, 'a capped champion with a full collection should still draw a drop');
const fullCollectionDropPlayer = fullCollectionState.players[fullCollectionDrop!.playerId];
assert(
  fullCollectionDropPlayer.teamId === fullCollectionState.userTeamId,
  'a full collection should force a cap-clearing cut instead of storing the drop',
);
const fullCollectionAfter = rosterOf(fullCollectionState, fullCollectionState.userTeamId);
assert(
  payrollOf(fullCollectionState, fullCollectionState.userTeamId) <= capFor(fullCollectionState) + 1e-9,
  'a full collection must not let the champion drop bypass the cap',
);
assert(
  fullCollectionAfter.length >= ROSTER_MIN &&
    fullCollectionAfter.length <= ROSTER_MAX &&
    fullCollectionAfter.some((entry) => entry.id === fullCollectionDropPlayer.id),
  'the signed drop should leave a legal roster',
);
const fullCollectionCuts = [...fullCollectionIds].filter(
  (id) => !fullCollectionAfter.some((entry) => entry.id === id),
);
assert(
  fullCollectionCuts.length > 0,
  'the drop should force at least one cut',
);
assert(
  fullCollectionCuts.every((id) => fullCollectionState.freeAgents.includes(id)),
  'players cut for the drop should hit free agency',
);
assert(
  (fullCollectionState.stash ?? []).length === STASH_LIMIT,
  'a full collection should stay at its limit',
);

/* Draft rarity: tier 3 is a rare find, so fusion cannot be farmed from picks */
const draftRng = new Rng(112233);
const DRAFT_SAMPLES = 20_000;
let lotteryTier3 = 0;
let lateTier3 = 0;
let middleBadTier = 0;
for (let i = 0; i < DRAFT_SAMPLES; i++) {
  if (rollDraftTier(draftRng, 0) === 3) lotteryTier3++;
  if (rollDraftTier(draftRng, 13) === 3) lateTier3++;
  const middle = rollDraftTier(draftRng, 7);
  if (middle !== 3 && middle !== 4 && middle !== 5) middleBadTier++;
}
assert(middleBadTier === 0, 'draft prospects should stay in tiers 3-5');
assert(
  Math.abs(lotteryTier3 / DRAFT_SAMPLES - (DRAFT_TIER3_CHANCE + DRAFT_TIER3_LOTTERY_BONUS)) < 0.02,
  'a lottery pick should find a tier-3 prospect at its stated rate',
);
assert(
  Math.abs(lateTier3 / DRAFT_SAMPLES - DRAFT_TIER3_CHANCE) < 0.02,
  'a late pick should rarely find a tier-3 prospect',
);
assert(
  DRAFT_TIER3_CHANCE + DRAFT_TIER3_LOTTERY_BONUS < 0.2,
  'a tier-3 prospect should be a rare find, not a guaranteed lottery prize',
);
assert(
  Array.from({ length: 14 }, (_, index) => rollDraftTier(new Rng(7 + index), index)).every(
    (tier) => tier >= 3,
  ),
  'the draft should never produce a tier better than 3',
);

const rookieId = rosterOf(marketLab, marketLab.userTeamId)[0].id;
const rookieLab: GameState = {
  ...marketLab,
  players: {
    ...marketLab.players,
    [rookieId]: { ...marketLab.players[rookieId], rookie: true },
  },
};
assert(
  Boolean(sellPlayerToMarket(rookieLab, rookieId, 5).error?.toLowerCase().includes('soulbound')),
  'rookie deals should be soulbound on the marketplace',
);

// Offseason moves happen before the new league year, so the player has not
// played yet and the ownership clock must start with the coming season.
const offseason = createLeague('NYS', 9090);
offseason.season = MARKET_MIN_ACCOUNT_SEASONS + 1;
offseason.phase = 'offseason';
let offseasonSigning: GameState | null = null;
let offseasonPlayerId = '';
const offseasonTargets = offseason.freeAgents
  .map((id) => offseason.players[id])
  .filter((p) => p && p.salary <= 3)
  .sort((a, b) => a.overall - b.overall);
for (const fa of offseasonTargets) {
  const attempt = signFreeAgent(offseason, fa.id, 2);
  if (attempt !== offseason) {
    offseasonSigning = attempt;
    offseasonPlayerId = fa.id;
    break;
  }
}
assert(offseasonSigning, 'a cheap free agent should be signable during the offseason');
assert(
  offseasonSigning.players[offseasonPlayerId].joinedSeason === MARKET_MIN_ACCOUNT_SEASONS + 2,
  'an offseason signing should be dated to the season he first plays, not the one just finished',
);
const signedFresh = canListOnMarket(offseasonSigning, offseasonPlayerId);
assert(!signedFresh.eligible, 'an offseason signing should not be listable before he plays');
assert(
  signedFresh.reasons.includes('ownership'),
  'an offseason signing should still owe an ownership season',
);

const afterSigningSeason = startNextSeason(offseasonSigning);
assert(afterSigningSeason !== offseasonSigning, 'the new season should begin');
assert(
  afterSigningSeason.season === MARKET_MIN_ACCOUNT_SEASONS + 2,
  'the signing should debut in the following season',
);
const debutBlocked = canListOnMarket(afterSigningSeason, offseasonPlayerId);
assert(!debutBlocked.eligible, 'a player is not listable while his first season is in progress');
assert(
  debutBlocked.reasons.includes('ownership'),
  'the first season with a team should not count until it is played',
);

const afterFullSeason = { ...afterSigningSeason, season: afterSigningSeason.season + 1 };
assert(
  canListOnMarket(afterFullSeason, offseasonPlayerId).eligible,
  'a player should be listable once he has played a full season for the team',
);

const draftedEver = Object.values(state.players).filter((p) => p.draftedBy);
assert(draftedEver.length > 0, 'six seasons should produce drafted players');
assert(
  draftedEver.every((p) => typeof p.draftSeason === 'number' && typeof p.joinedSeason === 'number'),
  'drafted players should record their draft and acquisition seasons',
);
assert(
  draftedEver.every((p) => p.joinedSeason! >= p.draftSeason!),
  'a drafted player cannot join a team before the season he was drafted in',
);
assert(
  draftedEver
    .filter((p) => p.rookie && p.teamId === p.draftedBy)
    .every((p) => p.joinedSeason === p.draftSeason! + 1),
  'draft picks should debut in the season after the offseason they were drafted in',
);

/* The eight-man floor only binds at tip-off: an offseason rebuild may fuse
   below it, but the new season still refuses to start short-handed. */
let floorLab = createLeague('NYS', 707070);
floorLab = enterOffseason(floorLab);
assert(floorLab.phase === 'offseason', 'the floor lab should be in the offseason');
let floorTrim = 0;
while (rosterOf(floorLab, floorLab.userTeamId).length > 9 && floorTrim++ < 30) {
  const spare = rosterOf(floorLab, floorLab.userTeamId)
    .sort((a, b) => a.overall - b.overall)[0];
  spare.teamId = null;
}
assert(
  rosterOf(floorLab, floorLab.userTeamId).length === 9,
  'the floor lab should start at nine players',
);
const floorTrio = rosterOf(floorLab, floorLab.userTeamId).slice(0, 3);
for (const player of floorTrio) player.level = MAX_LEVEL;
const floorFused = fusePlayers(floorLab, floorTrio.map((player) => player.id));
assert(
  floorFused.state,
  floorFused.error ?? 'fusing below eight should be allowed in the offseason',
);
floorLab = floorFused.state!;
assert(
  rosterOf(floorLab, floorLab.userTeamId).length < ROSTER_MIN,
  'the offseason fusion should leave fewer than eight players',
);
assert(
  startNextSeason(floorLab) === floorLab,
  'the new season must not tip off below eight players',
);
assert(
  advanceSeason(floorLab) === floorLab,
  'advancing the season below eight players must be refused',
);

console.log(
  'Simulation test passed: 6 seasons, tiers and the tier-2 training ceiling, fusion, training, points-to-cash, injuries, draft, free agency, playoffs, box scores, the marketplace and the Hall of Fame league are consistent.',
);
