/**
 * HWD macro-economy simulation: 2,000 seasons of a live Hardwood Dynasty.
 *
 * Token layout (as specified):
 *   - Fixed supply of 1,000,000,000 HWD. Nothing is ever minted again; the only
 *     thing that changes the total is the Hall of Fame burn, so supply drifts
 *     down over time.
 *   - 500,000,000 HWD is the launch AMM liquidity, paired with 10,000 USDT.
 *     Launch price is therefore $0.00002 and every token a player holds was
 *     either bought from that pool or earned in game.
 *   - The other 500,000,000 HWD is locked for 3 years (= 3 seasons):
 *       investors 25%  (125,000,000)
 *       rewards   55%  (275,000,000)  ← the in-game emission budget
 *       advisors  10%  ( 50,000,000)
 *       team      10%  ( 50,000,000)
 *     Insiders (225M) vest linearly over the 24 seasons after the lock and sell
 *     a slice of what they hold each season. The rewards bucket is not sold: it
 *     pays out in game and is the only source of marketplace sale proceeds, so
 *     supply stays fixed while the bucket drains.
 *   - No airdrop. A new career's 120 starting HWD comes out of the rewards
 *     bucket, the free base league costs nothing to play, and the Hall of Fame
 *     league costs 25 HWD — so anyone who wants the paid league, exploiters
 *     included, has to buy HWD with USDT first.
 *
 * Player inflow (as specified):
 *   - 100 new humans every 30 seasons up to season 1,000,
 *   - 2,000 new humans every 30 seasons from season 1,000 on.
 * Each cohort mixes three kinds of human:
 *   - spenders (buy HWD with USDT to fund their play),
 *   - casuals (play free, sell a few NFTs, cash out part of the income),
 *   - exploiters (run many accounts, farm NFTs, dump every token they earn).
 *
 * Marketplace and leagues:
 *   - A marketplace sale is settled by a CPU club with no wallet, so the
 *     seller's net proceeds come out of the 275M rewards budget — never out of
 *     thin air. Once that budget is gone, sales can no longer settle (the model
 *     counts the unpaid volume); the real fix is buyer-funded P2P settlement.
 *   - The 5% fee (min 1 HWD) is development-fund revenue: it is never minted and
 *     never burned, it just sits with the treasury.
 *   - Buying a listing spends HWD into a CPU seller that never spends it, so
 *     that HWD goes idle rather than burning.
 *   - Hall of Fame league: 10 seats × 25 HWD = a 250 HWD pool per bracket.
 *     10% (25 HWD) is burned and 225 HWD pays the podium — 12 / 7 / 3.5 per
 *     entry in aggregate, i.e. a 2.5 HWD burn and a 22.5 HWD payout per entry
 *     once every seat is a paying human. Entrants buy their entry from the AMM,
 *     so the league is a USDT inflow and a token sink, not a faucet.
 *   - Every token is tracked: pool + rewards budget + locked vault + insider
 *     float + player float + CPU-held + burned must always equal the fixed
 *     supply. The run aborts if that balance ever breaks.
 *
 * Run with: npm run tokenecon
 */

const SEASONS = 2000;
const BLOCK = 30;
const INFLOW_EARLY = 100; // humans added per 30 seasons before season 1,000
const INFLOW_LATE = 2000; // humans added per 30 seasons from season 1,000
const INFLOW_SHIFT = 1000;

/* ------------------------------------------------------------------ */
/* Fixed-supply token layout                                           */
/* ------------------------------------------------------------------ */

