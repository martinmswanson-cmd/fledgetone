/**
 * The right-click menu for clips and empty lane space (edit, copy, duplicate, repeat, delete, new
 * clip, insert pattern, paste, load audio, smart tools), and the menu items other menus share.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Dices, Drum, Music4, Grid3x3, AudioLines, Layers, ArrowRightToLine, AudioWaveform, ClipboardPaste, Copy, CopyPlus, FileAudio, FlipHorizontal2, Piano, Plus, Repeat2, Scissors, Shuffle, Slice, Trash2, Sigma, ChevronsRight, Link2, Unlink } from 'lucide-react';
import { reverseBlock } from '../../store/reverseActions';
import { doubleClip } from '../../store/vocalActions';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { patternsFor } from '../../store/demoSong';
import { formatBarCount } from '../../store/timelineTypes';
import { canMoveClipBetween, isAudioKind, isDrumKind } from '../../audio/instrumentCatalog';
import { isMixTrack } from '../../store/buses';
import { bassForChords, chordsForMelody, fillClipBar, rollClipDrums, useSmartDialog } from '../../store/smartActions';
import { FILLS } from '../../store/smartTools';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';
import { dropAudioFiles, pickAudioFiles } from './audioFiles';
import { openArrange } from './arrangeDialogStore';
import { sendSelectionToLauncher } from '../../store/launcher';
import { showToast } from './toastStore';
import { patternSize } from '../../store/patterns';
import { speedUpIntoDrop } from '../../store/speedUpActions';
import { SPEED_UP_DEFAULTS } from '../../store/speedUp';

export interface ContextMenuState {
  x: number;
  y: number;
  /** Snapped bar under the pointer; used by "Paste here". */
  bar: number;
  /** Track (lane) under the pointer. */
  trackId: string;
  /** Set when the menu was opened on a clip. */
  clipId: string | null;
}

interface ClipContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  /** "Chop sample…" on an audio clip: open that dialog for the clip. */
  onChop?: (clipId: string) => void;
  /** Open Generate variations for a clip */
  onVariations?: (clipId: string) => void;
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export interface MenuItemProps {
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  divider?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({ label, shortcut, icon, onClick, disabled, divider }) => (
  <>
    {divider && <div className="my-1 border-t border-forge-border" role="separator" />}
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-forge-text hover:bg-cyan-500/20 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
    >
      {icon}
      <span className="flex-1">{label}</span>
      <span className="text-forge-muted text-[10px]">{shortcut}</span>
    </button>
  </>
);

/** Why the last menu action did nothing, shown in the menu (which stays open). */
export const MenuNotice: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <div role="alert" className="mx-2 mt-1 mb-0.5 px-2 py-1.5 rounded border border-red-500/50 bg-red-500/10 text-[11px] leading-snug text-red-200">
      {text}
    </div>
  ) : null;

const MAX_REPEATS = 64;

/** "Repeat ×N": a number box in the menu. Enter (or OK) makes the copies. */
const RepeatForm: React.FC<{ onRepeat: (times: number) => void }> = ({ onRepeat }) => {
  const [text, setText] = useState('2');
  const input = useRef<HTMLInputElement>(null);
  // Focus without scrolling the page, which would close the menu
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  const times = /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  const valid = times >= 1 && times <= MAX_REPEATS;
  return (
    <form
      className="flex items-center gap-2 px-3 py-1 text-forge-text"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onRepeat(times);
      }}
    >
      <Repeat2 className="w-3.5 h-3.5" />
      <label htmlFor="repeat-times" className="flex-1">
        Repeat ×
      </label>
      <input
        id="repeat-times"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_REPEATS}
        step={1}
        ref={input}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={!valid}
        title={`How many copies, 1 to ${MAX_REPEATS}`}
        className={`w-14 h-6 px-1.5 rounded bg-forge-bg border text-right tabular-nums text-forge-text focus:outline-none ${
          valid ? 'border-forge-borderLight focus:border-cyan-500' : 'border-red-500'
        }`}
      />
      <button
        type="submit"
        disabled={!valid}
        className="h-6 px-2 rounded border border-forge-borderLight text-forge-text hover:border-cyan-500 hover:bg-cyan-500/20 disabled:opacity-40 disabled:pointer-events-none"
      >
        OK
      </button>
    </form>
  );
};

