import { MAX_LEVEL } from './data';
import type { GameState, MarketListing, Player } from './types';

/** Seasons the manager account must have completed before it can list anyone. */
export const MARKET_MIN_ACCOUNT_SEASONS = 6;
/** Full seasons a player must have spent with the current team. */
export const MARKET_MIN_OWNED_SEASONS = 1;

export type MarketBlock =
  | 'not-on-roster'
  | 'account-age'
  | 'rookie-deal'
  | 'ownership'
  | 'cornerstone';

export interface MarketEligibility {
  eligible: boolean;
  reasons: MarketBlock[];
  /** Seasons the account has completed, not counting the current one. */
  accountSeasons: number;
  /** Full seasons the player has played for the user's team. */
  ownedSeasons: number;
}

/* ------------------------------------------------------------------ */
/* HWD token                                                          */
/* ------------------------------------------------------------------ */

/**
 * HWD a brand-new career starts with, enough for one useful signing. It is paid
 * out of the game's rewards allocation, not minted and not an airdrop: a free
 * player starts here and earns the rest by playing the base league.
 */
export const HWD_STARTING = 120;
/** Share of every completed sale paid to the development treasury instead of the seller. */
export const MARKET_FEE_RATE = 0.05;
/**
 * Opening HWD float for each rival club. For now every CPU manager is treated
 * like a human player with a 5,000 HWD airdrop, so the peer-to-peer market has
 * real buyers. Sales are paid out of these balances, never minted.
 */
export const CLUB_HWD_START = 5000;
/** HWD pays for every Hall of Fame league entry. */
export const HWD_LEAGUE_ENTRY_FEE = 25;
/** CPU clubs list at a premium over what they would pay for a player. */
export const MARKET_ASK_PREMIUM = 1.1;
/** Cheapest listing the marketplace accepts. */
export const MARKET_MIN_PRICE = 1;
/** How many CPU listings the marketplace carries at once. */
export const MARKET_MAX_LISTINGS = 8;

export function hwdBalance(state: GameState): number {
  return Math.max(0, Math.round(state.hwd ?? 0));
}

/** HWD a rival club can spend on the marketplace right now. */
export function clubHwdBalance(state: GameState, teamId: string): number {
  return Math.max(0, Math.round(state.clubHwd?.[teamId] ?? 0));
}

/** Fees collected from completed marketplace sales; never minted, never burned. */
export function devFundBalance(state: GameState): number {
  return Math.max(0, Math.round(state.devFund ?? 0));
}

/** Development-fund HWD taken from a sale of this size; the platform keeps at least one token. */
export function marketFee(price: number): number {
  return Math.max(MARKET_MIN_PRICE, Math.ceil(price * MARKET_FEE_RATE));
}

/**
 * What the market pays for a player NFT, in HWD. Tiers matter through overall,
 * and youth plus remaining upside carry a real premium.
 */
export function marketValue(player: Player): number {
  const core = Math.max(0, player.overall - 40);
  const base = (core * core) / 55;
  const ageFactor =
    player.age <= 21
      ? 1.5
      : player.age <= 24
        ? 1.3
        : player.age <= 28
          ? 1.1
          : player.age <= 31
            ? 0.9
            : 0.7;
  const upside = 1 + Math.max(0, player.potential - player.overall) * 0.02;
  return Math.max(MARKET_MIN_PRICE, Math.round(base * ageFactor * upside));
}

/** What a club charges for the same player. */
export function marketAsk(player: Player): number {
  return Math.max(MARKET_MIN_PRICE, Math.round(marketValue(player) * MARKET_ASK_PREMIUM));
}

/* ------------------------------------------------------------------ */
/* Tier fusion (NFT merge)                                             */
/* ------------------------------------------------------------------ */