const TOTAL_SUPPLY = 1_000_000_000;
const POOL_HWD = 500_000_000; // launch liquidity, paired with 10,000 USDT
const POOL_USDT = 10_000;
const LOCKED_HWD = 500_000_000;
/** Lock length in seasons; one season is one year. */
const LOCK_SEASONS = 3;
/** Insider vesting after the lock, in seasons. */
const VEST_SEASONS = 24;
const ALLOC = { investors: 0.25, rewards: 0.55, advisors: 0.1, team: 0.1 } as const;
const REWARD_RESERVE = LOCKED_HWD * ALLOC.rewards; // 275,000,000
const INVESTOR_HWD = LOCKED_HWD * ALLOC.investors; // 125,000,000
const ADVISOR_HWD = LOCKED_HWD * ALLOC.advisors; //  50,000,000
const TEAM_HWD = LOCKED_HWD * ALLOC.team; //  50,000,000
const INSIDER_HWD = INVESTOR_HWD + ADVISOR_HWD + TEAM_HWD; // 225,000,000
const INSIDER_PER_SEASON = INSIDER_HWD / VEST_SEASONS;
/** Share of vested insider holdings sold into the AMM each season. */
const INSIDER_SELL_RATE = 0.1;
/** HWD a brand-new career starts with; paid out of the rewards budget. */
const STARTER_HWD = 120;

/* ------------------------------------------------------------------ */
/* Marketplace and Hall of Fame rules                                  */
/* ------------------------------------------------------------------ */

const MARKET_FEE_RATE = 0.05;
const MARKET_MIN_FEE = 1;
/** Fee revenue per sale, in HWD. */
const feeOf = (value: number) => Math.max(MARKET_MIN_FEE, Math.ceil(value * MARKET_FEE_RATE));

const HOF_ENTRY = 25;
const HOF_FIELD = 10;
const HOF_BURN_PER_ENTRY = HOF_ENTRY * 0.1; // 2.5, a tenth of every entry
const HOF_PRIZE_PER_ENTRY = HOF_ENTRY - HOF_BURN_PER_ENTRY; // 22.5 back to the podium
const HOF_POOL_PER_BRACKET = HOF_FIELD * HOF_ENTRY; // 250
const HOF_BURN_PER_BRACKET = HOF_FIELD * HOF_BURN_PER_ENTRY; // 25

/**
 * Spenders top up from the AMM only while HWD is cheaper than this. Above it
 * they stop buying (and stop entering), which is what a real player would do.
 */
const MAX_HWD_PRICE = 0.001; // 50× the launch price

/** Never take more than this share of the pool's HWD in one season's buys. */
const MAX_POOL_TAKE = 0.4;
/** The AMM never sells below this much HWD; past it, price discovery leaves the pool. */
const POOL_FLOOR = POOL_HWD * 0.05;

type Cohort = 'spender' | 'casual' | 'exploiter';

interface AccountFlow {
  /** NFT sales per account per season. */
  sales: number;
  /** Average sale price in HWD. */
  saleAvg: number;
  /** In-game NFT purchases per account per season (HWD into CPU wallets). */
  buys: number;
  buyAvg: number;
  /** Hall of Fame leagues entered per account per season. */
  hofEntries: number;
  /** Share of positive HWD income sold into the AMM. */
  dump: number;
}

const FLOWS: Record<Cohort, AccountFlow> = {
  // Spenders fund their play with USDT: they are the only USDT inflow.
  spender: { sales: 1, saleAvg: 30, buys: 4, buyAvg: 45, hofEntries: 0.5, dump: 0 },
  // Casuals sell a little, buy a little, cash out half their surplus.
  casual: { sales: 2, saleAvg: 22, buys: 1, buyAvg: 18, hofEntries: 0.1, dump: 0.5 },
  // Exploiters run many accounts, never buy, and dump everything.
  exploiter: { sales: 6, saleAvg: 24, buys: 0, buyAvg: 0, hofEntries: 0.4, dump: 1 },
};

interface Scenario {
  label: string;
  mix: Record<Cohort, number>;
  accountsPerExploiter: number;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'base — 60% exploiters × 8 accounts, 30% casuals, 10% spenders',
    mix: { spender: 0.1, casual: 0.3, exploiter: 0.6 },
    accountsPerExploiter: 8,
  },
  {
    label: 'anti-cheat — 30% exploiters × 2 accounts, 50% casuals, 20% spenders',
    mix: { spender: 0.2, casual: 0.5, exploiter: 0.3 },
    accountsPerExploiter: 2,
  },
  {
    label: 'honest — no exploiters, 70% casuals, 30% spenders',
    mix: { spender: 0.3, casual: 0.7, exploiter: 0 },
    accountsPerExploiter: 1,
  },
];

