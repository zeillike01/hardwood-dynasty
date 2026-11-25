import type { GameState, Series } from '../game/types';
import { championOf, conferenceRank, standingsOf } from '../game/engine';
import { PLAYOFF_ENTRY_FEE, TITLE_CASH_PRIZE } from '../game/data';
import { TeamMark } from '../components/ui';

function SeriesCard({ state, series }: { state: GameState; series: Series }) {
  const high = state.teams[series.high];
  const low = state.teams[series.low];
  const need = series.round === 3 ? 3 : 2;

  return (
    <div className={`series card${series.winner ? ' done' : ''}`}>
      <div className="series-label">{series.label}</div>
      <div className={`series-row${series.winner === high.id ? ' winner' : ''}`}>
        <TeamMark team={high} size={26} />
        <span className="series-name">
          <span className="series-seed">#{conferenceRank(state, high.id)}</span> {high.abbr}{' '}
          <span className="muted small">{high.city}</span>
        </span>
        <strong>{series.highWins}</strong>
      </div>
      <div className={`series-row${series.winner === low.id ? ' winner' : ''}`}>
        <TeamMark team={low} size={26} />
        <span className="series-name">
          <span className="series-seed">#{conferenceRank(state, low.id)}</span> {low.abbr}{' '}
          <span className="muted small">{low.city}</span>
        </span>
        <strong>{series.lowWins}</strong>
      </div>
      <div className="series-games">
        {series.games.map((game, index) => (
          <span key={index} className={game.homeScore > game.awayScore ? 'g-home' : 'g-away'}>
            {game.homeScore}–{game.awayScore}
          </span>
        ))}
        {!series.winner && <span className="muted">first to {need}</span>}
      </div>
    </div>
  );
}

export function PlayoffsView({
  state,
  onSimGame,
  onSimPlayoffs,
  onBeginOffseason,
}: {
  state: GameState;
  onSimGame: () => void;
  onSimPlayoffs: () => void;
  onBeginOffseason: () => void;
}) {
  if (state.phase === 'regular') {
    const east = standingsOf(state, 'East').slice(0, 4);
    const west = standingsOf(state, 'West').slice(0, 4);
    return (
      <section className="card">
        <div className="card-head">
          <h2>Playoff picture</h2>
          <span className="muted small">
            Top four per conference qualify · ${PLAYOFF_ENTRY_FEE.toFixed(1)}M entry fee · $
            {TITLE_CASH_PRIZE.toFixed(1)}M title prize
          </span>
        </div>
        <div className="bracket-preview">
          {[
            { conf: 'East', teams: east },
            { conf: 'West', teams: west },
          ].map(({ conf, teams }) => (
            <div key={conf}>
              <div className="eyebrow">{conf}</div>
              <ol className="seed-list">
                {teams.map((team, index) => (
                  <li key={team.id} className={team.id === state.userTeamId ? 'mine' : ''}>
                    <span className="seed">{index + 1}</span>
                    <span className="team-dot" style={{ background: team.color }} />
                    {team.city} {team.name}
                    <span className="muted small">
                      {team.wins}–{team.losses}
                    </span>
                  </li>
                ))}
                {teams.length === 0 && <li className="muted">Season in progress</li>}
              </ol>
            </div>
          ))}
        </div>
        <p className="muted">Finish the regular season to lock in the bracket.</p>
      </section>
    );
  }

  if (state.phase === 'offseason') {
    const champ = championOf(state);
    return (
      <section className="card">
        <div className="card-head">
          <h2>Season {state.season} complete</h2>
        </div>
        {champ && (
          <p>
            <strong>{state.teams[champ].city} {state.teams[champ].name}</strong> won the championship.
          </p>
        )}
        <button className="btn primary" onClick={onBeginOffseason}>
          Go to offseason
        </button>
      </section>
    );
  }

  const champion = championOf(state);
  const rounds = [1, 2, 3];
  const busy = state.playoffRound >= 3 && Boolean(champion);

  return (
    <div className="playoffs">
      <div className="playoff-actions">
        <div>
          <h2>Playoffs</h2>
          <p className="muted small">
            {champion
              ? 'The bracket is complete.'
              : `Round ${state.playoffRound} · best of ${state.playoffRound === 3 ? 5 : 3} · $${PLAYOFF_ENTRY_FEE.toFixed(1)}M entry paid · $${TITLE_CASH_PRIZE.toFixed(1)}M title prize`}
          </p>
        </div>
        <div className="btn-row">
          {!champion && (
            <>
              <button className="btn primary" onClick={onSimGame}>
                Sim next game
              </button>
              <button className="btn ghost" onClick={onSimPlayoffs}>
                Sim playoffs
              </button>
            </>
          )}
          {champion && (
            <button className="btn primary" onClick={onBeginOffseason}>
              Go to offseason
            </button>
          )}
        </div>
      </div>

      {champion && (
        <div className="champion card" style={{ borderColor: state.teams[champion].color }}>
          <span className="eyebrow">Champions</span>
          <h2>
            {state.teams[champion].city} {state.teams[champion].name}
          </h2>
          <span className="muted">Season {state.season} title winners</span>
        </div>
      )}

      {!busy || champion ? null : null}

      <div className="bracket">
        {rounds.map((round) => {
          const series = state.playoffs.filter((s) => s.round === round);
          if (!series.length) return null;
          return (
            <div className="bracket-round" key={round}>
              <div className="eyebrow">
                {round === 1 ? 'First Round' : round === 2 ? 'Conference Finals' : 'League Finals'}
              </div>
              {series.map((s) => (
                <SeriesCard key={s.id} state={state} series={s} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
