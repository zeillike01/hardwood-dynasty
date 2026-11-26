import type { AttrKey, Conf, Pos, Tier } from './types';

/**
 * The soft cap. Starting payrolls sit around $25–40M, so a 12-man roster with
 * two max players is a genuine squeeze and the luxury tax has teeth.
 */
export const CAP = 70;
/** The smallest contract the league allows, before any market scaling. */
export const LEAGUE_MIN_SALARY = 1.1;
export const ROSTER_MIN = 8;
export const ROSTER_MAX = 15;
/**
 * NFTs you can keep off the roster at once. The collection is capped so it can
 * never become a second, uncapped roster outside the salary cap.
 */
export const STASH_LIMIT = 10;

/**
 * A club below the roster minimum can always add a contract up to this share
 * of the cap: no signing bonus and no cap room required. Without this, a broke
 * team can get stuck at seven players with no legal way to reach eight.
 */
export const MIN_SALARY_EXCEPTION = 0.08;
export const SEASON_ROUNDS = 21;
export const PLAYOFF_TEAMS_PER_CONF = 4;

/** League revenue grows, so the salary cap rises $4M every season. */
export const CAP_GROWTH = 4;

/** Front-office cash needed to fully scout one draft prospect. */
export const SCOUT_COST = 1;

/* ---------------- front office ---------------- */

export type FacilityKey = 'training' | 'medical' | 'scouting' | 'analytics' | 'development';

export interface FacilityDef {
  key: FacilityKey;
  name: string;
  blurb: string;
  /** Cash cost of levels 1, 2 and 3. */
  costs: [number, number, number];
  /** One line per level describing that level's benefit. */
  effects: [string, string, string];
}

export const FACILITY_MAX_LEVEL = 3;

/** Permanent facilities bought with front-office cash, never cap space. */
export const FACILITIES: FacilityDef[] = [
  {
    key: 'training',
    name: 'Training complex',
    blurb: 'More practice time turns every result into extra training points.',
    costs: [2, 5, 9],
    effects: [
      '+6% training points from every game',
      '+12% training points from every game',
      '+18% training points from every game',
    ],
  },
  {
    key: 'medical',
    name: 'Medical center',
    blurb: 'Prevention and rehab keep the rotation on the floor.',
    costs: [2, 5, 9],
    effects: [
      '−10% injury chance, 1 fewer game missed',
      '−20% injury chance, 2 fewer games missed',
      '−30% injury chance, 3 fewer games missed',
    ],
  },
  {
    key: 'scouting',
    name: 'Scouting department',
    blurb: 'Full-time scouts cut the cost of reports and tighten the estimates.',
    costs: [1.5, 4, 7],
    effects: [
      'Reports cost $0.75M and are 20% tighter',
      'Reports cost $0.5M and are 35% tighter',
      'Reports are free and 50% tighter',
    ],
  },
  {
    key: 'analytics',
    name: 'Analytics department',
    blurb: 'Contract and tax models find savings before the league office does.',
    costs: [2, 5, 8],
    effects: [
      'Luxury tax bills are 10% smaller',
      'Luxury tax bills are 20% smaller',
      'Luxury tax bills are 30% smaller',
    ],
  },
  {
    key: 'development',
    name: 'Player development center',
    blurb: 'Coaches and facilities that make every skill academy session cheaper.',
    costs: [3, 6, 9],
    effects: [
      'Skill academy sessions cost 15% less',
      'Skill academy sessions cost 30% less',
      'Sessions cost 45% less; every player gains one extra skill level',
    ],
  },
];

/* ---------------- skill academy ---------------- */

export const SKILL_MAX_LEVEL = 3;
/** Cash-purchased levels allowed per player across every track. */
export const SKILL_TOTAL_CAP = 6;
export const SKILL_VETERAN_CAP = 3;
export const SKILL_VETERAN_AGE = 30;
export const SKILL_ATTR_CAP = 99;
/** Attribute points added by one cash skill level. */
export const SKILL_ATTR_GAIN = 3;

/** Level costs for a normal rating; 85+ attributes carry a 25% premium. */
export const SKILL_BASE_COSTS = [0.8, 1.8, 3.2] as const;

export interface SkillDef {
  name: string;
  blurb: string;
}

