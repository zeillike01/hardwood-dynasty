import type { GameState } from '../game/types';
import { FACILITIES, FACILITY_MAX_LEVEL, type FacilityKey } from '../game/data';
import {
  facilityLevels,
  facilityUpgradeCost,
  upgradeFacility,
  userTeam,
} from '../game/engine';
import { money } from '../components/ui';

export function OfficeView({
  state,
  onState,
  notify,
}: {
  state: GameState;
  onState: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
}) {
  const team = userTeam(state);
  const levels = facilityLevels(state);
  const dead = (team.deadMoney ?? []).reduce((sum, deal) => sum + deal.salary, 0);

  const upgrade = (key: FacilityKey) => {
    const result = upgradeFacility(state, key);
    const def = FACILITIES.find((entry) => entry.key === key);
    if (result.error || !result.state) {
      notify(result.error ?? 'Upgrade failed.', false);
      return;
    }
    onState(result.state);
    notify(`${def?.name ?? 'Facility'} upgraded to level ${levels[key] + 1}.`, true);
  };

  return (
    <div className="office">
      <section className="card office-head">
        <div>
          <div className="eyebrow">Front office</div>
          <h1>Build the operation</h1>
          <p className="muted">
            Facilities are paid in front-office cash, never cap space. Each one runs three levels
            and its benefits last for the rest of the career.
          </p>
          {dead > 0 && (
            <p className="muted small">
              Dead money: {money(dead)} of waived salary still counts against the cap this season.
            </p>
          )}
        </div>
        <div className="office-cash">
          <span className="eyebrow">Cash on hand</span>
          <strong>{money(team.cash)}</strong>
          <span className="muted small">from prizes, quests and TP conversion</span>
        </div>
      </section>

      <div className="office-grid">
        {FACILITIES.map((def) => {
          const level = levels[def.key];
          const cost = facilityUpgradeCost(state, def.key);
          const maxed = level >= FACILITY_MAX_LEVEL;
          return (
            <article key={def.key} className={`facility${level > 0 ? ' built' : ''}`}>
              <header className="facility-head">
                <div>
                  <span className="eyebrow">Facility</span>
                  <h2>{def.name}</h2>
                </div>
                <span className="facility-level">
                  L{level}/{FACILITY_MAX_LEVEL}
                </span>
              </header>
              <p className="muted small">{def.blurb}</p>
              <div className="facility-pips" aria-hidden="true">
                {Array.from({ length: FACILITY_MAX_LEVEL }).map((_, index) => (
                  <span key={index} className={index < level ? 'on' : ''} />
                ))}
              </div>
              <div className="facility-effect">
                <span className="eyebrow">
                  {maxed ? 'Current impact' : level > 0 ? 'Next level' : 'Level 1'}
                </span>
                <strong>{def.effects[Math.min(level, FACILITY_MAX_LEVEL - 1)]}</strong>
              </div>
              <button
                className="btn primary"
                disabled={maxed || cost === null || cost > team.cash}
                onClick={() => upgrade(def.key)}
              >
                {maxed ? 'Max level' : `Upgrade · ${money(cost ?? 0)}`}
              </button>
            </article>
          );
        })}
      </div>

      <section className="card office-note">
        <div>
          <span className="eyebrow">Contract buyouts</span>
          <p className="muted small">
            Open any player on your roster to buy out the rest of his deal. A buyout pays 60% of the
            remaining salary in cash and clears the cap hit; waiving him is free but leaves the
            salary on the cap as dead money.
          </p>
        </div>
        <div>
          <span className="eyebrow">Scouting</span>
          <p className="muted small">
            Scouting reports in the draft are billed per prospect; the scouting department cuts that
            price and tightens every rating range.
          </p>
        </div>
        <div>
          <span className="eyebrow">Skill academy</span>
          <p className="muted small">
            Open any player on your roster to buy targeted skill levels with cash. The player
            development center discounts every session and adds an extra level at its final tier.
            The academy is frozen while a Hall of Fame bracket is live.
          </p>
        </div>
      </section>
    </div>
  );
}
