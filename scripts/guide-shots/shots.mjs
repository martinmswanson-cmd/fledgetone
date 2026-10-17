// The guide's screenshots on fledgetone.com/guide/: which picture goes in which section, after
// which ### heading (null: after the section's opening paragraph, 'end': at the end), its caption,
// and how to set the studio up to take it. capture.mjs takes them; scripts/guide-site.mjs places
// them. GUIDE.md itself has no pictures, since the app's guide shows text only.
//
// `ai: true` marks a picture or clip showing the AI-generated test film (trailer.webm): its caption
// says so.
//
// Each setup gets `s`, the capture helpers (see capture.mjs), and returns the box to keep: an
// element, a list of elements (their union), or { x, y, width, height } in page pixels.

export const SHOTS = [
  {
    file: 'overview', section: 'getting-started', after: null,
    alt: 'The Fledgetone studio with the Boss Fight starter open: tracks and clips on the timeline, the mixer below.',
    caption: 'A starter song open: the menu bar and header at the top, the timeline in the middle, the bottom panel underneath.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.zoomOut(2); return s.viewport(); },
  },
  {
    file: 'menu-file', section: 'getting-started', after: 'the-menu-bar',
    alt: 'The File menu open, listing New, Open, Save, Export and the game and video exports.',
    caption: 'The File menu. Every tool is in one of these menus.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.menu('File'); return s.union([s.q('[role=menubar]'), s.q('[role=menu]')], 10); },
  },
  {
    file: 'search', section: 'getting-started', after: 'search',
    alt: 'The search palette with "reverb" typed, listing matching tools, settings and guide sections.',
    caption: 'Search (Ctrl+K) finds tools, settings, instruments and guide sections.',
    setup: async (s) => {
      await s.starter('Boss Fight');
      await s.page.keyboard.press('Control+k');
      await s.page.keyboard.type('reverb');
      await s.wait(500);
      return s.dialog();
    },
  },
  {
    file: 'timeline', section: 'the-timeline', after: null,
    alt: 'The arrangement timeline: track headers on the left with volume and pan, coloured clips of notes on the right.',
    caption: 'Tracks down the left, clips along the timeline.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.zoomOut(2); return s.timeline(); },
  },
  {
    file: 'transport', section: 'playback-and-the-loop', after: null,
    alt: 'The transport bar: go to start, play, stop, record, loop, markers, metronome, the bar and timecode readouts, tools and snap.',
    caption: 'The transport bar, with the bar and timecode readouts in the middle.',
    setup: async (s) => { await s.starter('Boss Fight'); return s.union([s.title('Go to In point'), s.title('Zoom in (+)')], 12); },
  },
  {
    file: 'loop', section: 'playback-and-the-loop', after: 'the-loop',
    alt: 'The ruler with the amber loop region between the IN and OUT brackets.',
    caption: 'The loop: the amber region on the ruler, between IN and OUT.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.zoomOut(2); return s.ruler(); },
  },
  {
    file: 'tempo-ruler', section: 'tempo-changes-and-time-signatures', after: null,
    alt: 'The ruler of the Cinematic starter: a tempo row with changes and glides between 100 and 88 BPM above the bars.',
    caption: 'Tempo changes on the ruler\'s top row. A faint line traces the tempo across the song.',
    setup: async (s) => { await s.starter('Cinematic'); await s.zoomOut(2); return s.ruler(); },
  },
  {
    file: 'tempo-header', section: 'tempo-changes-and-time-signatures', after: 'end',
    alt: 'The header: the tempo with minus and plus, TAP and FIT, swing, intensity and the master volume.',
    caption: 'Tempo, TAP and FIT in the header.',
    setup: async (s) => { await s.starter('Cinematic'); return s.union([s.title('Click to type a tempo'), s.title('Click repeatedly to tap tempo'), s.text('MASTER')], 16); },
  },
  {
    file: 'timecode', section: 'timecode-and-frame-rates', after: 'choosing-a-frame-rate',
    alt: 'The BAR.BEAT.TICK and TIMECODE readouts, with the frame rate menu open.',
    caption: 'The bar and timecode readouts. Click the frame rate next to TIMECODE to change it.',
    setup: async (s) => {
      await s.starter('Cinematic');
      return s.union([s.title('Click to type a bar position'), s.title('Click to type a timecode')], 12);
    },
  },
  {
    file: 'scoring', section: 'scoring-to-a-video', after: null, video: '/video/score.mp4', poster: '/video/score-poster.webp', ai: true,
    alt: 'Scoring to a short film: the video on its lane, its three cuts marked, FIT finds 117.76 BPM so all three land on a bar, then it plays in the preview window.',
    caption: 'Load a video, find its cuts, and fit the tempo so each cut lands on a bar.',
  },
  {
    file: 'first-flight', section: 'scoring-to-a-video', after: 'end', video: '/video/first-flight.mp4', poster: '/video/first-flight-poster.webp', sound: true, ai: true,
    alt: 'An AI-generated film of a young bird\'s first flight, with an orchestral score made in Fledgetone that hits each of its cuts.',
    caption: 'The finished result: strings, horns, harp, flute and taiko written to the film\'s cuts at 117.76 BPM.',
  },
  {
    file: 'courier', section: 'scoring-to-a-video', after: 'end', video: '/video/courier.mp4', poster: '/video/courier-poster.webp', sound: true, ai: true,
    alt: 'AI-generated game-style footage of a small courier drone, with an electronic score made in Fledgetone that hits each of its cuts.',
    caption: 'Another style: a modern electronic score with a growl bass, 808 slides, filter sweeps and a tempo change at each cut, plus sound effects from the sound effects maker.',
  },
  {
    file: 'video-tab', section: 'scoring-to-a-video', after: 'end', ai: true,
    alt: 'The Video tab: the reference video, its start, Find cuts, Dip under dialogue, hit points, the tempo finder and exports.',
    caption: 'The Video tab has everything for scoring in one place.',
    setup: async (s) => { await s.starter('Cinematic'); await s.loadVideo(); await s.view('Video'); return s.panel(); },
  },
  {
    file: 'marker-flags', section: 'markers', after: 'flags-on-the-ruler', ai: true,
    alt: 'Markers on the ruler: Intro, Build and Climax flags, and two hit points locked to time.',
    caption: 'Markers are flags on the ruler; hit points carry a lock.',
    setup: async (s) => { await s.starter('Cinematic'); await s.loadVideo(); await s.findCuts(); await s.zoomOut(1); return s.ruler(); },
  },
  {
    file: 'markers-list', section: 'markers', after: 'the-markers-list', ai: true,
    alt: 'The Markers list: every marker and hit point with its bar, timecode and lock.',
    caption: 'The Markers list.',
    setup: async (s) => { await s.starter('Cinematic'); await s.loadVideo(); await s.findCuts(); await s.menu('Song', /^Markers list/); return s.dialog(); },
  },
  {
    file: 'piano-roll', section: 'writing-notes-the-piano-roll', after: null,
    alt: 'The piano roll editing a brass melody: a keyboard on the left, notes on a grid, and grid, velocity, feel, scale and chord controls above.',
    caption: 'Double-click a clip to edit its notes in the piano roll.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.openClip('Boss theme'); return s.pianoRoll(); },
  },
  {
    file: 'notation', section: 'writing-notes-the-piano-roll', after: 'end',
    alt: 'A clip shown as sheet music on a staff, with the measure under the playhead lit.',
    caption: 'Tick NOTATION to read a clip as sheet music.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.openClip('Boss theme'); await s.page.getByText('NOTATION', { exact: true }).click(); await s.wait(1200); return s.pianoRoll(); },
  },
  {
    file: 'synth-designer', section: 'instruments', after: 'synth-designer',
    alt: 'The Synth Designer: oscillators, sub and noise, filter, filter and amp envelopes and an LFO for a synth patch.',
    caption: 'The Synth Designer, beside the timeline.',
    setup: async (s) => { await s.starter('Synthwave'); await s.page.getByTitle('Arp: open in the Inspector').click(); await s.wait(800); return s.inspector(); },
  },
  {
    file: 'mixer', section: 'mixing-and-effects', after: 'the-mixer',
    alt: 'The Mixer: a channel strip per track with inserts, reverb and delay sends, pan and a fader, a drum bus, the master and a spectrum.',
    caption: 'The Mixer, in the bottom panel.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.view('Mixer'); return s.panel(); },
  },
  {
    file: 'inspector', section: 'mixing-and-effects', after: 'the-track-inspector-fx-rack',
    alt: 'The Track Inspector open beside the timeline: the instrument, its insert effects and their settings.',
    caption: 'The Track Inspector and FX rack for the selected track.',
    setup: async (s) => {
      await s.starter('Dubstep');
      // A track whose sounds are ready, scrolled to its insert effects
      for (const b of await s.page.locator('[title$=": open in the Inspector"]').all()) {
        await b.click(); await s.wait(600);
        if (await s.page.getByText('Ready', { exact: true }).count()) break;
      }
      await s.page.getByText(/^(HUMAN|DISTORTION|FILTER|PUMP)$/).first().scrollIntoViewIfNeeded().catch(() => {});
      await s.wait(300);
      return s.inspector();
    },
  },
  {
    file: 'eq', section: 'mixing-and-effects', after: 'master',
    alt: 'The EQ & Dynamics tab: a parametric EQ curve over the spectrum, and a multiband compressor.',
    caption: 'EQ & Dynamics for the selected track.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.view('EQ & Dynamics'); return s.panel(); },
  },
  {
    file: 'automation', section: 'automation', after: 'opening-a-lane',
    alt: 'A track with its automation lane open under it: a line of points for a parameter over time.',
    caption: 'An automation lane under its track.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.zoomOut(2); await s.page.getByTitle('Show automation').nth(3).click(); await s.wait(600); return s.timeline(); },
  },
  {
    file: 'file-menu', section: 'projects-saving-and-opening', after: null,
    alt: 'The File menu: New, Open, Save, Save As and the exports.',
    caption: 'Save and Open are in the File menu (Ctrl+S, Ctrl+O).',
    setup: async (s) => { await s.starter('Boss Fight'); await s.menu('File'); return s.union([s.q('[role=menubar]'), s.q('[role=menu]')], 10); },
  },
  {
    file: 'midi', section: 'playing-a-midi-keyboard', after: null,
    alt: 'The MIDI input panel: the connected keyboard, its activity and the computer keyboard option.',
    caption: 'MIDI input, from the transport bar.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.page.getByTitle(/^MIDI input/).click(); await s.wait(500); return s.popover(); },
  },
  {
    file: 'recording', section: 'recording', after: null,
    alt: 'The recording settings: count-in, quantize, metronome and takes.',
    caption: 'Recording settings, next to the record button.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.page.getByTitle(/^Recording settings/).click(); await s.wait(500); return s.popover(); },
  },
  {
    file: 'export', section: 'exporting-audio', after: null,
    alt: 'The Export dialog: range, mixdown or stems, the ending, the format and loudness.',
    caption: 'The Export dialog (Ctrl+E).',
    setup: async (s) => { await s.starter('Boss Fight'); await s.page.getByTitle(/^Render the song or the loop/).click(); await s.wait(800); return s.dialog(); },
  },
  {
    file: 'game-tab', section: 'game-music', after: 'game-preview-hear-it-the-way-the-game-will-play-it',
    alt: 'The Game tab: the states, the intensity curves for each stem group, the stingers and the game exports.',
    caption: 'The Game tab: states, intensity, stingers and the game exports.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.view('Game'); return s.panel(); },
  },
  {
    file: 'sfx', section: 'game-music', after: 'sound-effects-maker',
    alt: 'The Sound FX tab: groups of sound kinds, the layers of the current sound and its finish settings.',
    caption: 'The sound effects maker, in the Sound FX tab.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.view('Sound effects'); return s.panel(); },
  },
  {
    file: 'try-game', section: 'game-music', after: 'try-it-in-a-game', video: '/video/game.mp4', poster: '/video/game-poster.webp',
    alt: 'Try it in a game: the music plays Phase 1 while exploring, switches to Phase 2 when the guard spots the robot, and plays a stinger when it is beaten.',
    caption: 'Try it in a game: the music follows what happens in the level.',
  },
];
