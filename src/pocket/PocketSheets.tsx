/**
 * What opens over Pocket's one screen, for the things done now and then: the song (its name,
 * tempo, key, metronome, a new song, the file), sharing it, adding an instrument (or your own
 * pads), arranging the song from a section (repeat it, make it its own, move it, a build-up,
 * bounce it to a pad, take it out), a chord progression for the piano roll, the song's earlier
 * versions, and the starters screen ("What are we making?").
 */
import { isDropTrack } from '../store/dropMoves';
import { GROOVE_FEELS } from '../store/grooveFeels';
import { drummerGroove } from '../store/drumGroove';
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FolderOpen, History, Mic, Minus, Monitor, Plus, Save } from 'lucide-react';
import { retryAutosave, useLastSession, useSongMeter, useTimelineStore } from '../store/timelineStore';
import { formatBarRange } from '../store/timelineTypes';
import { isPlainMeter, measureAt, meterAt } from '../audio/tempoMap';
import { notAutosavedWords } from '../store/autosaveWords';
import { sayWhatWasLeftOut } from '../store/reopenLastSong';
import { clearPreviousSession } from '../store/project';
import { STARTER_GROUPS, STARTERS } from '../store/starters';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { keyOf, NOTE_NAMES } from '../store/songKey';
import { DRUM_STYLES, FILLS, drummer, type DrumStyle } from '../store/smartTools';
import { fillClipBar } from '../store/smartActions';
import { CHORD_STYLES, chordNotesFor, PROGRESSIONS, progressionChords, type ChordStyle, type Progression } from '../store/smartTools';
import { fitToInstrument } from '../store/smartActions';
import { CHILLS, chillsFill, chillsNames, registerOf, type ChillsProgression } from '../store/chills';
import { BUILD_DEFAULTS, buildForChills, nameAfterChills } from '../store/chillsActions';
import { pickProjectFile, saveProjectFile } from '../components/timeline/projectFile';
import { exportMySounds, pickMySoundsFile } from '../components/mySoundsFile';
import { showToast } from '../components/timeline/toastStore';
import { Sheet, SheetItem, pill, pillOn } from './pocketUi';
import { FledgeTourButton } from '../components/FledgeTourButton';
import { playFledge, soundInstrumentName, usePocket } from './pocketStore';
import { editCell, inOneStep, useSelection, useSongKey } from './pocketCell';
import { cellClip, clipsIn, copySection, moveSection, pocketSections, removeSection, sectionIsLinked, unlinkSection } from './pocketSections';
import { chordGlideSupport, GLIDE_ABOUT, GLIDE_MS_DEFAULT, GLIDE_MS_MAX, GLIDE_MS_MIN, glideNotHere } from '../store/chordGlide';
import { UndoableRange } from '../components/UndoableRange';
import { FavouriteStar, pocketInstruments, pocketSounds, selectTrack } from './PocketDrawer';
import { useMySounds } from '../store/mySounds';
import { goToSection } from './PocketGrid';
import { sectionChordPlan } from './pocketGrid';
import { addVocalTrack } from './PocketVocals';
import { bounceSection, resampleSection } from './pocketBounce';
import { PocketShare } from './PocketShare';
import { chooseInterface } from './pocketMode';
import { cellDrumStyles, cellKey, pocketNoteId } from './pocketStore';
import { VersionsList } from '../components/VersionsList';
import { checkPersistence, usePwa } from '../pwa/pwa';
import { isNativeApp } from '../native/nativeApp';

const close = () => usePocket.getState().set({ sheet: null });