interface Snapshot {
  season: number;
  humans: number;
  accounts: number;
  price: number;
  poolHwd: number;
  poolUsdt: number;
  /** Tokens in players' hands: everything outside the pool, vaults and burns. */
  circulating: number;
  /** Extant supply: 1B minus everything the Hall of Fame league burned. */
  supply: number;
  /** Unspent in-game rewards budget. */
  rewardsLeft: number;
  /** Insider tokens still locked in the vesting vault. */
  locked: number;
  /** Insider tokens unlocked and held back by investors, advisors and team. */
  insiderHeld: number;
  /** HWD paid out to CPU clubs that sold a player and never spend it. */
  cpuIdle: number;
  /** 5% marketplace fees earned by the development fund (HWD, never minted). */
  feeHwd: number;
  feeUsd: number;
  /** HWD actually destroyed: Hall of Fame burn. */
  burned: number;
  hofEntries: number;
  /** Net sale proceeds the rewards budget could pay. */
  salesPaid: number;
  /** Net sale proceeds the budget could no longer pay. */
  salesUnpaid: number;
  /** Settled NFT volume, gross. */
  grossVolume: number;
  /** HWD handed to new careers out of the rewards budget. */
  starterGrants: number;
  usdtIn: number;
  usdtOut: number;
  exploiterUsdt: number;
  exploiterHofUsdt: number;
}

interface Run {
  label: string;
  snapshots: Snapshot[];
  peakPrice: number;
  peakSeason: number;
  drainedAt: number | null;
  exhaustedAt: number | null;
  poolEmptyAt: number | null;
  /** Value of all the treasury's fee HWD if it were dumped into the AMM. */
  feeDumpValue: number;
  /** USD value of the treasury's fee HWD at the season-2,000 price. */
  feeFaceValue: number;
}

const comma = (value: number) => Math.round(value).toLocaleString('en-US');
const num = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(abs < 1 ? 4 : 1);
};
const usd = (value: number) => {
  if (value === 0) return '$0';
  if (Math.abs(value) < 0.01) return `$${value.toExponential(2)}`;
  if (Math.abs(value) < 1000) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
};
const priceText = (value: number) => `$${value.toExponential(3)}`;

