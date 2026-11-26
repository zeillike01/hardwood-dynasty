import type { GameState, Player } from './types';
import { LEAGUE_MIN_SALARY, MAX_LEVEL, RATINGS_VERSION } from './data';
import {
  capFor,
  defaultLineupFor,
  resetPlayerRatings,
  salaryDemand,
  SEASON_COOLDOWN_ENABLED,
} from './engine';
import { CLUB_HWD_START, HWD_STARTING, refreshMarketListings } from './market';

const LEGACY_KEY = 'hardwood-dynasty-save-v1';
const SLOT_KEY = 'hardwood-dynasty-slot-v1';
const SLOT_KEYS = ['hardwood-dynasty-save-slot-1', 'hardwood-dynasty-save-slot-2', 'hardwood-dynasty-save-slot-3'];

export const SAVE_SLOTS = ['1', '2', '3'];

export function activeSlot(): string {
  try {
    const slot = localStorage.getItem(SLOT_KEY);
    return slot && SAVE_SLOTS.includes(slot) ? slot : '1';
  } catch {
    return '1';
  }
}

export function selectSlot(slot: string): void {
  try {
    localStorage.setItem(SLOT_KEY, slot);
  } catch {
    // ignore
  }
}

function keyFor(slot: string): string {
  if (slot === '1') return LEGACY_KEY;
  const index = Math.max(0, SAVE_SLOTS.indexOf(slot));
  return SLOT_KEYS[index] ?? SLOT_KEYS[0];
}

function migrate(parsed: GameState): GameState | null {
  if (!parsed || parsed.version !== 1 || !parsed.teams || !parsed.players) return null;
  // Older saves predate the tier/level economy; fill the new fields in place.
  for (const player of Object.values(parsed.players)) {
    if (typeof player.tier !== 'number') player.tier = 5;
    if (typeof player.level !== 'number') player.level = 1;
    // Older saves predate the injury report.
    if (typeof player.injuryGames !== 'number') player.injuryGames = 0;
    if (player.injury === undefined) player.injury = null;
    if (player.option === undefined) player.option = null;
    if (!player.skillLevels || typeof player.skillLevels !== 'object') player.skillLevels = {};
  }
  for (const team of Object.values(parsed.teams)) {
    if (typeof team.trainingPoints !== 'number') team.trainingPoints = 0;
    if (typeof team.cash !== 'number') team.cash = 10;
    if (!Array.isArray(team.deadMoney)) team.deadMoney = [];
    if (typeof team.taxStrikes !== 'number') team.taxStrikes = 0;
    if (typeof team.taxDebt !== 'number') team.taxDebt = 0;
  }
  if (!parsed.facilities) {
    parsed.facilities = { training: 0, medical: 0, scouting: 0, analytics: 0, development: 0 };
  }
  for (const key of ['training', 'medical', 'scouting', 'analytics', 'development'] as const) {
    if (typeof parsed.facilities[key] !== 'number') parsed.facilities[key] = 0;
  }
  // Older saves predate tradable draft picks.
  if (!parsed.pickOwners) {
    parsed.pickOwners = Object.fromEntries(Object.keys(parsed.teams).map((id) => [id, id]));
  }
  if (parsed.draftPickOrigins === undefined) parsed.draftPickOrigins = null;
  if (!parsed.history) parsed.history = [];
  // The trade desk is gone: strip its leftovers from older saves and exports.
  const legacy = parsed as GameState & { tradeOffers?: unknown; tradeBlock?: unknown };
  delete legacy.tradeOffers;
  delete legacy.tradeBlock;
  // The season clock is off while long seasons are tested: clear any wait a
  // save picked up while it was on.
  if (!SEASON_COOLDOWN_ENABLED) delete parsed.seasonReadyAt;
  if (!parsed.scouted) parsed.scouted = [];
  if (!parsed.devReport) parsed.devReport = [];
  if (!parsed.settings) parsed.settings = { difficulty: 'standard', scenario: 'rebuild' };
  // Saves from before the HWD marketplace start with a float and fresh listings.
  if (typeof parsed.hwd !== 'number') parsed.hwd = HWD_STARTING;
  if (typeof parsed.devFund !== 'number') parsed.devFund = 0;
  // Older saves predate the peer-to-peer club floats; give the rivals their
  // share once, and top everyone up when the CPU airdrop size changes.
  if (!parsed.clubHwd || typeof parsed.clubHwd !== 'object') parsed.clubHwd = {};
  if (parsed.clubHwdVersion !== 1) {
    parsed.clubHwd = Object.fromEntries(
      Object.keys(parsed.teams)
        .filter((id) => id !== parsed.userTeamId)
        .map((id) => [id, CLUB_HWD_START]),
    );
    parsed.clubHwdVersion = 1;
  }
  if (!Array.isArray(parsed.market)) parsed.market = [];
  // Older saves predate the stored-NFT collection.
  if (!Array.isArray(parsed.stash)) parsed.stash = [];
  // Older saves predate the Hall of Fame league.
  if (parsed.hof === undefined) parsed.hof = null;
  if (!parsed.market.length) parsed.market = refreshMarketListings(parsed);
  if (!parsed.lineup?.length) {
    parsed.lineup = defaultLineupFor(parsed);
  }
  // Saves from before the tier-curve rebalance get their ratings rebuilt once.
  if (parsed.ratingsVersion !== RATINGS_VERSION) {
    // The level cap can move between versions; clamp before ratings are rebuilt
    // from tier + level so nobody keeps levels the new cap does not allow.
    for (const player of Object.values(parsed.players)) {
      player.level = Math.min(player.level, MAX_LEVEL);
    }
    resetPlayerRatings(parsed.players);
    parsed.ratingsVersion = RATINGS_VERSION;
  }
  // The raised opening float is applied once to careers saved on the old one.
  // Bumped to version 2 when the starting balance moved to 5,000 HWD, so
  // saves that already received the 2,000 top-up are lifted to the new float.
  if (parsed.hwdGrantVersion !== 2) {
    parsed.hwd = Math.max(parsed.hwd ?? 0, HWD_STARTING);
    parsed.hwdGrantVersion = 2;
  }
  // The two hand-authored cornerstones are gone, so every career now opens
  // from the same tier-5 roster. Older saves lose them here, and anything that
  // still pointed at them (rotation, collection, listings) is cleaned up.
  let droppedCornerstones = false;
  for (const player of Object.values(parsed.players)) {
    if (!(player as Player & { cornerstone?: boolean }).cornerstone) continue;
    delete parsed.players[player.id];
    droppedCornerstones = true;
  }
  if (droppedCornerstones) {
    parsed.freeAgents = parsed.freeAgents.filter((id) => parsed.players[id]);
    parsed.stash = (parsed.stash ?? []).filter((id) => parsed.players[id]);
    parsed.market = (parsed.market ?? []).filter((entry) => parsed.players[entry.playerId]);
    parsed.lineup = defaultLineupFor(parsed);
  }
  // Stored NFTs freeze their contracts now, so an old save cannot lose one to
  // a deal that ran out. An earlier build pushed expired stored players into
  // free agency; pull them back into the collection and reopen the deal. A
  // player who is no longer sitting in the collection (a rival already signed
  // him) or has retired only loses his stale collection id here — the player
  // himself is never moved between teams.
  if (parsed.stashFreezeVersion !== 1) {
    const keptStash: string[] = [];
    for (const id of parsed.stash ?? []) {
      const player = parsed.players[id];
      if (!player || player.teamId !== null || player.retired) continue;
      parsed.freeAgents = parsed.freeAgents.filter((entry) => entry !== id);
      if (player.years <= 0) player.years = 1;
      keptStash.push(id);
    }
    parsed.stash = keptStash;
    parsed.stashFreezeVersion = 1;
  }
  // Fusion mints created before the fused-deal discount kept a full-market
  // salary. Cut every such contract back to the demand the engine charges
  // today, but never raise one: a fused deal already below the demand simply
  // predates later cap growth, and lifting it mid-contract could push a roster
  // over the cap. It runs after the ratings rebuild above so the demand is
  // based on the rating that rebuild produces.
  if (parsed.fusedSalaryVersion !== 1) {
    for (const player of Object.values(parsed.players)) {
      if (!player.fused) continue;
      const demand = Math.max(LEAGUE_MIN_SALARY, salaryDemand(player, capFor(parsed)));
      player.salary = Math.min(player.salary, demand);
    }
    parsed.fusedSalaryVersion = 1;
  }
  return parsed;
}

