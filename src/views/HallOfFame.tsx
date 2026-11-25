import type { GameState, HofPlacement, HofSeries } from '../game/types';
import { ROSTER_MIN } from '../game/data';
import { HWD_LEAGUE_ENTRY_FEE, hwdBalance } from '../game/market';
import { rosterOf } from '../game/engine';
import {
  HOF_FIELD_SIZE,
  HOF_PRIZES,
  HOF_REWARD_ODDS,
  HOF_SERIES_WINS,
  HOF_TOTAL_BURN,
  HOF_TOTAL_PAYOUT,
  HOF_TOTAL_POOL,
  enterHallOfFameLeague,
} from '../game/hof';
import { TierBadge } from '../components/ui';

export function HallOfFameView({
  state,
  onState,
  notify,
  onSimGame,
  onSimBracket,
}: {
  state: GameState;
  onState: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
  onSimGame: () => void;
  onSimBracket: () => void;
}) {
  const balance = hwdBalance(state);
  const myHof = state.hof && state.hof.season === state.season ? state.hof : null;
  const roster = rosterOf(state, state.userTeamId);
  const ready = balance >= HWD_LEAGUE_ENTRY_FEE && roster.length >= ROSTER_MIN && !myHof;
  const champion = myHof?.champion ? state.teams[myHof.champion] : null;
  const reward = myHof?.rewardPlayerId ? state.players[myHof.rewardPlayerId] : null;
  const odds = HOF_REWARD_ODDS.map(
    (entry) => `${entry.label} ${(entry.chance * 100).toFixed(1).replace(/\.0$/, '')}%`,
  ).join(' · ');
  const seedOf = (id: string) => (myHof ? myHof.seeds.indexOf(id) + 1 : 0);
  const abbrOf = (id: string) => state.teams[id]?.abbr ?? id;
  const placementLabel = (placement: HofPlacement) =>
    placement === 'champion'
      ? 'champions'
      : placement === 'runner-up'
        ? 'runners-up'
        : placement === 'third'
          ? 'third'
          : 'outside the prizes';
  const nextSeries = myHof
    ? (myHof.series.find((entry) => !entry.winner) ??
      (myHof.third && !myHof.third.winner ? myHof.third : null))
    : null;

  const enter = () => {
    const result = enterHallOfFameLeague(state);
    if (result.error || !result.state) {
      notify(result.error ?? 'The league could not be entered.', false);
      return;
    }
    onState(result.state);
    notify(
      `Hall of Fame bracket opened: ${HWD_LEAGUE_ENTRY_FEE} HWD paid. Play it game by game.`,
      true,
    );
  };

  const matchCard = (match: HofSeries) => (
    <div className="hof-match" key={`${match.round}-${match.high}-${match.low}`}>
      {[match.high, match.low].map((id) => (
        <div
          key={id}
          className={`hof-side${id === state.userTeamId ? ' me' : ''}${
            match.winner === id ? ' win' : ''
          }`}
        >
          <span className="hof-seed">{seedOf(id)}</span>
          <span className="hof-abbr">{abbrOf(id)}</span>
          <span className="hof-wins">{id === match.high ? match.highWins : match.lowWins}</span>
        </div>
      ))}
      <div className="hof-games muted small">
        {match.games.map((game) => `${game.homeScore}–${game.awayScore}`).join(' · ')}
      </div>
    </div>
  );

  const totalRounds = myHof ? (myHof.seeds.length > 8 ? 4 : 3) : 0;
  const rounds = myHof?.series.length
    ? Array.from(
        { length: Math.max(...myHof.series.map((match) => match.round)) },
        (_, index) => index + 1,
      )
    : [];

  return (
    <div className="hof-view">
      <section className="card">
        <div className="card-head">
          <div>
            <span className="eyebrow">Hall of Fame league</span>
            <h2>
              {HOF_FIELD_SIZE} managers · {HWD_LEAGUE_ENTRY_FEE} HWD entry
            </h2>
            <p className="muted small">
              Matchmaking: you plus the nine rival managers whose best eight players are closest to
              your own eight-man rating, seeded by that rating in a single-elimination bracket of
              best-of-{HOF_SERIES_WINS * 2 - 1} series with a play-in round and a third-place game.
              Games are played one at a time, like the playoffs. You compete with the club you
              enter with: no signings, market buys, training, skill academy purchases or fusions
              until the bracket settles. Selling, waiving and buyouts stay open, because they only
              weaken you. A full bracket
              puts {HOF_TOTAL_POOL} HWD in the pool; ten percent (
              {HOF_TOTAL_BURN} HWD) is burned and the other {HOF_TOTAL_PAYOUT} pays the podium —{' '}
              {HOF_PRIZES.champion} to the champion, {HOF_PRIZES['runner-up']} to the runner-up and{' '}
              {HOF_PRIZES.third} to third place. The champion also draws one player NFT: {odds}.
            </p>
          </div>
          <div className="hof-actions">
            {ready && (
              <button className="btn" onClick={enter}>
                Enter league — {HWD_LEAGUE_ENTRY_FEE} HWD
              </button>
            )}
            {!myHof && !ready && (
              <span className="muted small">
                {balance < HWD_LEAGUE_ENTRY_FEE
                  ? `You need ${HWD_LEAGUE_ENTRY_FEE - balance} more HWD to enter.`
                  : `You need ${ROSTER_MIN} players under contract to enter.`}
              </span>
            )}
            {myHof && !myHof.champion && (
              <>
                <button className="btn small" onClick={onSimGame}>
                  Sim next game
                </button>
                <button className="btn ghost small" onClick={onSimBracket}>
                  Sim bracket
                </button>
              </>
            )}
          </div>
        </div>

        {myHof && (
          <div className="hof-board">
            <div className="hof-summary">
              <span className="eyebrow">
                {myHof.champion ? `Season ${myHof.season} result` : `Season ${myHof.season} bracket`}
              </span>
              <strong>
                {champion
                  ? `${champion.city} ${champion.name}${
                      myHof.champion === state.userTeamId ? ' (you)' : ''
                    } won`
                  : 'Bracket in progress'}
              </strong>
              <span className="muted small">
                {myHof.champion
                  ? myHof.userPlacement === 'out'
                    ? 'You finished outside the prizes.'
                    : `You finished ${placementLabel(myHof.userPlacement)}: +${myHof.prize} HWD`
                  : nextSeries
                    ? `${nextSeries === myHof.third ? 'Third place: ' : 'Next game: '}${abbrOf(
                        nextSeries.high,
                      )} vs ${abbrOf(nextSeries.low)} · Game ${nextSeries.games.length + 1}`
                    : 'Bracket is set — press Sim next game to open the play-in.'}
              </span>
              {!myHof.champion && (
                <span className="muted small">
                  No player can be added or improved until the bracket settles. Play it out here —
                  an unplayed bracket settles on its own when the season ends.
                </span>
              )}
              {reward && (
                <span className="hof-inductee">
                  <TierBadge tier={reward.tier} />
                  {reward.name} · {reward.overall} OVR · {reward.pos} · champion NFT
                  {reward.teamId === null ? ' · stored in your collection' : ''}
                </span>
              )}
            </div>
            <div className="hof-rounds">
              {rounds.length === 0 && (
                <p className="muted small">The bracket fills in as the play-in is played.</p>
              )}
              {rounds.map((round) => {
                const last = round === totalRounds;
                return (
                  <div className="hof-round" key={round}>
                    <span className="eyebrow">
                      {last
                        ? 'Final'
                        : round === totalRounds - 1
                          ? 'Semifinals'
                          : round === 1 && totalRounds > 3
                            ? 'Play-in'
                            : 'Quarterfinals'}
                    </span>
                    {myHof.series
                      .filter((match) => match.round === round)
                      .map((match) => matchCard(match))}
                    {last && myHof.third && (
                      <>
                        <span className="eyebrow">Third place</span>
                        {matchCard(myHof.third)}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