function simulate(scenario: Scenario): Run {
  const humans: Record<Cohort, number> = { spender: 0, casual: 0, exploiter: 0 };
  let X = POOL_HWD; // HWD in the AMM
  let Y = POOL_USDT; // USDT in the AMM
  const k = X * Y;

  let rewards = REWARD_RESERVE;
  let locked = INSIDER_HWD;
  let insiderHeld = 0;
  let pledged = 0; // burned HWD
  let floatPlayers = 0; // tokens in player hands
  let cpuIdle = 0; // tokens parked in CPU clubs
  let treasury = 0; // fees collected by the development fund
  let vestedSeasons = 0;

  let feeHwd = 0;
  let hofEntriesTotal = 0;
  let salesPaid = 0;
  let salesUnpaid = 0;
  let starterGrants = 0;
  let grossVolume = 0;
  let usdtIn = 0;
  let usdtOut = 0;
  let exploiterUsdt = 0;
  let exploiterHofUsdt = 0;
  let peakPrice = Y / X;
  let peakSeason = 0;
  let drainedAt: number | null = null;
  let exhaustedAt: number | null = null;
  let poolEmptyAt: number | null = null;
  let poolDrained = false;

  const snapshots: Snapshot[] = [];
  const marks = new Set([100, 500, 1000, 1500, 2000]);

  // Constant-product swaps. Buys take HWD out of the pool and add USDT; sells
  // put HWD in and take USDT out.
  const buyHwd = (want: number): { take: number; cost: number } => {
    const room = Math.max(0, X - POOL_FLOOR);
    const take = Math.min(want, X * MAX_POOL_TAKE, room);
    if (want > take && room <= 0) poolDrained = true;
    if (take <= 0) return { take: 0, cost: 0 };
    const nextX = X - take;
    const cost = k / nextX - Y;
    X = nextX;
    Y += cost;
    usdtIn += cost;
    return { take, cost };
  };
  const sellHwd = (want: number): number => {
    if (want <= 0) return 0;
    const nextX = X + want;
    const out = Y - k / nextX;
    X = nextX;
    Y -= out;
    usdtOut += out;
    return out;
  };

  for (let season = 1; season <= SEASONS; season++) {
    // The 3-year insider lock ends, then vests linearly over 24 seasons.
    if (season > LOCK_SEASONS && locked > 0) {
      vestedSeasons += 1;
      const unlock =
        vestedSeasons >= VEST_SEASONS ? locked : Math.min(locked, INSIDER_PER_SEASON);
      locked -= unlock;
      insiderHeld += unlock;
    }

    // New humans join in 30-season blocks; the inflow jumps at season 1,000.
    let newcomers = 0;
    if (season % BLOCK === 0) {
      const inflow = season < INFLOW_SHIFT ? INFLOW_EARLY : INFLOW_LATE;
      newcomers = inflow;
      for (const cohort of Object.keys(humans) as Cohort[]) {
        humans[cohort] += inflow * scenario.mix[cohort];
      }
    }

    // Starter HWD is paid out of the rewards budget, never minted.
    const starterPaid = Math.min(newcomers * STARTER_HWD, rewards);
    rewards -= starterPaid;
    floatPlayers += starterPaid;
    starterGrants += starterPaid;

    const priceAtStart = Y / X;
    // Spenders walk away once HWD gets too expensive for them.
    const spenderScale = priceAtStart <= MAX_HWD_PRICE ? 1 : 0;

    let netProceeds = 0;
    let seasonGross = 0;
    let seasonFee = 0;
    let buyDemand = 0;
    let entries = 0;
    let exploiterEntries = 0;
    let spenderDemand = 0;
    let casualDump = 0;
    let exploiterDump = 0;

    for (const cohort of ['spender', 'casual', 'exploiter'] as Cohort[]) {
      const flow = FLOWS[cohort];
      const humansInCohort = humans[cohort];
      const accounts =
        humansInCohort * (cohort === 'exploiter' ? scenario.accountsPerExploiter : 1);
      if (accounts <= 0) continue;

      const activity = cohort === 'spender' ? spenderScale : 1;
      const sales = accounts * flow.sales * activity;
      const gross = sales * flow.saleAvg;
      const fee = sales * feeOf(flow.saleAvg);
      const buys = accounts * flow.buys * flow.buyAvg * activity;
      const cohortEntries = accounts * flow.hofEntries * activity;
      const net = gross - fee;

      seasonFee += fee;
      seasonGross += gross;
      buyDemand += buys;
      entries += cohortEntries;
      if (cohort === 'exploiter') exploiterEntries += cohortEntries;
      if (cohort === 'spender') spenderDemand += buys;
      netProceeds += net;
      if (cohort === 'casual') casualDump += net * flow.dump;
      if (cohort === 'exploiter') exploiterDump += net * flow.dump;
    }

    // Marketplace sales settle out of the rewards budget: it pays the gross, the
    // treasury keeps its 5% and the seller gets the rest. Once the budget is
    // empty the sale cannot be paid at all: that volume is the "needs P2P" gap.
    const settledGross = Math.min(seasonGross, rewards);
    rewards -= settledGross;
    const settle = seasonGross > 0 ? settledGross / seasonGross : 0;
    const settledFee = seasonFee * settle;
    const settledNet = settledGross - settledFee;
    floatPlayers += settledNet;
    treasury += settledFee;
    salesPaid += settledNet;
    const unpaid = seasonGross - settledGross;
    salesUnpaid += unpaid;
    if (unpaid > 0 && exhaustedAt === null) exhaustedAt = season;
    grossVolume += settledGross;
    feeHwd += settledFee;
    casualDump *= settle;
    exploiterDump *= settle;

    // Hall of Fame: entrants buy 25 HWD each from the AMM. Only the settled
    // share of entries can happen; a tenth of each settled fee is burned and
    // the rest stays with the podium, which then sells it.
    const entryWant = entries * HOF_ENTRY;
    const entryBuy = buyHwd(entryWant);
    const entryTake = entryBuy.take;
    floatPlayers += entryTake;
    const settledEntries = entryWant > 0 ? entries * (entryTake / entryWant) : 0;
    const hofBurn = settledEntries * HOF_BURN_PER_ENTRY;
    const burnable = Math.min(hofBurn, floatPlayers);
    floatPlayers -= burnable;
    pledged += burnable;
    hofEntriesTotal += settledEntries;
    // Prizes are already inside player float: they are the 22.5 that was not
    // burned out of each settled entry, and the winners sell them below.
    const prizeDump = settledEntries * HOF_PRIZE_PER_ENTRY;
    exploiterHofUsdt += entryBuy.cost * (entries > 0 ? exploiterEntries / entries : 0);

    // Everyone who earned cashes out first: casuals, exploiters, league winners.
    const insiderDump = insiderHeld * INSIDER_SELL_RATE;
    insiderHeld -= insiderDump;
    const casualSell = Math.min(casualDump, floatPlayers);
    floatPlayers -= casualSell;
    sellHwd(casualSell);
    const exploiterSell = Math.min(exploiterDump, floatPlayers);
    floatPlayers -= exploiterSell;
    exploiterUsdt += sellHwd(exploiterSell);
    const prizeSell = Math.min(prizeDump, floatPlayers);
    floatPlayers -= prizeSell;
    sellHwd(prizeSell);
    sellHwd(insiderDump);

    // Then spenders buy the HWD they need to build their club and spend it on CPU
    // listings; casuals spend what is left of their own earnings.
    const spenderBuy = buyHwd(spenderDemand);
    floatPlayers += spenderBuy.take;
    const playerSpend = Math.min(buyDemand, floatPlayers);
    floatPlayers -= playerSpend;
    cpuIdle += playerSpend;

    if (poolDrained && poolEmptyAt === null) poolEmptyAt = season;

    const price = Y / X;
    if (price > peakPrice) {
      peakPrice = price;
      peakSeason = season;
    }
    if (drainedAt === null && Y < POOL_USDT * 0.05) drainedAt = season;

    const supply = TOTAL_SUPPLY - pledged;
    const balance =
      X + rewards + locked + insiderHeld + floatPlayers + cpuIdle + treasury + pledged;
    if (Math.abs(balance - TOTAL_SUPPLY) > 1) {
      throw new Error(
        `season ${season} broke supply conservation: ${balance.toFixed(2)} vs ${TOTAL_SUPPLY}`,
      );
    }

    if (marks.has(season)) {
      snapshots.push({
        season,
        humans: humans.spender + humans.casual + humans.exploiter,
        accounts:
          humans.spender + humans.casual + humans.exploiter * scenario.accountsPerExploiter,
        price,
        poolHwd: X,
        poolUsdt: Y,
        circulating: floatPlayers,
        supply,
        rewardsLeft: rewards,
        locked,
        insiderHeld,
        cpuIdle,
        feeHwd,
        feeUsd: feeHwd * price,
        burned: pledged,
        hofEntries: hofEntriesTotal,
        salesPaid,
        salesUnpaid,
        grossVolume,
        starterGrants,
        usdtIn,
        usdtOut,
        exploiterUsdt,
        exploiterHofUsdt,
      });
    }
  }

  const last = snapshots[snapshots.length - 1];
  return {
    label: scenario.label,
    snapshots,
    peakPrice,
    peakSeason,
    drainedAt,
    exhaustedAt,
    poolEmptyAt,
    feeDumpValue: Y - k / (X + last.feeHwd),
    feeFaceValue: last.feeHwd * last.price,
  };
}

