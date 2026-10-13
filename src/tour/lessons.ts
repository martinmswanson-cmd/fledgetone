import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { PALETTE_SHORTCUT } from '../store/uiStore';

/**
 * The first-visit tour and the three guided tutorials. A step points at a part of the screen (a CSS
 * selector) and explains it. A step with a `task` waits for the person to do something and moves on
 * by itself once they have, checked against the app's state. Each task can note how things stood when
 * the step began (`begin`), so "add a track" means one more than there were.
 */

export type Level = 'Tour' | 'Beginner' | 'Intermediate' | 'Expert';

export interface LessonStep {
  title: string;
  /** Plain text; **bold** is shown bold */
  body: string;
  /** What to point at: a selector, or one worked out at the time (null: nothing, the card is centred) */
  target?: string | (() => string | null);
  /** Set the scene before the step shows (open a panel, select a track) */
  before?: () => void;
  task?: {
    /** What to do, in a few words (shown as "Your turn") */
    hint: string;
    begin?: () => unknown;
    done: (start: unknown) => boolean;
  };
}

export interface Lesson {
  id: string;
  level: Level;
  title: string;
  /** One line for the menu */
  summary: string;
  minutes: number;
  steps: LessonStep[];
}

const tl = () => useTimelineStore.getState();
const ui = () => useUiStore.getState();
const selected = () => {
  const s = tl();
  return s.tracks.find((t) => t.id === s.selectedTrackId) ?? s.tracks[0];
};
const noteCount = () => tl().clips.reduce((n, c) => n + c.notes.length, 0);
const pointCount = () => tl().tracks.reduce((n, t) => n + (t.automation ?? []).reduce((m, l) => m + l.points.length, 0), 0);
/** A fingerprint of every note's pitch, so a key change shows as a change */
const pitches = () => tl().clips.map((c) => c.notes.map((n) => n.note).join(',')).join('|');
const ensureTrack = () => {
  const s = tl();
  if (!s.tracks.length) s.addTrack('piano');
  if (!s.tracks.some((t) => t.id === s.selectedTrackId)) s.selectTrack(s.tracks[0].id);
};

const NEW_BUTTON = '#menu-file';
const EXPORT_BUTTON = 'button[title^="Render the song"]';
const RULER = '[data-tour="ruler"]';
const FIRST_HEADER = '[data-tour="track-header"]';
const dialogOr = (dialog: string, label: string, fallback: string) => () => (ui().dialog === dialog ? `[role="dialog"][aria-label="${label}"]` : fallback);