const SongSheet: React.FC = () => {
  const name = useTimelineStore((s) => s.projectName);
  const bpm = useTimelineStore((s) => s.bpm);
  const click = useTimelineStore((s) => s.recordOptions.metronome);
  const picked = usePocket((p) => p.key);
  const songKey = useSongKey();
  const s = useTimelineStore.getState;
  return (
    <Sheet title="Song" onClose={close}>
      <div className="px-1 space-y-4">
        <input aria-label="Song name" className="w-full h-11 rounded-xl border border-forge-border bg-forge-bg px-3 text-base font-semibold outline-none focus:border-cyan-400" value={name} onChange={(e) => s().setProjectName(e.target.value)} />
        <div className="flex items-center gap-2">
          <span className="text-sm text-forge-muted w-16">Tempo</span>
          <button type="button" aria-label="Slower" className={pill} onClick={() => s().setBpm(Math.max(40, Math.round(bpm) - 1))}>
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-14 text-center font-mono text-lg tabular-nums">{Math.round(bpm)}</span>
          <button type="button" aria-label="Faster" className={pill} onClick={() => s().setBpm(Math.min(300, Math.round(bpm) + 1))}>
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" className={`${pill} ml-auto`} onClick={() => s().tapTempo()}>
            Tap
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-forge-muted w-16">Key</span>
          <select
            aria-label="Key"
            className="flex-1 h-11 rounded-xl border border-forge-border bg-forge-panel px-2 text-sm"
            value={picked ? `${picked.root}-${picked.mode}` : 'song'}
            onChange={(e) => {
              if (e.target.value === 'song') return usePocket.getState().set({ key: null });
              const [root, mode] = e.target.value.split('-');
              usePocket.getState().set({ key: keyOf(Number(root), mode as 'major' | 'minor') });
            }}
          >
            <option value="song">The song's ({songKey.name})</option>
            {(['minor', 'major'] as const).flatMap((mode) =>
              NOTE_NAMES.map((n, root) => (
                <option key={`${root}-${mode}`} value={`${root}-${mode}`}>
                  {n} {mode}
                </option>
              ))
            )}
          </select>
        </div>
        <button type="button" aria-pressed={click} className={`${pill} w-full ${click ? pillOn : ''}`} onClick={() => s().setRecordOptions({ metronome: !click })}>
          Metronome {click ? 'on' : 'off'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={pill} onClick={() => void saveProjectFile()}>
            <Save className="w-4 h-4" /> Save file
          </button>
          <button type="button" className={pill} onClick={() => pickProjectFile()}>
            <FolderOpen className="w-4 h-4" /> Open file
          </button>
        </div>
        <button type="button" className={`${pill} w-full`} onClick={() => usePocket.getState().set({ sheet: 'versions' })}>
          <History className="w-4 h-4" /> Versions: go back to earlier
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={pill} onClick={() => void exportMySounds()}>
            <Save className="w-4 h-4" /> Save my sounds
          </button>
          <button type="button" className={pill} onClick={pickMySoundsFile}>
            <FolderOpen className="w-4 h-4" /> Open my sounds
          </button>
        </div>
        <button
          type="button"
          className={`${pill} w-full`}
          onClick={() => {
            close();
            usePocket.getState().set({ starting: true });
          }}
        >
          <Plus className="w-4 h-4" /> New song
        </button>
        <button type="button" className={`${pill} w-full`} onClick={() => chooseInterface('studio')}>
          <Monitor className="w-4 h-4" /> Use the full studio here
        </button>
        <SongStorage />
      </div>
    </Sheet>
  );
};

/**
 * Where the song is kept as you work, and whether it's kept for good there: the phone or browser
 * may clear a site's storage when space runs low unless it has agreed to keep it (pwa.ts asks).
 */
const SongStorage: React.FC = () => {
  const kept = usePwa((p) => p.persisted);
  const [asked, setAsked] = useState(false);
  useEffect(() => void checkPersistence(), []);
  const where = isNativeApp() ? 'on this phone' : 'in this browser';
  // (not saving itself just now: why, in the studio's words)
  const status = useTimelineStore((s) => s.autosaveStatus);
  return (
    <div className="text-[11px] text-forge-muted space-y-1">
      {status?.ok === false ? (
        <p role="status" className="text-red-400">
          {notAutosavedWords(status.reason, 'pocket')}
        </p>
      ) : (
        <p>The song saves itself {where} as you work. Save the file to keep a copy anywhere.</p>
      )}
      {kept === true && <p className="text-emerald-300">Your songs and sounds are kept {where}, even when space runs low.</p>}
      {kept === false && (
        <p className="text-amber-200">
          {isNativeApp() ? 'The phone' : 'The browser'} may clear them if space runs low: save the file to be safe.{' '}
          {!asked && (
            <button
              type="button"
              className="underline text-amber-100"
              onClick={() => {
                setAsked(true);
                void checkPersistence(true);
              }}
            >
              Ask to keep it
            </button>
          )}
        </p>
      )}
    </div>
  );
};

const AddSheet: React.FC = () => {
  useMySounds((s) => s.favourites);
  const groups = pocketInstruments();
  const mine = pocketSounds(useMySounds((s) => s.sounds));
  const [open, setOpen] = useState<string | null>(null);
  const added = (trackId: string) => {
    close();
    const t = useTimelineStore.getState().tracks.find((x) => x.id === trackId);
    if (t) selectTrack(t);
  };
  return (
    <Sheet title="Add an instrument" onClose={close}>
      <SheetItem
        title="Vocals"
        detail="Sing or rap over the song, with a vocal sound on (Clean lead to start)."
        color="#ec4899"
        onClick={() => {
          const id = addVocalTrack();
          close();
          const t = useTimelineStore.getState().tracks.find((x) => x.id === id);
          if (t) selectTrack(t);
        }}
      />
      <SheetItem
        title="Fledge Synth"
        detail="The app's own synth: wobble bass, growls and leads, with big sliders to shape the sound and the wobble in time with the song."
        color={INSTRUMENTS.plugin.color}
        onClick={() => added(playFledge(null))}
        trailing={<FledgeTourButton size="large" className="mr-1" />}
      />
      <SheetItem
        title="Drop pad"
        detail="Hold to stutter, filter, tape-stop, crush, gate or echo the whole mix. With Rec on, your moves stay in the song."
        color={INSTRUMENTS.dropPad.color}
        onClick={() => {
          // One is enough: it acts on the whole mix
          const have = useTimelineStore.getState().tracks.find(isDropTrack);
          added(have ? have.id : useTimelineStore.getState().addTrack('dropPad'));
        }}
      />
      <SheetItem
        title="Your pads"
        detail="16 pads for your own sounds: bounce a section of the song or a vocal take onto them, then play them like drums."
        color={INSTRUMENTS.drumRack.color}
        onClick={() => {
          const id = useTimelineStore.getState().addTrack('drumRack', 'Your pads');
          usePocket.getState().set({ rackPad: 0 });
          added(id);
        }}
      />
      {[...(mine.length ? [{ category: 'My sounds', keys: [] }] : []), ...groups].map(({ category, keys }) => (
        <div key={category}>
          <button type="button" className="w-full flex items-center gap-2 px-2 h-11 text-sm font-semibold" onClick={() => setOpen(open === category ? null : category)}>
            {open === category ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {category}
            <span className="ml-auto text-xs text-forge-muted font-normal">{category === 'My sounds' ? mine.length : keys.length}</span>
          </button>
          {open === category &&
            category === 'My sounds' &&
            mine.map((s) => (
              <SheetItem
                key={s.id}
                title={s.name}
                detail={`${soundInstrumentName(s)}, with the settings you saved`}
                color={INSTRUMENTS[s.settings.instrumentKey].color}
                onClick={() => added(useTimelineStore.getState().addSoundTrack(s))}
              />
            ))}
          {open === category &&
            keys.map((key) => (
              <SheetItem
                key={key}
                title={INSTRUMENTS[key].name}
                detail={INSTRUMENTS[key].blurb}
                color={INSTRUMENTS[key].color}
                onClick={() => added(useTimelineStore.getState().addTrack(key))}
                trailing={<FavouriteStar instrument={key} />}
              />
            ))}
        </div>
      ))}
    </Sheet>
  );
};

const SectionSheet: React.FC = () => {
  const i = usePocket((p) => p.sheetSection);
  const clips = useTimelineStore((s) => s.clips);
  const meter = useSongMeter();
  const sections = pocketSections();
  const sec = sections[i];
  if (!sec) return null;
  const linked = sectionIsLinked(sec, clips);
  // The track chosen in the drawer: Resample takes only it, when one is
  const selected = useTimelineStore.getState().tracks.find((t) => t.id === usePocket.getState().trackId && !usePocket.getState().mixAll);
  const run = (fn: () => string | null | void, after?: (fresh: ReturnType<typeof pocketSections>) => number, done?: string) => {
    const problem = fn();
    close();
    if (problem) return showToast(problem);
    const fresh = pocketSections();
    if (after) goToSection(Math.max(0, Math.min(fresh.length - 1, after(fresh))), fresh);
    if (done) showToast(done);
  };
  return (
    <Sheet title={`${sec.letter}: ${sec.name}, ${isPlainMeter(meter) ? `bars ${sec.from}–${sec.to - 1}` : formatBarRange(sec.from, sec.to, meter)}`} onClose={close}>
      <SheetItem title="Play it twice" detail="A copy right after it, linked: change either and both change." onClick={() => run(() => copySection(i), () => i + 1)} />
      {linked && <SheetItem title="Make it its own" detail={`Changes to it stop changing the other ${sec.letter}s.`} onClick={() => run(() => unlinkSection(i), () => i, 'Its own now: change it without changing the others')} />}
      {i > 0 && <SheetItem title="Move earlier" detail="Swap it with the section before." onClick={() => run(() => moveSection(i, -1), () => i - 1)} />}
      {i < sections.length - 1 && <SheetItem title="Move later" detail="Swap it with the section after." onClick={() => run(() => moveSection(i, 1), () => i + 1)} />}
      {i > 0 && (
        <SheetItem
          title="Build-up into it"
          detail="A riser and a snare roll over the bars before it, and a hit on its first beat."
          onClick={() => run(() => useTimelineStore.getState().addBuildAndDrop(sec.from), () => i, 'A build-up into it')}
        />
      )}
      {i > 0 && (
        <SheetItem
          title="Build for chills into it"
          detail={`${sections[i - 1].letter} swells into it: the parts start a little quieter and darker and grow back to their level (no part already there is turned up), a riser, a breath of near-silence, then a pad joins on its first beat, the riser and pad set under the music by measuring it.`}
          onClick={() => {
            close();
            showToast('Measuring the music for the build…');
            void buildForChills({ ...BUILD_DEFAULTS, from: sections[i - 1].from, peak: sec.from }).then(showToast);
          }}
        />
      )}
      {i > 0 && (
        <SheetItem
          title="Build for chills from the music’s level"
          detail={`The same build into it with nothing dipping first: the parts of ${sections[i - 1].letter} keep their level all through it (no filter sweep), and the lift comes from the riser, the breath of near-silence and the pad on its first beat.`}
          onClick={() => {
            close();
            showToast('Measuring the music for the build…');
            void buildForChills({ ...BUILD_DEFAULTS, start: 'level', from: sections[i - 1].from, peak: sec.from }).then(showToast);
          }}
        />
      )}
      <SheetItem
        title="Bounce it to a pad"
        detail="Everything playing in it made into one sound, on the first empty pad of your pads (or a new Bounces track): play it like a drum."
        onClick={() => {
          close();
          showToast(`Bouncing ${sec.letter}…`);
          void bounceSection(sec);
        }}
      />
      <SheetItem
        title="Resample it into a Slicer"
        detail={`${selected ? `${selected.name} in it` : 'Everything playing in it'} printed and chopped into 16 slices on a new Slicer, with a stutter pattern and a reversed tail: play the slices from its keys.`}
        onClick={() => {
          close();
          showToast(`Resampling ${sec.letter}…`);
          void resampleSection(sec, selected?.id);
        }}
      />
      <SheetItem title="Take it out" detail="Its bars go, and the rest of the song moves up. Undo brings it back." onClick={() => run(() => removeSection(i), () => Math.max(0, i - 1))} />
    </Sheet>
  );
};

const ChordsSheet: React.FC = () => {
  const { track, sec } = useSelection();
  const songKey = useSongKey();
  const meter = useSongMeter();
  const [style, setStyle] = useState<ChordStyle>('sustain');
  if (!track || !sec) return null;
  const write = (prog: Progression) => {
    const chords = progressionChords(songKey, prog);
    // A chord a bar (a measure as the ruler counts them) in a section of 4 bars or more, two in one of 8 or more
    const { chordBars, count, spans } = sectionChordPlan(sec.from, sec.to, meter);
    const all = Array.from({ length: count }, (_, k) => chords[k % chords.length]);
    const notes = fitToInstrument(chordNotesFor(all, chordBars, style, pocketNoteId, spans, { map: meter, atBar: sec.from }), track.instrumentKey);
    editCell(track.id, sec, () => notes);
    close();
  };
  // (Held chords filling the section, as the studio's piano roll fills a clip with one: chills.ts
  // chillsFill; and, as there, the clip named after the progression unless its name was typed)
  const writeChills = (prog: ChillsProgression) => {
    const notes = chillsFill(songKey, prog, sec.from, sec.to, meter, pocketNoteId, { range: INSTRUMENTS[track.instrumentKey].range });
    editCell(track.id, sec, () => notes, true, (id) => nameAfterChills(id, prog.name));
    close();
    showToast(`${prog.name}: ${chillsNames(songKey, prog).join(' – ')}. Undo takes it out.`);
  };
  return (
    <Sheet title={`Chords in ${songKey.name}`} onClose={close}>
      <div className="flex gap-1.5 flex-wrap mb-2 px-1">
        {CHORD_STYLES.map((st) => (
          <button key={st.id} type="button" className={`${pill} !h-9 !px-3 text-xs ${style === st.id ? pillOn : ''}`} onClick={() => setStyle(st.id)}>
            {st.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-forge-muted px-2 mb-1">Fills {track.name} in {sec.letter} with the progression, in place of what's there (Undo brings it back).</p>
      {PROGRESSIONS.filter((p) => p.mode === songKey.mode).map((p) => (
        <SheetItem key={p.id} title={p.name} onClick={() => write(p)} />
      ))}
      <p className="text-xs font-semibold text-forge-text px-2 mt-3 mb-1">For chills</p>
      <p className="text-xs text-forge-muted px-2 mb-1">Chord moves that give listeners chills at a peak: {registerOf(INSTRUMENTS[track.instrumentKey].range).kind === 'roots' ? 'on this bass instrument, each chord’s root (or the held home note), inside its range.' : 'held chords for synths and pads, one low note and the chord in the middle.'}</p>
      {CHILLS.map((p) => (
        <SheetItem key={p.id} title={p.name} detail={`${chillsNames(songKey, p).join(' – ')}. ${p.detail}`} onClick={() => writeChills(p)} />
      ))}
    </Sheet>
  );
};

/** Each Drummer pick plays a new take on the style (the same order every session) */
let drumSeed = 0;
const nextDrumSeed = () => (drumSeed = (drumSeed * 7919 + 104729) % 1000003);

const DrummerSheet: React.FC = () => {
  const { track, sec } = useSelection();
  const map = useSongMeter();
  if (!track || !sec) return null;
  const write = (style: DrumStyle) => {
    // (The time signature the section starts in: a song can change it part-way)
    const meter = meterAt(sec.from, map);
    const len = sec.to - sec.from;
    const bars = Math.max(1, Math.round((len * meter.den) / meter.num));
    const notes = drummer(style, bars, 0.5, bars >= 4 ? 4 : 0, nextDrumSeed(), pocketNoteId, meter).filter((n) => n.startOffset < len - 1e-6);
    // (A measured feel on the cell stays: the style's swing goes under it)
    inOneStep(() => {
      const before = cellClip(track.id, sec, false);
      const old = useTimelineStore.getState().clips.find((c) => c.id === before)?.groove;
      editCell(track.id, sec, () => notes);
      cellDrumStyles.set(cellKey(track.id, sec.from), style);
      const id = cellClip(track.id, sec, false);
      const groove = DRUM_STYLES.find((d) => d.id === style)?.groove;
      if (id) useTimelineStore.getState().setClipGroove(id, drummerGroove(old, groove), false);
    });
    close();
  };
  return (
    <Sheet title={`Drummer: ${track.name} in ${sec.letter}`} onClose={close}>
      <p className="text-xs text-forge-muted px-2 mb-2">Writes the whole section's beat in a style, in place of what's there (Undo brings it back). Pick again for another take on it.</p>
      {DRUM_STYLES.map((d) => (
        <SheetItem key={d.id} title={d.name} detail={`${d.bpm} BPM`} onClick={() => write(d.id)} />
      ))}
    </Sheet>
  );
};

/** A measured feel for the whole track (every clip of it), or none: one undo step. */
const FeelSheet: React.FC = () => {
  const { track } = useSelection();
  const current = useTimelineStore((s) => s.clips.find((c) => c.trackId === track?.id && c.groove?.feel)?.groove?.feel?.id ?? '');
  if (!track) return null;
  const pick = (id: string, name: string) => {
    useTimelineStore.getState().setTrackGrooveFeel(track.id, id ? { id, amount: 1 } : null);
    showToast(id ? `${track.name} plays with the ${name.toLowerCase()} feel. Undo to take it off.` : `${track.name} plays as written.`);
    close();
  };
  return (
    <Sheet title={`Feel: ${track.name}`} onClose={close}>
      <p className="text-xs text-forge-muted px-2 mb-2">Feels measured from real music: each part a few milliseconds early or late on each 16th, with its accents. Sets every clip on this track (pick again after adding more).</p>
      <SheetItem title={`As written${current ? '' : ' ✓'}`} detail="Every note on the grid, as you put it" onClick={() => pick('', '')} />
      {GROOVE_FEELS.map((f) => (
        <SheetItem key={f.id} title={`${f.name}${current === f.id ? ' ✓' : ''}`} detail={f.about} onClick={() => pick(f.id, f.name)} />
      ))}
    </Sheet>
  );
};

const FillSheet: React.FC = () => {
  const { track, sec } = useSelection();
  const map = useSongMeter();
  if (!track || !sec) return null;
  // (A bar in the section's last measure: in plain 4/4 its middle, as before; otherwise its start,
  // as a 3/8 measure is shorter than half a bar)
  const lastBar = isPlainMeter(map) ? sec.to - 0.5 : measureAt(sec.to - 1e-6, map).start;
  return (
    <Sheet title={`A fill at the end of ${sec.letter}`} onClose={close}>
      {FILLS.map((f) => (
        <SheetItem
          key={f.id}
          title={f.name}
          onClick={() => {
            inOneStep(() => {
              const id = cellClip(track.id, sec, true);
              // (The middle of the section's last bar: the fill goes at that bar's end)
              if (id) fillClipBar(id, lastBar, f.id);
            });
            close();
          }}
        />
      ))}
    </Sheet>
  );
};

/** The song as it was earlier (versions.ts): one tap to go back. */
const VersionsSheet: React.FC = () => (
  <Sheet title="Versions" onClose={close}>
    <VersionsList touch onRestored={() => usePocket.getState().set({ sheet: null, starting: false, section: 0, trackId: null, key: null, rec: false, mixAll: false })} />
  </Sheet>
);

const ShareSheet: React.FC = () => (
  <Sheet title="Share" onClose={close}>
    <PocketShare />
  </Sheet>
);

/**
 * Glide between chords for the cell's clip (see chordGlide.ts), as the studio's piano roll sets it
 * (ChordGlidePicker): switched on and off, one undo step (the cell made one clip first, in the
 * same step), and its time and the bass's, a drag one step.
 */
const GlideSheet: React.FC = () => {
  const { track, sec } = useSelection();
  const glide = useTimelineStore((s) => (track && sec ? clipsIn(s.clips, track.id, sec.from, sec.to).find((c) => !c.audio)?.glide : undefined));
  if (!track || !sec) return null;
  const glides = chordGlideSupport(track);
  const name = INSTRUMENTS[track.instrumentKey]?.name ?? 'This instrument';
  const toggle = () =>
    inOneStep(() => {
      const id = cellClip(track.id, sec, true);
      if (id) useTimelineStore.getState().setClipGlide(id, glide ? null : { ms: GLIDE_MS_DEFAULT });
    });
  const slide = (field: 'ms' | 'bassMs') => (v: number) => {
    const id = cellClip(track.id, sec, false);
    if (id && glide) useTimelineStore.getState().setClipGlide(id, { ...glide, [field]: v }, false);
  };
  const row = 'flex items-center gap-3 px-2 py-2 text-sm';
  return (
    <Sheet title={`Glide: ${track.name} in ${sec.letter}`} onClose={close}>
      <p className="text-xs text-forge-muted px-2 mb-2">{GLIDE_ABOUT}</p>
      {!glides && <p className="text-xs text-amber-200 px-2 mb-2">{glideNotHere(name)}</p>}
      <SheetItem title={`Glide between chords: ${glide ? 'on' : 'off'}`} detail={glide ? 'Tap to play the chords as written' : 'Tap to let the chords glide into each other'} onClick={toggle} />
      <label className={`${row}${glide ? '' : ' opacity-45'}`}>
        <span className="w-12 text-forge-muted">Time</span>
        <UndoableRange min={GLIDE_MS_MIN} max={GLIDE_MS_MAX} step={5} value={glide?.ms ?? GLIDE_MS_DEFAULT} onValue={slide('ms')} resetValue={GLIDE_MS_DEFAULT} disabled={!glide} className="flex-1 h-8" aria-label="Glide time" />
        <span className="w-16 text-right tabular-nums">{Math.round(glide?.ms ?? GLIDE_MS_DEFAULT)} ms</span>
      </label>
      <label className={`${row}${glide ? '' : ' opacity-45'}`}>
        <span className="w-12 text-forge-muted">Bass</span>
        <UndoableRange min={GLIDE_MS_MIN} max={GLIDE_MS_MAX} step={5} value={glide?.bassMs ?? glide?.ms ?? GLIDE_MS_DEFAULT} onValue={slide('bassMs')} resetValue={glide?.ms ?? GLIDE_MS_DEFAULT} disabled={!glide} className="flex-1 h-8" aria-label="Bass glide time" />
        <span className="w-16 text-right tabular-nums">{Math.round(glide?.bassMs ?? glide?.ms ?? GLIDE_MS_DEFAULT)} ms</span>
      </label>
      <p className="text-xs text-forge-muted px-2 mt-1">The lines in the roll show which note glides into which.</p>
    </Sheet>
  );
};

/** The sheet open now, if any. */
export const PocketSheets: React.FC = () => {
  const sheet = usePocket((p) => p.sheet);
  if (sheet === 'song') return <SongSheet />;
  if (sheet === 'share') return <ShareSheet />;
  if (sheet === 'add') return <AddSheet />;
  if (sheet === 'section') return <SectionSheet />;
  if (sheet === 'chords') return <ChordsSheet />;
  if (sheet === 'drummer') return <DrummerSheet />;
  if (sheet === 'fill') return <FillSheet />;
  if (sheet === 'feel') return <FeelSheet />;
  if (sheet === 'glide') return <GlideSheet />;
  if (sheet === 'versions') return <VersionsSheet />;
  return null;
};

/** "What are we making?": a starter, or an empty song; and the last song, to carry on. */
export const StartScreen: React.FC<{ canGoBack: boolean }> = ({ canGoBack }) => {
  const name = useTimelineStore((s) => s.projectName);
  const session = useLastSession((s) => s.session);
  const start = (template: Parameters<ReturnType<typeof useTimelineStore.getState>['newProject']>[0]) => {
    const s = useTimelineStore.getState();
    s.stop();
    s.newProject(template);
    const p = usePocket.getState();
    p.set({ starting: false, section: 0, trackId: null, tool: 'play', mixAll: false, key: null, sheet: null, ...(p.sizeBeforeRoll ? { drawer: p.sizeBeforeRoll, sizeBeforeRoll: null } : {}) });
    // Loop the first section, and play it: a starter should be heard
    requestAnimationFrame(() => {
      const first = pocketSections()[0];
      const st = useTimelineStore.getState();
      st.setLoopRange(first.from, first.to);
      if (!useTimelineStore.getState().loopRegion.enabled) st.toggleLoop();
      st.seek(first.from);
      if (template !== 'blank') void st.play();
    });
  };
  return (
    <div className="fixed inset-0 z-40 bg-forge-bg overflow-y-auto pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-[max(20px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
      {canGoBack && (
        <button type="button" className="h-11 -ml-2 px-2 flex items-center gap-1 text-cyan-300 font-medium" onClick={() => usePocket.getState().set({ starting: false })}>
          <ChevronLeft className="w-5 h-5" /> Back to {name}
        </button>
      )}
      <div className="flex items-center gap-2.5 font-bold text-lg mt-2">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="w-8 h-8 rounded-lg" />
        Fledgetone Pocket
      </div>
      <h1 className="text-3xl font-bold leading-tight mt-6 mb-1.5">What are we making?</h1>
      <p className="text-forge-muted mb-5">Pick a starter and it plays straight away. Everything in it can be changed.</p>
      {session && !canGoBack && (
        <button
          type="button"
          className="w-full mb-3 rounded-2xl border border-cyan-400/60 bg-cyan-500/10 p-4 text-left flex items-center gap-3"
          onClick={() => {
            clearPreviousSession(false);
            retryAutosave();
            useLastSession.setState({ session: null });
            useTimelineStore.getState().loadProject(session.project);
            sayWhatWasLeftOut(session.project);
            usePocket.getState().set({ starting: false, section: 0, trackId: null });
          }}
        >
          <History className="w-6 h-6 text-cyan-300 shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold truncate">Carry on with {session.project.name}</span>
            <span className="block text-xs text-forge-muted">{session.stopped ? "Your last song: it froze or stopped the app last time, so it wasn't opened again" : 'Your last song, as you left it'}</span>
          </span>
        </button>
      )}
      <button type="button" className="w-full h-16 rounded-[20px] px-3.5 text-left flex items-center justify-between border border-dashed border-forge-borderLight bg-forge-panel" onClick={() => start('blank')}>
        <b className="text-lg">Blank song</b>
        <span className="font-mono text-[11px] text-forge-muted tracking-wide">4 EMPTY TRACKS</span>
      </button>
      {STARTER_GROUPS.map((group) => (
        <div key={group} className="mt-4 rounded-2xl border border-forge-border bg-forge-panel p-2">
          <h2 className="px-2 pt-1 pb-2 text-sm font-semibold">{group}</h2>
          {STARTERS.filter((x) => x.group === group).map((st) => (
            <SheetItem key={st.id} title={st.name} detail={st.detail} onClick={() => start(st.id)} />
          ))}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2 mt-4">
        <button type="button" className={pill} onClick={() => pickProjectFile()}>
          <FolderOpen className="w-4 h-4" /> Open a file
        </button>
        <button type="button" className={pill} onClick={() => usePocket.getState().set({ sheet: 'versions' })}>
          <History className="w-4 h-4" /> Versions
        </button>
      </div>
      <p className="text-[11px] text-forge-muted mt-4 flex items-center gap-1.5">
        <Mic className="w-3.5 h-3.5" /> Wear headphones when you sing, so the song stays out of your take.
      </p>
    </div>
  );
};
