import { useState } from 'react';
import type { GameState } from '../game/types';
import {
  buyMarketPlayer,
  capSpaceOf,
  convertHwdToTrainingPoints,
  hofRosterLocked,
  rosterOf,
  sellPlayerToMarket,
} from '../game/engine';
import {
  HWD_TP_DAILY_CAP,
  HWD_TP_MIN,
  HWD_TP_RATE,
  HWD_TP_SEASON_CAP,
  MARKET_FEE_RATE,
  canListOnMarket,
  clubHwdBalance,
  devFundBalance,
  hwdBalance,
  hwdTpQuote,
  hwdTpRemaining,
  hwdTpRemainingToday,
  hwdTpSpent,
  marketBlockReason,
  marketFee,
  marketValue,
  openListings,
} from '../game/market';
import { ROSTER_MAX } from '../game/data';
import { money, TierBadge } from '../components/ui';

export function MarketView({
  state,
  onState,
  notify,
  onOpenPlayer,
}: {
  state: GameState;
  onState: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [asks, setAsks] = useState<Record<string, number>>({});
  const [convertHwd, setConvertHwd] = useState(HWD_TP_MIN);
  const balance = hwdBalance(state);
  const devFund = devFundBalance(state);
  const rivalHwd = Object.keys(state.teams)
    .filter((id) => id !== state.userTeamId)
    .reduce((sum, id) => sum + clubHwdBalance(state, id), 0);
  const listings = openListings(state);
  const roster = rosterOf(state, state.userTeamId).sort((a, b) => b.overall - a.overall);
  const rosterFull = roster.length >= ROSTER_MAX;
  const capSpace = capSpaceOf(state, state.userTeamId);
  const feePercent = Math.round(MARKET_FEE_RATE * 100);
  const tpRemaining = hwdTpRemaining(state);
  const todayRemaining = hwdTpRemainingToday(state);
  const convertMax = Math.min(tpRemaining, todayRemaining, balance);
  const wanted = Number.isFinite(convertHwd) ? Math.floor(convertHwd) : 0;
  const convertAmount = Math.min(Math.max(0, wanted), Math.max(0, convertMax));
  const quote = hwdTpQuote(convertAmount);
  const deskLocked = hofRosterLocked(state);
  const convert = () => {
    if (convertAmount < HWD_TP_MIN) {
      notify(`You need at least ${HWD_TP_MIN} convertible HWD this season.`, false);
      return;
    }
    if (
      !window.confirm(
        `Convert ${convertAmount} HWD into ${quote.tp} training points?`,
      )
    ) {
      return;
    }
    const result = convertHwdToTrainingPoints(state, convertAmount);
    if (result.error || !result.state) {
      notify(result.error ?? 'That conversion could not be completed.', false);
      return;
    }
    onState(result.state);
    notify(`Converted ${convertAmount} HWD into ${quote.tp} training points.`, true);
  };
  const sell = (id: string) => {
    const player = state.players[id];
    const ask = Math.max(1, Math.round(asks[id] ?? marketValue(player)));
    if (
      !window.confirm(
        `Sell ${player.name} for ${ask} HWD? ${marketFee(ask)} HWD goes to the development fund as the marketplace fee and he leaves your roster.`,
      )
    ) {
      return;
    }
    const result = sellPlayerToMarket(state, id, ask);
    if (result.error || !result.state) {
      notify(result.error ?? 'That sale could not be completed.', false);
      return;
    }
    onState(result.state);
    notify(`Sold ${player.name} for ${ask} HWD (${marketFee(ask)} to the development fund).`, true);
  };

  const buy = (listingId: string) => {
    const listing = listings.find((entry) => entry.id === listingId);
    const player = listing ? state.players[listing.playerId] : null;
    const result = buyMarketPlayer(state, listingId);
    if (result.error || !result.state) {
      notify(result.error ?? 'That signing could not be completed.', false);
      return;
    }
    onState(result.state);
    notify(
      `Signed ${player?.name ?? 'the player'} for ${listing?.price ?? 0} HWD.`,
      true,
    );
  };

  return (
    <div className="market-grid">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>HWD marketplace</h2>
            <p className="muted small">
              Player NFTs trade for HWD tokens, a currency of their own: cash still pays salaries,
              buyouts and the front office. Sales are peer-to-peer — the buying club pays from the
              HWD it holds, the seller receives the price net of the {feePercent}% marketplace fee,
              and that fee goes to the development fund. Rookies are soulbound until their rookie
              deal ends, and accounts need six completed seasons before they can sell.
            </p>
          </div>
        </div>

        <div className="market-stats">
          <div className="stat-tile card">
            <span className="eyebrow">HWD balance</span>
            <strong>{balance} HWD</strong>
            <span className="muted small">Marketplace currency</span>
          </div>
          <div className="stat-tile card">
            <span className="eyebrow">Rival buyers</span>
            <strong>{rivalHwd} HWD</strong>
            <span className="muted small">Held by the {Object.keys(state.teams).length - 1} rival managers</span>
          </div>
          <div className="stat-tile card">
            <span className="eyebrow">Listings</span>
            <strong>{listings.length}</strong>
            <span className="muted small">Players available right now</span>
          </div>
          <div className="stat-tile card">
            <span className="eyebrow">Development fund</span>
            <strong>{devFund} HWD</strong>
            <span className="muted small">Sale and fusion fees</span>
          </div>
          <div className="stat-tile card">
            <span className="eyebrow">Sale fee</span>
            <strong>{feePercent}%</strong>
            <span className="muted small">Paid to the development fund</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Convert HWD to training points</h2>
            <p className="muted small">
              The league desk buys HWD back at {HWD_TP_RATE} training points per token, with no
              fee. The desk takes at most {HWD_TP_DAILY_CAP} HWD a day and {HWD_TP_SEASON_CAP} HWD
              a season: you have converted {hwdTpSpent(state)} of {HWD_TP_SEASON_CAP} HWD this
              season, so {tpRemaining} HWD can still be sold ({todayRemaining} today).
            </p>
          </div>
        </div>
        <div className="hwd-convert">
          <input
            className="market-ask"
            type="number"
            min={HWD_TP_MIN}
            max={Math.max(0, convertMax)}
            step={1}
            value={convertHwd}
            aria-label="HWD to convert into training points"
            onChange={(event) => setConvertHwd(Number(event.target.value))}
          />
          <span className="muted small">
            {convertAmount} HWD → <strong>{quote.tp} TP</strong>
          </span>
          <button
            className="btn small"
            disabled={deskLocked || convertAmount < HWD_TP_MIN}
            title={
              deskLocked
                ? 'The desk is closed until the Hall of Fame bracket finishes'
                : convertMax < HWD_TP_MIN
                  ? `You need at least ${HWD_TP_MIN} convertible HWD (${todayRemaining} left today, ${tpRemaining} this season)`
                  : `Convert ${convertAmount} HWD into ${quote.tp} training points`
            }
            onClick={convert}
          >
            Convert
          </button>
        </div>
        {deskLocked && (
          <p className="muted small">
            The desk is closed until your Hall of Fame bracket finishes.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Buy players</h2>
            <p className="muted small">
              {money(capSpace)} in cap space · {roster.length}/{ROSTER_MAX} players. Your HWD goes
              straight to the selling club; only the {feePercent}% fee is withheld for development.
              Rival clubs clear any listing still on the board when the next season opens, so buy
              what you want before then.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
          <thead>
            <tr>
              <th className="left">Player</th>
              <th>Tier</th>
              <th>Age</th>
              <th>OVR</th>
              <th>POT</th>
              <th>Salary</th>
              <th>Seller</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => {
              const player = state.players[listing.playerId];
              const seller = state.teams[listing.sellerTeamId];
              const short = player.salary > capSpace;
              const reason =
                balance < listing.price
                  ? `You need ${listing.price - balance} more HWD`
                  : rosterFull
                    ? 'Roster is full'
                    : short
                      ? 'Not enough cap space'
                      : `Buy ${player.name} for ${listing.price} HWD`;
              return (
                <tr key={listing.id}>
                  <td
                    className="left clickable"
                    title={`View ${player.name}'s ratings`}
                    onClick={() => onOpenPlayer(player.id)}
                  >
                    <strong>{player.name}</strong>{' '}
                    <span className="pos-dot">{player.pos}</span>
                  </td>
                  <td>
                    <TierBadge tier={player.tier} />
                  </td>
                  <td>{player.age}</td>
                  <td>{player.overall}</td>
                  <td className="muted">{player.potential}</td>
                  <td>{money(player.salary)}</td>
                  <td className="muted">{seller?.abbr ?? '—'}</td>
                  <td>
                    <strong>{listing.price} HWD</strong>
                  </td>
                  <td>
                    <button
                      className="btn small"
                      disabled={balance < listing.price || rosterFull || short}
                      title={reason}
                      onClick={() => buy(listing.id)}
                    >
                      Buy
                    </button>
                  </td>
                </tr>
              );
            })}
            {listings.length === 0 && (
              <tr>
                <td className="left muted" colSpan={9}>
                  Every player on the market has been sold. New listings open next season.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Sell players</h2>
            <p className="muted small">
              Name your own ask, but rivals buy with their heads: a club only pays up to about a
              quarter over the valuation, and only if he would crack its rotation. It also has to
              hold that HWD and fit his contract under its cap; you receive the price net of the
              {feePercent}% fee. Make sure you can spare him.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
          <thead>
            <tr>
              <th className="left">Player</th>
              <th>Tier</th>
              <th>Age</th>
              <th>OVR</th>
              <th>Salary</th>
              <th>Valuation</th>
              <th>Your ask</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roster.map((player) => {
              const eligibility = canListOnMarket(state, player.id);
              const value = marketValue(player);
              const ask = Math.max(1, Math.round(asks[player.id] ?? value));
              const reason = eligibility.eligible
                ? `Sell ${player.name} for ${ask} HWD`
                : marketBlockReason(eligibility.reasons);
              return (
                <tr key={player.id}>
                  <td
                    className="left clickable"
                    title={`View ${player.name}'s ratings`}
                    onClick={() => onOpenPlayer(player.id)}
                  >
                    <strong>{player.name}</strong>{' '}
                    <span className="pos-dot">{player.pos}</span>
                  </td>
                  <td>
                    <TierBadge tier={player.tier} />
                  </td>
                  <td>{player.age}</td>
                  <td>{player.overall}</td>
                  <td>{money(player.salary)}</td>
                  <td className="muted">{value} HWD</td>
                  <td>
                    <input
                      className="market-ask"
                      type="number"
                      min={1}
                      value={ask}
                      aria-label={`Asking price for ${player.name}`}
                      disabled={!eligibility.eligible}
                      onChange={(event) =>
                        setAsks((current) => ({
                          ...current,
                          [player.id]: Number(event.target.value),
                        }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="btn small"
                      disabled={!eligibility.eligible || roster.length <= 8}
                      title={
                        roster.length <= 8
                          ? 'You must keep at least eight players'
                          : reason
                      }
                      onClick={() => sell(player.id)}
                    >
                      Sell
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
