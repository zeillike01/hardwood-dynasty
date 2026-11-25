import type { CSSProperties, ReactNode } from 'react';
import type { AttrKey, Game, GameState, Player, Team } from '../game/types';
import {
  POS_LABEL,
  SKILLS,
  SKILL_ATTR_GAIN,
  SKILL_KEYS,
  SKILL_MAX_LEVEL,
} from '../game/data';
import {
  buyoutCost,
  capFor,
  hofRosterLocked,
  prospectRange,
  salaryDemand,
  skillCapFor,
  skillLevelTotal,
  skillOffer,
} from '../game/engine';

export const money = (n: number) => `$${n.toFixed(1)}M`;

export function recordPct(wins: number, losses: number): string {
  const games = wins + losses;
  if (!games) return '.000';
  return (wins / games).toFixed(3).replace(/^0/, '');
}

export function TierBadge({ tier }: { tier: number }) {
  return (
    <span
      className={`tier-badge tier-${tier}`}
      title={tier === 0 ? 'Hall of Fame' : `Tier ${tier} of 5`}
    >
      {tier === 0 ? 'HOF' : `T${tier}`}
    </span>
  );
}

export function TeamMark({ team, size = 38 }: { team: Team; size?: number }) {
  return (
    <span
      className="team-mark"
      style={{
        background: `linear-gradient(150deg, ${team.color}, ${team.color}bb)`,
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.3),
      }}
      aria-hidden="true"
    >
      {team.abbr}
    </span>
  );
}

