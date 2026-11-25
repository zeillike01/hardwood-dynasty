import type { Game, GameState } from './types';

export interface ReplayPlay {
  id: number;
  quarter: number;
  clock: string;
  teamId: string;
  text: string;
  homeScore: number;
  awayScore: number;
}

const THREE_TEXT = [
  'drills a three',
  'buries a triple from the wing',
  'hits from way downtown',
  'splashes a corner three',
];
const TWO_TEXT = [
  'scores inside',
  'knocks down the jumper',
  'finishes at the rim',
  'sinks the mid-range shot',
  'spins home a layup',
];
const FT_TEXT = ['makes the free throw', 'sinks the free throw'];

function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

/**
 * Turn a finished box score into an ordered scoring log. Every make from the
 * box becomes one play, so the running score lands exactly on the final score.
 */
export function buildReplay(state: GameState, game: Game): ReplayPlay[] {
  if (!game.played || !game.box) return [];

  let seed = seedFrom(game.id);
  const pick = (lines: string[]) => {
    seed = nextSeed(seed);
    return lines[seed % lines.length];
  };

  const events: { teamId: string; points: number; text: string }[] = [];
  for (const line of game.box) {
    const player = state.players[line.playerId];
    const team = state.teams[line.teamId];
    if (!player || !team) continue;
    const threes = Math.max(0, line.tpm);
    const twos = Math.max(0, line.fgm - line.tpm);
    for (let i = 0; i < threes; i++) {
      events.push({
        teamId: team.id,
        points: 3,
        text: `${player.name} ${pick(THREE_TEXT)} (${team.abbr})`,
      });
    }
    for (let i = 0; i < twos; i++) {
      events.push({
        teamId: team.id,
        points: 2,
        text: `${player.name} ${pick(TWO_TEXT)} (${team.abbr})`,
      });
    }
    for (let i = 0; i < line.ftm; i++) {
      events.push({
        teamId: team.id,
        points: 1,
        text: `${player.name} ${pick(FT_TEXT)} (${team.abbr})`,
      });
    }
  }

  // Shuffle deterministically so both teams trade baskets.
  seed = seedFrom(`${game.id}-order`);
  for (let i = events.length - 1; i > 0; i--) {
    seed = nextSeed(seed);
    const j = seed % (i + 1);
    const swap = events[i];
    events[i] = events[j];
    events[j] = swap;
  }

  let home = 0;
  let away = 0;
  const total = Math.max(1, events.length);
  return events.map((event, index) => {
    const quarter = Math.min(4, Math.floor((index / total) * 4) + 1);
    const inQuarter = (index / total) * 4 - (quarter - 1);
    const secondsLeft = Math.max(0, Math.round(720 * (1 - inQuarter)));
    if (event.teamId === game.home) home += event.points;
    else away += event.points;
    return {
      id: index,
      quarter,
      clock: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`,
      teamId: event.teamId,
      text: event.text,
      homeScore: home,
      awayScore: away,
    };
  });
}