export function saveState(state: GameState, slot = activeSlot()): void {
  try {
    localStorage.setItem(keyFor(slot), JSON.stringify(state));
    localStorage.setItem(`${keyFor(slot)}:savedAt`, String(Date.now()));
  } catch {
    // Storage may be unavailable or full; the game still works in memory.
  }
}

export interface SaveSlotInfo {
  slot: string;
  season: number | null;
  teamId: string | null;
  savedAt: number | null;
}

export function saveSlots(): SaveSlotInfo[] {
  return SAVE_SLOTS.map((slot) => {
    try {
      const raw = localStorage.getItem(keyFor(slot));
      const savedAt = Number(localStorage.getItem(`${keyFor(slot)}:savedAt`)) || null;
      if (!raw) return { slot, season: null, teamId: null, savedAt: null };
      const parsed = JSON.parse(raw) as GameState;
      return {
        slot,
        season: parsed.season ?? null,
        teamId: parsed.userTeamId ?? null,
        savedAt,
      };
    } catch {
      return { slot, season: null, teamId: null, savedAt: null };
    }
  });
}

export function loadState(slot = activeSlot()): GameState | null {
  try {
    const raw = localStorage.getItem(keyFor(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function clearSave(slot = activeSlot()): void {
  try {
    localStorage.removeItem(keyFor(slot));
    localStorage.removeItem(`${keyFor(slot)}:savedAt`);
  } catch {
    // ignore
  }
}

export function exportSave(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

export function importSave(text: string): GameState | null {
  try {
    return migrate(JSON.parse(text) as GameState);
  } catch {
    return null;
  }
}