/** Keyed by attribute so a skill never needs a lookup or an unknown-key case. */
export const SKILLS: Record<AttrKey, SkillDef> = {
  inside: { name: 'Finishing school', blurb: 'Post moves, touch and finishing through contact.' },
  outside: { name: 'Shooting lab', blurb: 'Release, range and shot selection.' },
  playmaking: { name: 'Playmaking academy', blurb: 'Handles, vision and passing angles.' },
  defense: { name: 'Defensive dojo', blurb: 'Footwork, contests and team defense.' },
  rebounding: { name: 'Rebounding program', blurb: 'Positioning, box-outs and second efforts.' },
  athleticism: { name: 'Conditioning program', blurb: 'Speed, stamina and explosiveness.' },
};

export const SKILL_KEYS = Object.keys(SKILLS) as AttrKey[];

/** A buyout pays this share of the remaining contract in cash to erase the cap hit. */
export const BUYOUT_RATE = 0.6;

/** Contract lengths the user can offer in free agency and re-signings. */
export const CONTRACT_YEARS = [1, 2, 3, 4] as const;

export type Difficulty = 'relaxed' | 'standard' | 'hard';
export type Scenario = 'rebuild' | 'contender' | 'expansion';

export const DIFFICULTY: Record<
  Difficulty,
  { label: string; blurb: string; injury: number; tp: number; cpuTraining: number }
> = {
  relaxed: {
    label: 'Relaxed',
    blurb: 'Fewer injuries, more training points and softer CPU development.',
    injury: 0.65,
    tp: 1.25,
    cpuTraining: 0.85,
  },
  standard: {
    label: 'Standard',
    blurb: 'The intended balance: normal injuries, rewards and CPU growth.',
    injury: 1,
    tp: 1,
    cpuTraining: 1,
  },
  hard: {
    label: 'Hard',
    blurb: 'More injuries, leaner rewards and sharper CPU training.',
    injury: 1.35,
    tp: 0.8,
    cpuTraining: 1.15,
  },
};

export const SCENARIOS: Record<Scenario, { label: string; blurb: string }> = {
  rebuild: {
    label: 'Rebuild',
    blurb: 'Ten tier-5 players and a clean cap sheet. The classic start.',
  },
  contender: {
    label: 'Contender',
    blurb: 'A head start: three tier-4 players and a tier-3 centerpiece.',
  },
  expansion: {
    label: 'Expansion',
    blurb: 'Barely a roster: eight players, no stars and a long climb.',
  },
};

/* ---------------- player development economy ---------------- */

/** Every team starts with tier-5 players at level 1. */
export const STARTING_TIER = 5;
export const STARTING_LEVEL = 1;
export const MAX_LEVEL = 20;

/**
 * Base overall for each tier. Tier 5 is the weakest entry talent (25), and every
 * step up the ladder is worth ten points: 25 / 35 / 45 / 55 / 65. Tier 0 is the
 * Hall of Fame band (75 base, trained into the 90s; league drops arrive at 95). It is never drafted or trained into: a player is
 * created at tier 0 only by a champion's very rare NFT drop in the HWD Hall of
 * Fame league. Once signed he is an ordinary roster player and can be sold.
 */
export const TIER_BASE: Record<Tier, number> = { 0: 75, 1: 65, 2: 55, 3: 45, 4: 35, 5: 25 };

/** The Hall of Fame tier, awarded to the winner of the HWD entry-fee league. */
export const HALL_OF_FAME_TIER: Tier = 0;

/**
 * Hall of Fame league drops arrive this far above their tier base: the league
 * is the endgame, so its champion NFT has to outclass anything the normal
 * curve can produce (a maxed tier-1 player tops out around 86).
 */
export const HOF_REWARD_PREMIUM = 20;

/** Display name for a tier, including the Hall of Fame band. */
export function tierName(tier: Tier): string {
  return tier === HALL_OF_FAME_TIER ? 'Hall of Fame' : `Tier ${tier}`;
}

/** Bumped whenever player ratings are rebuilt; older saves re-run the reset once. */
export const RATINGS_VERSION = 5;

/**
 * Attribute points added per training level. Every level touches all six
 * attributes, so any tier gains about +1 overall per level up to the cap.
 */
