/**
 * The piano roll's GROOVE control: a feel measured from real music (grooveFeels.ts) for the
 * clip, how much of it (Amount) and which part its notes play (drums read each row's own), or
 * "Take from audio…": the groove of an audio clip in the song (grooveFromAudio.ts), measured and
 * put on this clip. A feel from audio rides in the clip (and so in the project), and is offered
 * again for the song's other clips. The clip schedule plays it, live and in exports alike.
 */
import React, { useRef, useState } from 'react';
import { Popover } from '../Popover';
import { FxSlider } from '../inspector/InsertFx';
import { useTimelineStore } from '../../store/timelineStore';
import { GROOVE_ROLE_NAMES, GROOVE_ROLES, feelOf, type GrooveRole } from '../../store/grooveFeels';
import { feelChoices, takeGrooveFromAudio } from './grooveFeelActions';
import type { Clip } from '../../store/timelineTypes';
import { showToast } from './toastStore';

const ACCENT = '#22d3ee';
const pct = (v: number) => `${Math.round(v * 100)}%`;

export const GrooveFeelPicker: React.FC<{ clip: Clip; className: string }> = ({ clip, className }) => {
  const clips = useTimelineStore((s) => s.clips);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const feel = clip.groove?.feel;
  const current = feelOf(feel);
  const choices = feelChoices(clips);
  const audioClips = clips.filter((c) => c.audio);
  const set = (id: string) => {
    const st = useTimelineStore.getState();
    if (!id) return st.setClipFeel(clip.id, null);
    const f = choices.find((c) => c.id === id);
    if (!f) return;
    st.setClipFeel(clip.id, { id: f.id, amount: feel?.amount ?? 1, ...(feel?.role ? { role: feel.role } : {}), ...(f.id.startsWith('user-') ? { user: f } : {}) });
  };
  const fromAudio = async (audioId: string) => {
    setBusy(0);
    try {
      const name = await takeGrooveFromAudio(audioId, (f) => useTimelineStore.getState().setClipFeel(clip.id, { id: f.id, amount: 1, user: f }), (p) => setBusy(p));
      showToast(name ? `Groove taken from the audio: "${name}". Undo to take it off.` : 'No clear groove in that audio: it needs a few bars of drums or other sharp hits.');
    } catch {
      showToast('Could not read that audio clip.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative flex items-center gap-1.5">
      <label data-search="groove feel template measured real music timing velocity accent" className="flex items-center gap-1.5" title="A feel measured from real music: each part a hair early or late on each 16th, and accented the way it was played. Plays in place of the clip's swing">
        GROOVE
        <select className={className} value={current ? feel!.id : ''} onChange={(e) => set(e.target.value)} aria-label="Groove feel">
          <option value="">As written</option>
          {choices.map((f) => (
            <option key={f.id} value={f.id} title={`${f.about} (measured from ${f.from})`}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`h-6 px-1.5 rounded border text-[10px] font-mono ${open ? 'border-cyan-500 text-white' : current ? 'border-cyan-700 text-cyan-300' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        title="How much of the feel, which part the notes play, and taking a groove from an audio clip"
      >
        {current ? pct(feel!.amount) : 'FEEL…'}
      </button>
      {open && (
        <Popover label="Groove feel" onClose={() => setOpen(false)} anchorRef={anchor} className="left-0 w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-2 text-[10px] font-mono">
            {current ? (
              <>
                <p className="text-forge-text font-bold">{current.name}</p>
                <p className="text-forge-muted">
                  {current.about}. Measured from {current.from}.
                </p>
                <FxSlider label="Amount" value={feel!.amount} min={0} max={1} step={0.01} format={pct} onChange={(v) => useTimelineStore.getState().setClipFeel(clip.id, { ...feel!, amount: v }, false)} reset={1} accent={ACCENT} disabled={false} />
                <label className="flex items-center gap-2">
                  <span className="w-16 text-forge-muted uppercase">Plays as</span>
                  <select
                    className={className}
                    value={feel!.role ?? ''}
                    onChange={(e) => {
                      const { role: _r, ...rest } = feel!;
                      useTimelineStore.getState().setClipFeel(clip.id, e.target.value ? { ...rest, role: e.target.value as GrooveRole } : rest);
                    }}
                  >
                    <option value="">Found from the track</option>
                    {GROOVE_ROLES.map((r) => (
                      <option key={r} value={r} disabled={!current.roles[r]}>
                        {GROOVE_ROLE_NAMES[r]}
                        {current.roles[r] ? '' : ' (not in this feel)'}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-forge-muted">Parts this feel has: {GROOVE_ROLES.filter((r) => current.roles[r]).map((r) => GROOVE_ROLE_NAMES[r].toLowerCase()).join(', ')}. A part it doesn't have plays as written.</p>
              </>
            ) : (
              <p className="text-forge-muted">Pick a feel above: the notes move a few milliseconds early or late on each 16th and get the accents of the music it was measured from.</p>
            )}
            <div className="border-t border-forge-border pt-1.5 flex flex-col gap-1">
              <span className="text-forge-text font-bold">Take from audio</span>
              {busy !== null ? (
                <span className="text-cyan-300">Listening… {pct(busy)}</span>
              ) : audioClips.length ? (
                audioClips.slice(0, 12).map((a) => (
                  <button key={a.id} type="button" onClick={() => void fromAudio(a.id)} className="h-6 px-1.5 rounded border border-forge-border text-left text-forge-text hover:border-cyan-500 truncate" title="Measure where this audio's hits land against the bar (its start is a bar line) and play this clip with that groove">
                    {a.name} (bar {Math.round(a.startBar * 100) / 100})
                  </button>
                ))
              ) : (
                <span className="text-forge-muted">Put a loop or a song on an Audio track, starting on a bar line, to take its groove.</span>
              )}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
};
