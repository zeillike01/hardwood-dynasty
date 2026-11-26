/**
 * Fusion audit: exercises the tier-fusion rules against the real engine.
 * Run with `npx tsx scripts/fusionaudit.ts`.
 */
import {
  capFor,
  convertHwdToTrainingPoints,
  createLeague,
  fusePlayers,
  payrollOf,
  rosterOf,
  signStashedPlayer,
  stashPlayers,
} from '../src/game/engine';
import { LEAGUE_MIN_SALARY, MAX_LEVEL, STASH_LIMIT } from '../src/game/data';
import { fusionHwdCost, HWD_TP_MIN, hwdTpQuote } from '../src/game/market';
import type { GameState, Player } from '../src/game/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`ok  ${message}`);
}

function eligible(state: GameState, count: number, tier: Player['tier'] = 5): Player[] {
  const picks = rosterOf(state, state.userTeamId)
    .slice(0, count);
  picks.forEach((player) => {
    player.tier = tier;
    player.level = MAX_LEVEL;
  });
  return picks;
}

/* ---------------------------------------------------------------- */
/* 1. happy path                                                     */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 11);
  const picks = eligible(base, 3);
  const fee = fusionHwdCost(Math.max(...picks.map((player) => player.overall)));
  const before = rosterOf(base, base.userTeamId).length;
  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(result.state, 'three maxed, same-tier roster players fuse');
  const next = result.state!;
  const minted = Object.values(next.players).find((player) => !base.players[player.id])!;
  assert(minted.tier === 4, 'target tier is one above the inputs (5 -> 4)');
  assert(minted.age === 18, 'the mint is 18 years old');
  assert(minted.years === 3, 'the mint is on a three-year deal');
  assert(
    minted.salary === LEAGUE_MIN_SALARY,
    'a low-rated mint is floored at the league minimum',
  );
  assert(minted.teamId === next.userTeamId, 'the mint is signed when roster and cap allow');
  assert(
    rosterOf(next, next.userTeamId).length === before - 3 + 1,
    'roster shrinks by two: three burned inputs, one mint',
  );
  assert(!next.players[picks[0].id], 'burned inputs are gone from the save');
  assert(
    !next.lineup!.includes(picks[0].id) && next.lineup!.every((id) => next.players[id]),
    'lineup has no dangling ids after the burn',
  );
  assert(
    payrollOf(next, next.userTeamId) <= capFor(next) + 1e-9,
    'payroll stays under the cap',
  );
  assert(
    (next.hwd ?? 0) === (base.hwd ?? 0) - fee,
    'a fusion pays its HWD price from the wallet',
  );
  assert(
    (next.devFund ?? 0) === (base.devFund ?? 0) + fee,
    'the fusion fee lands in the development treasury',
  );
}

/* ---------------------------------------------------------------- */
/* 1a. the HWD price rises with the best burned rating               */
/* ---------------------------------------------------------------- */
{
  assert(fusionHwdCost(60) === 1, 'a low-rated fusion pays the 1 HWD minimum');
  assert(
    fusionHwdCost(70) === 1 && fusionHwdCost(75) > fusionHwdCost(70),
    'the fee starts rising once the best burned player clears 70 OVR',
  );
  assert(
    fusionHwdCost(90) > fusionHwdCost(80) && fusionHwdCost(80) > fusionHwdCost(75),
    'the fee keeps rising with the inherited rating',
  );
  assert(
    fusionHwdCost(95) > fusionHwdCost(90),
    'a star-level anchor pays a star-level toll',
  );
}

/* ---------------------------------------------------------------- */
/* 1b. no training points, no fusion                                 */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 25);
  const picks = eligible(base, 3);
  base.hwd = 0;
  const before = JSON.stringify(base.players);
  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(!result.state && /HWD/.test(result.error ?? ''), 'fusion is refused without enough HWD');
  assert(JSON.stringify(base.players) === before, 'the refused fusion burned nothing');
}

/* ---------------------------------------------------------------- */
/* 1c. the conversion desk charges no fee                              */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 26);
  base.hwd = 100;
  base.devFund = 0;
  const quote = hwdTpQuote(HWD_TP_MIN);
  const converted = convertHwdToTrainingPoints(base, HWD_TP_MIN);
  assert(converted.state, 'HWD converts into training points');
  const afterDesk = converted.state!;
  assert(
    (afterDesk.hwd ?? 0) === 100 - HWD_TP_MIN &&
      afterDesk.teams[afterDesk.userTeamId].trainingPoints ===
        base.teams[base.userTeamId].trainingPoints + quote.tp &&
      (afterDesk.devFund ?? 0) === 0,
    'the desk pays the full rate and leaves the development treasury alone',
  );

  const picks = eligible(afterDesk, 3);
  const fee = fusionHwdCost(Math.max(...picks.map((player) => player.overall)));
  const result = fusePlayers(
    { ...afterDesk, hwd: fee + 1 },
    picks.map((player) => player.id),
  );
  assert(result.state, 'a conversion does not block a later fusion');
  assert(
    (result.state!.devFund ?? 0) === (afterDesk.devFund ?? 0) + fee,
    'fusion fees still collect in the development treasury',
  );
}

