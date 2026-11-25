import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game, GameState } from '../game/types';
import { buildReplay } from '../game/replay';
import { recentResults } from '../game/engine';
import { TeamMark } from './ui';

export interface SimFrame {
  state: GameState;
  /** The user's finished game in this frame, if the frame produced one. */
  gameId: string | null;
  label: string;
}

export interface SimJob {
  kind: 'round' | 'season' | 'playoffs';
  title: string;
  frames: SimFrame[];
  onFinish: (state: GameState) => void;
}

const HOLD_MS = 650;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function SimOverlay({ job }: { job: SimJob }) {
  const finalState = job.frames[job.frames.length - 1].state;
  const finished = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const roundFrame = job.kind === 'round' ? job.frames[0] : null;
  const roundGame: Game | null = useMemo(() => {
    if (!roundFrame?.gameId) return null;
    return roundFrame.state.schedule.find((game) => game.id === roundFrame.gameId) ?? null;
  }, [roundFrame]);
  const plays = useMemo(
    () => (roundFrame && roundGame ? buildReplay(roundFrame.state, roundGame) : []),
    [roundFrame, roundGame],
  );

  const duration =
    job.kind === 'round'
      ? plays.length
        ? clamp(plays.length * 46, 2200, 4200)
        : 1100
      : job.kind === 'season'
        ? 4200
        : job.frames.length > 1
          ? clamp(job.frames.length * 260, 1600, 4200)
          : 1800;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    job.onFinish(finalState);
  };

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const ms = now - start;
      setElapsed(ms);
      if (ms >= duration + HOLD_MS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = clamp(elapsed / duration, 0, 1);
  const frameIndex = Math.min(
    job.frames.length - 1,
    Math.floor(progress * job.frames.length),
  );
  const frame = job.frames[frameIndex];

  return (
    <div className="sim-backdrop" role="presentation">
      <div className="sim-panel" role="dialog" aria-modal="true" aria-label={`Simulating ${job.title}`}>
        <div className="sim-head">
          <div>
            <span className="eyebrow">Simulating</span>
            <div className="sim-title">{job.title}</div>
          </div>
          <button className="btn ghost small" onClick={finish}>
            Skip
          </button>
        </div>

        {job.kind === 'round' && roundFrame && roundGame ? (
          <RoundBody frame={roundFrame} game={roundGame} plays={plays} progress={progress} />
        ) : job.kind === 'season' ? (
          <SeasonBody frame={frame} progress={progress} />
        ) : (
          <PlayoffBody frame={frame} />
        )}

        <div className="sim-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="sim-foot">
          <span>{job.kind === 'season' ? 'Fast-forwarding the schedule' : 'Playing it out'}</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

function RoundBody({
  frame,
  game,
  plays,
  progress,
}: {
  frame: SimFrame;
  game: Game;
  plays: ReturnType<typeof buildReplay>;
  progress: number;
}) {
  const state = frame.state;
  const home = state.teams[game.home];
  const away = state.teams[game.away];
  const shown = plays.slice(0, Math.floor(progress * plays.length));
  const live = shown[shown.length - 1] ?? null;
  const homeScore = live?.homeScore ?? 0;
  const awayScore = live?.awayScore ?? 0;
  const feed = shown.slice(-7);

  const others = state.schedule.filter(
    (other) => other.played && other.id !== game.id && other.round === game.round,
  );
  const revealedOthers = Math.ceil(progress * others.length);

  return (
    <>
      <div className="sim-score">
        <div className="sim-team">
          <TeamMark team={away} size={34} />
          <div>
            <strong>{away.abbr}</strong>
            <span className="sim-team-name">{away.name}</span>
          </div>
        </div>
        <div className="sim-points">
          {awayScore} <span>–</span> {homeScore}
        </div>
        <div className="sim-team home">
          <TeamMark team={home} size={34} />
          <div>
            <strong>{home.abbr}</strong>
            <span className="sim-team-name">{home.name}</span>
          </div>
        </div>
      </div>
      <div className="sim-mid">
        {progress >= 1 ? (
          <strong>Final</strong>
        ) : live ? (
          <strong>
            Q{live.quarter} · {live.clock}
          </strong>
        ) : (
          <strong>Tip-off</strong>
        )}
      </div>

      <div className="sim-feed" aria-live="polite">
        {feed.length === 0 && <div className="sim-play muted">Tip-off…</div>}
        {feed.map((play, index) => (
          <div
            key={play.id}
            className={`sim-play${index === feed.length - 1 ? ' latest' : ''}`}
          >
            <span className="sim-clock">
              Q{play.quarter} {play.clock}
            </span>
            <span>{play.text}</span>
            <span className="sim-score">
              {play.awayScore}–{play.homeScore}
            </span>
          </div>
        ))}
      </div>

      {others.length > 0 && (
        <div className="sim-around">
          {others.map((other, index) => {
            const otherHome = state.teams[other.home];
            const otherAway = state.teams[other.away];
            const revealed = index < revealedOthers;
            return (
              <div className="sim-around-row" key={other.id}>
                <span>
                  {otherAway.abbr} <span className="sim-at">at</span> {otherHome.abbr}
                </span>
                <strong>{revealed ? `${other.awayScore}–${other.homeScore}` : '· · ·'}</strong>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function SeasonBody({ frame, progress }: { frame: SimFrame; progress: number }) {
  const state = frame.state;
  const team = state.teams[state.userTeamId];
  const results = recentResults(state, 5);

  return (
    <>
      <div className="sim-score sim-score-season">
        <div className="sim-team">
          <TeamMark team={team} size={34} />
          <div>
            <strong>{team.abbr}</strong>
            <span className="sim-team-name">{frame.label}</span>
          </div>
        </div>
        <div className="sim-record">
          <strong>
            {team.wins}–{team.losses}
          </strong>
          <span>record</span>
        </div>
        <div className="sim-team home">
          <div>
            <strong>
              {Math.min(21, state.round + (state.phase === 'regular' ? 1 : 0))}
              <span className="sim-round-total"> / 21</span>
            </strong>
            <span className="sim-team-name">Round</span>
          </div>
        </div>
      </div>

      <div className="sim-feed">
        {results.map((result) => {
          const isHome = result.home === team.id;
          const userScore = isHome ? result.homeScore : result.awayScore;
          const oppScore = isHome ? result.awayScore : result.homeScore;
          const opp = state.teams[isHome ? result.away : result.home];
          const won = userScore > oppScore;
          return (
            <div className="sim-result" key={result.id}>
              <span className={`sim-result-pill ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'}</span>
              <span>
                {isHome ? 'vs' : 'at'} {opp.abbr}
              </span>
              <span className="sim-result-score">
                {userScore}–{oppScore}
              </span>
              <span className="muted small">Round {result.round + 1}</span>
            </div>
          );
        })}
        {results.length === 0 && <div className="sim-play muted">Tip-off…</div>}
      </div>

      <div className="sim-note">
        {progress >= 1
          ? 'Regular season complete — building the playoff bracket.'
          : 'Games are resolving one round at a time.'}
      </div>
    </>
  );
}

function PlayoffBody({ frame }: { frame: SimFrame }) {
  const state = frame.state;
  const series = state.playoffs.filter((entry) => entry.round === state.playoffRound);
  const roundLabel =
    series[0]?.label ?? (state.playoffRound > 1 ? 'Playoffs' : 'First Round');

  return (
    <>
      <div className="sim-mid sim-mid-top">
        <strong>{roundLabel}</strong>
      </div>
      <div className="sim-series">
        {series.map((entry) => {
          const high = state.teams[entry.high];
          const low = state.teams[entry.low];
          const mine = entry.high === state.userTeamId || entry.low === state.userTeamId;
          return (
            <div className={`sim-series-row${mine ? ' mine' : ''}`} key={entry.id}>
              <span>{high.abbr}</span>
              <strong>
                {entry.highWins}–{entry.lowWins}
              </strong>
              <span>{low.abbr}</span>
              <span className="sim-series-status">
                {entry.winner
                  ? `${state.teams[entry.winner].abbr} advance`
                  : `Game ${entry.games.length + 1}`}
              </span>
            </div>
          );
        })}
        {series.length === 0 && <div className="sim-play muted">Playoffs are set…</div>}
      </div>
      <div className="sim-note">
        {state.playoffs.some((entry) => entry.round === 3 && entry.winner)
          ? 'The championship is decided.'
          : 'Playoff games are resolving series by series.'}
      </div>
    </>
  );
}