const runs = SCENARIOS.map(simulate);

console.log(
  `\nHWD macro simulation — ${SEASONS} seasons, +${INFLOW_EARLY} humans/30 seasons to season ${INFLOW_SHIFT}, then +${INFLOW_LATE}/30`,
);
console.log(`Token layout — fixed ${comma(TOTAL_SUPPLY)} HWD supply, nothing minted after launch`);
console.log(
  `  launch AMM: ${comma(POOL_HWD)} HWD / ${comma(POOL_USDT)} USDT — launch price $0.00002`,
);
console.log(
  `  locked ${comma(LOCKED_HWD)} HWD for ${LOCK_SEASONS} seasons: investors ${comma(
    INVESTOR_HWD,
  )} (25%) · rewards ${comma(REWARD_RESERVE)} (55%) · advisors ${comma(
    ADVISOR_HWD,
  )} (10%) · team ${comma(TEAM_HWD)} (10%)`,
);
console.log(
  `  insiders (${comma(INSIDER_HWD)}) vest over ${VEST_SEASONS} seasons after the lock and sell ${
    INSIDER_SELL_RATE * 100
  }% of their float a season; the rewards budget pays every in-game payout`,
);
console.log(
  `Hall of Fame: ${HOF_FIELD} seats × ${HOF_ENTRY} HWD = ${HOF_POOL_PER_BRACKET} pool · ${HOF_BURN_PER_BRACKET} burned (10%) · ${
    HOF_POOL_PER_BRACKET - HOF_BURN_PER_BRACKET
  } to the podium — 25 HWD to enter, the base league is free`,
);
console.log(
  `Marketplace: 5% fee (min ${MARKET_MIN_FEE} HWD) to the development fund; sale proceeds are paid from the rewards budget\n`,
);