/* ---------------------------------------------------------------- */
/* 2. mixed tiers rejected                                           */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 12);
  const picks = eligible(base, 3);
  picks[2].tier = 4;
  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(!result.state && /same tier/.test(result.error ?? ''), 'mixed tiers are rejected');
}

/* ---------------------------------------------------------------- */
/* 3. under-trained and duplicate inputs rejected                    */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 13);
  const picks = eligible(base, 3);
  picks[1].level = MAX_LEVEL - 1;
  assert(
    !fusePlayers(base, picks.map((player) => player.id)).state,
    'players below max level are rejected',
  );

  const again = createLeague('NYS', 14);
  const trio = eligible(again, 3);
  assert(
    !fusePlayers(again, [trio[0].id, trio[0].id, trio[1].id]).state,
    'duplicate ids are rejected',
  );
}

/* ---------------------------------------------------------------- */
/* 4. ownership and tier ceiling                                     */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 15);
  const trio = eligible(base, 3);
  const rival = Object.values(base.players).find(
    (player) => player.teamId && player.teamId !== base.userTeamId,
  )!;
  rival.tier = 5;
  rival.level = MAX_LEVEL;

  assert(
    !fusePlayers(base, [trio[0].id, trio[1].id, rival.id]).state,
    "a rival team's player cannot be fused",
  );

  const top = createLeague('NYS', 16);
  const tierTwo = eligible(top, 3, 2);
  const up = fusePlayers(top, tierTwo.map((player) => player.id));
  assert(up.state, 'three maxed tier-2 players fuse into tier 1');
  assert(
    Object.values(up.state!.players).some(
      (player) => !top.players[player.id] && player.tier === 1,
    ),
    'the tier-2 fusion mints a tier-1 player',
  );

}

/* ---------------------------------------------------------------- */
/* 5. roster minimum guard                                           */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 18);
  let guard = 0;
  while (rosterOf(base, base.userTeamId).length > 8 && guard++ < 30) {
    const spare = rosterOf(base, base.userTeamId)
      .sort((a, b) => a.overall - b.overall)[0];
    if (!spare) break;
    spare.teamId = null;
    base.freeAgents.push(spare.id);
  }
  const picks = eligible(base, 3);
  assert(rosterOf(base, base.userTeamId).length === 8, 'test roster trimmed to the minimum');
  assert(
    !fusePlayers(base, picks.map((player) => player.id)).state,
    'fusion cannot drop the roster below the eight-player minimum',
  );
}

/* ---------------------------------------------------------------- */
/* 6. a mint that cannot fit is stored, not lost                     */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 19);
  while (rosterOf(base, base.userTeamId).length < 15) {
    const donor = Object.values(base.players).find(
      (player) => !player.teamId,
    );
    if (!donor) break;
    donor.teamId = base.userTeamId;
    donor.salary = 1;
  }
  const picks = eligible(base, 3);
  picks.forEach((player) => (player.salary = 1));
  const others = rosterOf(base, base.userTeamId).filter(
    (player) => !picks.some((pick) => pick.id === player.id),
  );
  // Push payroll to the cap so even a league-minimum mint cannot fit.
  const room = capFor(base) - others.reduce((sum, player) => sum + player.salary, 0) - 1;
  others.forEach((player) => (player.salary += room / others.length));

  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(result.state, 'fusion still succeeds when the cap is full');
  const next = result.state!;
  const minted = Object.values(next.players).find((player) => !base.players[player.id])!;
  assert(minted.teamId === null, 'a mint that cannot fit stays unassigned');
  assert(
    (next.stash ?? []).includes(minted.id),
    'the unassigned mint lands in the stored-NFT collection',
  );
  assert(
    !next.lineup!.includes(minted.id),
    'the stored mint is not in the lineup',
  );
  const signed = signStashedPlayer(next, minted.id);
  assert(Boolean(signed.error), 'a stored mint that breaks the cap cannot be force-signed');
}

/* ---------------------------------------------------------------- */
/* 7. full collection: fusion is refused and nothing is burned       */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 20);
  while (rosterOf(base, base.userTeamId).length < 15) {
    const donor = Object.values(base.players).find(
      (player) => !player.teamId,
    );
    if (!donor) break;
    donor.teamId = base.userTeamId;
    donor.salary = 1;
  }
  const picks = eligible(base, 3);
  picks.forEach((player) => (player.salary = 1));
  const others = rosterOf(base, base.userTeamId).filter(
    (player) => !picks.some((pick) => pick.id === player.id),
  );
  const room = capFor(base) - others.reduce((sum, player) => sum + player.salary, 0) - 1;
  others.forEach((player) => (player.salary += room / others.length));

  // Fill the collection with three unsigned players.
  const spare = Object.values(base.players)
    .filter((player) => !player.teamId)
    .slice(0, STASH_LIMIT);
  assert(spare.length === STASH_LIMIT, 'found three spare players for the collection');
  spare.forEach((player) => {
    player.teamId = null;
    player.tier = 5;
    player.salary = 1;
  });
  base.stash = spare.map((player) => player.id);

  const snapshot = JSON.stringify(base.players);
  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(!result.state && /collection is full/.test(result.error ?? ''), 'a full collection blocks fusion');
  assert(JSON.stringify(base.players) === snapshot, 'the refused fusion burned nothing');
}

