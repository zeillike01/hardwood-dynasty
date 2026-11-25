import { useState } from 'react';
import type { GameState, Player, Pos } from '../game/types';
import {
  capFor,
  capSpaceOf,
  convertPointsToCash,
  fusePlayers,
  hofRosterLocked,
  HOF_ROSTER_LOCK,
  injuredPlayers,
  payrollOf,
  rosterOf,
  setBenchOrder,
  setStarters,
  signStashedPlayer,
  stashPlayers,
  trainPlayer,
  trainingCost,
} from '../game/engine';
import {
  MAX_LEVEL,
  POINTS_PER_CASH_BLOCK,
  POS_LABEL,
  POSITIONS,
  ROSTER_MAX,
  STASH_LIMIT,
} from '../game/data';
import {
  FUSION_BOTTOM_TIER,
  FUSION_MAX_PLAYERS,
  FUSION_MIN_PLAYERS,
  FUSION_TOP_TIER,
  fusionHwdCost,
  hwdBalance,
} from '../game/market';
import { money, TeamMark, TierBadge } from '../components/ui';

type GroupId = 'starters' | 'bench' | 'reserve';

const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'starters', label: 'Starters' },
  { id: 'bench', label: 'Bench' },
  { id: 'reserve', label: 'Reserve' },
];

function cardTone(player: Player): string {
  if (player.overall >= 85) return 'elite';
  if (player.overall >= 75) return 'star';
  if (player.overall >= 65) return 'solid';
  return 'role';
}

function Silhouette() {
  return (
    <svg viewBox="0 0 120 240" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <g fill="currentColor">
        <circle cx="60" cy="26" r="18" />
        <path d="M60 46c-16 0-27 10-30 27l-3 26 12 3 4-21v40h34V81l4 21 12-3-3-26c-3-17-14-27-30-27z" />
        <path d="M43 121h15l-4 103H37zM62 121h15l6 103H66z" />
      </g>
    </svg>
  );
}