/**
 * Right-click menu for clips (Edit / Copy / Cut / Duplicate / Repeat / Fill / Delete; an audio
 * clip: Gain and fades, Chop sample) and empty lane space (New clip, Insert pattern, Paste; on
 * an Audio track: Load audio file). Also opened by a track header's + button.
 */
export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({ menu, onClose, onChop, onVariations }) => {
  const ref = useRef<HTMLDivElement>(null);
  const hasClipboard = useTimelineStore((s) => s.clipboard.length > 0);
  const loopOut = useTimelineStore((s) => s.loopRegion.outBar);
  const [notice, setNotice] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, menu.x, menu.y);

  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === menu.trackId);
  const menuClip = menu.clipId ? s.clips.find((c) => c.id === menu.clipId) : undefined;
  const audioClip = !!menuClip?.audio;
  const takeCount = menuClip?.takes?.length ?? 0;
  const audioLane = !!track && isAudioKind(track.instrumentKey);
  /** Run an action and close, unless it returns a message saying why it couldn't: then show that. */
  const run = (action: () => string | null | void) => () => {
    const message = action();
    if (typeof message === 'string') setNotice(message);
    else onClose();
  };

  // Clips copied from one track paste onto this lane if its instrument can play them
  const pastesOntoLane =
    !!track &&
    s.clipboardInstrument !== null &&
    canMoveClipBetween(s.clipboardInstrument, track.instrumentKey) &&
    s.clipboard.some((c) => c.trackId !== track.id);
  const pasteHere: MenuItemProps = {
    label: 'Paste here',
    shortcut: pastesOntoLane ? 'this track' : '',
    icon: <ClipboardPaste className="w-3.5 h-3.5" />,
    onClick: run(() => s.pasteClips(menu.bar, menu.trackId)),
    disabled: !hasClipboard,
  };

  type Item = MenuItemProps & { key: string };

  const drumLane = !!track && isDrumKind(track.instrumentKey);
  const pitchedLane = !!track && !audioLane && !drumLane && !isMixTrack(track);
  const noteClip = !!menuClip && !audioClip;
  const openSmart = (mode: 'chords' | 'drummer' | 'math') => run(() => useSmartDialog.setState({ open: { mode, trackId: menu.trackId, bar: Math.max(1, Math.floor(menu.bar + 1e-6)) } }));
  // Writing helpers: fills on a drum clip, chords and a bass line from a note clip
  const smartClipItems: Item[] = !noteClip
    ? []
    : drumLane
      ? [
          {
            key: 'roll-beat',
            label: 'Roll the beat again',
            shortcut: 'new hats, same kick',
            icon: <Dices className="w-3.5 h-3.5" />,
            onClick: run(() => {
              rollClipDrums(menu.clipId!);
            }),
            divider: true,
          },
          ...FILLS.map((f, i) => ({
            key: `fill-${f.id}`,
            label: `Fill: ${f.name.toLowerCase()}`,
            shortcut: i === 0 ? 'this bar' : '',
            icon: <Drum className="w-3.5 h-3.5" />,
            onClick: run(() => {
              fillClipBar(menu.clipId!, menu.bar, f.id);
            }),
          })),
        ]
      : pitchedLane
        ? [
            {
              key: 'harmonize',
              label: 'Chords for this melody',
              shortcut: 'new track',
              icon: <Music4 className="w-3.5 h-3.5" />,
              onClick: run(() => {
                const names = chordsForMelody(menu.clipId!);
                if (!names) return 'This clip has no notes to write chords for.';
                showToast(`Chords on a new track: ${names.join(' ')}`);
              }),
              divider: true,
            },
            {
              key: 'melody',
              label: 'Melody variations…',
              shortcut: 'answer, darker…',
              icon: <Music4 className="w-3.5 h-3.5" />,
              onClick: run(() => useSmartDialog.setState({ open: { mode: 'melody', trackId: menu.trackId, bar: menu.bar, clipId: menu.clipId! } })),
            },
            {
              key: 'bassline',
              label: 'Bass line from these chords',
              shortcut: 'new track',
              icon: <Music4 className="w-3.5 h-3.5" />,
              onClick: run(() => {
                if (!bassForChords(menu.clipId!)) return 'This clip has no notes to write a bass line under.';
                showToast('A bass line on a new track, on the roots of these chords');
              }),
            },
            {
              key: 'accompany',
              label: 'Accompaniment for these chords…',
              shortcut: 'new track',
              icon: <Music4 className="w-3.5 h-3.5" />,
              onClick: run(() => useSmartDialog.setState({ open: { mode: 'accompany', trackId: menu.trackId, bar: menu.bar, clipId: menu.clipId! } })),
            },
          ]
        : [];
  const newClip = (bars: number): Item => ({
    key: `new-${bars}`,
    label: `New empty clip (${bars} bar${bars === 1 ? '' : 's'})`,
    shortcut: bars === 1 ? 'dbl-click' : '',
    icon: <Piano className="w-3.5 h-3.5" />,
    onClick: run(() => {
      // On the beat, as a double-click makes one
      const id = track && s.createEmptyClip(track.id, Math.floor(menu.bar * 4 + 1e-6) / 4, bars);
      if (id) s.openEditor(id);
    }),
  });

  const items: Item[] = menu.clipId
    ? [
        audioClip
          ? { key: 'edit', label: 'Gain and fades', shortcut: 'dbl-click', icon: <AudioWaveform className="w-3.5 h-3.5" />, onClick: run(() => s.openEditor(menu.clipId!)) }
          : { key: 'edit', label: 'Edit notes', shortcut: 'dbl-click', icon: <Piano className="w-3.5 h-3.5" />, onClick: run(() => s.openEditor(menu.clipId!)) },
        ...(takeCount
          ? [{ key: 'takes', label: `Takes (${takeCount})…`, shortcut: 'comp', icon: <Layers className="w-3.5 h-3.5" />, onClick: run(() => useUiStore.getState().setTakesClip(menu.clipId!)) }]
          : []),
        ...(audioClip && onChop
          ? [
              { key: 'chop', label: 'Chop sample…', icon: <Slice className="w-3.5 h-3.5" />, onClick: run(() => onChop(menu.clipId!)) },
              {
                key: 'tune',
                label: 'Tune vocal…',
                shortcut: takeCount > 1 ? 'flatten first' : '',
                icon: <AudioLines className="w-3.5 h-3.5" />,
                onClick: run(() => useUiStore.getState().setTuneClip(menu.clipId!)),
                // A take folder plays several sounds: tune it once it's flattened
                disabled: takeCount > 1,
              },
              {
                key: 'hardTune',
                label: 'Hard tune…',
                shortcut: takeCount > 1 ? 'flatten first' : 'robotic',
                icon: <AudioLines className="w-3.5 h-3.5" />,
                onClick: run(() => useUiStore.getState().setTuneClip(menu.clipId!, true)),
                disabled: takeCount > 1,
              },
              {
                key: 'double',
                label: 'Double this take',
                shortcut: takeCount > 1 ? 'flatten first' : 'L + R',
                icon: <CopyPlus className="w-3.5 h-3.5" />,
                onClick: run(() => {
                  showToast('Doubling the take…');
                  void doubleClip(menu.clipId!).then(showToast, (err) => showToast(`Couldn't double it: ${err instanceof Error ? err.message : String(err)}`));
                }),
                disabled: takeCount > 1,
              },
            ]
          : []),
        ...(onVariations
          ? [{ key: 'variations', label: 'Generate variations…', shortcut: 'game SFX', icon: <Shuffle className="w-3.5 h-3.5" />, onClick: run(() => onVariations(menu.clipId!)) }]
          : []),
        { key: 'copy', label: 'Copy', shortcut: `${MOD}C`, icon: <Copy className="w-3.5 h-3.5" />, onClick: run(s.copySelectedClips), divider: true },
        { key: 'cut', label: 'Cut', shortcut: `${MOD}X`, icon: <Scissors className="w-3.5 h-3.5" />, onClick: run(s.cutSelectedClips) },
        { key: 'paste', ...pasteHere },
        { key: 'duplicate', label: 'Duplicate', shortcut: `${MOD}D`, icon: <CopyPlus className="w-3.5 h-3.5" />, onClick: run(s.duplicateSelection), divider: true },
        ...(menuClip && !menuClip.audio
          ? [
              {
                key: 'duplicateLinked',
                label: 'Duplicate linked',
                shortcut: `${MOD}⇧D`,
                icon: <Link2 className="w-3.5 h-3.5" />,
                onClick: run(() => {
                  const message = s.duplicateLinked();
                  if (message) showToast(message);
                }),
              },
            ]
          : []),
        ...(menuClip && patternSize(s.clips, menuClip.pattern) > 1
          ? [
              {
                key: 'unique',
                label: 'Make unique',
                shortcut: `linked ×${patternSize(s.clips, menuClip.pattern)}`,
                icon: <Unlink className="w-3.5 h-3.5" />,
                onClick: run(() => s.makeClipsUnique(menuClip.isSelected ? s.clips.filter((c) => c.isSelected).map((c) => c.id) : [menuClip.id])),
              },
            ]
          : []),
        { key: 'repeat', label: 'Repeat ×N…', icon: <Repeat2 className="w-3.5 h-3.5" />, onClick: () => setRepeating(true) },
        // Speed up the end of the block under the pointer (this clip, or every selected clip with it)
        // into what follows: two one-click versions, and the options
        ...(() => {
          const picked = menuClip?.isSelected ? s.clips.filter((c) => c.isSelected) : menuClip ? [menuClip] : [];
          if (!picked.length) return [];
          const from = Math.min(...picked.map((c) => c.startBar));
          const to = Math.max(...picked.map((c) => c.startBar + c.lengthBars));
          const quick = (amount: number, roll: boolean) => () => {
            onClose();
            showToast(speedUpIntoDrop({ ...SPEED_UP_DEFAULTS, from, to, amount, curve: roll ? 'build' : 'steady' }, { roll }));
          };
          return [
            { key: 'speed-up', label: 'Speed up the end', shortcut: 'last 25%, +25%', icon: <ChevronsRight className="w-3.5 h-3.5" />, onClick: quick(0.25, false), divider: true },
            { key: 'speed-up-roll', label: 'Speed up the end + drum roll', shortcut: '+50%', icon: <ChevronsRight className="w-3.5 h-3.5" />, onClick: quick(0.5, true) },
            {
              key: 'speed-up-more',
              label: 'Speed up the end…',
              shortcut: 'options',
              icon: <ChevronsRight className="w-3.5 h-3.5" />,
              onClick: () => {
                onClose();
                openArrange('drops', Math.round(to), undefined, { from, to });
              },
            },
          ];
        })(),
        ...(s.clips.find((c) => c.id === menu.clipId)?.notes.length && !s.clips.find((c) => c.id === menu.clipId)?.audio
          ? [
              {
                key: 'backwards',
                label: 'Play backwards',
                shortcut: 'as audio',
                icon: <FlipHorizontal2 className="w-3.5 h-3.5" />,
                onClick: run(() => {
                  const clip = s.clips.find((c) => c.id === menu.clipId)!;
                  showToast(`Reversing "${clip.name}"…`);
                  void reverseBlock(clip.startBar, clip.startBar + clip.lengthBars, clip.id).then(showToast, (err) => showToast(`Couldn't reverse it: ${err instanceof Error ? err.message : String(err)}`));
                }),
              },
            ]
          : []),
        {
          key: 'fill',
          label: 'Fill to loop Out',
          shortcut: `bar ${formatBarCount(loopOut)}`,
          icon: <ArrowRightToLine className="w-3.5 h-3.5" />,
          onClick: run(s.fillSelectionToLoopOut),
          // Greyed out when Out isn't after the selection: there'd be no room for a copy
          disabled: !s.clips.some((c) => c.isSelected) || Math.max(...s.clips.filter((c) => c.isSelected).map((c) => c.startBar + c.lengthBars)) >= loopOut - 1e-6,
        },
        {
          key: 'launcher',
          label: 'Send to launcher',
          icon: <Grid3x3 className="w-3.5 h-3.5" />,
          onClick: run(() => {
            const n = sendSelectionToLauncher();
            if (n) {
              useUiStore.getState().openDock('launcher');
              showToast(`In the launcher: ${n} slot${n === 1 ? '' : 's'}`);
            }
          }),
        },
        ...smartClipItems,
        { key: 'delete', label: 'Delete', shortcut: 'Del', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: run(s.deleteSelectedClips), divider: true },
      ]
    : [
        ...(track && audioLane
          ? [
              {
                key: 'load',
                label: 'Load audio file…',
                shortcut: 'dbl-click',
                icon: <FileAudio className="w-3.5 h-3.5" />,
                onClick: run(() => {
                  void pickAudioFiles().then((files) => dropAudioFiles(track.id, menu.bar, files));
                }),
              },
            ]
          : []),
        ...(track && !audioLane ? [newClip(1), newClip(2), newClip(4)] : []),
        ...(drumLane ? [{ key: 'drummer', label: 'Drummer…', shortcut: 'make a beat', icon: <Drum className="w-3.5 h-3.5" />, onClick: openSmart('drummer') }] : []),
        ...(pitchedLane ? [{ key: 'chords', label: 'Chord progression…', shortcut: 'in key', icon: <Music4 className="w-3.5 h-3.5" />, onClick: openSmart('chords') }] : []),
        ...(pitchedLane ? [{ key: 'math', label: 'Math patterns…', shortcut: 'formulas', icon: <Sigma className="w-3.5 h-3.5" />, onClick: openSmart('math') }] : []),
        ...(pitchedLane ? [{ key: 'dark', label: 'Dark melody…', shortcut: 'bells, piano', icon: <Music4 className="w-3.5 h-3.5" />, onClick: run(() => openArrange('melody', Math.max(1, Math.floor(menu.bar + 1e-6)), menu.trackId)) }] : []),
        ...(track
          ? patternsFor(track.instrumentKey).map((p, i) => ({
              key: `pattern-${p.id}`,
              label: `Insert ${p.name}`,
              shortcut: `${p.lengthBars} bars`,
              icon: <Plus className="w-3.5 h-3.5" />,
              onClick: run(() => s.insertPatternClip(track.id, p.id, menu.bar)),
              divider: i === 0,
            }))
          : []),
        { key: 'paste', ...pasteHere, divider: true },
        {
          key: 'paste-playhead',
          label: 'Paste at playhead',
          shortcut: `${MOD}V`,
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          onClick: run(() => s.pasteClips()),
          disabled: !hasClipboard,
        },
      ];

  return (
    <div ref={ref} role="menu" className={menuClass} onContextMenu={(e) => e.preventDefault()}>
      {items.map(({ key, ...item }) =>
        key === 'repeat' && repeating ? (
          <RepeatForm key={key} onRepeat={(times) => run(() => s.repeatSelection(times))()} />
        ) : (
          <MenuItem key={key} {...item} />
        )
      )}
      <MenuNotice text={notice} />
    </div>
  );
};