const TOUR: Lesson = {
  id: 'tour',
  level: 'Tour',
  title: 'Quick tour',
  summary: "Where everything is, in about a minute. Nothing to do but read and click Next.",
  minutes: 1,
  steps: [
    {
      title: "Welcome to Bo's Beatbox",
      body: 'A music maker that runs in your browser: build a song from tracks and clips, mix it, and export it for your game or video. Here is where everything lives.',
    },
    {
      title: 'Start the audio',
      body: 'Browsers only allow sound after you click something. **START AUDIO** turns it on (pressing Play does too). It glows red until audio is running.',
      target: '[data-tour="start-audio"]',
    },
    {
      title: 'The menus',
      body: 'Every tool lives in the menu bar: **File** (New, Open, Save, Export), **Edit**, **Song** (markers, tempo, build-ups, key changes), **Track**, **Tools**, **Video**, **Game**, **View** and **Help**. **New** offers a blank timeline, the demo song or one of 42 genre starters.',
      target: '[role="menubar"]',
    },
    {
      title: 'Your project',
      body: 'Name it, **Save** a project file, **Export** audio and video, or **Share** a link. It also autosaves in this browser.',
      target: '#btn-save-project',
    },
    {
      title: 'Play, stop and loop',
      body: '**Space** plays and pauses. Stop goes back to the loop start, and the loop button (**L**) repeats the In-to-Out range. Record, metronome and MIDI keyboard live here too.',
      target: '[role="group"][aria-label="Transport"]',
    },
    {
      title: 'The timeline',
      body: 'Each row is a **track** (one instrument) and the blocks on it are **clips** of notes. Drag clips to move them, double-click one to write its notes, and right-click the ruler for markers, build-ups and key changes.',
      target: '[data-timeline-scroll]',
    },
    {
      title: 'Track controls',
      body: 'Volume and pan, **M**ute, **S**olo and **R**ecord-arm, plus buttons for automation, freezing and the track’s effects.',
      target: FIRST_HEADER,
    },
    {
      title: 'Add a track',
      body: 'Pick from 198 instruments. Type to search: a name, or a style such as *8-bit*, *orchestral* or *jazz*.',
      target: 'button[title="Add a new instrument track"]',
    },
    {
      title: 'Effects and mixing',
      body: '**FX Rack** opens the Inspector: EQ, compressor, filter, pump, lo-fi, gate, reverb and more for the selected track, and the master effects.',
      target: '#btn-inspector-toggle',
    },
    {
      title: 'The bottom panel',
      body: 'Tabs under the timeline: the **Mixer** (every track side by side), **Instruments** (try any sound, play pads, drag patterns), **Game**, **Video** tools and the **Sound FX** maker. Drag its top edge to resize it.',
      target: '[role="tablist"][aria-label="Bottom panel tabs"]',
    },
    {
      title: 'Tempo and swing',
      body: 'Type a tempo or drag it, tap it in with **TAP**, or **FIT** the song to a length of time. Swing shuffles the off-beat 16ths.',
      target: '[aria-label="Tempo (BPM)"]',
    },
    {
      title: 'Find anything',
      body: `**SEARCH** (or ${PALETTE_SHORTCUT}) finds any tool, setting, instrument, starter or guide page and takes you there.`,
      target: 'button[title^="Search tools"]',
    },
    {
      title: 'Learn more',
      body: '**LEARN** has this tour and three hands-on tutorials (Beginner, Intermediate, Expert). **GUIDE** (or **?**) explains everything in detail.',
      target: 'button[title^="Tour and tutorials"]',
    },
  ],
};

