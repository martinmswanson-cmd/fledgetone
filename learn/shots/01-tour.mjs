// Screenshots and examples for learn/01-tour.md (taken by scripts/guide-shots/capture.mjs --learn).
export const SHOTS = [
  {
    file: 'tour-file-menu',
    alt: 'The File menu open at the top left of the studio, with New first.',
    caption: 'File › New… opens the starters and demo songs.',
    setup: async (s) => {
      await s.starter('Boss Fight');
      await s.menu('File');
      return s.union([s.q('[role=menubar]'), s.q('[role=menu]')], 10);
    },
  },
  {
    file: 'tour-timeline',
    alt: 'The timeline with the Boss Fight starter: track headers with M, S and volume on the left, coloured clips to the right.',
    caption: 'Tracks down the left, clips along the timeline, the playhead in red.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.zoomOut(1); return s.timeline(); },
  },
  {
    file: 'tour-piano-roll',
    alt: 'The piano roll under the timeline, showing the notes of a clip against a keyboard.',
    caption: 'Double-click a clip: its notes open in the piano roll.',
    setup: async (s) => {
      await s.starter('Boss Fight');
      await s.openClip('Boss theme');
      return s.pianoRoll();
    },
  },
  {
    file: 'tour-mixer',
    alt: 'The Mixer tab: a channel strip with a fader for each track and the master on the right.',
    caption: 'The Mixer: a channel strip per track, the master on the right.',
    setup: async (s) => { await s.starter('Boss Fight'); await s.view('Mixer'); return s.panel(); },
  },
  {
    file: 'tour-search',
    alt: 'The search palette with "reverb" typed, listing tools, settings and guide sections.',
    caption: 'Ctrl+K searches tools, settings, instruments, starters and the guide.',
    setup: async (s) => {
      await s.starter('Boss Fight');
      await s.page.keyboard.press('Control+k');
      await s.page.keyboard.type('reverb');
      await s.wait(500);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'boss-fight',
    label: 'The Boss Fight starter, to play with.',
    setup: async (s) => { await s.starter('Boss Fight'); },
  },
];
