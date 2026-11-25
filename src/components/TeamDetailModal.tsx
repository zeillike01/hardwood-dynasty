import type { GameState } from '../game/types';
import { capFor, capSpaceOf, conferenceRank, payrollOf, rosterOf } from '../game/engine';
import { money, Modal, TierBadge, TeamMark } from './ui';

export function TeamDetailModal({
  state,
  teamId,
  onClose,
  onOpenPlayer,
}: {
  state: GameState;
  teamId: string;
  onClose: () => void;
  onOpenPlayer: (id: string) => void;
}) {
  const team = state.teams[teamId];
  if (!team) return null;
  const roster = rosterOf(state, teamId).sort((a, b) => b.overall - a.overall);
  const payroll = payrollOf(state, teamId);
  const picks = Object.entries(state.pickOwners ?? {})
    .filter(([, owner]) => owner === teamId)
    .map(([origin]) => `${origin} 1st`);

  return (
    <Modal onClose={onClose} wide>
      <div className="player-head">
        <div>
          <div className="eyebrow">Team page</div>
          <h2>
            {team.city} {team.name}
          </h2>
          <div className="muted">
            {team.conference} Conference · #{conferenceRank(state, teamId)} · {team.wins}–
            {team.losses} · {money(capSpaceOf(state, teamId))} cap space
          </div>
        </div>
        <TeamMark team={team} size={52} />
      </div>

      <div className="detail-grid three">
        <div className="detail-box">
          <span className="eyebrow">Payroll</span>
          <strong>{money(payroll)}</strong>
          <span className="muted">of {money(capFor(state))}</span>
        </div>
        <div className="detail-box">
          <span className="eyebrow">Roster</span>
          <strong>{roster.length} players</strong>
          <span className="muted">
            {roster.filter((p) => p.injuryGames > 0).length} injured
          </span>
        </div>
        <div className="detail-box">
          <span className="eyebrow">Draft picks</span>
          <strong>{picks.length ? picks.join(', ') : 'None'}</strong>
          <span className="muted">next first-rounders owned</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th className="left">Player</th>
              <th>Pos</th>
              <th>Tier</th>
              <th>Age</th>
              <th>OVR</th>
              <th>Salary</th>
              <th>Yrs</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((player) => (
              <tr
                key={player.id}
                className="clickable"
                onClick={() => {
                  onClose();
                  onOpenPlayer(player.id);
                }}
              >
                <td className="left">
                  <strong>{player.name}</strong>
                  {player.injuryGames > 0 && <span className="tag danger">OUT</span>}
                </td>
                <td>{player.pos}</td>
                <td>
                  <TierBadge tier={player.tier} />
                </td>
                <td>{player.age}</td>
                <td>{player.overall}</td>
                <td>{money(player.salary)}</td>
                <td className={player.years <= 0 ? 'down' : ''}>
                  {player.years <= 0 ? 'Exp' : player.years}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