const BEGINNER: Lesson = {
  id: 'beginner',
  level: 'Beginner',
  title: 'Your first song',
  summary: 'Open a starter, play it, change it, write a few notes and export it.',
  minutes: 5,
  steps: [
    {
      title: 'Your first song',
      body: "In this tutorial you'll open a ready-made song, play it, change it and write some notes of your own. Each step tells you what to do and moves on by itself once you've done it.",
    },
    {
      title: 'Turn on the sound',
      body: 'Click **START AUDIO** in the top-right corner.',
      target: '[data-tour="start-audio"]',
      task: { hint: 'Click START AUDIO', done: () => useAudioStore.getState().audioState === 'running' },
    },
    {
      title: 'Open a starter',
      body: 'Open the **File** menu, click **New…**, then pick any genre starter. *Lo-Fi* is a gentle first one. (This replaces the current timeline.)',
      target: dialogOr('new', 'New arrangement', NEW_BUTTON),
      task: { hint: 'New, then a starter', begin: () => tl().projectName, done: (name) => tl().projectName !== name && tl().clips.length > 0 },
    },
    {
      title: 'Play it',
      body: 'Press **Space**, or the green Play button.',
      target: '#btn-play',
      task: { hint: 'Press Space', done: () => tl().isPlaying },
    },
    {
      title: 'Mute a track',
      body: "While it plays, click a track's **M** button and hear that part drop out.",
      target: FIRST_HEADER,
      task: { hint: 'Click M on any track', done: () => tl().tracks.some((t) => t.isMuted) },
    },
    {
      title: 'Bring it back',
      body: 'Click **M** again to unmute it. **S** (solo) does the opposite: only soloed tracks play.',
      target: FIRST_HEADER,
      task: { hint: 'Unmute the track', done: () => !tl().tracks.some((t) => t.isMuted) },
    },
    {
      title: 'Change the tempo',
      body: 'Drag the tempo slider, use **-** and **+**, or type a new number. The song speeds up or slows down as it plays.',
      target: '[aria-label="Tempo (BPM)"]',
      task: { hint: 'Change the tempo', begin: () => tl().bpm, done: (bpm) => tl().bpm !== bpm },
    },
    {
      title: 'Stop',
      body: 'Press **Space** again to pause.',
      target: '#btn-play',
      task: { hint: 'Press Space', done: () => !tl().isPlaying },
    },
    {
      title: 'Open a clip',
      body: 'Double-click any clip on the timeline. Its notes open in the **piano roll** below.',
      target: '[data-timeline-scroll]',
      task: { hint: 'Double-click a clip', done: () => tl().editingClipId !== null },
    },
    {
      title: 'Write a note',
      body: 'Click an empty spot in the grid to add a note there; it plays as you add it. Drag a note to move it, drag its end to make it longer, right-click it to delete it.',
      target: '[aria-label="Piano roll"]',
      task: { hint: 'Click in the grid to add a note', begin: noteCount, done: (n) => noteCount() > (n as number) },
    },
    {
      title: 'Undo',
      body: 'Made a mistake? **Ctrl+Z** undoes (Cmd+Z on a Mac), **Ctrl+Shift+Z** redoes. Almost everything can be undone.',
      target: '#btn-undo',
      task: { hint: 'Press Ctrl+Z', begin: noteCount, done: (n) => noteCount() < (n as number) },
    },
    {
      title: 'Close the piano roll',
      body: 'Press **Esc**, or the X at its top right.',
      target: '[aria-label="Piano roll"]',
      task: { hint: 'Press Esc', done: () => tl().editingClipId === null },
    },
    {
      title: 'Export your song',
      body: 'Click **Export**. Choose **MP3** for sharing or **WAV** for the best quality, then **Export** in the dialog to download it.',
      target: dialogOr('export', 'Export audio', EXPORT_BUTTON),
      task: { hint: 'Open Export', done: () => ui().dialog === 'export' },
    },
    {
      title: "You've made it!",
      body: 'You can open, play, change, write and export a song. Your work saves itself in this browser; use **Save** to keep a file. When you are ready, the **Intermediate** tutorial covers effects, automation and arranging.',
    },
  ],
};

