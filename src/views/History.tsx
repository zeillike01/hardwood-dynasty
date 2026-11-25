import type { GameState, Player } from '../game/types';
import { rosterOf, userTeam } from '../game/engine';
import { TeamMark } from '../components/ui';

function careerTotal(player: Player, key: 'pts' | 'reb' | 'ast'): number {
  return player.career?.[key] ?? 0;
}

function Leaders({
  state,
  stat,
  label,
  onOpenPlayer,
}: {
  state: GameState;
  stat: 'pts' | 'reb' | 'ast';
  label: string;
  onOpenPlayer: (id: string) => void;
}) {
  const leaders = Object.values(state.players)
    .filter((player) => careerTotal(player, stat) > 0)
    .sort((a, b) => careerTotal(b, stat) - careerTotal(a, stat))
    .slice(0, 10);
  return (
    <div className="record-column">
      <div className="eyebrow">{label}</div>
      {leaders.length === 0 && <p className="muted small">No completed seasons yet.</p>}
      <ol className="record-list">
        {leaders.map((player, index) => (
          <li key={player.id}>
            <span className="record-rank">{index + 1}</span>
            <button className="link-btn" onClick={() => onOpenPlayer(player.id)}>
              {player.name}
            </button>
            <span className="record-team">{player.teamId ? state.teams[player.teamId]?.abbr : 'FA'}</span>
            <strong>{careerTotal(player, stat)}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HistoryView({
  state,
  onOpenPlayer,
}: {
  state: GameState;
  onOpenPlayer: (id: string) => void;
}) {
  const team = userTeam(state);
  const history = [...(state.history ?? [])].reverse();
  const titles = history.filter((record) => record.champion === team.id).length;
  const finals = history.filter(
    (record) => record.champion === team.id || record.runnerUp === team.id,
  ).length;
  const banners = history.filter((record) => record.champion);

  const playerName = (id: string | null) => (id ? state.players[id]?.name ?? '—' : '—');

  return (
    <div className="history">
      <section className="card history-hero">
        <div>
          <div className="eyebrow">Franchise record</div>
          <h1>
            {team.city} {team.name}
          </h1>
          <p className="muted">
            {titles === 0
              ? 'No banners yet. The record book is waiting for its first dynasty.'
              : `${titles} title${titles === 1 ? '' : 's'} and ${finals} Finals appearance${
                  finals === 1 ? '' : 's'
                } in ${history.length} completed season${history.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <div className="recap-stats">
          <div>
            <span className="eyebrow">Titles</span>
            <strong>{titles}</strong>
          </div>
          <div>
            <span className="eyebrow">Seasons</span>
            <strong>{history.length}</strong>
          </div>
          <div>
            <span className="eyebrow">Roster</span>
            <strong>{rosterOf(state, team.id).length}</strong>
          </div>
        </div>
      </section>

      {banners.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Championship banners</h3>
          </div>
          <div className="banner-row">
            {banners.map((record) => {
              const champ = state.teams[record.champion];
              return (
                <div className="banner" key={`banner-${record.season}`} style={{ borderColor: champ.color }}>
                  <span className="eyebrow">Season {record.season}</span>
                  <strong>
                    {champ.city} {champ.name}
                  </strong>
                  <span className="muted small">
                    {record.mvpId ? `MVP ${playerName(record.mvpId)}` : 'Champions'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Season by season</h3>
          <span className="muted small">Newest first</span>
        </div>
        {history.length === 0 ? (
          <p className="muted">Finish a season to start the record book.</p>
        ) : (
          <div className="table-scroll">
            <table className="table compact history-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th className="left">Champion</th>
                  <th>Record</th>
                  <th className="left">Your finish</th>
                  <th className="left">MVP</th>
                  <th className="left">DPOY</th>
                  <th className="left">ROY</th>
                  <th className="left">Finals MVP</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => {
                  const champion = state.teams[record.champion];
                  return (
                    <tr key={record.season}>
                      <td>{record.season}</td>
                      <td className="left">
                        {champion && <TeamMark team={champion} size={20} />}{' '}
                        {champion ? champion.abbr : '—'}
                      </td>
                      <td>
                        {record.userWins}–{record.userLosses}
                      </td>
                      <td className="left">{record.userResult}</td>
                      <td className="left">{playerName(record.mvpId)}</td>
                      <td className="left">{playerName(record.dpoyId)}</td>
                      <td className="left">{playerName(record.royId)}</td>
                      <td className="left">{playerName(record.finalsMvpId ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>All-time leaders</h3>
          <span className="muted small">Career totals</span>
        </div>
        <div className="record-grid">
          <Leaders state={state} stat="pts" label="Points" onOpenPlayer={onOpenPlayer} />
          <Leaders state={state} stat="reb" label="Rebounds" onOpenPlayer={onOpenPlayer} />
          <Leaders state={state} stat="ast" label="Assists" onOpenPlayer={onOpenPlayer} />
        </div>
      </section>
    </div>
  );
}