for (const run of runs) {
  console.log(`=== ${run.label} ===`);
  console.log(
    [
      'season'.padEnd(7),
      'humans'.padStart(8),
      'accounts'.padStart(9),
      'price'.padStart(12),
      'poolUSDT'.padStart(9),
      'circul.'.padStart(9),
      'rewards'.padStart(9),
      'feeHWD'.padStart(10),
      'burned'.padStart(10),
    ].join(''),
  );
  for (const point of run.snapshots) {
    console.log(
      [
        String(point.season).padEnd(7),
        num(point.humans).padStart(8),
        num(point.accounts).padStart(9),
        priceText(point.price).padStart(12),
        usd(point.poolUsdt).padStart(9),
        num(point.circulating).padStart(9),
        num(point.rewardsLeft).padStart(9),
        num(point.feeHwd).padStart(10),
        num(point.burned).padStart(10),
      ].join(''),
    );
  }
  const last = run.snapshots[run.snapshots.length - 1];
  console.log(
    `peak price ${priceText(run.peakPrice)} at season ${run.peakSeason} · USDT pool under 5% ${
      run.drainedAt ? `at season ${run.drainedAt}` : 'never'
    } · rewards budget exhausted ${
      run.exhaustedAt ? `at season ${run.exhaustedAt}` : 'never'
    } · AMM HWD reserve hit its floor ${run.poolEmptyAt ? `at season ${run.poolEmptyAt}` : 'never'}`,
  );
  console.log(
    `lifetime: NFT volume ${num(last.grossVolume)} HWD · fees earned ${num(last.feeHwd)} HWD (${usd(
      run.feeFaceValue,
    )} at the end) · burned ${num(last.burned)} HWD from ${num(last.hofEntries)} paid league entries`,
  );
  console.log(
    `AMM: USDT in ${usd(last.usdtIn)} · USDT out ${usd(last.usdtOut)} · exploiters took ${usd(
      last.exploiterUsdt,
    )} after paying ${usd(last.exploiterHofUsdt)} into league entries · final price ${priceText(
      last.price,
    )}`,
  );
  console.log(
    `sales settled ${num(last.salesPaid)} HWD · sale proceeds the rewards budget could not pay: ${num(
      last.salesUnpaid,
    )} HWD`,
  );
  console.log(
    `treasury fee HWD is worth ${usd(run.feeDumpValue)} if dumped into the AMM at the end\n`,
  );
}

