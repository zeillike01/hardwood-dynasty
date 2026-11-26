import { useEffect, useState } from 'react';
import type { GameState } from '../game/types';
import { seasonSkipQuote } from '../game/engine';

/** Countdown text for the season wait: hours and minutes, or minutes only. */
function clockText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/**
 * The offseason's single advance control. While the season clock is running it
 * shows the wait and offers the paid skip; once the wait expires it is the
 * normal start button again.
 */
export function SeasonAdvance({
  state,
  ready,
  label,
  className,
  onStart,
  onSkip,
}: {
  state: GameState;
  /** False when the roster is not legal yet, so neither action is available. */
  ready: boolean;
  label: string;
  className: string;
  onStart: () => void;
  onSkip: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), 20000);
    return () => window.clearInterval(id);
  }, []);

  const quote = seasonSkipQuote(state);
  if (quote.remainingMs === 0) {
    return (
      <div className="season-advance">
        <button className={className} disabled={!ready} onClick={onStart}>
          {label}
        </button>
      </div>
    );
  }

  const skipTitle = !ready
    ? 'Finish your offseason moves first'
    : quote.blocked ?? `Pay ${quote.cost} HWD to open the season now`;
  return (
    <div className="season-advance">
      <button className={className} disabled onClick={onStart}>
        {label}
      </button>
      <span
        className="season-advance-clock"
        title="Time left before the next season can start"
      >
        {clockText(quote.remainingMs)}
      </span>
      <button
        className="btn small"
        disabled={!ready || Boolean(quote.blocked)}
        title={skipTitle}
        onClick={onSkip}
      >
        Skip · {quote.cost} HWD
      </button>
      {quote.blocked && <span className="season-advance-note">{quote.blocked}</span>}
    </div>
  );
}
