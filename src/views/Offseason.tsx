import { useState } from 'react';
import type { GameState } from '../game/types';
import {
  CONTRACT_YEARS,
  PLAYOFF_ENTRY_FEE,
  ROSTER_MAX,
  ROSTER_MIN,
  TITLE_CASH_PRIZE,
} from '../game/data';
import {
  capFor,
  capSpaceOf,
  championOf,
  draftProspects,
  makeDraftPick,
  passDraftPick,
  payrollByYear,
  payrollOf,
  pendingContractPlayers,
  prospectRange,
  reSignPlayer,
  rosterOf,
  scoutCost,
  scoutProspect,
  sellPlayerToMarket,
  signedPlayers,
  storeExpiredPlayer,
  userOnTheClock,
  userTeam,
} from '../game/engine';
import { canListOnMarket, marketBlockReason, marketFee, marketValue } from '../game/market';
import { money, TeamMark, TierBadge } from '../components/ui';
import { SeasonAdvance } from '../components/SeasonAdvance';
import { FreeAgentTable } from './FreeAgency';

export function OffseasonView({
  state,
  onState,
  onStartSeason,
  onSkipSeason,
  notify,
  onOpenPlayer,
}: {
  state: GameState;
  onState: (next: GameState) => void;
  onStartSeason: () => void;
  onSkipSeason: () => void;
  notify: (message: string, ok: boolean) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const team = userTeam(state);
  const roster = rosterOf(state, state.userTeamId).sort((a, b) => b.overall - a.overall);
  const prospects = draftProspects(state).sort((a, b) => b.potential - a.potential);
  const onClock = userOnTheClock(state);
  const champ = championOf(state);
  const expired = pendingContractPlayers(state, state.userTeamId);
  const reportCost = scoutCost(state);
  const signed = signedPlayers(state, state.userTeamId);
  const ready = signed.length >= ROSTER_MIN;
  const rosterFull = roster.length >= ROSTER_MAX;
  const future = payrollByYear(state, state.userTeamId);
  const latest = state.history?.[state.history.length - 1] ?? null;
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [clauses, setClauses] = useState<Record<string, 'player' | 'team'>>({});
  const [asks, setAsks] = useState<Record<string, number>>({});

  const resign = (id: string) => {
    const player = state.players[id];
    const years = lengths[id] ?? 3;
    const option = clauses[id] ?? null;
    const next = reSignPlayer(state, id, years, option);
    if (next === state) {
      notify(
        `${player.name} cannot be re-signed: the deal would take payroll past the ${money(
          capFor(state) * 1.1,
        )} hard ceiling. Let him walk or clear salary first.`,
        false,
      );
      return;
    }
    onState(next);
    notify(
      `${player.name} re-signed for ${years} year${years === 1 ? '' : 's'} at ${money(
        player.salary,
      )} per year${option ? ` with a ${option} option` : ''}.`,
      true,
    );
  };

  const store = (id: string) => {
    const player = state.players[id];
    const years = lengths[id] ?? 3;
    const result = storeExpiredPlayer(state, id, years);
    if (result.error || !result.state) {
      notify(result.error ?? 'That NFT could not be stored.', false);
      return;
    }
    onState(result.state);
    notify(
      `${player.name} stored in your NFT collection on a ${years}-year deal. Sign him from the Roster before it runs out.`,
      true,
    );
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
    notify(
      result.note ?? `Sold ${player.name} for ${ask} HWD (${marketFee(ask)} to the development fund).`,
      true,
    );
  };

  const draft = (id: string) => {
    const next = makeDraftPick(state, id);
    if (next === state) return;
    const pickNumber = (state.draftPickIndex ?? 0) + 1;
    const player = state.players[id];
    onState(next);
    notify(`Pick ${pickNumber}: ${player.name} joins the ${team.abbr}.`, true);
  };

  const passPick = () => {
    const next = passDraftPick(state);
    if (next === state) return;
    onState(next);
    notify('You passed on your pick. The board moves on.', false);
  };

  const scout = (id: string) => {
    const player = state.players[id];
    const next = scoutProspect(state, id);
    if (next === state) {
      notify(`Scouting ${player.name} needs ${money(reportCost)} of cash.`, false);
      return;
    }
    onState(next);
    notify(
      `Report filed: ${player.name} is ${player.overall} OVR with ${player.potential} potential.`,
      true,
    );
  };

  const nameOf = (id: string | null) => (id ? state.players[id]?.name ?? 'Unknown' : '—');

  return (
    <div className="offseason">
      <section className="card season-recap" style={{ borderTop: `3px solid ${team.color}` }}>
        <div>
          <div className="eyebrow">Season {state.season} · Offseason</div>
          <h1>Build the next contender</h1>
          <p className="muted">
            {champ
              ? `${state.teams[champ].city} ${state.teams[champ].name} lifted the trophy and the $${TITLE_CASH_PRIZE.toFixed(1)}M title prize. Now the league resets — re-sign, draft and reload.`
              : 'The season is over. Reshape the roster before training camp.'}
          </p>
          <p className="muted small">
            Playoff qualifiers paid a ${PLAYOFF_ENTRY_FEE.toFixed(1)}M entry fee. The worst
            regular-season record picks first and prospects arrive from tier 5 to tier 3, where a
            tier-3 talent is a rare find. Payroll
            above the {money(capFor(state))} cap is taxed at a rising rate — 1.5× the first $5M,
            2× the next $10M and 3× beyond — and a second straight tax season adds 25% and moves
            your first-round pick to the end of the draft.
          </p>
        </div>
        <div className="recap-stats">
          <div>
            <span className="eyebrow">Record</span>
            <strong>
              {team.wins}–{team.losses}
            </strong>
          </div>
          <div>
            <span className="eyebrow">Cap space</span>
            <strong>{money(capSpaceOf(state, state.userTeamId))}</strong>
            <span className="muted small">
              {money(payrollOf(state, state.userTeamId))} committed of {money(capFor(state))}
            </span>
            <span className="muted small">
              {money(future[0])} next season · {money(future[1])} the year after
            </span>
          </div>
          <div>
            <span className="eyebrow">Roster</span>
            <strong className={ready ? '' : 'down'}>{signed.length} signed</strong>
            <span className="muted small">Minimum {ROSTER_MIN}</span>
          </div>
        </div>
      </section>

      {latest && latest.season === state.season && (
        <section className="card awards-card">
          <div className="card-head">
            <div>
              <h3>Season {latest.season} awards</h3>
              <p className="muted small">
                MVP {nameOf(latest.mvpId)} · Defensive Player {nameOf(latest.dpoyId)} · Rookie{' '}
                {nameOf(latest.royId)} · Finals MVP {nameOf(latest.finalsMvpId ?? null)}
              </p>
            </div>
          </div>
          <div className="all-league">
            <span className="eyebrow">All-League first team</span>
            <div className="all-league-list">
              {latest.allLeague.map((id) => (
                <button key={id} className="injury-report-item" onClick={() => onOpenPlayer(id)}>
                  <strong>{nameOf(id)}</strong>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {(state.devReport ?? []).length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Development report</h3>
              <p className="muted small">
                Natural growth and aging from last season. Training levels are separate.
              </p>
            </div>
          </div>
          <div className="dev-list">
            {(state.devReport ?? []).map((note) => {
              const player = state.players[note.playerId];
              if (!player) return null;
              const delta = note.after - note.before;
              return (
                <button
                  key={note.playerId}
                  className="dev-item"
                  onClick={() => onOpenPlayer(note.playerId)}
                >
                  <strong>{player.name}</strong>
                  <span className="muted small">Age {player.age}</span>
                  <span className="dev-numbers">
                    {note.before} → {note.after}
                  </span>
                  <em className={delta > 0 ? 'up' : delta < 0 ? 'down' : 'muted'}>
                    {note.note}
                  </em>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {expired.length > 0 && (
        <section className="card contract-decisions">
          <div className="card-head">
            <div>
              <h2>Contract decisions</h2>
              <p className="muted small">
                These deals expired when the playoffs ended. Re-sign them on the length you
                choose, store the NFT in your collection on a new deal, or sell him on the
                marketplace for HWD. Stored deals keep counting down, so sign him before they run
                out; anyone left unresolved walks as a free agent when you open next season.
              </p>
            </div>
            <span className="tag star">{expired.length} expired</span>
          </div>
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr>
                  <th className="left">Player</th>
                  <th>Pos</th>
                  <th>Tier</th>
                  <th>OVR</th>
                  <th>Asking</th>
                  <th>Years</th>
                  <th>Clause</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expired.map((player) => {
                  const eligibility = canListOnMarket(state, player.id);
                  const ask = Math.max(1, Math.round(asks[player.id] ?? marketValue(player)));
                  return (
                    <tr key={player.id}>
                      <td className="left clickable" onClick={() => onOpenPlayer(player.id)}>
                        <strong>{player.name}</strong>
                      </td>
                      <td>
                        <span className="pos-dot">{player.pos}</span>
                      </td>
                      <td>
                        <TierBadge tier={player.tier} />
                      </td>
                      <td>{player.overall}</td>
                      <td>{money(player.salary)}</td>
                      <td>
                        <select
                          className="mini-select"
                          value={lengths[player.id] ?? 3}
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
                        <select
                          className="mini-select"
                          value={clauses[player.id] ?? ''}
                          onChange={(event) =>
                            setClauses((current) => ({
                              ...current,
                              [player.id]: event.target.value as 'player' | 'team',
                            }))
                          }
                          aria-label={`Contract clause for ${player.name}`}
                        >
                          <option value="">None</option>
                          <option value="team">Team option</option>
                          <option value="player">Player option</option>
                        </select>
                      </td>
                      <td>
                        <div className="btn-row">
                          <button className="btn small primary" onClick={() => resign(player.id)}>
                            Re-sign
                          </button>
                          <input
                            className="market-ask"
                            type="number"
                            min={1}
                            value={ask}
                            aria-label={`Asking price in HWD for ${player.name}`}
                            disabled={!eligibility.eligible}
                            title={
                              eligibility.eligible
                                ? 'Name your own ask — rivals pay up to about 25% over valuation'
                                : marketBlockReason(eligibility.reasons)
                            }
                            onChange={(event) =>
                              setAsks((current) => ({
                                ...current,
                                [player.id]: Number(event.target.value),
                              }))
                            }
                          />
                          <button
                            className="btn small"
                            disabled={!eligibility.eligible}
                            title={
                              eligibility.eligible
                                ? `Sell ${player.name} for ${ask} HWD`
                                : marketBlockReason(eligibility.reasons)
                            }
                            onClick={() => sell(player.id)}
                          >
                            Sell
                          </button>
                          <button
                            className="btn small ghost"
                            title={`Store ${player.name} in your NFT collection on a ${
                              lengths[player.id] ?? 3
                            }-year deal`}
                            onClick={() => store(player.id)}
                          >
                            Store
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Rookie draft</h2>
            <p className="muted small">
              {onClock
                ? 'You are on the clock. Pick your prospect.'
                : state.draftOrder && state.draftPickIndex >= state.draftOrder.length
                  ? 'Draft complete.'
                  : 'The board is moving — CPU teams are picking.'}{' '}
              Unscouted prospects show ratings as ranges; scouting costs{' '}
              {reportCost > 0 ? money(reportCost) : 'nothing'}.
            </p>
          </div>
        </div>

        {state.draftOrder && (
          <div className="draft-order">
            {state.draftOrder.map((teamId, index) => {
              const origin = state.draftPickOrigins?.[index];
              return (
                <div
                  key={`${teamId}-${index}`}
                  className={`draft-slot${index === state.draftPickIndex ? ' current' : ''}${
                    teamId === state.userTeamId ? ' mine' : ''
                  }${index < state.draftPickIndex ? ' spent' : ''}`}
                  title={`${state.teams[teamId].city} ${state.teams[teamId].name}${
                    origin && origin !== teamId ? ` (via ${origin})` : ''
                  }`}
                >
                  <span className="pick-no">{index + 1}</span>
                  {state.teams[teamId].abbr}
                  {origin && origin !== teamId && <em className="pick-via">via {origin}</em>}
                </div>
              );
            })}
          </div>
        )}

        {prospects.length > 0 ? (
          <div className="table-scroll draft-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="left">Prospect</th>
                  <th>Pos</th>
                  <th>Tier</th>
                  <th>Age</th>
                  <th>OVR</th>
                  <th>POT</th>
                  <th>Report</th>
                  <th>Scout</th>
                  <th>Salary</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {prospects.map((player) => {
                  const range = prospectRange(state, player);
                  return (
                    <tr key={player.id} className="clickable" onClick={() => onOpenPlayer(player.id)}>
                      <td className="left">
                        <strong>{player.name}</strong>
                      </td>
                      <td>
                        <span className="pos-dot">{player.pos}</span>
                      </td>
                      <td>
                        <TierBadge tier={player.tier} />
                      </td>
                      <td>{player.age}</td>
                      <td>{range ? `${range.ovr[0]}–${range.ovr[1]}` : player.overall}</td>
                      <td className="up">
                        {range ? `${range.pot[0]}–${range.pot[1]}` : player.potential}
                      </td>
                      <td className="muted small">{range ? range.risk : 'Fully scouted'}</td>
                      <td>
                        <button
                          className="btn small ghost"
                          disabled={!range || state.teams[state.userTeamId].cash < reportCost}
                          onClick={(event) => {
                            event.stopPropagation();
                            scout(player.id);
                          }}
                        >
                          {range ? 'Scout' : 'Scouted'}
                        </button>
                      </td>
                      <td>{money(player.salary)}</td>
                      <td>
                        <div className="btn-row">
                          <button
                            className="btn small primary"
                            disabled={!onClock || rosterFull}
                            title={rosterFull ? 'Roster is full. Waive a player or pass.' : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              draft(player.id);
                            }}
                          >
                            Draft
                          </button>
                          <button
                            className="btn small ghost"
                            disabled={!onClock}
                            onClick={(event) => {
                              event.stopPropagation();
                              passPick();
                            }}
                          >
                            Pass
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {prospects.length > 0 ? (
          <div className="draft-cards">
            {prospects.map((player) => {
              const range = prospectRange(state, player);
              return (
                <article className="draft-card" key={player.id}>
                  <div
                    className="draft-card-head"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenPlayer(player.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenPlayer(player.id);
                      }
                    }}
                  >
                    <strong>{player.name}</strong>
                    <span className="draft-card-meta">
                      <span className="pos-dot">{player.pos}</span>
                      Tier {player.tier} · Age {player.age} · {money(player.salary)}
                    </span>
                  </div>
                  <div className="draft-card-stats">
                    <span>
                      <b>{range ? `${range.ovr[0]}–${range.ovr[1]}` : player.overall}</b>OVR
                    </span>
                    <span className="up">
                      <b>{range ? `${range.pot[0]}–${range.pot[1]}` : player.potential}</b>POT
                    </span>
                    <span>{range ? range.risk : 'Fully scouted'}</span>
                  </div>
                  <div className="draft-card-actions">
                    <button
                      className="btn small ghost"
                      disabled={!range || state.teams[state.userTeamId].cash < reportCost}
                      onClick={() => scout(player.id)}
                    >
                      {range ? 'Scout' : 'Scouted'}
                    </button>
                    <button
                      className="btn small primary"
                      disabled={!onClock || rosterFull}
                      title={rosterFull ? 'Roster is full. Waive a player or pass.' : undefined}
                      onClick={() => draft(player.id)}
                    >
                      Draft
                    </button>
                    <button className="btn small ghost" disabled={!onClock} onClick={passPick}>
                      Pass
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted">No prospects remain on the board.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Free agency</h2>
            <p className="muted small">
              Fill out the roster before opening night. Rival clubs chase the stars.
            </p>
          </div>
        </div>
        <FreeAgentTable state={state} onState={onState} notify={notify} compact />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Your roster</h3>
          <span className="muted small">
            {money(payrollOf(state, state.userTeamId))} of {money(capFor(state))}
          </span>
        </div>
        <div className="table-scroll">
          <table className="table compact">
            <thead>
              <tr>
                <th className="left">Player</th>
                <th>Pos</th>
                <th>Age</th>
                <th>OVR</th>
                <th>Salary</th>
                <th>Yrs</th>
                <th>Clause</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => (
                <tr key={player.id} className="clickable" onClick={() => onOpenPlayer(player.id)}>
                  <td className="left">
                    <TeamMark team={team} size={22} />
                    <strong>{player.name}</strong>
                  </td>
                  <td>
                    <span className="pos-dot">{player.pos}</span>
                  </td>
                  <td>{player.age}</td>
                  <td>{player.overall}</td>
                  <td>{money(player.salary)}</td>
                  <td className={player.years <= 0 ? 'down' : ''}>
                    {player.years <= 0 ? 'Expired' : player.years}
                  </td>
                  <td className="muted small">
                    {player.option ? `${player.option} option` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="offseason-footer">
        <span className="muted">
          {ready
            ? expired.length
              ? `${expired.length} expired deal${expired.length === 1 ? '' : 's'} will leave when you open the season.`
              : 'Roster is legal. Training camp awaits.'
            : `You need ${ROSTER_MIN - signed.length} more player${
                ROSTER_MIN - signed.length === 1 ? '' : 's'
              } under contract to open the season.`}
        </span>
        <SeasonAdvance
          state={state}
          ready={ready}
          label={`Start season ${state.season + 1}`}
          className="btn primary"
          onStart={onStartSeason}
          onSkip={onSkipSeason}
        />
      </div>
    </div>
  );
}