console.log('=== Headline answers (base scenario) ===');
const base = runs[0].snapshots;
const at = (season: number) => base.find((point) => point.season === season)!;
for (const season of [1000, 2000]) {
  const point = at(season);
  console.log(
    `season ${season}:`,
    `\n  marketplace fees earned: ${comma(point.feeHwd)} HWD (face value ${usd(point.feeUsd)})`,
    `\n  HWD burned (HOF): ${comma(point.burned)} HWD (${comma(
      point.hofEntries,
    )} paid entries · ${usd(point.burned * point.price)} at the time · ${(
      (point.burned / TOTAL_SUPPLY) *
      100
    ).toFixed(2)}% of supply)`,
    `\n  supply: ${comma(point.supply)} HWD · circulating ${comma(
      point.circulating,
    )} HWD · pool ${comma(point.poolHwd)} HWD / ${usd(point.poolUsdt)} · price ${priceText(
      point.price,
    )}`,
    `\n  rewards budget left: ${comma(point.rewardsLeft)} HWD · insider tokens still locked ${comma(
      point.locked,
    )} HWD · CPU-held ${comma(point.cpuIdle)} HWD`,
    `\n  sale proceeds paid by the rewards budget: ${comma(
      point.salesPaid,
    )} HWD · unpaid because the budget ran dry: ${comma(point.salesUnpaid)} HWD`,
    `\n  exploiters cashed out: ${usd(point.exploiterUsdt)} after buying ${usd(
      point.exploiterHofUsdt,
    )} of league entries`,
  );
}

const last = base[base.length - 1];
console.log(
  `\nLifetime: ${comma(last.feeHwd)} HWD of fees = ${(
    (last.feeHwd / TOTAL_SUPPLY) *
    100
  ).toFixed(2)}% of the fixed supply; ${comma(last.burned)} HWD burned = ${(
    (last.burned / TOTAL_SUPPLY) *
    100
  ).toFixed(2)}% of supply.`,
);
console.log(
  `Treasury: ${comma(last.feeHwd)} HWD of fee revenue is worth ${usd(
    runs[0].feeDumpValue,
  )} if sold into the AMM, or ${usd(runs[0].feeFaceValue)} at the final price.`,
);
console.log(
  `Rewards budget: ${comma(REWARD_RESERVE)} HWD paid ${comma(
    last.salesPaid,
  )} HWD of seller proceeds and ${comma(last.starterGrants)} HWD of starter balances across 2,000 seasons; ${
    last.salesUnpaid > 0
      ? `${comma(last.salesUnpaid)} HWD of sales could not be paid at all`
      : 'every sale settled'
  }.`,
);
console.log(
  `Burn runway: at season 2,000 the paid league burns about ${num(
    (last.burned - (at(1500)?.burned ?? 0)) / 500,
  )} HWD per season — roughly ${usd(
    ((last.burned - (at(1500)?.burned ?? 0)) / 500) * last.price,
  )} a season at the final price.`,
);

console.log('\n=== Scenarios at a glance ===');
for (const run of runs) {
  console.log(run.label);
  for (const season of [1000, 2000]) {
    const point = run.snapshots.find((entry) => entry.season === season)!;
    console.log(
      `  season ${season}: ${num(point.accounts)} accounts · price ${priceText(
        point.price,
      )} · fees ${num(point.feeHwd)} HWD (${usd(point.feeUsd)}) · burned ${num(
        point.burned,
      )} HWD · rewards left ${num(point.rewardsLeft)} HWD · unpaid sales ${num(
        point.salesUnpaid,
      )} HWD · exploiters ${usd(point.exploiterUsdt)}`,
    );
  }
}
