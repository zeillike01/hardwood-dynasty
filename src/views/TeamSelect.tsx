import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DIFFICULTY,
  SCENARIOS,
  TEAM_BLUEPRINTS,
  type Difficulty,
  type Scenario,
} from '../game/data';
import type { Conf, GameState } from '../game/types';
import { loadState, saveSlots, selectSlot } from '../game/store';

export function TeamSelect({
  onStart,
  onLoad,
}: {
  onStart: (teamId: string, settings: { difficulty: Difficulty; scenario: Scenario }) => void;
  onLoad: (state: GameState) => void;
}) {
  const [selected, setSelected] = useState<string>(TEAM_BLUEPRINTS[0].id);
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [scenario, setScenario] = useState<Scenario>('rebuild');
  const conferences: Conf[] = ['East', 'West'];
  const difficulties = Object.entries(DIFFICULTY) as [Difficulty, (typeof DIFFICULTY)[Difficulty]][];
  const scenarios = Object.entries(SCENARIOS) as [Scenario, (typeof SCENARIOS)[Scenario]][];
  const saves = saveSlots().filter((info) => info.season);

  const resume = (slot: string) => {
    const next = loadState(slot);
    if (!next) return;
    selectSlot(slot);
    onLoad(next);
  };

  return (
    <div className="setup">
      <div className="setup-head">
        <div className="brand large">
          <span className="brand-ball" />
          HARDWOOD <span>DYNASTY</span>
        </div>
        <h1>Take the job. Build the dynasty.</h1>
        <p className="muted">
          Twelve franchises, one trophy. Draft, sign and manage the cap through 21-game seasons,
          then chase a championship. Your choices are saved automatically.
        </p>
      </div>

      <div className="setup-conferences">
        {conferences.map((conf) => (
          <div className="setup-conf" key={conf}>
            <div className="eyebrow">{conf} Conference</div>
            <div className="team-grid">
              {TEAM_BLUEPRINTS.filter((team) => team.conference === conf).map((team) => (
                <button
                  key={team.id}
                  className={`team-card${selected === team.id ? ' selected' : ''}`}
                  onClick={() => setSelected(team.id)}
                  style={{ '--team': team.color } as CSSProperties}
                >
                  <span className="team-abbr" style={{ color: team.color }}>
                    {team.abbr}
                  </span>
                  <span className="team-name">
                    {team.city}
                    <strong>{team.name}</strong>
                  </span>
                  <span className="team-arena">{team.arena}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {saves.length > 0 && (
        <div className="setup-options">
          <div className="option-group">
            <div className="eyebrow">Continue a saved career</div>
            <div className="option-row">
              {saves.map((info) => (
                <button key={info.slot} className="option-card" onClick={() => resume(info.slot)}>
                  <strong>Slot {info.slot}</strong>
                  <span className="muted small">
                    Season {info.season} · {info.teamId ?? 'Career'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="setup-options">
        <div className="option-group">
          <div className="eyebrow">Start scenario</div>
          <div className="option-row">
            {scenarios.map(([id, info]) => (
              <button
                key={id}
                className={`option-card${scenario === id ? ' selected' : ''}`}
                onClick={() => setScenario(id)}
                title={info.blurb}
              >
                <strong>{info.label}</strong>
                <span className="muted small">{info.blurb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="option-group">
          <div className="eyebrow">Difficulty</div>
          <div className="option-row">
            {difficulties.map(([id, info]) => (
              <button
                key={id}
                className={`option-card small-option${
                  difficulty === id ? ' selected' : ''
                }`}
                onClick={() => setDifficulty(id)}
                title={info.blurb}
              >
                <strong>{info.label}</strong>
                <span className="muted small">{info.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="setup-footer">
        <span className="muted">
          You will run the {TEAM_BLUEPRINTS.find((t) => t.id === selected)?.city}{' '}
          {TEAM_BLUEPRINTS.find((t) => t.id === selected)?.name} on{' '}
          {DIFFICULTY[difficulty].label.toLowerCase()} difficulty, starting as a{' '}
          {SCENARIOS[scenario].label.toLowerCase()}.
        </span>
        <button
          className="btn primary"
          onClick={() => onStart(selected, { difficulty, scenario })}
        >
          Take over franchise
        </button>
      </div>
    </div>
  );
}
