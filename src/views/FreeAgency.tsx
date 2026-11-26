import { useState } from 'react';
import type { GameState } from '../game/types';
import { CONTRACT_YEARS } from '../game/data';
import {
  freeAgentTerms,
  hasRivalInterest,
  isSuperstar,
  signFreeAgent,
} from '../game/engine';
import { money, TierBadge } from '../components/ui';

export function FreeAgentTable({
  state,
  onState,
  notify,
  compact = false,
}: {
  state: GameState;
  onState: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
  compact?: boolean;
}) {
  const freeAgents = state.freeAgents
    .map((id) => state.players[id])
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  // The offseason table shows the ten best free agents, plus any cheaper option
  // beyond them, so a capped-out or HWD-poor club can still find a legal deal.
  const rows = compact
    ? freeAgents.filter(
        (player, index) => index < 10 || freeAgentTerms(state, player).affordable,
      )
    : freeAgents.slice(0, 40);

  const sign = (id: string) => {
    const player = state.players[id];
    const terms = freeAgentTerms(state, player);
    if (!terms.affordable) {
      notify(`${player.name}: ${terms.reason?.toLowerCase() ?? 'cannot be signed.'}`, false);
      return;
    }
    const years = lengths[id] ?? 2;
    onState(signFreeAgent(state, id, years));
    notify(
      `Signed ${player.name} for ${years} year${years === 1 ? '' : 's'} at ${money(
        terms.asking,
      )} per year${terms.hwd ? `, ${terms.hwd} HWD to the development fund` : ' on a minimum-scale deal'}.`,
      true,
    );
  };

  return (
    <div className="fa-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="left">Player</th>
            <th>Pos</th>
            <th>Tier</th>
            <th>Lvl</th>
            <th>Age</th>
            <th>OVR</th>
            <th>POT</th>
            <th>Asking</th>
            <th>HWD fee</th>
            <th>Years</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((player) => {
            const terms = freeAgentTerms(state, player);
            const asking = terms.asking;
            const rival = hasRivalInterest(player, state.season);
            const reason = terms.reason ?? `Sign ${player.name}`;
            return (
              <tr key={player.id}>
                <td className="left">
                  <strong>{player.name}</strong>
                  {isSuperstar(player) && <span className="tag star">Superstar</span>}
                  {rival && <span className="tag danger">Rival offer</span>}
                </td>
                <td>
                  <span className="pos-dot">{player.pos}</span>
                </td>
                <td>
                  <TierBadge tier={player.tier} />
                </td>
                <td>{player.level}</td>
                <td>{player.age}</td>
                <td>{player.overall}</td>
                <td className="muted">{player.potential}</td>
                <td className={rival ? 'down' : ''}>{money(asking)}</td>
                <td>{terms.hwd || 'Free'}</td>
                <td>
                  <select
                    className="mini-select"
                    value={lengths[player.id] ?? 2}
                    onChange={(event) =>
                      setLengths((current) => ({
                        ...current,
                        [player.id]: Number(event.target.value),
                      }))
                    }
                    aria-label={`Contract length for ${player.name}`}
                  >
                    {CONTRACT_YEARS.map((years) => (
                      <option key={years} value={years}>
                        {years} yr
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn small"
                    disabled={!terms.affordable}
                    title={reason}
                    onClick={() => sign(player.id)}
                  >
                    Sign
                  </button>
                </td>
              </tr>
            );
          })}
          {freeAgents.length === 0 && (
            <tr>
              <td className="left muted" colSpan={11}>
                The market is empty.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
