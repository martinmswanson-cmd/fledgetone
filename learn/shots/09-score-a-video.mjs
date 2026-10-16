// Screenshots and examples for learn/09-score-a-video.md (taken by scripts/guide-shots/capture.mjs --learn).
// The film is scripts/guide-shots/trailer.webm, an AI-generated test film (24 fps, 15 seconds, three
// hard cuts): every caption that shows it says so.
const AI = 'The film in the picture is AI-generated.';

/** Epic Orchestral at 24 fps with the film loaded (and its cuts found). */
async function scored(s, { cuts = true } = {}) {
  await s.starter('Epic Orchestral');
  await s.q('select[title="Timecode frame rate (saved with the project)"]').selectOption({ label: '24 fps' });
  await s.loadVideo();
  if (cuts) await s.findCuts();
}

/** FIT › Hit points › Bar, open (the suggestions listed). */
async function openFinder(s) {
  await s.page.getByRole('button', { name: /^FIT$/ }).first().click();
  await s.wait(400);
  await s.q('[role=dialog] button').filter({ hasText: /^Hit points$/ }).click();
  await s.q('[role=dialog] button').filter({ hasText: /^Bar$/ }).click();
  await s.wait(800);
}

/** Apply the suggestion around 117.5 BPM (the film's cuts, 4 s apart, on bars 3, 5 and 7). */
async function applyFit(s) {
  await openFinder(s);
  for (const b of await s.q('[role=dialog] button').filter({ hasText: /^Apply$/ }).all()) {
    const row = await b.evaluate((e) => e.parentElement.innerText.trim());
    if (/^11[78]\./.test(row)) { await b.click(); break; }
  }
  await s.wait(600);
  await s.page.keyboard.press('Escape');
  await s.wait(300);
}

/** Right-click the ruler at the start of a bar and pick an item. */
async function rulerMenu(s, bar, item) {
  const b = await s.text(`${bar}.1`).first().boundingBox();
  await s.page.mouse.click(b.x + 3, b.y + 5, { button: 'right' });
  await s.wait(300);
  await s.q('[role=menu] [role^=menuitem]').filter({ hasText: item }).first().click();
  await s.wait(1200);
}

/** The loop from bar 1 to the end of the film (00:00:15:01 at 24 fps), typed in Loop range. */
async function loopToFilm(s) {
  await s.page.getByTitle('Loop In, Out and Length: type exact values').click();
  await s.wait(400);
  const out = s.page.getByLabel('Loop Out');
  await out.fill('15:01');
  await out.press('Enter');
  await s.wait(300);
  await s.page.keyboard.press('Escape');
  await s.wait(300);
}

/** The ruler, the film strip and the first tracks, wide enough for bar 8. */
async function rulerAndStrip(s, tracksBelow = 70) {
  const left = await s.union(s.own('Tracks'));
  const top = await s.union(s.q('[title^="The song\'s tempo"]'));
  return { x: Math.max(0, left.x - 18), y: top.y - 6, width: 1420 - Math.max(0, left.x - 18), height: left.y + left.height - top.y + tracksBelow };
}

export const SHOTS = [
  {
    file: 'score-timecode',
    alt: 'The BAR.BEAT.TICK and TIMECODE readouts in the transport bar, with the frame rate set to 24 FPS.',
    caption: 'Set the frame rate next to TIMECODE to the film\'s: 24 fps here.',
    setup: async (s) => {
      await s.starter('Epic Orchestral');
      await s.q('select[title="Timecode frame rate (saved with the project)"]').selectOption({ label: '24 fps' });
      await s.page.mouse.move(700, 4);
      return s.union([s.title('Click to type a bar position'), s.title('Click to type a timecode'), s.q('select[title="Timecode frame rate (saved with the project)"]')], 12);
    },
  },
  {
    file: 'score-video-tab',
    alt: 'The Video tab with trailer.webm loaded: its length and size, where it starts, Find cuts, Dip under dialogue, Tempo finder, Cut to length, the marker exports and Export music onto the video.',
    caption: 'The Video tab with the film loaded: everything for scoring in one place.',
    setup: async (s) => {
      await scored(s, { cuts: false });
      await s.view('Video');
      // The film's preview window floats over the panel's corner: hide it for this picture
      await s.page.getByTitle(/^Hide \(show it again/).first().click();
      await s.wait(300);
      const box = await s.panel();
      return { ...box, height: 300 };
    },
  },
  {
    file: 'score-cuts',
    alt: 'The ruler with the film strip under it and three hit points, Cut 1, Cut 2 and Cut 3, each with a lock, falling in the middle of bars at 130 BPM.',
    caption: `Find cuts drops a hit point on each cut. At 130 BPM they fall between the bar lines. ${AI}`,
    setup: async (s) => { await scored(s); return rulerAndStrip(s, 48); },
  },
  {
    file: 'score-fit',
    alt: 'The FIT window on Hit points with Bar chosen: tempos that land all three hits on a bar line, and a list of each cut with the bar it lands on and how early or late it is.',
    caption: 'FIT › Hit points lists the tempos that put the cuts on bar lines.',
    setup: async (s) => { await scored(s); await openFinder(s); return s.dialog(); },
  },
  {
    file: 'score-drop',
    alt: 'The timeline at 117.55 BPM: the cuts now sit on bars 3, 5 and 7, with a snare roll and a build-up clip running from bar 3 into a Drop marker at bar 7.',
    caption: `At 117.55 BPM every cut sits on a bar line, and Build-up & drop leads into the last one. ${AI}`,
    setup: async (s) => {
      await scored(s);
      await applyFit(s);
      await rulerMenu(s, 7, /^Build-up & drop here/);
      await s.page.mouse.move(700, 4);
      // The video's preview window would cover the new clips at the bottom right
      await s.page.getByTitle(/^Hide|^Close the preview/).first().click().catch(() => {});
      const box = await s.timeline();
      return box;
    },
  },
  {
    file: 'score-markers',
    alt: 'The Markers list: each marker and hit point with its bar and its timecode at 24 fps, and the Export markers for menu with Premiere Pro, DaVinci Resolve, Final Cut Pro and spreadsheet choices.',
    caption: 'The Markers list, with every hit point\'s timecode and the exports for video editors.',
    setup: async (s) => {
      await scored(s);
      await applyFit(s);
      await s.menu('Song', /^Markers list/);
      return s.dialog();
    },
  },
  {
    file: 'score-export',
    alt: 'The Export dialog with Loop region, Video (MP4) and Exact length chosen, and "Put the music on trailer.webm" ticked.',
    caption: 'Export the loop region as Video (MP4), with Put the music on your video ticked.',
    setup: async (s) => {
      await scored(s);
      await applyFit(s);
      await loopToFilm(s);
      await s.page.getByTitle(/^Render the song or the loop/).click();
      await s.wait(800);
      const pick = (t) => s.q('[role=dialog] button, [role=dialog] label').filter({ hasText: t }).first().click();
      await pick(/^Loop region$/);
      await pick(/^Video \(MP4\)/);
      await pick(/^Exact length$/);
      await s.wait(500);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'scored-film',
    label: 'Epic Orchestral at 117.55 BPM and 24 fps, with the film\'s three cuts as hit points and a build-up into the last one. The film itself isn\'t in the link: load any video to see how it works.',
    setup: async (s) => {
      await scored(s);
      await applyFit(s);
      await rulerMenu(s, 7, /^Build-up & drop here/);
    },
  },
];