const INTERMEDIATE: Lesson = {
  id: 'intermediate',
  level: 'Intermediate',
  title: 'Shape and mix a song',
  summary: 'Add instruments, effects, automation, the mixer, markers and a build-up and drop.',
  minutes: 8,
  steps: [
    {
      title: 'Shape and mix a song',
      body: 'This tutorial works on whatever is on your timeline (any starter is fine). You will add an instrument, shape its sound, automate it, mix and arrange.',
    },
    {
      title: 'Add a track',
      body: 'Click **Add Track** under the last track and search for an instrument: try *strings*, *8-bit* or *choir*. Enter picks it.',
      target: 'button[title="Add a new instrument track"]',
      task: { hint: 'Add any instrument track', begin: () => tl().tracks.length, done: (n) => tl().tracks.length > (n as number) },
    },
    {
      title: 'Open the FX Rack',
      body: "Click **FX Rack** (or the sliders icon on a track header). It shows the selected track's instrument and effects.",
      target: '#btn-inspector-toggle',
      before: ensureTrack,
      task: { hint: 'Open the FX Rack', done: () => tl().isInspectorOpen },
    },
    {
      title: 'Turn on the Filter',
      body: 'Switch the **Filter** ON, then drag **Cutoff** down to darken the sound and back up to open it.',
      target: '[data-search="Filter"]',
      before: () => {
        ensureTrack();
        tl().toggleInspector(true);
        ui().setInspectorTab('track');
      },
      task: { hint: 'Switch the Filter on', done: () => !!selected()?.fx.filter.on },
    },
    {
      title: 'Make it pump',
      body: 'Switch the **Pump** ON. With **Kick drum** chosen, the track ducks under every kick: the classic sidechain feel of dance music.',
      target: '[data-search="Pump"]',
      task: { hint: 'Switch the Pump on', done: () => !!selected()?.fx.pump.on },
    },
    {
      title: 'Add some space',
      body: 'Raise the **Studio Reverb Send**. All tracks share one reverb, so a little on each glues the song together.',
      target: '[data-search="sends"]',
      task: { hint: 'Raise the reverb send', begin: () => selected()?.reverbSend ?? 0, done: (v) => (selected()?.reverbSend ?? 0) > (v as number) + 0.04 },
    },
    {
      title: 'Show an automation lane',
      body: "Automation changes a setting over time. Click the curve button on a track header to show that track's lane.",
      target: FIRST_HEADER,
      task: { hint: 'Click the curve button', done: () => Object.values(tl().automationView).some((v) => v?.open) },
    },
    {
      title: 'Draw automation',
      body: 'Pick a setting at the left of the lane (Volume, Filter Cutoff...), then click in the lane to add points. The line between them is how the setting moves while the song plays.',
      target: '[data-automation-lane]',
      task: { hint: 'Click in the lane to add a point', begin: pointCount, done: (n) => pointCount() > (n as number) },
    },
    {
      title: 'Open the Mixer',
      body: 'Click the **Mixer** tab under the timeline to see every track side by side with level meters. Balance them by ear.',
      target: () => (ui().dockOpen && ui().dockTab === 'mixer' ? '[role="region"][aria-label="Mixer"]' : '#btn-mixer'),
      task: { hint: 'Open the Mixer tab', done: () => ui().dockOpen && ui().dockTab === 'mixer' },
    },
    {
      title: 'Mark a section',
      body: 'Move the playhead (click the ruler) and press **M** to drop a marker there. Double-click a marker flag to rename it; **,** and **.** jump between markers.',
      target: RULER,
      task: { hint: 'Press M to add a marker', begin: () => tl().markers.length, done: (n) => tl().markers.length > (n as number) },
    },
    {
      title: 'Build-up and drop',
      body: 'Right-click the ruler on the bar where a drop should land and choose **Build-up & drop here**: a riser, a snare roll and a hit, in one step.',
      target: RULER,
      task: { hint: 'Right-click the ruler: Build-up & drop', begin: () => tl().clips.length, done: (n) => tl().clips.length >= (n as number) + 2 },
    },
    {
      title: 'Set the loop',
      body: 'Drag the **In** and **Out** brackets on the ruler (or press **I** and **O** at the playhead) and switch the loop on with **L**, to work on one part over and over.',
      target: RULER,
      task: {
        hint: 'Move the loop or turn it on',
        begin: () => JSON.stringify(tl().loopRegion),
        done: (l) => JSON.stringify(tl().loopRegion) !== l,
      },
    },
    {
      title: 'Save a copy',
      body: 'Your work autosaves in this browser, but a file is safer. **Save** downloads a project file with its sounds; **Open** (or dropping the file on the page) loads it on any computer.',
      target: '#btn-save-project',
    },
    {
      title: 'Nicely done!',
      body: 'You can arrange, shape, automate and mix. The **Expert** tutorial covers sound design, sidechains, key changes, freezing and game-ready exports.',
    },
  ],
};