export const TRAINING_ATTR_GAIN = 6;

/**
 * Draft tier odds. Tier 3 is the rare find: most classes produce none, and the
 * four lottery picks only get a modest edge. The rest of a class is tier 4 or
 * tier 5, so tier-3 talent — the only fusion input — cannot be farmed.
 */
export const DRAFT_TIER3_CHANCE = 0.07;
/** Extra tier-3 chance for the four lottery picks. */
export const DRAFT_TIER3_LOTTERY_BONUS = 0.08;
export const DRAFT_TIER4_CHANCE = 0.58;

/** Rookie contracts run at least two seasons; drafted players get three. */
export const ROOKIE_YEARS = 3;

/** Playoff economics: every qualifier pays in, the champion and runner-up cash out. */
export const PLAYOFF_ENTRY_FEE = 1.5;
export const PLAYOFF_WIN_CASH = 0.5;
export const TITLE_CASH_PRIZE = 8;
export const RUNNER_UP_CASH_PRIZE = 3;

/**
 * Training points earned per result. Income is deliberately lean: a maxed
 * tier-5 player costs 532 TP, so one good season buys roughly one, and a full
 * tier-5-to-tier-2 build is a multi-season project. Winning pays six times a
 * loss in the regular season, so tanking is a genuinely bad development plan.
 */
export const WIN_TRAINING_POINTS = 30;
export const LOSS_TRAINING_POINTS = 5;
export const PLAYOFF_WIN_POINTS = 45;
export const PLAYOFF_LOSS_POINTS = 8;
export const TITLE_BONUS_POINTS = 180;

/* ---------------- injuries ---------------- */

/** Chance per team, per game, that one of its rotation players gets hurt. */
export const INJURY_TEAM_CHANCE = 0.12;

/** A knock costs at least one game; the longest injuries can end a season. */
export const INJURY_MAX_GAMES = 16;

export interface InjuryGrade {
  weight: number;
  minGames: number;
  maxGames: number;
  labels: string[];
}

/**
 * Recovery is measured in games missed, so the same table works for the
 * regular season and the playoffs.
 */
export const INJURY_GRADES: InjuryGrade[] = [
  {
    weight: 0.58,
    minGames: 1,
    maxGames: 2,
    labels: ['Ankle sprain', 'Bruised ribs', 'Calf tightness', 'Jammed finger'],
  },
  {
    weight: 0.27,
    minGames: 3,
    maxGames: 5,
    labels: ['Hamstring strain', 'Knee soreness', 'Back spasms', 'Shoulder strain'],
  },
  {
    weight: 0.12,
    minGames: 6,
    maxGames: 9,
    labels: ['High ankle sprain', 'Wrist fracture', 'Groin strain', 'Elbow sprain'],
  },
  {
    weight: 0.03,
    minGames: 10,
    maxGames: INJURY_MAX_GAMES,
    labels: ['Torn meniscus', 'Broken hand', 'Stress fracture'],
  },
];

/** Training points -> front-office cash. */
export const POINTS_PER_CASH_BLOCK = 100;
export const CASH_PER_BLOCK = 1;
export const STARTING_CASH = 10;

/* ---------------- league cash flow ---------------- */

/**
 * Every season pays a revenue share tied to the salary cap (so the economy
 * scales with league revenue) plus gate money for each regular-season win.
 */
export const REVENUE_RATE = 0.09;
export const REVENUE_PER_WIN = 0.25;

/** Basketball operations cost, charged every offseason as a share of payroll. */
export const OPERATIONS_RATE = 0.08;

export interface TeamBlueprint {
  id: string;
  city: string;
  name: string;
  abbr: string;
  color: string;
  conference: Conf;
  arena: string;
}