/** A fusion always takes three fully trained players. */
export const FUSION_MIN_PLAYERS = 3;
/** Exactly three inputs; together they mint one NFT a tier above them. */
export const FUSION_MAX_PLAYERS = 3;
/** The strongest tier fusion can reach; tier 0 is the Hall of Fame league only. */
export const FUSION_TOP_TIER = 1;
/** The weakest tier that can be fused (three tier-5 players make a tier 4). */
export const FUSION_BOTTOM_TIER = 5;

/**
 * Fusion is paid in HWD, not training points, and every token goes to the
 * development treasury: the fee moves HWD rather than minting or burning it,
 * exactly like the marketplace fee.
 *
 * The fee is sized to the market, not to the tier number. A fusion mint appears
 * as an 18-year-old worth roughly 1 / 2 / 12 / 28 HWD at tier 4 up to tier 1
 * (and a maxed version of him is worth 6 / 15 / 27 / 46), so the toll is about
 * a sixth of what the prospect becomes rather than a multiple of what he is.
 * The three burned maxed NFTs remain the real price of a fusion.
 */
export const FUSION_HWD_FEES: Record<number, number> = { 5: 1, 4: 2, 3: 4, 2: 7 };

export function fusionHwdCost(inputTier: number): number {
  return FUSION_HWD_FEES[inputTier] ?? FUSION_HWD_FEES[FUSION_BOTTOM_TIER];
}

/** True when the user owns the player, on the roster or in the stored collection. */
export function ownsPlayer(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  return player.teamId === state.userTeamId || (state.stash ?? []).includes(playerId);
}

export interface FusionCheck {
  ok: boolean;
  reason?: string;
}

/**
 * A fusion burns its inputs for good and mints one brand-new NFT a tier above
 * them, so the rules are strict: exactly three distinct players you own, all of
 * the same tier and all at max level, plus the HWD price, which the treasury
 * keeps. Tier 5 up to tier 2 can be fused; the result tops out at tier 1 and
 * can never be the Hall of Fame tier.
 */
