import type { GameState } from '../game/types';
import {
  apg,
  capFor,
  capSpaceOf,
  conferenceRank,
  expiringPlayers,
  injuredPlayers,
  nextUserGame,
  payrollOf,
  ppg,
  recentResults,
  rosterOf,
  rpg,
  teamLeaders,
  userTeam,
} from '../game/engine';
import { money, recordPct, StatStrip, StatTile, TeamMark } from '../components/ui';
import { HOF_TOTAL_POOL } from '../game/hof';
import { HWD_LEAGUE_ENTRY_FEE } from '../game/market';
import {
  milestoneLabel,
  QUEST_MILESTONES,
  questLabel,
  questProgress,
  rewardLabel,
} from '../game/quests';

interface Props {
  state: GameState;
  onSimRound: () => void;
  onSimSeason: () => void;
  onOpenPlayer: (id: string) => void;
  onOpenBox: (gameId: string) => void;
  onClaimQuest: () => void;
  onOpenHof: () => void;
}

export function Dashboard({
  state,
  onSimRound,
  onSimSeason,
  onOpenPlayer,
  onOpenBox,
  onClaimQuest,
  onOpenHof,
}: Props) {
  const team = userTeam(state);
  const rank = conferenceRank(state, team.id);
  const next = nextUserGame(state);
  const results = recentResults(state, 5);
  const leaders = teamLeaders(state, team.id, 'pts', 5);
  const roster = rosterOf(state, team.id);
  const injured = injuredPlayers(state, team.id);
  const expiring = state.phase === 'offseason' ? [] : expiringPlayers(state, team.id);
  const payroll = payrollOf(state, team.id);
  const capSpace = capSpaceOf(state, team.id);
  const diff = team.ptsFor - team.ptsAgainst;
  const gamesPlayed = team.wins + team.losses;
  const opponent = next ? state.teams[next.home === team.id ? next.away : next.home] : null;
  const quest = state.dailyQuest ?? null;
  const questDone = quest ? questProgress(state, quest) : 0;
  const questShown = quest ? Math.min(questDone, quest.target) : 0;
  const questReady = Boolean(quest && !quest.claimed && questDone >= quest.target);
  const nextMilestone = quest ? QUEST_MILESTONES.find((entry) => entry.quests > quest.completed) : null;
  const hof = state.hof && state.hof.season === state.season ? state.hof : null;
  const phaseLabel =
    state.phase === 'regular' ? 'In season' : state.phase === 'playoffs' ? 'In postseason' : 'Offseason';
  const roundLabel =
    state.phase === 'regular'
      ? `Round ${Math.min(state.round + 1, 21)} / 21`
      : state.phase === 'playoffs'
        ? `Playoff round ${state.playoffRound}`
        : `Season ${state.season} complete`;

  return (
    <div className="home-grid">
      <div className="home-col">
        <section className="card team-panel">
          <div className="panel-bar">
            <TeamMark team={team} size={46} />
            <h2>
              {team.city} {team.name}
            </h2>
            <span className="panel-bar-rank">
              {team.conference} #{rank}
            </span>
          </div>

          <div className="strip-list">
            <StatStrip label="Season" value={String(state.season)} />
            <StatStrip label="Record" value={`${team.wins}–${team.losses}`} />
            <StatStrip label="Win percentage" value={recordPct(team.wins, team.losses)} />
            <StatStrip label="Conference rank" value={`#${rank}`} />
            <StatStrip label="Players" value={String(roster.length)} />
            <StatStrip
              label="Injured"
              value={injured.length ? `${injured.length} out` : 'None'}
            />
            <StatStrip
              label="Expiring"
              value={expiring.length ? `${expiring.length} deals` : 'None'}
            />
            <StatStrip label="Cap space" value={money(capSpace)} />
            <StatStrip label="Training points" value={`${team.trainingPoints} TP`} />
            <StatStrip label="Cash" value={money(team.cash)} />
          </div>

          {expiring.length > 0 && (
            <div className="contract-alert">
              <span className="eyebrow">Final contract year</span>
              <p>
                {expiring.map((player) => `${player.name} (${money(player.salary)})`).join(', ')}{' '}
                {expiring.length === 1 ? 'is' : 'are'} in the last year of the deal. They hit free
                agency when the playoffs end — re-sign on the Offseason tab.
              </p>
            </div>
          )}

          <div className="mini-grid">
            <div className="mini-tile">
              <span className="eyebrow">Next game</span>
              {opponent && next ? (
                <>
                  <div className="next-opponent">
                    <TeamMark team={opponent} size={38} />
                    <div>
                      <strong>
                        {next.home === team.id ? 'vs' : 'at'} {opponent.name}
                      </strong>
                      <span className="muted small">
                        {opponent.wins}–{opponent.losses} · {opponent.conference} #
                        {conferenceRank(state, opponent.id)}
                      </span>
                    </div>
                  </div>
                  {injured.length > 0 && (
                    <p className="muted small injury-note">
                      Out:{' '}
                      {injured
                        .slice(0, 3)
                        .map((player) => `${player.name} (${player.injuryGames}g)`)
                        .join(', ')}
                      {injured.length > 3 ? ` +${injured.length - 3} more` : ''}
                    </p>
                  )}
                  <div className="btn-row">
                    <button className="btn primary small" onClick={onSimRound}>
                      Play round
                    </button>
                    <button className="btn ghost small" onClick={onSimSeason}>
                      Sim season
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted small">
                  {state.phase === 'playoffs'
                    ? 'The playoffs are underway. Head to the bracket.'
                    : 'The offseason is here. Rebuild the roster.'}
                </p>
              )}
            </div>

            <div className="mini-tile">
              <span className="eyebrow">Front office wire</span>
              <ul className="log-list">
                {state.log.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <span className="log-season">S{entry.season}</span>
                    {entry.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Recent results</h3>
            <span className="muted small">{results.length} played</span>
          </div>
          {results.length === 0 && <p className="muted">No games played yet. Simulate round one.</p>}
          <div className="result-list">
            {results.map((game) => {
              const isHome = game.home === team.id;
              const userScore = isHome ? game.homeScore : game.awayScore;
              const oppScore = isHome ? game.awayScore : game.homeScore;
              const won = userScore > oppScore;
              const opp = state.teams[isHome ? game.away : game.home];
              return (
                <div className="result-row" key={game.id}>
                  <span className={`result-pill ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'}</span>
                  <span className="result-opp">
                    {isHome ? 'vs' : 'at'} {opp.abbr}
                  </span>
                  <span className="result-score">
                    {userScore}–{oppScore}
                  </span>
                  <button className="link-btn" onClick={() => onOpenBox(game.id)}>
                    Box
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {quest && (
          <section className="card quest-card">
            <div className="card-head">
              <h3>Daily quest</h3>
              <span className="quest-reward">{rewardLabel(quest.reward)}</span>
            </div>
            <p className="quest-title">{questLabel(quest)}</p>
            <div className="quest-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((questShown / quest.target) * 100)}%` }} />
            </div>
            <div className="quest-meta">
              <span>
                {questShown} / {quest.target}
              </span>
              <span className={questReady ? 'up' : ''}>
                {quest.claimed
                  ? 'Claimed — back tomorrow'
                  : questReady
                    ? 'Ready to claim'
                    : 'In progress'}
              </span>
            </div>
            <button
              className="btn primary small quest-claim"
              disabled={!questReady}
              onClick={onClaimQuest}
            >
              Claim {rewardLabel(quest.reward)}
            </button>
            <div className="quest-milestone">
              {nextMilestone
                ? `${quest.completed} / ${nextMilestone.quests} quests · Milestone ${milestoneLabel(nextMilestone, capFor(state))}`
                : 'All quest milestones claimed.'}
            </div>
          </section>
        )}
      </div>

      <div className="home-col">
        <section className="card status-panel">
          <div className="status-art" aria-hidden="true" />
          <div className="status-top">
            <h2>
              <span>Season</span> {phaseLabel}
            </h2>
            <span className="status-round">{roundLabel}</span>
          </div>
          <div className="strip-list">
            <StatStrip tone="hot" label="Games played" value={`${gamesPlayed} / 21`} />
            <StatStrip
              tone="hot"
              label="Point diff"
              value={`${diff >= 0 ? '+' : ''}${diff}`}
            />
            <StatStrip tone="hot" label="Payroll" value={money(payroll)} />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Hall of Fame league</h3>
            <span className="muted small">
              {hof ? `Season ${hof.season}` : `${HWD_LEAGUE_ENTRY_FEE} HWD entry`}
            </span>
          </div>
          <p className="muted small">
            {hof
              ? hof.champion
                ? `${state.teams[hof.champion]?.abbr} won the bracket${
                    hof.rewardPlayerId
                      ? `; ${state.players[hof.rewardPlayerId]?.name ?? 'a prospect'} joined them`
                      : ''
                  }.`
                : 'Your bracket is in progress — play the next game.'
              : `Ten managers, a ${HOF_TOTAL_POOL} HWD pool and one Hall of Fame NFT for the champion.`}
          </p>
          <button className="btn small" onClick={onOpenHof}>
            {hof ? 'Open bracket' : 'Open Hall of Fame'}
          </button>
        </section>

        <div className="tile-row">
          <StatTile
            label="Scoring"
            value={gamesPlayed ? (team.ptsFor / gamesPlayed).toFixed(1) : '—'}
            hint="Points per game"
          />
          <StatTile
            label="Defense"
            value={gamesPlayed ? (team.ptsAgainst / gamesPlayed).toFixed(1) : '—'}
            hint="Points allowed"
          />
        </div>

        <section className="card">
          <div className="card-head">
            <h3>Scoring leaders</h3>
            <span className="muted small">Per game</span>
          </div>
          {leaders.length === 0 && <p className="muted">Stats appear after your first game.</p>}
          <div className="table-scroll">
            <table className="table compact">
            <thead>
              <tr>
                <th className="left">Player</th>
                <th>PPG</th>
                <th>RPG</th>
                <th>APG</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((player) => (
                <tr key={player.id} onClick={() => onOpenPlayer(player.id)} className="clickable">
                  <td className="left">
                    <span className="pos-dot">{player.pos}</span>
                    {player.name}
                  </td>
                  <td>{ppg(player).toFixed(1)}</td>
                  <td>{rpg(player).toFixed(1)}</td>
                  <td>{apg(player).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
