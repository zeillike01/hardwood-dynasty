import type { Difficulty, FacilityKey, Scenario } from './data';

export type Pos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type Conf = 'East' | 'West';
export type Phase = 'regular' | 'playoffs' | 'offseason';
/**
 * 5 is the entry tier, 1 is the top tier, and 0 is the Hall of Fame tier. Only
 * a champion's rare NFT drop in the HWD Hall of Fame league creates tier 0.
 */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

export interface Attrs {
  inside: number;
  outside: number;
  playmaking: number;
  defense: number;
  rebounding: number;
  athleticism: number;
}

export type AttrKey = keyof Attrs;

export interface StatLine {
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

export interface Player {
  id: string;
  name: string;
  pos: Pos;
  age: number;
  attrs: Attrs;
  overall: number;
  potential: number;
  tier: Tier;
  level: number;
  salary: number;
  years: number;
  teamId: string | null;
  stats: StatLine;
  /** Games still to miss with the current injury; 0 means healthy. */
  injuryGames: number;
  /** Short name of the current injury, or null when healthy. */
  injury: string | null;
  /** Career totals, accumulated at every season rollover. */
  career?: StatLine;
  /** Optional contract clause: a player or team option year. */
  option?: 'player' | 'team' | null;
  /** Skill levels bought with front-office cash, one track per attribute. */
  skillLevels?: Partial<Record<AttrKey, number>>;
  /** True while the player is still on the rookie-scale deal he was drafted on. */
  rookie?: boolean;
  /** Minted by a fusion: 22% under the market on his deal and every re-signing. */
  fused?: boolean;
  /**
   * True once he has retired. He stays in the player list for the record book
   * but never ages again and never returns to free agency.
   */
  retired?: boolean;
  /** Team that drafted him, used for draft-surplus accounting. */
  draftedBy?: string | null;
  /** Season the rookie deal began. */
  draftSeason?: number;
  /** First season the player actually played for his current team (1 at save creation). */
  joinedSeason?: number;
  /**
   * True for a player dropped by the Hall of Fame league, whose ratings keep a
   * premium over the normal tier curve when they are rebuilt.
   */
  hofReward?: boolean;
}

export interface DeadContract {
  name: string;
  salary: number;
  /** Seasons of salary still counting against the cap. */
  years: number;
}

export interface Team {
  id: string;
  city: string;
  name: string;
  abbr: string;
  color: string;
  conference: Conf;
  wins: number;
  losses: number;
  ptsFor: number;
  ptsAgainst: number;
  trainingPoints: number;
  cash: number;
  /** Waived contracts that still count against the cap. */
  deadMoney?: DeadContract[];
  /** Consecutive seasons finishing above the cap (drives repeat-offender penalties). */
  taxStrikes?: number;
  /** Luxury tax owed but not yet covered by cash, settled from future revenue. */
  taxDebt?: number;
}

export interface BoxLine {
  playerId: string;
  teamId: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

export interface Game {
  id: string;
  round: number;
  home: string;
  away: string;
  played: boolean;
  homeScore: number;
  awayScore: number;
  box: BoxLine[] | null;
}

export interface SeriesGame {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

export interface Series {
  id: string;
  round: number;
  label: string;
  high: string;
  low: string;
  highWins: number;
  lowWins: number;
  games: SeriesGame[];
  winner: string | null;
}

export interface Tx {
  id: string;
  season: number;
  text: string;
}

export interface SeasonRecord {
  season: number;
  champion: string;
  runnerUp: string;
  userWins: number;
  userLosses: number;
  /** Short description of how the user's season ended. */
  userResult: string;
  mvpId: string | null;
  dpoyId: string | null;
  royId: string | null;
  finalsMvpId?: string | null;
  allLeague: string[];
}

export interface DevNote {
  playerId: string;
  before: number;
  after: number;
  note: string;
}

export interface MarketListing {
  id: string;
  playerId: string;
  /** Team that owns the player NFT right now. */
  sellerTeamId: string;
  /** Asking price in HWD tokens. */
  price: number;
  /** Season the listing was posted. */
  season: number;
}

export interface HofGame {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

/** One best-of-three series in the HWD Hall of Fame league. */
export interface HofSeries {
  round: number;
  /** Higher seed: hosts games one and three. */
  high: string;
  low: string;
  highWins: number;
  lowWins: number;
  games: HofGame[];
  winner: string | null;
}

export type HofPlacement = 'champion' | 'runner-up' | 'third' | 'out';

/** The season's Hall of Fame league: entrants, bracket, payout and NFT drop. */
export interface HofLeague {
  season: number;
  /** Team ids, strongest seed first. */
  seeds: string[];
  series: HofSeries[];
  /** Played by the two semifinal losers. */
  third: HofSeries | null;
  champion: string | null;
  /** How the user's club finished, which sets the payout. */
  userPlacement: HofPlacement;
  /** HWD credited from the pot for that finish. */
  prize: number;
  /** HWD paid out to the podium once the bracket settles. */
  prizePool?: number;
  /** Tier rolled for the champion's one-player NFT reward. */
  rewardTier: Tier | null;
  rewardPlayerId: string | null;
}

export interface GameSettings {
  difficulty: Difficulty;
  scenario: Scenario;
}

export interface QuestReward {
  type: 'tp' | 'cash';
  amount: number;
}

export interface DailyQuest {
  /** Local calendar day the quest was issued, e.g. 2026-11-22. */
  date: string;
  kind: 'games' | 'wins' | 'points';
  target: number;
  reward: QuestReward;
  /** Season and round when the quest was issued; only later games count. */
  season: number;
  round: number;
  claimed: boolean;
  /** Lifetime daily quests claimed, used for milestone rewards. */
  completed: number;
  /** Milestone tiers already paid out. */
  milestones: number;
}

export interface GameState {
  version: number;
  /** Ratings revision, used to rebuild player attributes once after a rebalance. */
  ratingsVersion?: number;
  /** Set once fused contracts have been re-priced onto the fused-deal discount. */
  fusedSalaryVersion?: number;
  /** Set once stored NFTs have had their deals frozen and pulled out of free agency. */
  stashFreezeVersion?: number;
  seed: number;
  rngState: number;
  season: number;
  phase: Phase;
  userTeamId: string;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  schedule: Game[];
  round: number;
  playoffs: Series[];
  playoffRound: number;
  freeAgents: string[];
  draftClass: string[] | null;
  draftOrder: string[] | null;
  /** Original team id for each draft slot, so traded picks show their origin. */
  draftPickOrigins: string[] | null;
  /** Original team id -> current owner of that team's next first-round pick. */
  pickOwners: Record<string, string>;
  draftPickIndex: number;
  log: Tx[];
  /** User's rotation order: five starters (PG, SG, SF, PF, C) then bench. */
  lineup?: string[];
  /** Completed seasons, newest last. */
  history?: SeasonRecord[];
  /** Draft prospects the user has fully scouted. */
  scouted?: string[];
  /** Last offseason's development report for the user's roster. */
  devReport?: DevNote[];
  settings?: GameSettings;
  /** Today's small daily objective and lifetime quest count. */
  dailyQuest?: DailyQuest;
  /** Front-office facility levels bought with cash. */
  facilities?: Partial<Record<FacilityKey, number>>;
  /** HWD token balance: the marketplace currency, separate from team cash. */
  hwd?: number;
  /**
   * HWD held by each rival club. The marketplace is peer-to-peer: a club pays
   * for your player from this balance and is paid when you buy its listing,
   * so a completed sale moves tokens instead of creating them.
   */
  clubHwd?: Record<string, number>;
  /** Set once the CPU clubs' starting HWD airdrop has been applied to this save. */
  clubHwdVersion?: number;
  /** Set once the raised starting HWD float has been applied to this save. */
  hwdGrantVersion?: number;
  /** HWD set aside from the 5% marketplace fee and reserved for development. */
  devFund?: number;
  /**
   * HWD-to-training-points conversions: the season and HWD spent for the season
   * cap, plus the calendar day and HWD spent on it for the daily cap. A new
   * season or day resets its own cap.
   */
  tpSwap?: { season: number; hwd: number; day?: string; dayHwd?: number };
  /**
   * When the next season may tip off (ISO). Opening a season starts a 24-hour
   * wait; an absent value means the season is ready right now.
   */
  seasonReadyAt?: string;
  /** Calendar day and paid skips used, for the daily skip cap. */
  seasonSkip?: { day: string; count: number };
  /** Player NFTs other clubs are offering on the marketplace. */
  market?: MarketListing[];
  /**
   * NFTs you own that are not on the active roster. They cost no cap space and
   * take no roster spot until you sign them, and they can be used in a fusion.
   */
  stash?: string[];
  /** This season's Hall of Fame league, once the entry fee has been paid. */
  hof?: HofLeague | null;
}
