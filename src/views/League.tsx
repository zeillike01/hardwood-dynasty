import type { Conf, GameState } from '../game/types';
import { recordPct } from '../components/ui';
import { apg, ppg, rpg, userGames, userTeam } from '../game/engine';

export function LeagueView({
  state,
  onOpenBox,
  onOpenTeam,
  onOpenPlayer,
}: {
  state: GameState;
  onOpenBox: (gameId: string) => void;
  onOpenTeam: (teamId: string) => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const conferences: Conf[] = ['East', 'West'];
  const team = userTeam(state);
  const schedule = userGames(state).sort((a, b) => a.round - b.round);
  const leaders = Object.values(state.players)
    .filter((player) => player.stats.gp >= 5)
    .sort((a, b) => ppg(b) - ppg(a))
    .slice(0, 8);
  const injured = Object.values(state.players)
    .filter((player) => player.teamId && player.injuryGames > 0)
    .sort((a, b) => b.injuryGames - a.injuryGames)
    .slice(0, 10);
  const power = Object.values(state.teams)
    .map((row) => {
      const roster = Object.values(state.players).filter((p) => p.teamId === row.id);
      const ovr = roster.length
        ? roster.reduce((sum, p) => sum + p.overall, 0) / roster.length
        : 0;
      const games = row.wins + row.losses;
      const winPct = games ? row.wins / games : 0;
      return {
        team: row,
        score: winPct * 100 + (row.ptsFor - row.ptsAgainst) * 0.4 + ovr * 0.8,
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <div className="league-layout">
      <div className="standings-columns">
        {conferences.map((conf) => {
          const teams = Object.values(state.teams)
            .filter((t) => t.conference === conf)
            .sort((a, b) => b.wins - a.wins || b.ptsFor - b.ptsAgainst - (a.ptsFor - a.ptsAgainst));
          return (
            <section className="card" key={conf}>
              <div className="card-head">
                <h3>{conf} Conference</h3>
              </div>
              <div className="table-scroll">
              <table className="table standings">
                <thead>
                  <tr>
                    <th className="left">Team</th>
                    <th>W</th>
                    <th>L</th>
                    <th>PCT</th>
                    <th>DIFF</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((row, index) => (
                    <tr
                      key={row.id}
                      className={`clickable${row.id === state.userTeamId ? ' mine' : ''}`}
                      onClick={() => onOpenTeam(row.id)}
                      title={`Open ${row.city} ${row.name}`}
                    >
                      <td className="left">
                        <span className="seed">{index + 1}</span>
                        <span className="team-dot" style={{ background: row.color }} />
                        {row.city} {row.name}
                      </td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{recordPct(row.wins, row.losses)}</td>
                      <td className={row.ptsFor - row.ptsAgainst >= 0 ? 'up' : 'down'}>
                        {row.ptsFor - row.ptsAgainst >= 0 ? '+' : ''}
                        {row.ptsFor - row.ptsAgainst}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <h3>{team.abbr} schedule</h3>
          <span className="muted small">21-game season</span>
        </div>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Rd</th>
              <th className="left">Opponent</th>
              <th>Loc</th>
              <th>Result</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((game) => {
              const isHome = game.home === team.id;
              const opp = state.teams[isHome ? game.away : game.home];
              const won = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
              return (
                <tr key={game.id} className={game.played ? '' : 'muted-row'}>
                  <td>{game.round + 1}</td>
                  <td className="left">
                    <span className="team-dot" style={{ background: opp.color }} />
                    {opp.city} {opp.name}
                  </td>
                  <td>{isHome ? 'H' : 'A'}</td>
                  <td>
                    {game.played ? (
                      <span className={`result-pill ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {game.played ? (
                      <button className="link-btn" onClick={() => onOpenBox(game.id)}>
                        {isHome ? game.homeScore : game.awayScore}–
                        {isHome ? game.awayScore : game.homeScore}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Power rankings</h3>
          <span className="muted small">Record, point diff and talent</span>
        </div>
        <ol className="power-list">
          {power.map((entry, index) => (
            <li key={entry.team.id}>
              <span className="seed">{index + 1}</span>
              <span className="team-dot" style={{ background: entry.team.color }} />
              <button className="link-btn" onClick={() => onOpenTeam(entry.team.id)}>
                {entry.team.city} {entry.team.name}
              </button>
              <span className="muted small">
                {entry.team.wins}–{entry.team.losses}
              </span>
              <strong>{Math.round(entry.score)}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>League leaders</h3>
          <span className="muted small">Points per game</span>
        </div>
        <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th className="left">Player</th>
              <th>Team</th>
              <th>PPG</th>
              <th>RPG</th>
              <th>APG</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((player) => (
              <tr key={player.id} className="clickable" onClick={() => onOpenPlayer(player.id)}>
                <td className="left">
                  <span className="pos-dot">{player.pos}</span>
                  {player.name}
                </td>
                <td>{player.teamId ? state.teams[player.teamId]?.abbr : 'FA'}</td>
                <td>{ppg(player).toFixed(1)}</td>
                <td>{rpg(player).toFixed(1)}</td>
                <td>{apg(player).toFixed(1)}</td>
              </tr>
            ))}
            {leaders.length === 0 && (
              <tr>
                <td className="left muted" colSpan={5}>
                  Stats appear after a few games.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>League injury report</h3>
          <span className="muted small">{injured.length} out</span>
        </div>
        {injured.length === 0 ? (
          <p className="muted">Every roster is healthy.</p>
        ) : (
          <ul className="injury-league-list">
            {injured.map((player) => (
              <li key={player.id}>
                <button className="link-btn" onClick={() => onOpenPlayer(player.id)}>
                  {player.name}
                </button>
                <span className="muted small">
                  {player.teamId ? state.teams[player.teamId]?.abbr : 'FA'} · {player.injury}
                </span>
                <strong className="down">{player.injuryGames}g</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
