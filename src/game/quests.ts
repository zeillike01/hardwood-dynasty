import type { DailyQuest, GameState, QuestReward, Team } from './types';
import { capFor } from './engine';

/**
 * Quest payouts scale with the salary cap so a daily reward is worth the same
 * share of the economy in season 1 and season 100. Cash is a share of the cap;
 * TP is flat because training costs are flat.
 */
export const QUEST_CASH_SHARES = [0.0015, 0.002, 0.0025];
export const QUEST_TP_AMOUNTS = [8, 10, 12];

export interface QuestMilestone {
  quests: number;
  reward: { type: 'cash'; share: number } | { type: 'tp'; amount: number };
}

export const QUEST_MILESTONES: QuestMilestone[] = [
  { quests: 3, reward: { type: 'cash', share: 0.03 } },
  { quests: 7, reward: { type: 'tp', amount: 30 } },
  { quests: 15, reward: { type: 'cash', share: 0.06 } },
];

/** Resolve a milestone's stored share or flat amount against the current cap. */
export function milestoneReward(milestone: QuestMilestone, cap: number): QuestReward {
  const reward = milestone.reward;
  if (reward.type === 'tp') return { type: 'tp', amount: reward.amount };
  return { type: 'cash', amount: Math.round(cap * reward.share * 10) / 10 };
}

export function milestoneLabel(milestone: QuestMilestone, cap: number): string {
  return rewardLabel(milestoneReward(milestone, cap));
}

const QUEST_POOL: { kind: DailyQuest['kind']; targets: number[] }[] = [
  { kind: 'games', targets: [2, 3] },
  { kind: 'wins', targets: [1, 2] },
  { kind: 'points', targets: [260, 300] },
];



function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function createQuest(state: GameState, previous?: DailyQuest): DailyQuest {
  const date = todayKey();
  const seed = hash(`${date}|${state.seed}|${state.season}|${state.round}`);
  const entry = QUEST_POOL[seed % QUEST_POOL.length];
  const target = entry.targets[(seed >>> 5) % entry.targets.length];
  const isTp = ((seed >>> 9) & 1) === 0;
  const index = (seed >>> 13) % QUEST_CASH_SHARES.length;
  const amount = isTp
    ? QUEST_TP_AMOUNTS[index]
    : Math.round(capFor(state) * QUEST_CASH_SHARES[index] * 10) / 10;
  return {
    date,
    kind: entry.kind,
    target,
    reward: { type: isTp ? 'tp' : 'cash', amount },
    season: state.season,
    round: state.round,
    claimed: false,
    completed: previous?.completed ?? 0,
    milestones: previous?.milestones ?? 0,
  };
}

/** Issue a fresh quest when the calendar day turns, otherwise leave the save alone. */
export function ensureDailyQuest(state: GameState): GameState {
  const current = state.dailyQuest;
  if (current && current.date === todayKey()) return state;
  return { ...state, dailyQuest: createQuest(state, current) };
}

function questGames(state: GameState, quest: DailyQuest) {
  const teamId = state.userTeamId;
  return state.schedule.filter(
    (game) =>
      game.played &&
      (game.home === teamId || game.away === teamId) &&
      (state.season > quest.season || game.round >= quest.round),
  );
}

export function questProgress(state: GameState, quest: DailyQuest): number {
  if (quest.claimed) return quest.target;
  const games = questGames(state, quest);
  switch (quest.kind) {
    case 'games':
      return games.length;
    case 'wins':
      return games.filter((game) =>
        game.home === state.userTeamId
          ? game.homeScore > game.awayScore
          : game.awayScore > game.homeScore,
      ).length;
    case 'points':
      return games.reduce(
        (total, game) =>
          total + (game.home === state.userTeamId ? game.homeScore : game.awayScore),
        0,
      );
  }
}

export function questLabel(quest: DailyQuest): string {
  switch (quest.kind) {
    case 'games':
      return `Play ${quest.target} games`;
    case 'wins':
      return `Win ${quest.target} game${quest.target === 1 ? '' : 's'}`;
    case 'points':
      return `Score ${quest.target} total points`;
  }
}

export function rewardLabel(reward: QuestReward): string {
  return reward.type === 'tp' ? `+${reward.amount} TP` : `+$${reward.amount.toFixed(1)}M`;
}

export interface QuestClaimResult {
  state: GameState;
  reward: QuestReward;
  milestones: QuestReward[];
  message: string;
}

function addReward(team: Team, reward: QuestReward) {
  if (reward.type === 'tp') team.trainingPoints += reward.amount;
  else team.cash = Math.round((team.cash + reward.amount) * 10) / 10;
}

/** Pay out a completed daily quest, plus any milestone tiers it unlocked. */
export function claimDailyQuest(state: GameState): QuestClaimResult | null {
  const quest = state.dailyQuest;
  if (!quest || quest.claimed || questProgress(state, quest) < quest.target) return null;

  const team: Team = { ...state.teams[state.userTeamId] };
  addReward(team, quest.reward);

  const completed = quest.completed + 1;
  const paid: QuestReward[] = [];
  let milestones = quest.milestones;
  for (let index = milestones; index < QUEST_MILESTONES.length; index++) {
    const milestone = QUEST_MILESTONES[index];
    if (completed < milestone.quests) break;
    const reward = milestoneReward(milestone, capFor(state));
    addReward(team, reward);
    paid.push(reward);
    milestones = index + 1;
  }

  const teams = { ...state.teams, [state.userTeamId]: team };
  const log = [...state.log];
  log.unshift({
    id: `log_${state.season}_quest_${quest.date}`,
    season: state.season,
    text: `Daily quest complete: ${questLabel(quest)}. Earned ${rewardLabel(quest.reward)}${
      paid.length ? ` plus milestone rewards (${paid.map(rewardLabel).join(', ')})` : ''
    }.`,
  });

  const message = `Daily quest claimed: ${rewardLabel(quest.reward)}${
    paid.length ? ` · Milestone ${paid.map(rewardLabel).join(' · ')}` : ''
  }.`;

  return {
    state: {
      ...state,
      teams,
      log,
      dailyQuest: { ...quest, claimed: true, completed, milestones },
    },
    reward: quest.reward,
    milestones: paid,
    message,
  };
}
