import { useRef, useState } from 'react';
import type { GameState } from '../game/types';
import {
  activeSlot,
  clearSave,
  exportSave,
  importSave,
  loadState,
  saveSlots,
  saveState,
  selectSlot,
  type SaveSlotInfo,
} from '../game/store';
import { money, Modal } from './ui';

export function SavesModal({
  state,
  onClose,
  onLoad,
  notify,
}: {
  state: GameState;
  onClose: () => void;
  onLoad: (next: GameState) => void;
  notify: (message: string, ok: boolean) => void;
}) {
  const [slot, setSlot] = useState(activeSlot());
  const [slots, setSlots] = useState<SaveSlotInfo[]>(() => saveSlots());
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => setSlots(saveSlots());

  const saveHere = (target: string) => {
    saveState(state, target);
    selectSlot(target);
    setSlot(target);
    refresh();
    notify(`Career saved to slot ${target}.`, true);
  };

  const loadSlot = (target: string) => {
    const next = loadState(target);
    if (!next) {
      notify('That slot is empty.', false);
      return;
    }
    selectSlot(target);
    setSlot(target);
    onLoad(next);
    notify(`Loaded slot ${target}: season ${next.season}.`, true);
    onClose();
  };

  const deleteSlot = (target: string) => {
    if (!window.confirm(`Delete the save in slot ${target}? This cannot be undone.`)) return;
    clearSave(target);
    refresh();
    notify(`Slot ${target} cleared.`, false);
  };

  const download = () => {
    const blob = new Blob([exportSave(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hardwood-dynasty-s${state.season}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify('Career exported as a JSON file.', true);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const next = importSave(text);
    if (!next) {
      notify('That file is not a valid Hardwood Dynasty save.', false);
      return;
    }
    if (!window.confirm('Import this career into the current slot? The current save will be replaced.')) {
      return;
    }
    saveState(next, slot);
    selectSlot(slot);
    onLoad(next);
    refresh();
    notify(`Imported season ${next.season} into slot ${slot}.`, true);
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div className="player-head">
        <div>
          <div className="eyebrow">Front office</div>
          <h2>Saves</h2>
          <div className="muted">
            Season {state.season} · {money(state.teams[state.userTeamId].cash)} cash
          </div>
        </div>
      </div>

      <div className="save-slots">
        {slots.map((info) => {
          const team = info.teamId ? state.teams[info.teamId] : null;
          return (
            <div key={info.slot} className={`save-slot${slot === info.slot ? ' current' : ''}`}>
              <div>
                <strong>Slot {info.slot}</strong>
                <span className="muted small">
                  {info.season
                    ? `Season ${info.season}${team ? ` · ${team.abbr}` : ''}${
                        info.savedAt ? ` · ${new Date(info.savedAt).toLocaleString()}` : ''
                      }`
                    : 'Empty'}
                </span>
              </div>
              <div className="save-actions">
                <button className="btn small" onClick={() => saveHere(info.slot)}>
                  Save here
                </button>
                <button
                  className="btn small ghost"
                  disabled={!info.season}
                  onClick={() => loadSlot(info.slot)}
                >
                  Load
                </button>
                <button
                  className="btn small danger"
                  disabled={!info.season}
                  onClick={() => deleteSlot(info.slot)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="save-transfer">
        <button className="btn small" onClick={download}>
          Export career
        </button>
        <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
          Import career
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
      <p className="muted small">
        The game autosaves to the active slot after every move. Load a slot to make it active.
      </p>
    </Modal>
  );
}
