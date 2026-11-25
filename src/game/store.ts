import type { GameState } from './types';
import { MAX_LEVEL, RATINGS_VERSION } from './data';
import { addCornerstones, defaultLineupFor, resetPlayerRatings } from './engine';
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
  // Careers created before the cornerstones existed get them added once.
  if (parsed.cornerstonesVersion !== 1) {
    addCornerstones(parsed);
    parsed.cornerstonesVersion = 1;
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
