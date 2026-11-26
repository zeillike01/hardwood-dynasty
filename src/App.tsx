import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AttrKey, GameState } from './game/types';
import {
  buyoutCost,
  buyoutPlayer,
  buySkillLevel,
  capSpaceOf,
  createLeague,
  enterOffseason,
  pendingContractPlayers,
  rosterOf,
  signedPlayers,
  simulateNextRound,
  simulatePlayoffGame,
  advanceSeason,
  seasonReady,
  seasonSkipQuote,
  skipSeasonWait,
  waivePlayer,
} from './game/engine';
import { ROSTER_MIN, SKILLS } from './game/data';
import { clearSave, loadState, saveState } from './game/store';
import { claimDailyQuest, ensureDailyQuest } from './game/quests';
import { finishHofLeague, simulateHofGame } from './game/hof';
import { money } from './components/ui';
import { BoxScoreModal, PlayerDetailModal, TeamMark } from './components/ui';
import { SavesModal } from './components/SavesModal';
import { SimOverlay } from './components/SimOverlay';
import type { SimFrame, SimJob } from './components/SimOverlay';
import { TeamDetailModal } from './components/TeamDetailModal';
import { TeamSelect } from './views/TeamSelect';
import { Dashboard } from './views/Dashboard';
import { RosterView } from './views/Roster';
import { LeagueView } from './views/League';
import { PlayoffsView } from './views/Playoffs';
import { OffseasonView } from './views/Offseason';
import { SeasonAdvance } from './components/SeasonAdvance';
import { HistoryView } from './views/History';
import { OfficeView } from './views/Office';
import { MarketView } from './views/Market';
import { HallOfFameView } from './views/HallOfFame';

type Tab =
  | 'dashboard'
  | 'roster'
  | 'league'
  | 'playoffs'
  | 'hof'
  | 'market'
  | 'offseason'
  | 'office'
  | 'history';

interface Toast {
  text: string;
  ok: boolean;
}