export function Modal({
  children,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

const ATTR_LABELS: { key: keyof Player['attrs']; label: string }[] = [
  { key: 'inside', label: 'Inside' },
  { key: 'outside', label: 'Outside' },
  { key: 'playmaking', label: 'Playmaking' },
  { key: 'defense', label: 'Defense' },
  { key: 'rebounding', label: 'Rebounding' },
  { key: 'athleticism', label: 'Athleticism' },
];

function Bar({ value, tone = 'default' }: { value: number; tone?: 'default' | 'muted' }) {
  const width = Math.max(4, Math.min(100, value));
  return (
    <span className={`bar ${tone}`}>
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

export function PlayerDetailModal({
  state,
  player,
  onClose,
  onWaive,
  onBuyout,
  onBuySkill,
}: {
  state: GameState;
  player: Player;
  onClose: () => void;
  onWaive: (id: string) => boolean;
  onBuyout: (id: string) => boolean;
  onBuySkill: (id: string, key: AttrKey) => void;
}) {
  const team = player.teamId ? state.teams[player.teamId] : null;
  const userPlayer = player.teamId === state.userTeamId;
  // The academy is part of the roster freeze while a Hall of Fame bracket is live.
  const skillsLocked = userPlayer && hofRosterLocked(state);
  const cash = state.teams[state.userTeamId].cash;
  const skillUsed = skillLevelTotal(player);
  const skillCap = skillCapFor(state, player);
  const s = player.stats;
  const career = player.career;
  const perGame = (total: number) => (s.gp ? (total / s.gp).toFixed(1) : '—');
  const isProspect = player.teamId === null && (state.draftClass ?? []).includes(player.id);
  const unscouted = isProspect ? prospectRange(state, player) : null;

  return (
    <Modal onClose={onClose}>
      <div className="player-head">
        <div>
          <div className="eyebrow">
            {player.pos} · {POS_LABEL[player.pos]}
          </div>
          <h2>{player.name}</h2>
          <div className="muted">
            {team ? `${team.city} ${team.name}` : 'Free agent'} · Age {player.age}
          </div>
          <div className="player-training">
            <TierBadge tier={player.tier} />
            <span className="muted small">
              Level {player.level} / 25
            </span>
          </div>
        </div>
        <div className="ovr-block">
          <span className="ovr">
            {unscouted ? `${unscouted.ovr[0]}–${unscouted.ovr[1]}` : player.overall}
          </span>
          <span className="ovr-label">OVR</span>
          <span className="pot" title="Natural development ceiling">
            POT {unscouted ? `${unscouted.pot[0]}–${unscouted.pot[1]}` : player.potential}
          </span>
        </div>
      </div>

      {player.injuryGames > 0 && (
        <div className="injury-banner">
          <span className="injury-tag">OUT {player.injuryGames}g</span>
          <span>
            <strong>{player.injury ?? 'Injury'}</strong> · {player.injuryGames} game
            {player.injuryGames === 1 ? '' : 's'} remaining
          </span>
        </div>
      )}

      {unscouted ? (
        <div className="scout-hidden">
          <strong>Unscouted prospect</strong>
          <span className="muted small">
            Ratings are estimated ({unscouted.risk.toLowerCase()}). Scout him from the draft board to
            reveal the true attributes.
          </span>
        </div>
      ) : (
        <div className="attr-grid">
          {ATTR_LABELS.map(({ key, label }) => (
            <div className="attr" key={key}>
              <span className="attr-label">{label}</span>
              <Bar value={player.attrs[key]} />
              <span className="attr-value">{player.attrs[key]}</span>
            </div>
          ))}
        </div>
      )}

      {userPlayer && (
        <div className="skill-academy">
          <div className="skill-head">
            <div>
              <span className="eyebrow">Skill academy</span>
              <h3>Targeted development</h3>
            </div>
            <span className="skill-cap">
              {skillUsed}/{skillCap} cash levels
            </span>
          </div>
          <div className="skill-list">
            {SKILL_KEYS.map((key) => {
              const skill = SKILLS[key];
              const offer = skillOffer(state, player, key);
              const action =
                offer.cost === null
                  ? offer.blocked === 'maxed'
                    ? 'Maxed'
                    : 'Capped'
                  : `+${SKILL_ATTR_GAIN} · ${money(offer.cost)}`;
              return (
                <div className="skill-row" key={key}>
                  <div className="skill-name">
                    <div className="skill-name-line">
                      <strong>{skill.name}</strong>
                      <span className="skill-attr">{player.attrs[key]}</span>
                      <span
                        className="skill-level"
                        aria-label={`Level ${offer.level} of ${SKILL_MAX_LEVEL}`}
                      >
                        {offer.level}/{SKILL_MAX_LEVEL}
                      </span>
                    </div>
                    <span className="muted small">{skill.blurb}</span>
                  </div>
                  <button
                    className="btn small"
                    disabled={skillsLocked || offer.cost === null || cash + 1e-9 < offer.cost}
                    title={
                      skillsLocked ? 'Frozen until your Hall of Fame bracket settles' : undefined
                    }
                    aria-label={`${skill.name}: ${action}`}
                    onClick={() => onBuySkill(player.id, key)}
                  >
                    {action}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="muted small skill-note">
            {skillsLocked
              ? 'The skill academy is frozen: no player can be added or improved until your Hall of Fame bracket settles.'
              : 'Cash levels are separate from TP training. Each one raises a single attribute, and their next contract ask follows their overall. Players 30 and older are limited to 3 cash levels.'}
          </p>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-box">
          <span className="eyebrow">Contract</span>
          <strong>{money(player.salary)} / yr</strong>
          {player.years <= 0 ? (
            <>
              <span className="down">Contract expired — re-sign in the offseason</span>
              <span className="muted small">
                Market ask {money(salaryDemand(player, capFor(state)))} / yr at age {player.age}
              </span>
            </>
          ) : (
            <span className="muted">
              {player.years} year{player.years === 1 ? '' : 's'} remaining
              {player.years === 1 ? ' · final year' : ''}
              {player.option ? ` · ${player.option} option` : ''}
            </span>
          )}
        </div>
        <div className="detail-box">
          <span className="eyebrow">Season</span>
          <strong>
            {perGame(s.pts)} pts · {perGame(s.reb)} reb · {perGame(s.ast)} ast
          </strong>
          <span className="muted">
            {s.gp} games · {s.gp ? (s.min / s.gp).toFixed(1) : '0.0'} min
          </span>
        </div>
        {career && career.gp > 0 && (
          <div className="detail-box">
            <span className="eyebrow">Career</span>
            <strong>
              {career.pts} pts · {career.reb} reb · {career.ast} ast
            </strong>
            <span className="muted">{career.gp} games</span>
          </div>
        )}
      </div>

      <div className="shooting">
        <div>
          <span className="eyebrow">Field goals</span>
          <strong>
            {s.fgm}/{s.fga}
          </strong>
          <span className="muted">
            {s.fga ? ((s.fgm / s.fga) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
        <div>
          <span className="eyebrow">Threes</span>
          <strong>
            {s.tpm}/{s.tpa}
          </strong>
          <span className="muted">
            {s.tpa ? ((s.tpm / s.tpa) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
        <div>
          <span className="eyebrow">Free throws</span>
          <strong>
            {s.ftm}/{s.fta}
          </strong>
          <span className="muted">
            {s.fta ? ((s.ftm / s.fta) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
        <div>
          <span className="eyebrow">Stocks</span>
          <strong>
            {perGame(s.stl)} stl · {perGame(s.blk)} blk
          </strong>
          <span className="muted">per game</span>
        </div>
      </div>

      {player.teamId === state.userTeamId && (
        <div className="contract-actions">
          {player.years > 0 && (
            <button
              className="btn primary full"
              disabled={state.teams[state.userTeamId].cash + 1e-9 < buyoutCost(player)}
              title="Pay cash now to clear the rest of the contract from the cap"
              onClick={() => {
                if (onBuyout(player.id)) onClose();
              }}
            >
              Buy out contract · {money(buyoutCost(player))} cash
            </button>
          )}
          <button
            className="btn danger full"
            onClick={() => {
              if (onWaive(player.id)) onClose();
            }}
          >
            Waive player
          </button>
          <p className="muted small contract-note">
            Waiving leaves the remaining salary on the cap as dead money. A buyout clears it for
            cash, and the player can sign elsewhere next season.
          </p>
        </div>
      )}
    </Modal>
  );
}

type BoxStatKey = 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk';

const BOX_COLS: { key: BoxStatKey; label: string }[] = [
  { key: 'min', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
];

export function BoxScoreModal({
  state,
  game,
  onClose,
}: {
  state: GameState;
  game: Game;
  onClose: () => void;
}) {
  if (!game.box) return null;
  const teamIds = [game.away, game.home];

  return (
    <Modal onClose={onClose} wide>
      <div className="box-head">
        <div className="eyebrow">Final · Round {game.round + 1}</div>
        <h2>
          {state.teams[game.away].abbr} {game.awayScore} — {game.homeScore} {state.teams[game.home].abbr}
        </h2>
        <div className="muted">
          {state.teams[game.away].city} {state.teams[game.away].name} at {state.teams[game.home].city}{' '}
          {state.teams[game.home].name}
        </div>
      </div>

      {teamIds.map((teamId) => {
        const team = state.teams[teamId];
        const lines = (game.box ?? [])
          .filter((line) => line.teamId === teamId)
          .sort((a, b) => b.pts - a.pts);
        const totals = lines.reduce(
          (acc, line) => {
            for (const col of BOX_COLS) acc[col.key] += line[col.key];
            acc.fgm += line.fgm;
            acc.fga += line.fga;
            acc.tpm += line.tpm;
            acc.tpa += line.tpa;
            return acc;
          },
          { min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 },
        );

        return (
          <div className="box-section" key={teamId}>
            <div className="box-team">
              <TeamMark team={team} size={30} />
              <strong>
                {team.city} {team.name}
              </strong>
            </div>
            <table className="table box-table">
              <thead>
                <tr>
                  <th className="left">Player</th>
                  {BOX_COLS.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                  <th>FG</th>
                  <th>3P</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const player = state.players[line.playerId];
                  return (
                    <tr key={line.playerId}>
                      <td className="left">
                        <span className="pos-dot">{player?.pos ?? '—'}</span>
                        {player?.name ?? 'Unknown'}
                      </td>
                      {BOX_COLS.map((col) => (
                        <td key={col.key}>{line[col.key]}</td>
                      ))}
                      <td>
                        {line.fgm}/{line.fga}
                      </td>
                      <td>
                        {line.tpm}/{line.tpa}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="left">Team</td>
                  <td>{totals.min}</td>
                  <td>{totals.pts}</td>
                  <td>{totals.reb}</td>
                  <td>{totals.ast}</td>
                  <td>{totals.stl}</td>
                  <td>{totals.blk}</td>
                  <td>
                    {totals.fgm}/{totals.fga}
                  </td>
                  <td>
                    {totals.tpm}/{totals.tpa}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </Modal>
  );
}

export function StatStrip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'hot';
}) {
  return (
    <div className={`strip${tone === 'hot' ? ' hot' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  const style: CSSProperties | undefined = accent ? { color: accent } : undefined;
  return (
    <div className="stat-tile card">
      <span className="eyebrow">{label}</span>
      <strong style={style}>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