export function RosterView({
  state,
  onOpenPlayer,
  onState,
  notify,
}: {
  state: GameState;
  onOpenPlayer: (id: string) => void;
  onState: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
}) {
  const [group, setGroup] = useState<GroupId>('starters');
  const [mode, setMode] = useState<'roster' | 'fusion'>('roster');
  const [fuseIds, setFuseIds] = useState<string[]>([]);
  const roster = rosterOf(state, state.userTeamId).sort((a, b) => b.overall - a.overall);
  const injured = injuredPlayers(state, state.userTeamId);
  const payroll = payrollOf(state, state.userTeamId);
  const team = state.teams[state.userTeamId];
  const points = team.trainingPoints;
  const stored = stashPlayers(state);
  const fusionCandidates = [...roster, ...stored].filter(
    (player) =>
      player.tier > FUSION_TOP_TIER &&
      player.tier <= FUSION_BOTTOM_TIER &&
      player.level >= MAX_LEVEL,
  );
  const fusionSelection = fuseIds.filter((id) =>
    fusionCandidates.some((player) => player.id === id),
  );
  const readyCounts = fusionCandidates.reduce<Record<number, number>>((counts, player) => {
    counts[player.tier] = (counts[player.tier] ?? 0) + 1;
    return counts;
  }, {});
  const fusionInputTier = fusionSelection.length
    ? state.players[fusionSelection[0]]?.tier ?? null
    : null;
  const fusionResultTier = fusionInputTier === null ? null : fusionInputTier - 1;
  const wallet = hwdBalance(state);
  const fusionCost = fusionInputTier === null ? null : fusionHwdCost(fusionInputTier);

  const lineup = state.lineup ?? [];
  const byId = new Map(roster.map((player) => [player.id, player]));
  const ordered = lineup
    .map((id) => byId.get(id))
    .filter((player): player is Player => Boolean(player));
  const starters = ordered.slice(0, 5);
  const bench = ordered.slice(5, 9);
  const reserves = roster.filter((player) => !lineup.includes(player.id));
  const groupPlayers: Record<GroupId, Player[]> = { starters, bench, reserve: reserves };
  const active = groupPlayers[group];
  const average = starters.length
    ? (starters.reduce((sum, player) => sum + player.overall, 0) / starters.length).toFixed(1)
    : '—';
  const groupLabel = GROUPS.find((item) => item.id === group)?.label ?? 'Starters';

  const starterAt = (pos: Pos) => starters.find((player) => player.pos === pos) ?? null;

  const chooseStarter = (pos: Pos, id: string) => {
    const ids = POSITIONS.map((slot) => (slot === pos ? id : starterAt(slot)?.id ?? ''));
    if (ids.some((value) => !value)) {
      notify(`You need a ${pos} in every slot before changing the lineup.`, false);
      return;
    }
    const next = setStarters(state, ids);
    if (next === state) {
      notify('That lineup is not valid.', false);
      return;
    }
    onState(next);
  };

  const autoLineup = () => {
    const ids = POSITIONS.map(
      (pos) =>
        roster
          .filter((player) => player.pos === pos)
          .sort((a, b) => b.overall - a.overall)[0]?.id ?? '',
    );
    if (ids.some((value) => !value)) {
      notify('You need at least one player at every position for an automatic lineup.', false);
      return;
    }
    onState(setStarters(state, ids));
    notify('Lineup set to your best five by position.', true);
  };

  const moveBench = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= bench.length) return;
    const ids = bench.map((player) => player.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onState(setBenchOrder(state, ids));
  };

  const train = (id: string) => {
    const player = state.players[id];
    // Training is blocked outright while a Hall of Fame bracket is live, so the
    // freeze has to be named instead of the missing training points.
    if (hofRosterLocked(state)) {
      notify(HOF_ROSTER_LOCK, false);
      return;
    }
    const next = trainPlayer(state, id);
    if (next === state) {
      notify(`Not enough training points to train ${player.name}.`, false);
      return;
    }
    onState(next);
    notify(`${player.name} trained to level ${next.players[id].level}.`, true);
  };

  const toggleFusion = (id: string) => {
    setFuseIds((previous) => {
      const active = previous.filter((value) =>
        fusionCandidates.some((player) => player.id === value),
      );
      if (active.includes(id)) return active.filter((value) => value !== id);
      const player = state.players[id];
      if (!player) return active;
      const tier = player.tier;
      const sameTier = active.filter((value) => state.players[value]?.tier === tier);
      // Picking a player from another tier starts a new selection instead of
      // producing a set the engine will reject.
      if (sameTier.length !== active.length) return [id];
      // A full set is never silently trimmed: deselect one first.
      if (active.length >= FUSION_MAX_PLAYERS) return active;
      return [...active, id];
    });
  };

  const fuse = () => {
    const next = fusePlayers(state, fusionSelection);
    if (!next.state) {
      notify(next.error ?? 'Those players cannot be fused.', false);
      return;
    }
    const minted = Object.values(next.state.players)
      .filter((player) => !state.players[player.id])
      .sort((a, b) => b.overall - a.overall)[0];
    onState(next.state);
    setFuseIds([]);
    notify(
      minted
        ? `${minted.name} minted: tier ${minted.tier}, 18 years old, ${minted.overall} OVR${
            minted.teamId ? '.' : ' — stored in your NFT collection.'
          }`
        : 'Fusion complete.',
      true,
    );
  };

  const signStored = (id: string) => {
    const player = state.players[id];
    const result = signStashedPlayer(state, id);
    if (result.error || !result.state) {
      notify(result.error ?? 'That NFT could not be signed.', false);
      return;
    }
    onState(result.state);
    notify(`${player.name} added to the roster.`, true);
  };

  const convert = () => {
    const next = convertPointsToCash(state);
    if (next === state) {
      notify(`You need ${POINTS_PER_CASH_BLOCK} training points to convert.`, false);
      return;
    }
    onState(next);
    notify(`Converted ${POINTS_PER_CASH_BLOCK} TP into $1.0M of front-office cash.`, true);
  };

  return (
    <section className="card team-screen">
      <div className="card-head">
        <div>
          <h2>Team</h2>
          <p className="muted small">
            {roster.length} players · {money(payroll)} committed of {money(capFor(state))} ·{' '}
            {money(capSpaceOf(state, state.userTeamId))} cap space
          </p>
        </div>

        <div className="training-purse">
          <span className="purse-line">
            <strong>{points}</strong> TP
          </span>
          <span className="purse-line">
            <strong>{money(team.cash)}</strong> cash
          </span>
          <button
            className="btn small"
            disabled={points < POINTS_PER_CASH_BLOCK}
            onClick={convert}
            title={`Convert ${POINTS_PER_CASH_BLOCK} training points into $1.0M cash`}
          >
            Convert {POINTS_PER_CASH_BLOCK} TP → $1.0M
          </button>
        </div>
      </div>

      <div className="team-subtabs mode-tabs" role="tablist" aria-label="Team sections">
        {(['roster', 'fusion'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={mode === item}
            className={`team-subtab${mode === item ? ' active' : ''}`}
            onClick={() => setMode(item)}
          >
            <span>
              {item === 'roster' ? 'Roster' : 'Fusion'}
              {item === 'fusion' && <em>{fusionCandidates.length}</em>}
            </span>
          </button>
        ))}
      </div>

      {mode === 'roster' && (
        <>
          <div className="lineup-editor">
            <div className="lineup-head">
              <span className="eyebrow">Starting five</span>
              <button className="link-btn" onClick={autoLineup}>
                Auto-fill best five
              </button>
            </div>
            <div className="lineup-slots">
              {POSITIONS.map((pos) => (
                <label key={pos} className="lineup-slot">
                  <span className="pos-dot">{pos}</span>
                  <select
                    value={starterAt(pos)?.id ?? ''}
                    onChange={(event) => chooseStarter(pos, event.target.value)}
                    aria-label={`Starting ${pos}`}
                  >
                    <option value="" disabled>
                      No {pos}
                    </option>
                    {roster
                      .filter((player) => player.pos === pos)
                      .map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name} · {player.overall}
                          {player.injuryGames > 0 ? ' (OUT)' : ''}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="bench-order">
              <span className="eyebrow">Bench order</span>
              <div className="bench-order-list">
                {bench.length === 0 && <span className="muted small">No bench players.</span>}
                {bench.map((player, index) => (
                  <span className="bench-chip" key={player.id}>
                    <span className="pos-dot">{player.pos}</span>
                    {player.name}
                    <button
                      className="bench-move"
                      onClick={() => moveBench(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${player.name} up the bench`}
                    >
                      ↑
                    </button>
                    <button
                      className="bench-move"
                      onClick={() => moveBench(index, 1)}
                      disabled={index === bench.length - 1}
                      aria-label={`Move ${player.name} down the bench`}
                    >
                      ↓
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="team-subtabs" role="tablist" aria-label="Roster groups">
            {GROUPS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={group === item.id}
                className={`team-subtab${group === item.id ? ' active' : ''}`}
                onClick={() => setGroup(item.id)}
              >
                <span>
                  {item.label} <em>{groupPlayers[item.id].length}</em>
                </span>
              </button>
            ))}
          </div>

          {injured.length > 0 && (
            <div className="injury-report">
              <span className="eyebrow">Injury report</span>
              <span className="injury-report-list">
                {injured.map((player) => (
                  <button
                    key={player.id}
                    className="injury-report-item"
                    onClick={() => onOpenPlayer(player.id)}
                    title={`${player.injury} — ${player.injuryGames} game(s) remaining`}
                  >
                    <strong>{player.name}</strong>
                    <em>
                      {player.injury} · {player.injuryGames}g
                    </em>
                  </button>
                ))}
              </span>
              <span className="muted small">Next men up replace them automatically.</span>
            </div>
          )}

          <div className="team-stage">
            <div className="team-cards">
              {active.map((player) => {
                const maxed = player.level >= MAX_LEVEL;
                const cost = trainingCost(player);

                return (
                  <article
                    key={player.id}
                    className={`player-card tone-${cardTone(player)}${player.injuryGames > 0 ? ' injured' : ''}`}
                    onClick={() => onOpenPlayer(player.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenPlayer(player.id);
                      }
                    }}
                  >
                    <div className="pc-wash" />
                    <div className="pc-streaks" />
                    <div className="pc-figure">
                      <Silhouette />
                    </div>

                    <span className="pc-pos">
                      <span className="pc-pos-long">{POS_LABEL[player.pos]}</span>
                      <span className="pc-pos-short">{player.pos}</span>
                    </span>
                    <span className="pc-tier">
                      <TierBadge tier={player.tier} />
                    </span>
                    <span className="pc-ovr">{player.overall}</span>
                    {player.injuryGames > 0 && (
                      <span
                        className="pc-injury"
                        title={`${player.injury} — out ${player.injuryGames} more game(s)`}
                      >
                        OUT {player.injuryGames}
                      </span>
                    )}

                    <div className="pc-info">
                      <span className="pc-chip">{player.pos}</span>
                      <strong className="pc-name">{player.name}</strong>
                      <span className="pc-meta">
                        LVL {player.level} · {money(player.salary)}
                        {player.years <= 0
                          ? ' · EXPIRED'
                          : player.years === 1
                            ? ' · FINAL YR'
                            : ''}
                      </span>
                    </div>

                    {maxed ? (
                      player.tier > FUSION_TOP_TIER ? (
                        <button
                          className="pc-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMode('fusion');
                          }}
                          title={`Fuse three maxed tier-${player.tier} players to mint a tier ${player.tier - 1} player`}
                        >
                          Ready to fuse
                        </button>
                      ) : (
                        <span className="pc-action maxed">Maxed</span>
                      )
                    ) : (
                      <button
                        className="pc-action"
                        disabled={points < cost}
                        onClick={(event) => {
                          event.stopPropagation();
                          train(player.id);
                        }}
                        title="Spend TP to add a level"
                      >
                        Train · {cost} TP
                      </button>
                    )}
                  </article>
                );
              })}
            </div>

            {active.length === 0 && (
              <p className="muted team-empty">No players in this group yet.</p>
            )}
          </div>
        </>
      )}

      {mode === 'fusion' && (
        <>
          <div className="fusion-panel">
            <div className="fusion-head">
              <span className="eyebrow">Tier fusion</span>
              <span className="muted small">
                Pick {FUSION_MIN_PLAYERS} fully trained players of the same tier. They are all burned
                permanently and mint one brand-new 18-year-old NFT a tier above them, on a rookie-scale
                deal. The merge is paid in HWD, which goes to the development treasury — it costs no
                training points. Fusion stops at tier {FUSION_TOP_TIER + 1} → {FUSION_TOP_TIER}; the
                Hall of Fame tier is HWD-league only.
              </span>
            </div>
            {fusionCandidates.length === 0 ? (
              <p className="muted small">
                No fully trained players yet. Train a player to level {MAX_LEVEL} first — every fusion
                needs {FUSION_MIN_PLAYERS} maxed players of the same tier, from the roster or your
                stored NFTs.
              </p>
            ) : (
              <>
                <p className="muted small">
                  Ready now:{' '}
                  {Object.entries(readyCounts)
                    .sort((a, b) => Number(b[0]) - Number(a[0]))
                    .map(([tier, count]) => `${count}× tier ${tier}`)
                    .join(' · ')}
                  {' '}— pick {FUSION_MIN_PLAYERS} of one tier.
                </p>
                <div className="fusion-options">
                  {fusionCandidates.map((player) => {
                    const on = fusionSelection.includes(player.id);
                    return (
                      <button
                        key={player.id}
                        type="button"
                        className={`fusion-chip${on ? ' on' : ''}`}
                        aria-pressed={on}
                        disabled={fusionInputTier !== null && player.tier !== fusionInputTier}
                        title={
                          fusionInputTier !== null && player.tier !== fusionInputTier
                            ? `Fusion takes one tier at a time; deselect your tier ${fusionInputTier} picks to switch.`
                            : undefined
                        }
                        onClick={() => toggleFusion(player.id)}
                      >
                        <span className="pos-dot">{player.pos}</span>
                        <strong>{player.name}</strong>
                        <em>
                          T{player.tier} · {player.overall} OVR
                          {player.teamId ? '' : ' · stored'}
                        </em>
                      </button>
                    );
                  })}
                </div>
                {fusionCost !== null && (
                  <p className={`fusion-cost small${wallet < fusionCost ? ' short' : ''}`}>
                    Costs <strong>{fusionCost} HWD</strong> · paid into the development treasury · you
                    hold {wallet} HWD
                    {wallet < fusionCost ? ' — not enough HWD' : ''}
                  </p>
                )}
                <button
                  className="btn small"
                  disabled={
                    fusionSelection.length !== FUSION_MIN_PLAYERS ||
                    (fusionCost !== null && wallet < fusionCost)
                  }
                  onClick={fuse}
                >
                  {fusionResultTier === null
                    ? 'Select players to fuse'
                    : `Fuse ${fusionSelection.length} → tier ${fusionResultTier} · ${fusionCost} HWD`}
                </button>
          </>
        )}
      </div>

      <div className="fusion-panel">
        <div className="fusion-head">
          <span className="eyebrow">
            Stored NFTs · {stored.length}/{STASH_LIMIT}
          </span>
          <span className="muted small">
            Yours, but off the roster: no cap hit and no roster spot until you sign them. Stored
            players are frozen — no aging and no development — and their contracts keep ticking. A
            stored deal that runs out is lost, so sign him before it does.
          </span>
        </div>
        {stored.length === 0 ? (
          <p className="muted small">
            Your collection is empty. A fusion mints straight into it when the roster or the cap
            has no room for the new player.
          </p>
        ) : (
          <div className="stash-list">
            {stored.map((player) => {
              const fits =
                roster.length < ROSTER_MAX && payroll + player.salary <= capFor(state) + 1e-9;
              return (
                <div className="stash-row" key={player.id}>
                  <TierBadge tier={player.tier} />
                  <strong>{player.name}</strong>
                  <span className="muted small">
                    {player.pos} · {player.overall} OVR · {player.age}y · {money(player.salary)} ·{' '}
                    {player.years}y
                  </span>
                  <button
                    className="btn small"
                    disabled={!fits}
                    title={
                      roster.length >= ROSTER_MAX
                        ? 'Roster is full'
                        : !fits
                          ? 'Not enough cap space'
                          : `Sign ${player.name}`
                    }
                    onClick={() => signStored(player.id)}
                  >
                    Sign
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
        </>
      )}

      <div className="team-strip">
        <div className="team-strip-ovr">
          <strong>{average}</strong>
          <span>OVR</span>
        </div>
        <div className="team-strip-label">
          <strong>{groupLabel}</strong>
          <span>
            {active.length} players · {money(payroll)} payroll · {team.wins}–{team.losses}
          </span>
        </div>
        <TeamMark team={team} size={54} />
      </div>

      <p className="muted small training-note">
        Win games to earn TP and train players to level {MAX_LEVEL}. Promotion is fusion-only:
        burn {FUSION_MIN_PLAYERS} maxed players of the same tier and pay the HWD fee, which goes into
        the development treasury, to mint one 18-year-old a tier higher (up to tier{' '}
        {FUSION_TOP_TIER}). The Hall of Fame tier comes only from the HWD league on the HOF tab.
        Cash pays signing bonuses.
      </p>
    </section>
  );
}