export function fusionCheck(state: GameState, playerIds: string[]): FusionCheck {
  const unique = new Set(playerIds);
  if (unique.size !== playerIds.length) return { ok: false, reason: 'Choose each player once.' };
  if (playerIds.length < FUSION_MIN_PLAYERS || playerIds.length > FUSION_MAX_PLAYERS) {
    return {
      ok: false,
      reason: `Fuse exactly ${FUSION_MIN_PLAYERS} players at a time.`,
    };
  }
  const first = state.players[playerIds[0]];
  if (!first || !ownsPlayer(state, playerIds[0])) {
    return { ok: false, reason: 'Every fused player must belong to you.' };
  }
  if (first.tier > FUSION_BOTTOM_TIER || first.tier <= FUSION_TOP_TIER) {
    return {
      ok: false,
      reason: `Fuse tier ${FUSION_TOP_TIER + 1} to tier ${FUSION_BOTTOM_TIER} players; tier 1 and the Hall of Fame tier cannot be fused.`,
    };
  }
  // Burning NFTs is not enough: the mint is paid for in HWD, held by the treasury.
  const cost = fusionHwdCost(first.tier);
  const balance = hwdBalance(state);
  if (balance < cost) {
    return {
      ok: false,
      reason: `A tier ${first.tier} fusion costs ${cost} HWD; you have ${balance}.`,
    };
  }
  for (const id of playerIds) {
    const player = state.players[id];
    if (!player || !ownsPlayer(state, id)) {
      return { ok: false, reason: 'Every fused player must belong to you.' };
    }
    if (player.tier !== first.tier) {
      return { ok: false, reason: 'Every fused player must be the same tier.' };
    }
    if (player.cornerstone) {
      return { ok: false, reason: 'A cornerstone can never be fused.' };
    }
    if (player.level < MAX_LEVEL) {
      return { ok: false, reason: `Every fused player must be level ${MAX_LEVEL}.` };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Listing eligibility                                                 */
/* ------------------------------------------------------------------ */

/** Completed seasons on this save. Season 1 is in progress at state.season === 1. */
export function accountSeasons(state: GameState): number {
  return Math.max(0, state.season - 1);
}

/**
 * Marketplace listing gate. Keeps freshly minted rookie-scale value off the
 * market: an account needs six completed seasons, and the player must be off
 * his rookie deal and have actually played a full season with the team.
 * `joinedSeason` is the first season a player plays, so an offseason signing
 * only starts the clock when the next season tips off.
 */
export function canListOnMarket(state: GameState, playerId: string): MarketEligibility {
  const player = state.players[playerId];
  const completed = accountSeasons(state);
  const ownedSeasons = player
    ? Math.max(0, state.season - (player.joinedSeason ?? 1))
    : 0;
  const reasons: MarketBlock[] = [];
  if (!player || player.teamId !== state.userTeamId) reasons.push('not-on-roster');
  if (completed < MARKET_MIN_ACCOUNT_SEASONS) reasons.push('account-age');
  if (player?.rookie) reasons.push('rookie-deal');
  if (ownedSeasons < MARKET_MIN_OWNED_SEASONS) reasons.push('ownership');
  // Cornerstones are the franchise, not tradeable assets: no sale, waiver or buyout.
  if (player?.cornerstone) reasons.push('cornerstone');
  return {
    eligible: reasons.length === 0,
    reasons,
    accountSeasons: completed,
    ownedSeasons,
  };
}

export function marketBlockReason(reasons: MarketBlock[]): string {
  const first = reasons[0];
  if (first === 'not-on-roster') return 'That player is not on your roster.';
  if (first === 'account-age') {
    return `Marketplace accounts need ${MARKET_MIN_ACCOUNT_SEASONS} completed seasons.`;
  }
  if (first === 'rookie-deal') return 'Rookie-scale contracts are soulbound until they expire.';
  if (first === 'ownership') return 'A player must play one full season for you before he can be sold.';
  if (first === 'cornerstone') return 'A cornerstone is untouchable: he can never be sold, waived or bought out.';
  return 'That player cannot be listed.';
}

/* ------------------------------------------------------------------ */
/* CPU listings                                                        */
/* ------------------------------------------------------------------ */

export function userListings(state: GameState): MarketListing[] {
  return (state.market ?? []).filter(
    (listing) =>
      listing.sellerTeamId === state.userTeamId &&
      state.players[listing.playerId]?.teamId === state.userTeamId,
  );
}

export function openListings(state: GameState): MarketListing[] {
  return (state.market ?? [])
    .filter(
      (listing) =>
        listing.sellerTeamId !== state.userTeamId &&
        state.players[listing.playerId]?.teamId === listing.sellerTeamId,
    )
    .sort((a, b) => b.price - a.price);
}

/**
 * Rebuild the CPU side of the marketplace: one listing per rival club for the
 * most valuable player it is willing to move. Rookies and cornerstones are
 * soulbound, so they never appear.
 */
export function refreshMarketListings(state: GameState): MarketListing[] {
  const kept = userListings(state);
  const listed = new Set(kept.map((listing) => listing.playerId));
  const candidates = Object.values(state.teams)
    .filter((team) => team.id !== state.userTeamId)
    .map((team) => {
      const roster = Object.values(state.players)
        .filter(
          (player) =>
            player.teamId === team.id &&
            !player.rookie &&
            !player.cornerstone &&
            player.years > 0 &&
            !listed.has(player.id),
        )
        .sort((a, b) => marketValue(b) - marketValue(a));
      return roster[0] ?? null;
    })
    .filter((player): player is Player => Boolean(player))
    .sort((a, b) => marketValue(b) - marketValue(a))
    .slice(0, MARKET_MAX_LISTINGS);

  return [
    ...kept,
    ...candidates.map((player) => ({
      id: `mkt_${state.season}_${player.id}`,
      playerId: player.id,
      sellerTeamId: player.teamId as string,
      price: marketAsk(player),
      season: state.season,
    })),
  ];
}