/* ---------------------------------------------------------------- */
/* 8. stored NFTs can be fused, freeing collection slots             */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 21);
  const spare = Object.values(base.players)
    .filter((player) => !player.teamId)
    .slice(0, 3);
  spare.forEach((player) => {
    player.teamId = null;
    player.tier = 5;
    player.level = MAX_LEVEL;
  });
  base.stash = spare.map((player) => player.id);
  const before = rosterOf(base, base.userTeamId).length;
  const result = fusePlayers(base, spare.map((player) => player.id));
  assert(result.state, 'three stored maxed NFTs fuse');
  const next = result.state!;
  assert(
    rosterOf(next, next.userTeamId).length === before + 1,
    'the mint joins the roster when it fits',
  );
  assert((next.stash ?? []).length === 0, 'the collection is emptied by the fusion');
  assert(stashPlayers(next).length === 0, 'no stored players remain');
}

/* ---------------------------------------------------------------- */
/* 9. collection contents never count against the roster minimum     */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 22);
  let guard = 0;
  while (rosterOf(base, base.userTeamId).length > 8 && guard++ < 30) {
    const spare = rosterOf(base, base.userTeamId)
      .sort((a, b) => a.overall - b.overall)[0];
    if (!spare) break;
    spare.teamId = null;
  }
  const candidates = Object.values(base.players)
    .filter((player) => !player.teamId)
    .slice(0, 2);
  candidates.forEach((player) => {
    player.tier = 5;
    player.level = MAX_LEVEL;
  });
  const onRoster = eligible(base, 1).filter((player) => !candidates.includes(player));
  const fused = fusePlayers(base, [onRoster[0].id, ...candidates.map((p) => p.id)]);
  assert(
    !fused.state,
    'stored players cannot mask a roster-minimum breach',
  );
}

/* ---------------------------------------------------------------- */
/* 10. a stored mint must not break the roster minimum               */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 23);
  let guard = 0;
  while (rosterOf(base, base.userTeamId).length > 10 && guard++ < 30) {
    const spare = rosterOf(base, base.userTeamId)
      .sort((a, b) => a.overall - b.overall)[0];
    if (!spare) break;
    spare.teamId = null;
  }
  assert(rosterOf(base, base.userTeamId).length === 10, 'test roster trimmed to ten');
  const picks = eligible(base, 3);
  picks.forEach((player) => (player.salary = 1));
  const others = rosterOf(base, base.userTeamId).filter(
    (player) => !picks.some((pick) => pick.id === player.id),
  );
  const room = capFor(base) - others.reduce((sum, player) => sum + player.salary, 0) - 1;
  others.forEach((player) => (player.salary += room / others.length));

  const snapshot = JSON.stringify(base.players);
  const result = fusePlayers(base, picks.map((player) => player.id));
  assert(
    !result.state && /at least 8 players/.test(result.error ?? ''),
    'a fusion whose mint would be stored cannot leave seven players',
  );
  assert(JSON.stringify(base.players) === snapshot, 'the rejected fusion burned nothing');
}

/* ---------------------------------------------------------------- */
/* 11. stored inputs can still fuse down to exactly eight            */
/* ---------------------------------------------------------------- */
{
  const base = createLeague('NYS', 24);
  let guard = 0;
  while (rosterOf(base, base.userTeamId).length > 10 && guard++ < 30) {
    const spare = rosterOf(base, base.userTeamId)
      .sort((a, b) => a.overall - b.overall)[0];
    if (!spare) break;
    spare.teamId = null;
  }
  const picks = eligible(base, 2);
  picks.forEach((player) => (player.salary = 1));
  const storedPlayer = Object.values(base.players).find(
    (player) => !player.teamId && !picks.includes(player),
  )!;
  storedPlayer.tier = 5;
  storedPlayer.level = MAX_LEVEL;
  storedPlayer.years = 3;
  base.stash = [storedPlayer.id];

  const others = rosterOf(base, base.userTeamId).filter(
    (player) => !picks.some((pick) => pick.id === player.id),
  );
  const room = capFor(base) - others.reduce((sum, player) => sum + player.salary, 0) - 1;
  others.forEach((player) => (player.salary += room / others.length));

  const result = fusePlayers(base, [...picks.map((player) => player.id), storedPlayer.id]);
  assert(result.state, 'two roster players plus one stored NFT fuse at the minimum');
  const next = result.state!;
  assert(
    rosterOf(next, next.userTeamId).length === 8,
    'the roster lands on exactly eight, not seven',
  );
  const minted = Object.values(next.players).find((player) => !base.players[player.id])!;
  assert((next.stash ?? []).includes(minted.id), 'the capped-out mint is stored');
}

console.log('\nfusion audit passed');