const EXPERT: Lesson = {
  id: 'expert',
  level: 'Expert',
  title: 'Pro techniques',
  summary: 'Search, sound design, sidechains, the Gate, key changes, freezing and game-music exports.',
  minutes: 10,
  steps: [
    {
      title: 'Pro techniques',
      body: 'Faster ways to work and the deeper tools: designing sounds, sidechaining, rhythmic effects, key changes, freezing, and exporting music a game can loop.',
    },
    {
      title: 'Search everything',
      body: `Press **${PALETTE_SHORTCUT}** from anywhere. It finds tools, settings, instruments, starters and guide pages, and takes you straight there.`,
      target: 'button[title^="Search tools"]',
      task: { hint: `Press ${PALETTE_SHORTCUT}`, done: () => ui().paletteOpen },
    },
    {
      title: 'Design a synth',
      body: 'Type **synth designer** and press Enter. It adds a Synth Designer track and opens its panel.',
      target: '[role="dialog"][aria-label="Search"]',
      task: {
        hint: 'Search: synth designer',
        begin: () => tl().tracks.filter((t) => t.instrumentKey === 'synthDesigner').length,
        done: (n) => tl().tracks.filter((t) => t.instrumentKey === 'synthDesigner').length > (n as number) || selected()?.instrumentKey === 'synthDesigner',
      },
    },
    {
      title: 'Start from a preset',
      body: 'Choose a sound from **Load preset…**, then shape it: two oscillators with unison, a filter with its own envelope, an amp envelope and a tempo-synced LFO.',
      target: '[aria-label="Synth Designer"]',
      task: { hint: 'Load a preset or move a knob', begin: () => JSON.stringify(selected()?.synth ?? null), done: (s) => JSON.stringify(selected()?.synth ?? null) !== s },
    },
    {
      title: 'Sidechain from any track',
      body: 'On the **Pump**, choose **A track** and pick which track it follows: the pad can duck under the bass, or the chords under a lead. The followed track can even be muted, as a silent trigger.',
      target: '[data-search="Pump"]',
      before: () => {
        ensureTrack();
        tl().toggleInspector(true);
        ui().setInspectorTab('track');
      },
      task: { hint: 'Pump: follow a track', done: () => tl().tracks.some((t) => t.fx.pump.on && t.fx.pump.trigger === 'track') },
    },
    {
      title: 'Chop it with the Gate',
      body: 'Switch the **Gate** ON on a held pad or chord: it chops the sound in time with the song. Try **1/16**, then **1/16T** for triplet stutters before a drop.',
      target: '[data-search="Gate"]',
      task: { hint: 'Switch the Gate on', done: () => tl().tracks.some((t) => t.fx.gate.on) },
    },
    {
      title: 'Key change',
      body: 'Right-click the ruler where the last chorus starts and choose **Key change here: up a whole step**. Pitched notes from there on move up; drums stay put.',
      target: RULER,
      task: { hint: 'Right-click the ruler: Key change', begin: pitches, done: (p) => pitches() !== p },
    },
    {
      title: 'Freeze a heavy track',
      body: "Click a track's snowflake to **freeze** it: it's rendered to audio so playback needs less of the computer. Change anything on it and it plays live again until you freeze it once more.",
      target: 'button[aria-label^="Freeze "]',
      task: { hint: 'Freeze any track', done: () => tl().tracks.some((t) => !!t.frozen) },
    },
    {
      title: 'Hear it like a game',
      body: 'The **Game** tab plays your marker sections as game states that switch on the next bar or beat, with layers you can bring in and an Intensity slider.',
      target: () => (ui().dockOpen && ui().dockTab === 'game' ? '[aria-label="Game preview"]' : '#btn-game'),
      task: { hint: 'Open the Game tab', done: () => ui().dockOpen && ui().dockTab === 'game' },
    },
    {
      title: 'Export for a game',
      body: 'In **Export**, the **Intro + loop** range renders an intro and a seamless loop with loop points a game engine reads, and **Layers** exports each track for adaptive music.',
      target: dialogOr('export', 'Export audio', EXPORT_BUTTON),
      task: { hint: 'Open Export', done: () => ui().dialog === 'export' },
    },
    {
      title: 'Work faster',
      body: '**J** / **K** / **Shift+L**: back a bar, play/pause, forward a bar. **V** and **C**: select and razor tools. **Ctrl+D** duplicates the selected clips; **Alt**-drag copies one. **+** / **-** zoom. In the piano roll, **SCALE**, **CHORD** and **TOOLS** (arpeggiate, strum, ratchet, roll) do the busy work.',
    },
    {
      title: 'Score to picture, play live',
      body: 'The **Video** tab loads gameplay or a trailer that plays in sync with the playhead; video export can put your music on it. **Mic** records your voice or an instrument, and the MIDI button connects a keyboard or turns the computer keyboard into one.',
      target: '#btn-video-tools',
    },
    {
      title: "You're a pro",
      body: 'That is the whole toolbox. The **GUIDE** goes deeper on every part, and **SEARCH** takes you to anything in a couple of keystrokes. Have fun!',
    },
  ],
};

export const LESSONS: Lesson[] = [TOUR, BEGINNER, INTERMEDIATE, EXPERT];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