export const TEAM_BLUEPRINTS: TeamBlueprint[] = [
  { id: 'NYS', city: 'New York', name: 'Skyliners', abbr: 'NYS', color: '#ff6b35', conference: 'East', arena: 'The Rooftop' },
  { id: 'BOS', city: 'Boston', name: 'Harbormen', abbr: 'BOS', color: '#2f9e6b', conference: 'East', arena: 'Pier 9 Arena' },
  { id: 'PHI', city: 'Philadelphia', name: 'Founders', abbr: 'PHI', color: '#c9a227', conference: 'East', arena: 'Independence Hall' },
  { id: 'CHI', city: 'Chicago', name: 'Stockyards', abbr: 'CHI', color: '#c0392b', conference: 'East', arena: 'Union Yard' },
  { id: 'MIA', city: 'Miami', name: 'Tide', abbr: 'MIA', color: '#17b3c9', conference: 'East', arena: 'Neon Bay' },
  { id: 'ATL', city: 'Atlanta', name: 'Flight', abbr: 'ATL', color: '#8a63d2', conference: 'East', arena: 'Peachtree Dome' },
  { id: 'LAC', city: 'Los Angeles', name: 'Comets', abbr: 'LAC', color: '#e2456f', conference: 'West', arena: 'Sunset Coliseum' },
  { id: 'SFW', city: 'San Francisco', name: 'Waves', abbr: 'SFW', color: '#2563eb', conference: 'West', arena: 'Breakwater Center' },
  { id: 'SEA', city: 'Seattle', name: 'Evergreens', abbr: 'SEA', color: '#1f9d55', conference: 'West', arena: 'Rainline Arena' },
  { id: 'DAL', city: 'Dallas', name: 'Iron', abbr: 'DAL', color: '#98a2b3', conference: 'West', arena: 'Foundry Fieldhouse' },
  { id: 'DEN', city: 'Denver', name: 'Peaks', abbr: 'DEN', color: '#6d5bd0', conference: 'West', arena: 'High Altitude Dome' },
  { id: 'PHX', city: 'Phoenix', name: 'Sol', abbr: 'PHX', color: '#f0a11b', conference: 'West', arena: 'Sunspire Arena' },
];

export const POSITIONS: Pos[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export const FIRST_NAMES = [
  'Andre', 'Marcus', 'Darius', 'Jalen', 'Tyrese', 'Malik', 'Deshawn', 'Corey', 'Elijah', 'Trey',
  'Isaiah', 'Cameron', 'Devin', 'Julian', 'Kendrick', 'Lamar', 'Micah', 'Noah', 'Omar', 'Quentin',
  'Rashad', 'Silas', 'Terrell', 'Xavier', 'Zion', 'Amari', 'Bryce', 'Caleb', 'Dante', 'Emmett',
  'Franco', 'Gabriel', 'Hassan', 'Ibrahim', 'Joaquin', 'Kai', 'Lucas', 'Mateo', 'Nico', 'Oscar',
  'Preston', 'Rafael', 'Santiago', 'Theo', 'Victor', 'Wesley', 'Yusuf', 'Zeke',
];

export const LAST_NAMES = [
  'Adebayo', 'Barrett', 'Castillo', 'Daniels', 'Ellison', 'Freeman', 'Grady', 'Holloway', 'Ingram', 'Jefferson',
  'Kowalski', 'Lawson', 'Mercer', 'Novak', 'Okafor', 'Pruitt', 'Quintero', 'Ramsey', 'Sinclair', 'Tolliver',
  'Underwood', 'Vaughn', 'Whitaker', 'Yates', 'Zamora', 'Ashford', 'Blakely', 'Cromwell', 'Delgado', 'Escobar',
  'Fairchild', 'Gallagher', 'Hargrove', 'Iverson', 'Jennings', 'Kingston', 'Langford', 'Mabry', 'Nash', 'Ortiz',
  'Paxton', 'Rowan', 'Sandoval', 'Thibodeaux', 'Vargas', 'Winslow', 'Yeboah', 'Zeller', 'Barlow', 'Chambers',
  'Dillard', 'Elmore', 'Fontaine', 'Griggs', 'Hendricks', 'Ishmael', 'Jarrett', 'Kessler', 'Lombardi', 'Malloy',
  'Ndiaye', 'Osei', 'Pemberton', 'Rucker', 'Stroud', 'Tavares', 'Vinson', 'Whitfield', 'Yancey', 'Zubac',
];

export const POS_LABEL: Record<Pos, string> = {
  PG: 'Point Guard',
  SG: 'Shooting Guard',
  SF: 'Small Forward',
  PF: 'Power Forward',
  C: 'Center',
};