export default function App() {
  const [game, setGame] = useState<GameState | null>(() => {
    const loaded = loadState();
    if (!loaded) return null;
    return ensureDailyQuest(loaded);
  });
  const [tab, setTab] = useState<Tab>('dashboard');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [boxGameId, setBoxGameId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [savesOpen, setSavesOpen] = useState(false);
  const [simJob, setSimJob] = useState<SimJob | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // Roll the daily quest over when the calendar day changes.
  useEffect(() => {
    if (!game) return;
    const ensured = ensureDailyQuest(game);
    if (ensured !== game) setGame(ensured);
  }, [game]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setGame((current) => (current ? ensureDailyQuest(current) : current));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (game) saveState(game);
  }, [game]);

  // On narrow screens the tab strip scrolls; keep the active tab in view.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLButtonElement>('.tab.active');
    if (!nav || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 12);
    else if (right > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = right - nav.clientWidth + 12;
  }, [tab]);

  const notify = (text: string, ok = true) => setToast({ text, ok });

  if (!game) {
    return (
      <TeamSelect
        onStart={(teamId, settings) => {
          const next = createLeague(teamId, (Date.now() % 2_000_000_000) >>> 0, settings);
          setGame(next);
          setTab('dashboard');
          notify(
            `You are now the GM of the ${next.teams[teamId].city} ${next.teams[teamId].name}.`,
            true,
          );
        }}
        onLoad={(next) => {
          setGame(next);
          setTab('dashboard');
          notify(`Resumed season ${next.season} with the ${next.teams[next.userTeamId].abbr}.`, true);
        }}
      />
    );
  }

  const team = game.teams[game.userTeamId];
  const phase = game.phase;

  /** The user's finished game in a given round, used for the replay ticker. */
  const playedUserGameId = (state: GameState, round: number) =>
    state.schedule.find(
      (entry) =>
        entry.round === round &&
        entry.played &&
        (entry.home === state.userTeamId || entry.away === state.userTeamId),
    )?.id ?? null;

  const startSim = (job: Omit<SimJob, 'onFinish'> & { onFinish: (state: GameState) => void }) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      job.onFinish(job.frames[job.frames.length - 1].state);
      return;
    }
    setSimJob({
      ...job,
      onFinish: (state) => {
        setSimJob(null);
        job.onFinish(state);
      },
    });
  };

  const simRound = () => {
    const round = Math.min(game.round + 1, 21);
    const next = simulateNextRound(game);
    const reachedPlayoffs = game.phase === 'regular' && next.phase === 'playoffs';
    startSim({
      kind: 'round',
      title: `Round ${round}`,
      frames: [{ state: next, gameId: playedUserGameId(next, game.round), label: `Round ${round}` }],
      onFinish: (final) => {
        setGame(final);
        if (reachedPlayoffs) {
          setTab('playoffs');
          notify('The regular season is over — the playoffs are set.', true);
        }
      },
    });
  };

  const simSeason = () => {
    const frames: SimFrame[] = [];
    let next = game;
    let guard = 0;
    while (next.phase === 'regular' && guard++ < 40) {
      const round = next.round;
      next = simulateNextRound(next);
      frames.push({
        state: next,
        gameId: playedUserGameId(next, round),
        label: `Round ${Math.min(round + 1, 21)}`,
      });
    }
    if (!frames.length) return;
    startSim({
      kind: 'season',
      title: `Season ${game.season}`,
      frames,
      onFinish: (final) => {
        setGame(final);
        setTab('playoffs');
        notify(`Season ${game.season} complete. Playoff bracket locked.`, true);
      },
    });
  };

  const simPlayoffGame = () => {
    const next = simulatePlayoffGame(game);
    const champion = next.playoffs.some((series) => series.round === 3 && series.winner);
    startSim({
      kind: 'playoffs',
      title: 'Playoff game',
      frames: [{ state: next, gameId: null, label: `Playoff round ${game.playoffRound}` }],
      onFinish: (final) => {
        setGame(final);
        if (champion) notify('Championship decided.', true);
      },
    });
  };

  const simAllPlayoffs = () => {
    const frames: SimFrame[] = [];
    let next = game;
    let guard = 0;
    while (next.phase === 'playoffs' && guard++ < 120) {
      const before = JSON.stringify(next.playoffs);
      const round = next.playoffRound;
      next = simulatePlayoffGame(next);
      if (JSON.stringify(next.playoffs) === before && next.playoffRound >= 3) break;
      frames.push({ state: next, gameId: null, label: `Playoff round ${round}` });
    }
    if (!frames.length) return;
    startSim({
      kind: 'playoffs',
      title: 'Playoffs',
      frames,
      onFinish: (final) => {
        setGame(final);
        notify('Playoffs complete.', true);
      },
    });
  };

  const announceHof = (next: GameState, before: GameState) => {
    const hof = next.hof;
    if (!hof?.champion || before.hof?.champion) return;
    const drop = hof.rewardPlayerId ? next.players[hof.rewardPlayerId] : null;
    if (hof.champion === next.userTeamId) {
      notify(
        `You won the Hall of Fame league: +${hof.prize} HWD and ${drop?.name ?? 'a new player'} (${
          drop?.overall ?? 0
        } OVR).`,
        true,
      );
      return;
    }
    const club = next.teams[hof.champion];
    notify(
      `${club.city} ${club.name} won the Hall of Fame league${
        hof.prize ? `; your ${hof.userPlacement} finish paid ${hof.prize} HWD` : ''
      }.`,
      hof.userPlacement !== 'out',
    );
  };

  const simHofGame = () => {
    const result = simulateHofGame(game);
    if (!result.state) {
      notify(result.error ?? 'The bracket cannot be played.', false);
      return;
    }
    const settled = result.state;
    if (result.replay) {
      // Play the Hall of Fame game through the same overlay as a season round.
      startSim({
        kind: 'round',
        title: 'Hall of Fame game',
        frames: [
          { state: result.replay.state, gameId: result.replay.game.id, label: 'Hall of Fame' },
        ],
        onFinish: () => {
          setGame(settled);
          announceHof(settled, game);
        },
      });
      return;
    }
    setGame(settled);
    announceHof(settled, game);
  };

  const simHofBracket = () => {
    let next = game;
    let guard = 0;
    while (guard++ < 160) {
      const result = simulateHofGame(next);
      if (!result.state) break;
      next = result.state;
      if (next.hof?.champion) break;
    }
    if (next === game) {
      notify('There is no bracket left to play.', false);
      return;
    }
    setGame(next);
    announceHof(next, game);
  };

  const beginOffseason = () => {
    // The Hall of Fame league belongs to the season that opened it: settle any
    // unplayed bracket before the offseason rolls rosters over, so the games
    // use this season's clubs and an open entry never freezes offseason moves.
    const next = enterOffseason(finishHofLeague(game));
    const expired = pendingContractPlayers(next, next.userTeamId);
    setGame(next);
    setTab('offseason');
    notify(
      expired.length
        ? `${expired.length} contract${expired.length === 1 ? '' : 's'} expired — re-sign them on the Offseason tab.`
        : 'Offseason has begun.',
      expired.length === 0,
    );
  };

  const startSeason = () => {
    // An unfinished bracket would be stranded by the new league year: play it
    // out first so the entry still pays its podium and NFT.
    const settled = finishHofLeague(game);
    const signed = signedPlayers(settled, settled.userTeamId);
    if (signed.length < ROSTER_MIN) {
      notify(
        `You need ${ROSTER_MIN - signed.length} more player${
          ROSTER_MIN - signed.length === 1 ? '' : 's'
        } under contract.`,
        false,
      );
      return;
    }
    if (!seasonReady(settled)) {
      notify('The next season has not opened yet — wait it out or pay to skip the clock.', false);
      return;
    }
    const expired = pendingContractPlayers(settled, settled.userTeamId);
    if (expired.length) {
      const names = expired.map((player) => player.name).join(', ');
      if (
        !window.confirm(
          `${names} will leave as free agents because their contracts expired. Start the season anyway?`,
        )
      ) {
        return;
      }
    }
    const next = advanceSeason(settled);
    if (next === settled) {
      notify('You need a legal roster first.', false);
      return;
    }
    setGame(next);
    setTab('dashboard');
    const hofNote =
      settled !== game
        ? settled.hof?.champion === settled.userTeamId
          ? `Hall of Fame bracket settled — you won ${settled.hof.prize} HWD. `
          : 'Hall of Fame bracket settled. '
        : '';
    notify(`${hofNote}Season ${next.season} tips off.`, true);
  };

  const skipSeason = () => {
    // Every wait-clearing path settles the bracket first, same as a free start.
    const settled = finishHofLeague(game);
    const signed = signedPlayers(settled, settled.userTeamId);
    if (signed.length < ROSTER_MIN) {
      notify(
        `You need ${ROSTER_MIN - signed.length} more player${
          ROSTER_MIN - signed.length === 1 ? '' : 's'
        } under contract.`,
        false,
      );
      return;
    }
    const quote = seasonSkipQuote(settled);
    if (quote.blocked) {
      notify(quote.blocked, false);
      return;
    }
    if (
      !window.confirm(
        `Pay ${quote.cost} HWD to open season ${settled.season + 1} now? The fee goes to the development fund.`,
      )
    ) {
      return;
    }
    const result = skipSeasonWait(settled);
    if (result.error || !result.state) {
      notify(result.error ?? 'That skip could not be completed.', false);
      return;
    }
    setGame(result.state);
    setTab('dashboard');
    notify(
      `Skipped the wait for ${quote.cost} HWD. Season ${result.state.season} tips off.`,
      true,
    );
  };

  const newCareer = () => {
    if (
      window.confirm(
        'Reset the game? This erases your current career and returns you to team select.',
      )
    ) {
      clearSave();
      setGame(null);
      setTab('dashboard');
    }
  };

  const claimQuest = () => {
    const result = claimDailyQuest(game);
    if (!result) return;
    setGame(result.state);
    notify(result.message, true);
  };

  const waive = (id: string) => {
    const player = game.players[id];
    const hit = player.salary * Math.max(0, player.years);
    const note = hit > 0 ? ` ${money(hit)} of salary stays on the cap as dead money.` : '';
    if (!window.confirm(`Waive ${player.name}?${note}`)) {
      return false;
    }
    const next = waivePlayer(game, id);
    if (next === game) {
      notify(`You must keep at least ${ROSTER_MIN} players.`, false);
      return false;
    }
    setGame(next);
    notify(`${player.name} waived.`, true);
    return true;
  };

  const buySkill = (id: string, key: AttrKey) => {
    const player = game.players[id];
    const result = buySkillLevel(game, id, key);
    if (result.error || !result.state) {
      notify(result.error ?? 'That skill level could not be bought.', false);
      return;
    }
    setGame(result.state);
    notify(`${player.name}: ${SKILLS[key].name} improved.`, true);
  };

  const buyout = (id: string) => {
    const player = game.players[id];
    const cost = buyoutCost(player);
    if (
      !window.confirm(
        `Buy out ${player.name} for ${money(cost)} cash? The rest of the contract comes off the cap, and he can sign elsewhere next season.`,
      )
    ) {
      return false;
    }
    const result = buyoutPlayer(game, id);
    if (result.error || !result.state) {
      notify(result.error ?? 'That buyout could not be completed.', false);
      return false;
    }
    setGame(result.state);
    notify(`${player.name} bought out for ${money(cost)}.`, true);
    return true;
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Home' },
    { id: 'roster', label: 'Team' },
    { id: 'league', label: 'League' },
    phase === 'offseason'
      ? { id: 'offseason', label: 'Offseason' }
      : { id: 'playoffs', label: 'Playoffs' },
    { id: 'hof', label: 'HOF' },
    { id: 'market', label: 'Market' },
    { id: 'office', label: 'Office' },
    { id: 'history', label: 'History' },
  ];

  const selectedPlayer = playerId ? game.players[playerId] : null;
  const selectedGame = boxGameId ? game.schedule.find((g) => g.id === boxGameId) ?? null : null;

  const roster = rosterOf(game, game.userTeamId);
  const rated = [...roster].sort((a, b) => b.overall - a.overall).slice(0, 8);
  const ovr = rated.length
    ? (rated.reduce((sum, player) => sum + player.overall, 0) / rated.length).toFixed(1)
    : '—';
  const progress =
    phase === 'regular'
      ? `${Math.min(game.round + 1, 21)}/21`
      : phase === 'playoffs'
        ? 'PO'
        : 'OFF';

  return (
    <div className="app" style={{ '--team': team.color } as CSSProperties}>
      <header className="hud">
        <div className="hud-team">
          <span className="hud-shield" title={`Season ${game.season}`}>
            <span className="hud-shield-num">{game.season}</span>
            <span className="hud-shield-label">Season</span>
          </span>
          <TeamMark team={team} size={44} />
          <div className="hud-ovr">
            <strong>{ovr}</strong>
            <span>OVR</span>
          </div>
        </div>

        <div className="hud-chips">
          <HudChip icon={<BallIcon />} label="Record" value={`${team.wins}–${team.losses}`} />
          <HudChip icon={<CashIcon />} label="Cap space" value={money(capSpaceOf(game, team.id))} />
          <HudChip icon={<BoltIcon />} label="Training points" value={`${team.trainingPoints} TP`} />
          <HudChip icon={<StackIcon />} label="Front-office cash" value={money(team.cash)} />
          <HudChip icon={<TokenIcon />} label="HWD tokens" value={`${game.hwd ?? 0} HWD`} />
          <HudChip icon={<ClockIcon />} label="Season progress" value={progress} />
        </div>
      </header>

      <div className="navrow">
        <nav className="tabs" ref={navRef}>
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`tab${tab === item.id ? ' active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="navrow-actions">
          {phase === 'regular' && (
            <button className="tab-action" onClick={simRound}>
              Sim round
            </button>
          )}
          {phase === 'playoffs' && (
            <button className="tab-action" onClick={simPlayoffGame}>
              Sim game
            </button>
          )}
          {phase === 'offseason' && (
            <SeasonAdvance
              state={game}
              ready={signedPlayers(game, game.userTeamId).length >= ROSTER_MIN}
              label={`Start season ${game.season + 1}`}
              className="tab-action"
              onStart={startSeason}
              onSkip={skipSeason}
            />
          )}
          {phase === 'regular' && (
            <button className="ghost-tab" onClick={simSeason}>
              Sim season
            </button>
          )}
          {phase === 'playoffs' && (
            <button className="ghost-tab" onClick={simAllPlayoffs}>
              Sim all
            </button>
          )}
          <button
            className="ghost-tab save-tab"
            onClick={() => setSavesOpen(true)}
            title="Save slots, export and import"
          >
            Saves
          </button>
          <button
            className="new-game-btn"
            onClick={newCareer}
            title="Reset the game and start a new career"
          >
            <GearIcon />
            <span className="new-game-label">New game</span>
          </button>
        </div>
      </div>

      <main className="container">
        {tab === 'dashboard' && (
          <Dashboard
            state={game}
            onSimRound={simRound}
            onSimSeason={simSeason}
            onOpenPlayer={setPlayerId}
            onOpenBox={setBoxGameId}
            onClaimQuest={claimQuest}
            onOpenHof={() => setTab('hof')}
          />
        )}
        {tab === 'roster' && (
          <RosterView
            state={game}
            onOpenPlayer={setPlayerId}
            onState={setGame}
            notify={notify}
          />
        )}
        {tab === 'league' && (
          <LeagueView
            state={game}
            onOpenBox={setBoxGameId}
            onOpenTeam={setTeamId}
            onOpenPlayer={setPlayerId}
          />
        )}
        {tab === 'playoffs' && (
          <PlayoffsView
            state={game}
            onSimGame={simPlayoffGame}
            onSimPlayoffs={simAllPlayoffs}
            onBeginOffseason={beginOffseason}
          />
        )}
        {tab === 'hof' && (
          <HallOfFameView
            state={game}
            onState={setGame}
            notify={notify}
            onSimGame={simHofGame}
            onSimBracket={simHofBracket}
          />
        )}
        {tab === 'market' && (
          <MarketView
            state={game}
            onState={setGame}
            notify={notify}
            onOpenPlayer={setPlayerId}
          />
        )}
        {tab === 'office' && (
          <OfficeView state={game} onState={setGame} notify={notify} />
        )}
        {tab === 'history' && <HistoryView state={game} onOpenPlayer={setPlayerId} />}
        {tab === 'offseason' && (
          <OffseasonView
            state={game}
            onState={setGame}
            onStartSeason={startSeason}
            onSkipSeason={skipSeason}
            notify={notify}
            onOpenPlayer={setPlayerId}
          />
        )}
      </main>

      {selectedPlayer && (
        <PlayerDetailModal
          state={game}
          player={selectedPlayer}
          onClose={() => setPlayerId(null)}
          onWaive={waive}
          onBuyout={buyout}
          onBuySkill={buySkill}
        />
      )}
      {selectedGame && (
        <BoxScoreModal state={game} game={selectedGame} onClose={() => setBoxGameId(null)} />
      )}
      {teamId && (
        <TeamDetailModal
          state={game}
          teamId={teamId}
          onClose={() => setTeamId(null)}
          onOpenPlayer={setPlayerId}
        />
      )}
      {simJob && <SimOverlay job={simJob} />}
      {savesOpen && (
        <SavesModal
          state={game}
          onClose={() => setSavesOpen(false)}
          onLoad={(next) => setGame(next)}
          notify={notify}
        />
      )}

      {toast && (
        <div className={`toast${toast.ok ? '' : ' bad'}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          <button
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function HudChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className="hud-chip" title={label}>
      <span className="hud-chip-icon">{icon}</span>
      <span className="hud-chip-value">{value}</span>
    </span>
  );
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function BallIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18M5.7 5.7c3.4 3.4 3.4 9.2 0 12.6M18.3 5.7c-3.4 3.4-3.4 9.2 0 12.6" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg {...svgProps}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.6" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg {...svgProps}>
      <ellipse cx="12" cy="6.4" rx="7.4" ry="3.1" />
      <path d="M4.6 6.4v5.2c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1V6.4" />
      <path d="M4.6 11.6v5.2c0 1.7 3.3 3.1 7.4 3.1s7.4-1.4 7.4-3.1v-5.2" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.4 8.4h4.1a2.4 2.4 0 0 1 0 4.8H9.4V8.4zM9.4 13.2v3.4M9.4 11h4.2" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg {...svgProps}>
      <path d="M13.4 2.6 5.8 13.2h5l-1.5 8.2 8.8-11.4h-5.2z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.4l3.4 2" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.6v2.9M12 18.5v2.9M2.6 12h2.9M18.5 12h2.9M5.4 5.4l2 2M16.6 16.6l2 2M18.6 5.4l-2 2M7.4 16.6l-2 2" />
    </svg>
  );
}
