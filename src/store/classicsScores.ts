/**
 * The notes of the five public-domain pieces behind the Classics (demo songs in New, arranged in startersClassics.ts),
 * as plain data: packed scores (see scoreNotes.ts for the format) and one line written out by hand.
 * Times are quarter notes from the piece's first beat. Where each comes from (all public domain;
 * the editions and their makers are credited in SCORE_CREDITS, src/credits.ts):
 *
 * - Pachelbel, Canon in D: the first violin's line, written out from a 1929 edition (IMSLP #44549)
 *   and checked note by note against a CC0 edition (IMSLP #1022928), which leaves out the line's
 *   ninth and tenth bars; the second and third violins play it two and four bars later (a strict
 *   canon) over the ground bass. The editors' dynamics, ornaments and keyboard parts aren't used.
 * - Beethoven, Sonata Op. 27 No. 2, first movement, complete: transcribed bar by bar from the
 *   19th-century complete edition of Beethoven's works (IMSLP #994719), the triplets checked
 *   against the Mutopia Project's public-domain guitar-duo arrangement (Mutopia 2101) where it
 *   keeps the piano's register.
 * - Bach, Cello Suite No. 1 in G, BWV 1007, Prelude, complete: Mutopia Project 517, from a 1916
 *   edition.
 * - Grieg, In the Hall of the Mountain King, Op. 46 No. 4, complete, in Grieg's piano version:
 *   Mutopia Project 1888, from a 1918 edition.
 * - Debussy, Suite bergamasque, Clair de lune, complete: Mutopia Project 1778, from a 1905
 *   edition. 9/8 throughout.
 *
 * The packed parts are the Mutopia typesettings' own MIDI renderings (the notes as engraved),
 * and for the sonata the transcription; scripts/scoreNotes.test.mjs checks their opening bars,
 * lengths and keys.
 */
import { parseLine, unpackScore } from './scoreNotes';
import type { ScoreNote } from './scoreNotes';

/** The Canon's line from the first violin's entry: 54 bars of 4/4 (`|` checks each bar). */
const CANON_LINE = `
  F#5:1 E5:1 D5:1 C#5:1 |
  B4:1 A4:1 B4:1 C#5:1 |
  D5:1 C#5:1 B4:1 A4:1 |
  G4:1 F#4:1 G4:1 E4:1 |
  D4:1/2 F#4:1/2 A4:1/2 G4:1/2 F#4:1/2 D4:1/2 F#4:1/2 E4:1/2 |
  D4:1/2 B3:1/2 D4:1/2 A4:1/2 G4:1/2 B4:1/2 A4:1/2 G4:1/2 |
  F#4:1/2 D4:1/2 E4:1/2 C#5:1/2 D5:1/2 F#5:1/2 A5:1/2 A4:1/2 |
  B4:1/2 G4:1/2 A4:1/2 F#4:1/2 D4:1/2 D5:1/2 D5:1/2 C#5:1/2 |
  D5:1/4 C#5:1/4 D5:1/4 D4:1/4 C#4:1/4 A4:1/4 E4:1/4 F#4:1/4 D4:1/4 D5:1/4 C#5:1/4 B4:1/4 C#5:1/4 F#5:1/4 A5:1/4 B5:1/4 |
  G5:1/4 F#5:1/4 E5:1/4 G5:1/4 F#5:1/4 E5:1/4 D5:1/4 C#5:1/4 B4:1/4 A4:1/4 G4:1/4 F#4:1/4 E4:1/4 G4:1/4 F#4:1/4 E4:1/4 |
  D4:1/4 E4:1/4 F#4:1/4 G4:1/4 A4:1/4 E4:1/4 A4:1/4 G4:1/4 F#4:1/4 B4:1/4 A4:1/4 G4:1/4 A4:1/4 G4:1/4 F#4:1/4 E4:1/4 |
  D4:1/4 B3:1/4 B4:1/4 C#5:1/4 D5:1/4 C#5:1/4 B4:1/4 A4:1/4 G4:1/4 F#4:1/4 E4:1/4 B4:1/4 A4:1/4 B4:1/4 A4:1/4 G4:1/4 |
  F#4:1/2 F#5:1/2 E5:1 r:1/2 D5:1/2 F#5:1 |
  B5:1 A5:1 B5:1 C#6:1 |
  D6:1/2 D5:1/2 C#5:1 r:1/2 B4:1/2 D5:1 |
  D5:3/2 D5:1/2 D5:1/2 G5:1/2 E5:1/2 A5:1/2 |
  A5:1/4 F#5:1/8 G5:1/8 A5:1/4 F#5:1/8 G5:1/8 A5:1/8 A4:1/8 B4:1/8 C#5:1/8 D5:1/8 E5:1/8 F#5:1/8 G5:1/8 F#5:1/4 D5:1/8 E5:1/8 F#5:1/4 F#4:1/8 G4:1/8 A4:1/8 B4:1/8 A4:1/8 G4:1/8 A4:1/8 F#4:1/8 G4:1/8 A4:1/8 |
  G4:1/4 B4:1/8 A4:1/8 G4:1/4 F#4:1/8 E4:1/8 F#4:1/8 E4:1/8 D4:1/8 E4:1/8 F#4:1/8 G4:1/8 A4:1/8 B4:1/8 G4:1/4 B4:1/8 A4:1/8 B4:1/4 C#5:1/8 D5:1/8 A4:1/8 B4:1/8 C#5:1/8 D5:1/8 E5:1/8 F#5:1/8 G5:1/8 A5:1/8 |
  F#5:1/4 D5:1/8 E5:1/8 F#5:1/4 E5:1/8 D5:1/8 E5:1/8 C#5:1/8 D5:1/8 E5:1/8 F#5:1/8 E5:1/8 D5:1/8 C#5:1/8 D5:1/4 B4:1/8 C#5:1/8 D5:1/4 D4:1/8 E4:1/8 F#4:1/8 G4:1/8 F#4:1/8 E4:1/8 F#4:1/8 D5:1/8 C#5:1/8 D5:1/8 |
  B4:1/4 D5:1/8 C#5:1/8 B4:1/4 A4:1/8 G4:1/8 A4:1/8 G4:1/8 F#4:1/8 G4:1/8 A4:1/8 B4:1/8 C#5:1/8 D5:1/8 B4:1/4 D5:1/8 C#5:1/8 D5:1/4 C#5:1/8 B4:1/8 C#5:1/8 D5:1/8 E5:1/8 D5:1/8 C#5:1/8 D5:1/8 B4:1/8 C#5:1/8 |
  D5:1/2 r:1/2 C#5:1/2 r:1/2 B4:1/2 r:1/2 D5:1/2 r:1/2 |
  D4:1/2 r:1/2 D4:1/2 r:1/2 D4:1/2 r:1/2 E4:1/2 r:1/2 |
  r:1/2 A4:1/2 r:1/2 A4:1/2 r:1/2 F#4:1/2 r:1/2 A4:1/2 |
  r:1/2 G4:1/2 r:1/2 F#4:1/2 r:1/2 G4:1/2 r:1/2 E5:1/2 |
  F#5:1/4 F#4:1/4 G4:1/4 F#4:1/4 E4:1/4 E5:1/4 F#5:1/4 E5:1/4 D5:1/4 F#4:1/4 D4:1/4 B4:1/4 A4:1/4 A3:1/4 G3:1/4 A3:1/4 |
  B3:1/4 B4:1/4 C#5:1/4 B4:1/4 A4:1/4 A3:1/4 G3:1/4 A3:1/4 B3:1/4 B4:1/4 A4:1/4 B4:1/4 C#5:1/4 C#4:1/4 B3:1/4 C#4:1/4 |
  D4:1/4 D5:1/4 E5:1/4 D5:1/4 C#5:1/4 C#4:1/4 D4:1/4 C#4:1/4 B3:1/4 B4:1/4 A4:1/4 B4:1/4 C#5:1/4 C#4:1/4 F#4:1/4 E4:1/4 |
  D4:1/4 D5:1/4 E5:1/4 G5:1/4 F#5:1/4 F#4:1/4 A4:1/4 F#5:1/4 D5:1/4 G5:1/4 F#5:1/4 G5:1/4 E5:1/4 A4:1/4 G4:1/4 A4:1/4 |
  F#4:1/4 A4:1/4 A4:1/4 A4:1/4 A4:1/4 A4:1/4 A4:1/4 A4:1/4 F#4:1/4 F#4:1/4 F#4:1/4 F#4:1/4 F#4:1/4 F#4:1/4 A4:1/4 A4:1/4 |
  G4:1/4 G4:1/4 G4:1/4 D5:1/4 D5:1/4 D5:1/4 D5:1/4 D5:1/4 D5:1/4 D5:1/4 B4:1/4 B4:1/4 A4:1/4 A4:1/4 E5:1/4 C#5:1/4 |
  A4:1/4 F#5:1/4 F#5:1/4 F#5:1/4 E5:1/4 E5:1/4 E5:1/4 E5:1/4 D5:1/4 D5:1/4 D5:1/4 D5:1/4 A5:1/4 A5:1/4 A5:1/4 A5:1/4 |
  B5:1/4 B5:1/4 B5:1/4 B5:1/4 A5:1/4 A5:1/4 A5:1/4 A5:1/4 B5:1/4 B5:1/4 B5:1/4 B5:1/4 C#6:1/4 C#5:1/4 C#5:1/4 C#5:1/4 |
  D5:1/4 D4:1/8 E4:1/8 F#4:1/4 D4:1/4 C#4:1/4 C#5:1/8 D5:1/8 E5:1/4 C#5:1/4 B4:1/4 B3:1/8 C#4:1/8 D4:1/4 B3:1/4 C#4:1/4 A4:1/8 G4:1/8 F#4:1/4 E4:1/4 |
  D4:1/4 G4:1/8 F#4:1/8 E4:1/4 G4:1/4 F#4:1/4 D4:1/8 E4:1/8 F#4:1/4 A4:1/4 G4:1/4 B4:1/8 A4:1/8 G4:1/4 F#4:1/4 E4:1/4 A4:1/8 G4:1/8 F#4:1/4 E4:1/4 |
  F#4:1/4 D5:1/8 C#5:1/8 D5:1/4 F#4:1/4 A4:1/4 A4:1/8 B4:1/8 C#5:1/4 A4:1/4 F#4:1/4 D5:1/8 E5:1/8 F#5:1/4 D5:1/4 F#5:1/4 F#5:1/8 E5:1/8 D5:1/4 C#5:1/4 |
  B4:1/4 B4:1/8 A4:1/8 B4:1/4 C#5:1/4 D5:1/4 F#5:1/8 E5:1/8 D5:1/4 F#5:1/4 G5:1/4 D5:1/8 C#5:1/8 B4:1/4 B4:1/4 A4:1/4 E4:1/4 A4:1/4 A4:1/4 |
  A4:3/2 A4:1/2 D4:3/2 A4:1/2 |
  G4:1 A4:1 G4:1/2 D4:1/2 D4:3/4 C#4:1/4 |
  D4:1/2 D5:1/2 C#5:1 B4:1 A4:1 |
  D4:3/4 E4:1/4 F#4:1 B4:1 E4:3/4 E4:1/4 |
  F#4:3/4 F#5:1/4 F#5:1/4 G5:1/4 F#5:1/4 E5:1/4 D5:3/4 D5:1/4 D5:1/4 E5:1/4 D5:1/4 C#5:1/4 |
  B4:1 D5:1 D5:1/4 C5:1/4 B4:1/4 C5:1/4 A4:3/4 A4:1/4 |
  A4:3/4 A5:1/4 A5:1/4 B5:1/4 A5:1/4 G5:1/4 F#5:3/4 F#5:1/4 F#5:1/4 G5:1/4 F#5:1/4 E5:1/4 |
  D5:1/4 C5:1/4 B4:1/4 C5:1/4 A4:3/4 A4:1/4 G4:1/2 D5:1/2 C#5:3/4 C#5:1/4 |
  D5:1/2 D5:1 C#5:1 B4:1 A4:1/2~ |
  A4:1/2 G4:1 F#4:5/4 E4:1/4 E4:1 |
  F#4:1/2 F#5:1 E5:1/2 D5:1/2 D6:1 C6:1/2 |
  B5:1 D6:1/2 A5:1/2 B5:1 A5:1 |
  A5:1 A4:3/4 G4:1/4 F#4:1 F#5:3/4 E5:1/4 |
  D5:3/2 D5:1/2 D5:1 C#5:1 |
  D5:1/2 D4:1/2 C#4:1/2 C#5:1/2 B4:1/2 B3:1/2 A3:1/2 A4:1/2 |
  G4:1/2 G5:1/2 F#5:1/2 F#4:1/2 G4:1/2 D5:1/2 A4:1/2 E5:1/2 |
  F#5:1/2 F#4:1/2 E4:1/2 E5:1/2 D5:1/2 D4:1/2 C#4:1/2 C#5:1/2 |
  B4:1/2 B5:1/2 A5:1/2 A4:1/2 G4:3/4 E5:1/4 A4:1/2 A4:1/2 |
`;

/** The Canon's line, starting at quarter `from`. */
export const canonLine = (from: number): ScoreNote[] => parseLine(CANON_LINE, 4, from);

const PACKED = {
  moonMelody:
    'pc.10.1w 10.c.1w c.40.1w 40.10.1w 10.c.1w c.2o.1w 2o.2o.1x 2o.2o.1w 2o.1c.1u 1c.1c.1z 1c.1c.1s 9c.10.1v ' +
    '10.c.1v c.40.1v 40.10.1v 10.c.1v c.40.1v 40.1c.1u 1c.2o.1u 2o.1c.1v 1c.1c.1s 1c.2o.1u 2o.2o.1u 2o.1c.1u ' +
    '40.1c.1z 1c.40.20 40.1c.1y 1c.40.1z 40.1c.1z 1c.40.20 40.1c.1y 1c.2o.1z 2o.2o.1z 2o.2o.1z 2o.2o.1x 2o.2o.1v ' +
    '2o.2o.1u 2o.2o.1p 2o.1c.1p 1c.1c.1p 5c.10.21 10.c.21 c.40.21 40.10.21 10.c.21 c.2o.21 2o.1c.20 1c.1c.21 ' +
    '1c.40.23 40.1c.23 1c.2o.24 2o.1c.23 1c.1c.21 280.10.1w 10.c.1w c.40.1w 40.10.1w 10.c.1w c.2o.1w 2o.2o.1x ' +
    '2o.2o.1w 2o.1c.1u 1c.1c.1z 1c.1c.1w 40.10.1z 10.c.1z c.40.1z 40.10.1z 10.c.1z c.2o.1z 2o.1c.20 1c.1c.21 ' +
    '1c.2o.23 2o.2o.24 2o.2o.22 2o.2o.20 2o.40.21 40.1c.21 1c.40.22 40.1c.20 1c.40.21 40.1c.21 1c.40.22 40.1c.20 ' +
    '1c.2o.21 2o.2o.21 2o.40.1z 40.1c.1z 1c.1c.1x 1c.1c.1x 1c.1c.1w 1c.1c.1w 1c.2o.1u 2o.1c.1w 1c.1c.1x 1c.2o.1w ' +
    '2o.2o.1w 2o.1c.1p 19c.2o.1s_1w_21 2o.5c.1s_1w_21',
  moonTriplets:
    '0.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s ' +
    'g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1l g.g.1p g.g.1s g.g.1l g.g.1p g.g.1s ' +
    'g.g.1l g.g.1q g.g.1u g.g.1l g.g.1q g.g.1u g.g.1k g.g.1o g.g.1u g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1r ' +
    'g.g.1i g.g.1o g.g.1r g.g.1g g.g.1k g.g.1p g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s ' +
    'g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1p g.g.1s ' +
    'g.g.1k g.g.1p g.g.1s g.g.1l g.g.1p g.g.1u g.g.1l g.g.1p g.g.1u g.g.1k g.g.1n g.g.1s g.g.1k g.g.1n g.g.1s ' +
    'g.g.1i g.g.1l g.g.1r g.g.1l g.g.1n g.g.1r g.g.1k g.g.1n g.g.1s g.g.1k g.g.1n g.g.1s g.g.1k g.g.1n g.g.1s ' +
    'g.g.1k g.g.1n g.g.1s g.g.1j g.g.1n g.g.1s g.g.1j g.g.1n g.g.1s g.g.1j g.g.1n g.g.1s g.g.1j g.g.1n g.g.1s ' +
    'g.g.1j g.g.1n g.g.1t g.g.1j g.g.1n g.g.1t g.g.1j g.g.1n g.g.1t g.g.1j g.g.1n g.g.1t g.g.1j g.g.1o g.g.1s ' +
    'g.g.1j g.g.1n g.g.1s g.g.1j g.g.1p g.g.1s g.g.1i g.g.1p g.g.1s g.g.1i g.g.1n g.g.1q g.g.1i g.g.1n g.g.1q ' +
    'g.g.1j g.g.1n g.g.1p g.g.1g g.g.1n g.g.1p g.g.1i g.g.1n g.g.1q g.g.1i g.g.1n g.g.1q g.g.1i g.g.1m g.g.1p ' +
    'g.g.1i g.g.1m g.g.1p g.g.1n g.g.1q g.g.1u g.g.1n g.g.1q g.g.1u g.g.1n g.g.1r g.g.1u g.g.1n g.g.1r g.g.1u ' +
    'g.g.1n g.g.1s g.g.1v g.g.1n g.g.1s g.g.1v g.g.1n g.g.1s g.g.1v g.g.1n g.g.1s g.g.1v g.g.1n g.g.1r g.g.1u ' +
    'g.g.1n g.g.1r g.g.1u g.g.1n g.g.1r g.g.1u g.g.1n g.g.1r g.g.1u g.g.1n g.g.1s g.g.1v g.g.1n g.g.1s g.g.1v ' +
    'g.g.1n g.g.1s g.g.1v g.g.1n g.g.1s g.g.1v g.g.1n g.g.1r g.g.1u g.g.1n g.g.1r g.g.1u g.g.1n g.g.1q g.g.1t ' +
    'g.g.1n g.g.1q g.g.1t g.g.1n g.g.1p g.g.1w g.g.1n g.g.1p g.g.1w g.g.1l g.g.1p g.g.1u g.g.1l g.g.1p g.g.1u ' +
    'g.g.1j g.g.1n g.g.1q g.g.1j g.g.1n g.g.1q g.g.1i g.g.1l g.g.1r g.g.1i g.g.1l g.g.1r g.g.1d g.g.1i g.g.1l ' +
    'g.g.1d g.g.1i g.g.1l g.g.1d g.g.1i g.g.1k g.g.1d g.g.1h g.g.1k g.g.1i g.g.1l g.g.1p g.g.1l g.g.1p g.g.1u ' +
    'g.g.1p g.g.1u g.g.1x g.g.1p g.g.1u g.g.1x g.g.1p g.g.1w g.g.1z g.g.1p g.g.1w g.g.1z g.g.1p g.g.1w g.g.1z ' +
    'g.g.1p g.g.1w g.g.1z g.g.1p g.g.1u g.g.1x g.g.1p g.g.1u g.g.1x g.g.1o g.g.1u g.g.1x g.g.1p g.g.1u g.g.1x ' +
    'g.g.1r g.g.1u g.g.1w g.g.1r g.g.1u g.g.1w g.g.1r g.g.1u g.g.1w g.g.1r g.g.1u g.g.1w g.g.1s g.g.1w g.g.21 ' +
    'g.g.1s g.g.1w g.g.21 g.g.1r g.g.1u g.g.1x g.g.1p g.g.1s g.g.1y g.g.20 g.g.1o g.g.1r g.g.1w g.g.1o g.g.1r ' +
    'g.g.1x g.g.1o g.g.1r g.g.1u g.g.1o g.g.1r w.g.1o g.g.1r g.g.1k g.g.1o g.g.1r g.g.1l g.g.1o g.g.1r g.g.1i ' +
    'g.g.1o g.g.1r w.g.1s g.g.1w g.g.21 g.g.1s g.g.1w g.g.24 g.g.1s g.g.1w g.g.21 g.g.1s g.g.1w w.g.1g g.g.1k ' +
    'g.g.1p g.g.1g g.g.1k g.g.1s g.g.1g g.g.1k g.g.1p g.g.1g g.g.1k g.g.1f g.g.1l g.g.1i g.g.1o g.g.1l g.g.1r ' +
    'g.g.1o g.g.1u g.g.1r g.g.1x g.g.1u g.g.20 g.g.1g g.g.1p g.g.1k g.g.1s g.g.1p g.g.1w g.g.1s g.g.21 g.g.1w ' +
    'g.g.24 g.g.21 g.g.1w g.g.1p g.g.1v g.g.1s g.g.1y g.g.1v g.g.21 g.g.1y g.g.24 g.g.21 g.g.27 g.g.24 g.g.2a ' +
    'g.g.1u g.g.20 g.g.1x g.g.23 g.g.20 g.g.26 g.g.23 g.g.29 g.g.26 g.g.2c g.g.29 g.g.2f g.g.2c g.g.26 g.g.29 ' +
    'g.g.23 g.g.26 g.g.20 g.g.23 g.g.1x g.g.20 g.g.1u g.g.1x g.g.1r g.g.1u g.g.1o g.g.1r g.g.1l g.g.1o g.g.1i ' +
    'g.g.1l g.g.1f g.g.1i g.g.1d g.g.1i g.g.1l g.2o.1c_1d g.g.1i g.g.1k g.g.1l g.g.1k g.g.1i g.1c.1f g.g.1i g.g.1l ' +
    'g.1c.1d g.g.1i g.g.1l g.2o.1c_1d g.g.1i g.g.1k g.g.1l g.g.1k g.g.1i g.1c.1e g.g.1i g.g.1l g.1c.1d g.g.1i ' +
    'g.g.1l g.2o.1c_1d g.g.1i g.g.1k g.g.1l g.g.1k g.g.1i g.g.1d g.g.1g g.g.1p g.g.1d g.g.1g g.g.1p g.g.1f g.g.1l ' +
    'g.g.1p g.g.1f g.g.1l g.g.1p g.g.1f g.g.1k g.g.1o g.g.1f g.g.1k g.g.1o g.g.1g g.g.1k g.g.1p g.g.1k g.g.1p ' +
    'g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r ' +
    'g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1l g.g.1p g.g.1u g.g.1l g.g.1p ' +
    'g.g.1u g.g.1k g.g.1n g.g.1s g.g.1k g.g.1n g.g.1s g.g.1i g.g.1l g.g.1r g.g.1l g.g.1n g.g.1r g.g.1n g.g.1s ' +
    'g.g.1w g.g.1n g.g.1s g.g.1w g.g.1n g.g.1s g.g.1w g.g.1n g.g.1s g.g.1w g.g.1n g.g.1u g.g.1x g.g.1n g.g.1u ' +
    'g.g.1x g.g.1n g.g.1u g.g.1x g.g.1n g.g.1u g.g.1x g.g.1n g.g.1s g.g.1w g.g.1n g.g.1s g.g.1w g.g.1o g.g.1u ' +
    'g.g.1w g.g.1p g.g.1s g.g.1w g.g.1r g.g.1u g.g.1w g.g.1r g.g.1u g.g.1w g.g.1s g.g.1w g.g.21 g.g.1s g.g.1w ' +
    'g.g.21 g.g.1q g.g.1u g.g.1x g.g.1q g.g.1u g.g.1x g.g.1o g.g.1u g.g.1w g.g.1o g.g.1u g.g.1w g.g.1p g.g.1s ' +
    'g.g.1w g.g.1p g.g.1s g.g.1w g.g.1p g.g.1t g.g.1w g.g.1p g.g.1t g.g.1w g.g.1q g.g.1u g.g.1x g.g.1q g.g.1u ' +
    'g.g.1x g.g.1q g.g.1u g.g.1x g.g.1o g.g.1u g.g.1x g.g.1p g.g.1t g.g.1w g.g.1p g.g.1t g.g.1w g.g.1p g.g.1t ' +
    'g.g.1w g.g.1p g.g.1t g.g.1w g.g.1q g.g.1u g.g.1x g.g.1q g.g.1u g.g.1x g.g.1q g.g.1u g.g.1x g.g.1o g.g.1u ' +
    'g.g.1x g.g.1p g.g.1t g.g.1w g.g.1p g.g.1t g.g.1w g.g.1p g.g.1u g.g.1x g.g.1p g.g.1u g.g.1x g.g.1n g.g.1u ' +
    'g.g.1x g.g.1n g.g.1u g.g.1x g.g.1n g.g.1u g.g.1x g.g.1n g.g.1s g.g.1w g.g.1l g.g.1s g.g.1w g.g.1l g.g.1r ' +
    'g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1p g.g.1s g.g.1i g.g.1p g.g.1r g.g.1i g.g.1p g.g.1r g.g.1k g.g.1p ' +
    'g.g.1r g.g.1l g.g.1p g.g.1r g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1i g.g.1o g.g.1r g.g.1i g.g.1o ' +
    'g.g.1r g.g.1g g.g.1k g.g.1p g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1p g.g.1s g.g.1k g.g.1r ' +
    'g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1r g.g.1u g.g.1k g.g.1s g.g.1p g.g.1w g.g.1s ' +
    'g.g.21 g.g.1w g.g.24 g.g.21 g.g.28 g.g.24 g.g.21 g.g.20 g.g.23 g.g.1x g.g.20 g.g.1u g.g.1x g.g.1r g.g.1u ' +
    'g.w.1l g.1c.1o g.g.1k g.g.1i g.g.1k g.g.1s g.g.1p g.g.1w g.g.1s g.g.21 g.g.1w g.g.24 g.g.21 g.g.28 g.g.24 ' +
    'g.g.21 g.g.20 g.g.23 g.g.1x g.g.20 g.g.1u g.g.1x g.g.1r g.g.1u g.w.1l g.1c.1o g.g.1k g.g.1i g.g.1g_1p g.g.1k ' +
    'g.g.1p g.g.1s g.g.1p g.g.1k w.g.1g g.g.1k g.g.1p g.g.1k g.g.1g w.g.1d g.g.1g g.g.1k g.g.1g g.g.1d g.g.18 ' +
    'g.g.1d g.g.18 g.g.14 g.g.18 g.g.14',
  moonBass:
    '0.5c.11_1d 5c.5c.z_1b 5c.2o.x_19 2o.2o.u_16 2o.2o.w_18 2o.2o.w_18 2o.5c.11_18_1d 5c.5c.10_18_1c 5c.2o.11_1d ' +
    '2o.2o.u_16 2o.2o.z_1b 2o.2o.z_1b 2o.5c.14_1g 5c.5c.14_1g 5c.5c.12_1e 5c.1c.10_1c 1c.1c.z_1b 1c.2o.y_1a ' +
    '2o.2o.z_1b 2o.1c.14 1c.1c.17 1c.2o.u_16 2o.2o.u_16 2o.5c.z_1b 5c.1c.z_1b 1c.1c.14_1g 1c.1c.17_1j 1c.1c.14_1g ' +
    '1c.5c.z_1b 5c.1c.z_1b 1c.1c.14_1g 1c.1c.17_1j 1c.1c.14_1g 1c.2o.z_1b 2o.2o.w_18 2o.2o.t_15 2o.2o.u_16 ' +
    '2o.2o.z_1b 2o.2o.10_1c 2o.2o.11_1d 2o.2o.11_1d 2o.5c.u_16 5c.5c.t_15_1b 5c.2o.u_16 2o.1c.13_1f 1c.1c.11_1d ' +
    '1c.40.10_1c 40.1c.w_18 1c.2o.11_1d 2o.1c.u_16 1c.1c.v_17 1c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 ' +
    '5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.5c.w_18 5c.2o.w_18 2o.2o.x_19 ' +
    '2o.2o.u_16 2o.2o.w_18 2o.5c.11_18_1d 5c.5c.10_18_1c 5c.2o.11_1d 2o.2o.u_16 2o.2o.z_1b 2o.2o.z_1b 2o.5c.14_1g ' +
    '5c.5c.13_1f 5c.2o.14_1g 2o.1c.13_1f 1c.1c.11_1d 1c.2o.10_18_1f 2o.2o.11_18_1d 2o.2o.u_16 2o.2o.w_18 ' +
    '2o.5c.11_1d 5c.1c.11_1d 1c.1c.16_1i 1c.1c.19_1l 1c.1c.16_1i 1c.5c.11_1d 5c.1c.11_1d 1c.1c.16_1i 1c.1c.19_1l ' +
    '1c.1c.16_1i 1c.2o.11_1d 2o.2o.u_16 2o.40.13_1f 40.1c.14_1g 1c.1c.11_1d 1c.1c.13_1f 1c.1c.10_1c 1c.1c.11_1d ' +
    '1c.2o.x_19 2o.1c.w_18 1c.1c.u_16 1c.2o.w_18 2o.2o.w_18 2o.40.18 0.5c.11 40.10.18 10.c.18 c.40.18 0.5c.10 ' +
    '40.10.18 10.c.18 c.40.18 0.5c.11 40.10.18 10.c.18 c.40.18 0.5c.w 40.10.18 10.c.18 c.40.18 0.5c.11 40.10.18 ' +
    '10.c.18 c.40.18 0.5c.w 40.10.18 10.c.18 c.2o.18 0.5c.11 2o.2o.1d 2o.2o.11_18 5c.2o.11 2o.2o.11_18_1d ' +
    '2o.5c.11_18_1d',
  preludeCello:
    '0.c.17 c.c.1e c.c.1n c.c.1l c.c.1n c.c.1e c.c.1n c.c.1e c.c.17 c.c.1e c.c.1n c.c.1l c.c.1n c.c.1e c.c.1n ' +
    'c.c.1e c.c.17 c.c.1g c.c.1o c.c.1n c.c.1o c.c.1g c.c.1o c.c.1g c.c.17 c.c.1g c.c.1o c.c.1n c.c.1o c.c.1g ' +
    'c.c.1o c.c.1g c.c.17 c.c.1i c.c.1o c.c.1n c.c.1o c.c.1i c.c.1o c.c.1i c.c.17 c.c.1i c.c.1o c.c.1n c.c.1o ' +
    'c.c.1i c.c.1o c.c.1i c.c.17 c.c.1j c.c.1n c.c.1l c.c.1n c.c.1j c.c.1n c.c.1j c.c.17 c.c.1j c.c.1n c.c.1l ' +
    'c.c.1n c.c.1j c.c.1n c.c.1i c.c.17 c.c.1g c.c.1n c.c.1l c.c.1n c.c.1j c.c.1i c.c.1j c.c.1g c.c.1j c.c.1i ' +
    'c.c.1j c.c.1b c.c.1e c.c.1d c.c.1b c.c.1d c.c.1j c.c.1l c.c.1j c.c.1l c.c.1j c.c.1l c.c.1j c.c.1d c.c.1j ' +
    'c.c.1l c.c.1j c.c.1l c.c.1j c.c.1l c.c.1j c.c.1i c.c.1l c.c.1q c.c.1p c.c.1q c.c.1l c.c.1j c.c.1l c.c.1i ' +
    'c.c.1l c.c.1j c.c.1l c.c.1e c.c.1i c.c.1g c.c.1e c.c.14 c.c.1b c.c.1j c.c.1i c.c.1j c.c.1b c.c.1j c.c.1b ' +
    'c.c.14 c.c.1b c.c.1j c.c.1i c.c.1j c.c.1b c.c.1j c.c.1b c.c.14 c.c.1d c.c.1e c.c.1g c.c.1e c.c.1d c.c.1b ' +
    'c.c.19 c.c.1j c.c.1i c.c.1g c.c.1q c.c.1p c.c.1n c.c.1l c.c.1j c.c.1i c.c.1g c.c.1e c.c.1q c.c.1l c.c.1q ' +
    'c.c.1i c.c.1l c.c.1e c.c.1g c.c.1i c.c.1l c.c.1j c.c.1i c.c.1g c.c.1e c.c.1k c.c.1e c.c.1h c.c.1g c.c.1h ' +
    'c.c.1e c.c.1k c.c.1e c.c.1n c.c.1e c.c.1h c.c.1g c.c.1h c.c.1e c.c.1k c.c.1e c.c.1c c.c.1g c.c.1l c.c.1n ' +
    'c.c.1o c.c.1l c.c.1g c.c.1e c.c.1c c.c.1g c.c.1l c.c.1n c.c.1o c.c.1l c.c.1i c.c.1g c.c.1f c.c.1i c.c.1f ' +
    'c.c.1i c.c.1l c.c.1i c.c.1l c.c.1i c.c.1f c.c.1i c.c.1f c.c.1i c.c.1l c.c.1i c.c.1l c.c.1i c.c.1j c.c.1i ' +
    'c.c.1g c.c.1j c.c.1i c.c.1j c.c.1l c.c.1i c.c.1j c.c.1i c.c.1g c.c.1e c.c.1c c.c.1b c.c.19 c.c.17 c.c.16 ' +
    'c.c.1c c.c.1e c.c.1c c.c.1e c.c.1c c.c.1e c.c.1c c.c.16 c.c.1c c.c.1e c.c.1c c.c.1e c.c.1c c.c.1e c.c.1c ' +
    'c.c.17 c.c.1b c.c.1h c.c.1g c.c.1h c.c.1b c.c.1h c.c.1b c.c.17 c.c.1b c.c.1h c.c.1g c.c.1h c.c.1b c.c.1h ' +
    'c.c.1b c.c.17 c.c.1c c.c.1g c.c.1e c.c.1g c.c.1c c.c.1g c.c.1c c.c.17 c.c.1c c.c.1g c.c.1e c.c.1g c.c.1c ' +
    'c.c.1g c.c.1c c.c.17 c.c.1i c.c.1o c.c.1n c.c.1o c.c.1i c.c.1o c.c.1i c.c.17 c.c.1i c.c.1o c.c.1n c.c.1o ' +
    'c.c.1i c.c.1o c.c.1i c.c.17 c.c.1e c.c.1n c.c.1l c.c.1n c.c.1j c.c.1i c.c.1g c.c.1e c.c.1c c.c.1b c.c.19 ' +
    'c.c.17 c.c.16 c.c.14 c.c.12 c.c.11 c.c.19 c.c.1g c.c.1i c.c.1j c.c.1g c.c.1i c.c.1j c.c.11 c.c.19 c.c.1g ' +
    'c.c.1i c.c.1j c.c.1g c.c.1i c.c.1j c.c.10 c.c.19 c.c.1e c.c.1g c.c.1i c.c.1e c.c.1g c.c.1i c.c.10 c.c.19 ' +
    'c.c.1e c.c.1g c.c.1i c.c.1e c.c.1g c.c.1i c.c.10 c.c.19 c.c.1e c.c.1i c.c.1l c.c.1p c.10.1q 10.c.19 c.c.1b ' +
    'c.c.1c c.c.1e c.c.1g c.c.1i c.c.1j c.c.1l c.c.1i c.c.1e c.c.1g c.c.1i c.c.1j c.c.1l c.c.1n c.c.1o c.c.1l ' +
    'c.c.1i c.c.1j c.c.1l c.c.1n c.c.1o c.c.1q c.c.1r c.c.1q c.c.1p c.c.1q c.c.1q c.c.1o c.c.1n c.c.1o c.c.1o ' +
    'c.c.1l c.c.1i c.c.1g c.c.1e c.c.19 c.c.1b c.c.1c c.c.12 c.c.19 c.c.1e c.c.1i c.c.1l c.c.1n c.c.1o c.c.1l ' +
    'c.c.1n c.c.1j c.c.1e c.c.1c c.c.1b c.c.17 c.c.19 c.c.1b c.c.12 c.c.17 c.c.1b c.c.1e c.c.1j c.c.1l c.c.1n ' +
    'c.c.1j c.c.1p c.c.1m c.c.1l c.c.1m c.c.1m c.c.1l c.c.1k c.c.1l c.c.1l c.c.1j c.c.1i c.c.1j c.c.1j c.c.1g ' +
    'c.c.1d c.c.1b c.c.19 c.c.1d c.c.1g c.c.1j c.c.1l c.c.1p c.c.1q c.c.1p c.c.1q c.c.1l c.c.1i c.c.1g c.c.1i ' +
    'c.c.1l c.c.1e c.c.1i c.c.19 c.c.1e c.c.1d c.c.1b c.c.19 c.c.17 c.c.16 c.c.14 c.o.12 o.c.1o c.c.1n c.c.1l ' +
    'c.c.1j c.c.1i c.c.1g c.c.1e c.c.1o c.c.1n c.c.1l c.c.1j c.c.1i c.c.1g c.c.1e c.c.1c c.c.1n c.c.1l c.c.1j ' +
    'c.c.1i c.c.1g c.c.1e c.c.1c c.c.1b c.c.1l c.c.1j c.c.1i c.c.1g c.c.1e c.c.1c c.c.1b c.c.19 c.c.1j c.c.1i ' +
    'c.c.1g c.c.1i c.c.1l c.c.1e c.c.1l c.c.1g c.c.1l c.c.1i c.c.1l c.c.1j c.c.1l c.c.1g c.c.1l c.c.1i c.c.1l ' +
    'c.c.1e c.c.1l c.c.1j c.c.1l c.c.1g c.c.1l c.c.1i c.c.1l c.c.1e c.c.1l c.c.1j c.c.1l c.c.1g c.c.1l c.c.1i ' +
    'c.c.1l c.c.1e c.c.1l c.c.1g c.c.1l c.c.1i c.c.1l c.c.1j c.c.1l c.c.1l c.c.1l c.c.1n c.c.1l c.c.1e c.c.1l ' +
    'c.c.1l c.c.1l c.c.1n c.c.1l c.c.1o c.c.1l c.c.1e c.c.1l c.c.1n c.c.1l c.c.1o c.c.1l c.c.1q c.c.1l c.c.1n ' +
    'c.c.1l c.c.1o c.c.1l c.c.1n c.c.1l c.c.1o c.c.1l c.c.1l c.c.1l c.c.1n c.c.1l c.c.1l c.c.1l c.c.1n c.c.1l ' +
    'c.c.1j c.c.1l c.c.1l c.c.1l c.c.1j c.c.1l c.c.1l c.c.1l c.c.1i c.c.1l c.c.1j c.c.1l c.c.1i c.c.1l c.c.1j ' +
    'c.c.1l c.c.1g c.c.1l c.c.1i c.c.1l c.c.1e c.c.1g c.c.1h c.c.1e c.c.1i c.c.1e c.c.1j c.c.1e c.c.1k c.c.1e ' +
    'c.c.1l c.c.1e c.c.1m c.c.1e c.c.1n c.c.1e c.c.1o c.c.1e c.c.1p c.c.1e c.c.1q c.c.1e c.c.1r c.c.1e c.c.1s ' +
    'c.c.1e c.c.1t c.c.1e c.c.1u c.c.1e c.c.1v c.c.1n c.c.1e c.c.1n c.c.1v c.c.1n c.c.1v c.c.1n c.c.1v c.c.1n ' +
    'c.c.1e c.c.1n c.c.1v c.c.1n c.c.1v c.c.1n c.c.1v c.c.1l c.c.1e c.c.1l c.c.1v c.c.1l c.c.1v c.c.1l c.c.1v ' +
    'c.c.1l c.c.1e c.c.1l c.c.1v c.c.1l c.c.1v c.c.1l c.c.1u c.c.1o c.c.1e c.c.1o c.c.1u c.c.1o c.c.1u c.c.1o ' +
    'c.c.1u c.c.1o c.c.1e c.c.1o c.c.1u c.c.1o c.c.1u c.c.1o c.5c.17_1n_1v',
  kingRight:
    '0.4o.1i_1u.j 5c.c.z.h o.c.11 o.c.12 o.c.14 o.c.16 o.c.12 o.o.16 1c.c.15 o.c.11 o.o.15 1c.c.14 o.c.10 o.o.14 ' +
    '1c.c.z o.c.11 o.c.12 o.c.14 o.c.16 o.c.12 o.c.16 o.c.1b o.c.19 o.c.16 o.c.12 o.c.16 o.2c.19 2o.c.1b o.c.1d ' +
    'o.c.1e o.c.1g o.c.1i o.c.1e o.o.1i 1c.c.1h o.c.1d o.o.1h 1c.c.1g o.c.1c o.o.1g 1c.c.1b o.c.1d o.c.1e o.c.1g ' +
    'o.c.1i o.c.1e o.c.1i o.c.1n o.c.1l o.c.1i o.c.1e o.c.1i o.2c.19_1l 2o.c.16 o.c.18 o.c.1a o.c.1b o.c.1d o.c.1a ' +
    'o.o.1d 1c.c.1e o.c.1a o.o.1e 1c.c.1d o.c.1a o.o.1d 1c.c.16 o.c.18 o.c.1a o.c.1b o.c.1d o.c.1a o.o.1d 1c.c.1e ' +
    'o.c.1a o.o.1e 1c.2c.1d 2o.c.1i o.c.1k o.c.1m o.c.1n o.c.1p o.c.1m o.o.1p 1c.c.1q o.c.1m o.o.1q 1c.c.1p o.c.1m ' +
    'o.o.1p 1c.c.1i o.c.1k o.c.1m o.c.1n o.c.1p o.c.1m o.o.1p 1c.c.1q o.c.1m o.o.1q 1c.2c.1d_1p 2o.c.z o.c.11 ' +
    'o.c.12 o.c.14 o.c.16 o.c.12 o.o.16 1c.c.15 o.c.11 o.o.15 1c.c.14 o.c.10 o.o.14 1c.c.z o.c.11 o.c.12 o.c.14 ' +
    'o.c.16 o.c.12 o.c.16 o.c.1b o.c.19 o.c.16 o.c.12 o.c.16 o.2c.19 2o.c.1b o.c.1d o.c.1e o.c.1g o.c.1i o.c.1e ' +
    'o.o.1i 1c.c.1h o.c.1d o.o.1h 1c.c.1g o.c.1c o.o.1g 1c.c.1b o.c.1d o.c.1e o.c.1g o.c.1i o.c.1e o.c.1i o.c.1n ' +
    'o.c.1l o.c.1i o.c.1e o.c.1i o.2c.19_1l 2o.c.1n o.c.1p o.c.1i_1q o.c.1s o.c.1u o.c.1q o.o.1i_1u 1c.c.1t o.c.1p ' +
    'o.o.1h_1t 1c.c.1s o.c.1o o.o.1g_1s 1c.c.1n o.c.1p o.c.1i_1q o.c.1s o.c.1u o.c.1q o.c.1u o.c.1z o.c.1x o.c.1u ' +
    'o.c.1l_1q o.c.1u o.2c.1x 1c.16.1l_1q.p 1c.c.1z.h o.c.21 o.c.22.p 0.16.1u o.c.24 o.c.26.h o.c.22 o.o.26.p ' +
    '0.16.1u 1c.c.25.h o.c.21 o.o.25.p 0.16.1u 1c.c.24.h o.c.20 o.o.24.p 0.16.1u 1c.c.1z.h o.c.21 o.c.22.p 0.16.1u ' +
    'o.c.24 o.c.26.h o.c.22 o.c.26 o.c.2b o.c.29 o.c.26 o.c.22.p 0.16.1x o.c.26 o.2c.29.h 1c.16.1x_22.p 1c.c.1u.h ' +
    'o.c.1w o.c.1y.i 0.16.1u.p o.c.1z.i o.c.21 o.c.1y o.16.1u_1y.p 0.16.21.i 1c.c.22 o.c.1y o.16.1u_1y.p 0.16.22.i ' +
    '1c.c.21 o.c.1y.j o.16.1u_1y.p 0.16.21.j 1c.c.1u o.c.1w o.c.1y 0.16.1u.p o.c.1z.j o.c.21 o.c.1y.k o.16.1u_1y.p ' +
    '0.16.21.k 1c.c.22 o.c.1y o.16.1u_1y.p 0.16.22.k 1c.2c.21 1c.16.1u_1y.p 1c.c.26.k o.c.28.l o.c.26_2a o.c.2b ' +
    'o.c.2d o.c.2a o.o.26_2a_2d 1c.c.2e o.c.2a o.o.26_2a_2e 1c.c.2d.m o.c.2a o.o.26_2a_2d 1c.c.26 o.c.28 o.c.26_2a ' +
    'o.c.2b o.c.2d.n o.c.2a o.o.26_2a_2d 1c.c.2e o.c.2a o.o.26_2a_2e 1c.2c.2d 1c.16.26_2a.p 1c.c.1n.o o.c.1p ' +
    'o.c.1i_1q o.c.1s o.c.1u o.c.1q o.o.1i_1u 1c.c.1t o.c.1p o.o.1i_1t 1c.c.1s.p o.c.1o o.o.1i_1t 1c.c.1n o.c.1p ' +
    'o.c.1i_1q o.c.1s o.c.1u o.c.1q o.c.1n_1u o.c.1z o.c.1x o.c.1u o.c.1l_1s o.c.1u o.2c.1x 1c.16.1l_1s 1c.c.1z.q ' +
    'o.c.21 o.c.22 0.16.1u.p o.c.24.q o.c.26 o.c.22 o.16.1u.p 0.16.26.q 1c.c.25 o.c.21 o.o.25 0.16.1u.p 1c.c.24.q ' +
    'o.c.20.r o.16.1u.p 0.16.24.r 1c.c.1z o.c.21 o.c.22 o.c.24 o.c.26 o.c.22 o.c.26 0.16.1z_22.p o.c.2b.r o.c.26 ' +
    'o.c.22 o.c.26.s 0.16.1z_22.p o.c.2b.s o.2c.1z 2o.2c.2b o.c.2d o.c.2e o.c.2g o.l.2i 0.2c.2b.p o.c.2e.s o.o.2i ' +
    '1c.c.2h 0.2c.2b.p o.c.2d.s o.o.2h 1c.c.2g 0.2c.2b.p o.c.2c.s o.o.2g 1c.2c.2b o.c.2d o.c.2e o.c.2g o.c.2i ' +
    '0.2c.2b.p o.c.2e.s o.c.2i o.c.2n o.c.2l 0.1c.2e.p 0.2c.29 o.c.2i.s o.10.2e o.c.2i o.2c.29_2e.p 0.2c.2l.s ' +
    '2o.2c.2b o.c.2d o.c.2e o.c.2g o.l.2i 0.2c.2b.p o.c.2e.s o.o.2i 1c.l.2h 0.2c.2b.p o.c.2d.s o.o.2h 1c.l.2g ' +
    '0.2c.2b.p o.c.2c.s o.o.2g 1c.2c.2b o.c.2d o.c.2e o.c.2g o.c.2i 0.2c.2b.p o.c.2e.s o.c.2i o.c.2n o.c.2l ' +
    '0.1c.2e.p 0.2c.29 o.c.2i.s o.10.2e o.c.2i o.2c.29_2e.p 0.2c.2l.s 2o.2c.2i o.c.2k o.c.2m o.c.2n o.l.2p ' +
    '0.16.2d_2i.p o.c.2m.s o.16.2d_2i.p 0.16.2p.s 1c.l.2e_2i_2q.h o.c.2m o.16.2e_2i_2q 1c.l.2d_2i_2p o.c.2m ' +
    'o.16.2d_2i_2p 1c.c.2i o.c.2i_2j o.c.2i_2m o.c.2i_2n o.l.2d_2i_2p o.c.2d_2i_2m o.16.2d_2i_2p 1c.l.2e_2i_2q ' +
    'o.c.2e_2i_2m o.16.2e_2i_2q 1c.2c.2d_2i_2p 2o.2c.2i.p o.c.2k.s o.c.2m o.c.2n o.l.2p 0.16.2d_2i.p o.c.2m.s ' +
    'o.16.2d_2i.p 0.16.2p.s 1c.l.2f_2i_2r.h o.c.2m o.16.2f_2i_2r 1c.l.2d_2i_2p o.c.2m o.16.2d_2i_2p 1c.c.2i ' +
    'o.c.2i_2j o.c.2i_2m o.c.2i_2n o.l.2d_2i_2p o.c.2d_2i_2m o.16.2d_2i_2p 1c.l.2e_2i_2q o.c.2e_2i_2m o.16.2e_2i_2q ' +
    '1c.2c.2d_2i_2p 2o.2c.2b.s o.c.2d o.c.2e o.c.2g o.l.2i 0.2c.2b.p o.c.2e.s o.16.2i 1c.l.2h 0.2c.2b.p o.c.2d.s ' +
    'o.o.2h 1c.l.2g 0.2c.2b.p o.c.2c.s o.o.2g 1c.2c.2b o.c.2d o.c.2e o.c.2g o.c.2i 0.o.2b.p o.1o.2b.s o.c.2i o.c.2n ' +
    'o.c.2l 0.1c.2e.p 0.2c.29 o.c.2i.s o.10.2e o.c.2i o.2c.29_2e.p 0.2c.2l.s 2o.c.2b.h o.c.2b_2d o.c.2b_2e ' +
    'o.c.2b_2g o.l.2b_2i o.c.2b_2e o.o.2b_2e_2i 1c.l.2b_2h o.c.2b_2d o.o.2b_2d_2h 1c.l.2b_2g o.c.2b_2c o.o.2b_2c_2g ' +
    '1c.c.2b o.c.2b_2d o.c.2b_2e o.c.2b_2g o.c.2b_2i o.c.2b_2e o.c.2b_2i o.c.2b_2n o.c.2b_2i o.c.2b_2e o.c.2b_2i ' +
    'o.c.2b_2n o.24.2b 3s.3.2k 2.3.2l 3.3.2m 3.g.2e_2n 54.3.2k 2.3.2l 3.3.2m 3.o.2e_2n 40.c.1z o.c.21 o.c.22 o.c.24 ' +
    'o.c.26 o.c.22 o.c.26 o.c.2b o.c.2a o.c.26 o.c.2a o.c.2d o.24.2b 3s.3.2k 2.3.2l 3.3.2m 3.g.2e_2n 54.3.2k 2.3.2l ' +
    '3.3.2m 3.o.2e_2n 40.c.2b o.c.2d o.c.2e o.c.2g o.c.2i o.c.2e o.c.2i o.c.2n o.c.2m o.c.2i o.c.2m o.c.2p o.24.2n ' +
    '3s.3.2k 2.3.2l 3.3.2m 3.g.2e_2n 54.3.2k 2.3.2l 3.3.2m 3.g.2e_2n 54.3.2k 2.3.2l 3.3.2m 3.y.2e_2n 14.3.2k 2.3.2l ' +
    '3.3.2m 3.y.2e_2n 14.3.2k 2.3.2l 3.3.2m 3.y.2e_2n 14.3.2k 2.3.2l 3.3.2m 3.y.2e_2n 16.3.2k.i 3.3.2l 2.3.2m ' +
    '4.y.2e_2n 16.3.2k.j 2.3.2l 3.3.2m 3.y.2e_2n 16.3.2k.k 3.3.2l 2.3.2m 4.y.2e_2n d3.3.2k.s 3.3.2l 2.3.2m ' +
    '4.16.2e_2n',
  kingLeft:
    '5c.o.n.h 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.q 1c.o.x 1c.o.q ' +
    '1c.o.x 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.q 1c.o.x ' +
    '1c.o.q 1c.o.x 1c.16.u 1c.16.11 1c.16.u 1c.16.11 1c.16.q 1c.16.y 1c.16.u 1c.16.11 1c.16.u 1c.16.11 1c.16.u ' +
    '1c.16.11 1c.16.q 1c.16.y 1c.16.u 1c.16.11 1c.16.u 1c.16.11 1c.16.u 1c.16.11 1c.16.q 1c.16.y 1c.16.u 1c.16.11 ' +
    '1c.16.u 1c.16.11 1c.16.u 1c.16.11 1c.16.q 1c.16.y 1c.16.u 1c.16.11 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u ' +
    '1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.q 1c.o.x 1c.o.q 1c.o.x 1c.o.n 1c.o.u 1c.o.n 1c.o.u 1c.o.n ' +
    '1c.o.u 1c.o.n 1c.o.u 1c.o.n 1c.o.z 1c.o.x 1c.o.v 1c.o.u 1c.o.s 1c.o.p 1c.o.n 1c.16.n 1c.c.16_1e c.c.15 c.l.16 ' +
    'o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.z 1c.c.16_1d c.c.15 c.l.16 o.o.z 1c.c.16_1c c.c.15 c.l.16 o.o.z 1c.c.16_1e ' +
    'c.c.15 c.l.16 o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.12 1c.c.19_1i c.c.18 c.l.19 o.o.12 1c.c.19_1i c.c.18 c.l.19 ' +
    'o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.z 1c.c.16_1d c.c.15 c.l.16 o.o.z 1c.c.16_1e ' +
    'c.c.15 c.l.16 o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.z 1c.c.16_1e c.c.15 c.l.16 o.o.12 1c.c.19_1i c.c.18 c.l.19 ' +
    'o.o.12 1c.c.19_1i c.c.18 c.l.19 o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.12 ' +
    '1c.c.1e_1m c.c.1d c.l.1e o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.16 1c.c.1d_1m ' +
    'c.c.1c c.l.1d o.o.12 1c.c.1e_1m c.c.1d c.l.1e o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.16 1c.c.1d_1m c.c.1c c.l.1d ' +
    'o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.12 1c.c.1e_1m c.c.1d c.l.1e o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.16 ' +
    '1c.c.1d_1m c.c.1c c.l.1d o.o.16 1c.c.1d_1m c.c.1c c.l.1d o.o.12 1c.c.1e_1m c.c.1d c.l.1e o.o.16 1c.c.1d_1m ' +
    'c.c.1c c.l.1d o.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 ' +
    'g.e.16 g.e.1d g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.e.1c g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 ' +
    'g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.12 g.e.18 g.e.19 g.e.1i g.e.18 g.e.19 g.e.12 g.e.18 g.e.19 g.e.1i ' +
    'g.e.18 g.e.19 g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 ' +
    'g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.e.1e g.e.15 g.e.16 g.e.z g.e.15 g.e.16 g.o.1b_1n ' +
    '1c.o.19_1b_1l 1c.o.17_1b_1j 1c.16.16_1b_1i 1c.16.14_1b_1g 1c.16.12_1b_1e 1c.16.11_1b_1d 1c.l.z_1b o.c.19 ' +
    'o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 ' +
    'o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.12_1e o.c.1d o.c.1b o.c.19 o.l.12_1e o.c.1d ' +
    'o.c.1b o.c.19 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 ' +
    'o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 ' +
    'o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.16_1i o.c.1g o.c.1e o.c.1d o.l.16_1i o.c.1g o.c.1e o.c.1d ' +
    'o.l.12_1e o.c.1d o.c.1e o.c.1g o.l.16_1i o.c.1g o.c.1e o.c.1d o.l.16_1i o.c.1g o.c.1e o.c.1d o.l.16_1i o.c.1g ' +
    'o.c.1e o.c.1d o.l.12_1e o.c.1d o.c.1e o.c.1g o.l.16_1i o.c.1g o.c.1e o.c.1d o.l.16_1i o.c.1h o.c.1f o.c.1d ' +
    'o.l.16_1i o.c.1h o.c.1f o.c.1d o.l.13_1f o.c.1d o.c.1f o.c.1h o.l.16_1i o.c.1h o.c.1f o.c.1d o.l.16_1i o.c.1h ' +
    'o.c.1f o.c.1d o.l.16_1i o.c.1h o.c.1f o.c.1d o.l.13_1f o.c.1d o.c.1f o.c.1h o.l.16_1i o.c.1h o.c.1f o.c.1d ' +
    'o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 ' +
    'o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.12_1e o.c.1d o.c.19 o.c.17 ' +
    'o.l.12_1e o.c.1d o.c.19 o.c.17 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 ' +
    'o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 ' +
    'o.l.z_1b o.c.19 o.c.17 o.c.16 o.l.z_1b o.c.19 o.c.17 o.c.16 o.16.z_1b 1c.o.1e_1h_1k_1n 40.16.z_1b ' +
    '1c.o.1e_1h_1k_1n 40.16.17_1j 1c.16.1e_1j_1n 1c.16.16_1i 1c.16.1e_1i_1n 1c.16.u_16 1c.16.1d_1i_1m 1c.16.z_1b ' +
    '1c.16.1e_1i_1n 1c.16.z_1b 1c.o.1e_1h_1k_1n 40.16.z_1b 1c.o.1e_1h_1k_1n 40.16.17_1j 1c.16.1e_1j_1n 1c.16.16_1i ' +
    '1c.16.1e_1i_1n 1c.16.u_16 1c.16.1d_1i_1m 1c.16.z_1b 1c.16.1e_1i_1n 1c.16.z_1b 1c.o.1e_1h_1k_1n 40.16.z_1b ' +
    '1c.o.1e_1h_1k_1n 40.16.z_1b 1c.o.1e_1h_1k_1n 1c.o.1e_1h_1k_1n 1c.o.1e_1h_1k_1n 1c.o.1e_1h_1k_1n ' +
    '1c.o.1e_1h_1k_1n 1c.o.1e_1h_1k_1n 1c.o.1e_1h_1k_1n 40.b.z c.b.1b c.b.z c.b.1b c.b.z c.b.1b c.b.z c.b.1b c.b.z ' +
    'c.b.1b c.b.z c.b.1b c.b.z c.b.1b c.b.z c.b.1b.k c.b.z.m c.b.1b.p c.b.z c.b.1b c.b.z c.b.1b c.b.z c.b.1b ' +
    'c.16.n_z.s 1c.o.1b_1e_1i_1n',
  clairUpper:
    '1c.2o.25_28 2o.2o.21_25 2o.o.20_23 o.o.21_25 o.4o.20_23 4o.o.1y_21 o.o.20_23 o.10.21 0.4o.1y 10.20.25 20.1o.21 ' +
    '1o.o.1w_20 o.o.1y_21 o.40.1w 0.4o.20 40.40.1u o.o.1y o.o.20 o.o.1y o.o.23 o.o.1y o.o.1w 0.20.1u o.o.1y o.1c.1w ' +
    'o.40.1r o.o.1u o.o.1w o.20.1u 20.20.1r 0.2o.1t 20.60.1p o.o.1t o.o.1u o.o.1t o.o.1y o.o.1t o.o.1r o.o.1t ' +
    'o.1c.1r o.40.1m o.o.1p o.o.1r o.20.1p 20.20.1k_1o 2o.1c.1h_1k 1c.20.25_28 20.2o.21_25 2o.o.23 0.5c.1u_1y ' +
    'o.o.25 o.4o.23 4o.o.1p_21 0.1c.1w o.o.1r_23 o.20.1w_21_28 20.20.1t_21 0.2o.25 2o.o.23 0.5c.1u_1y o.o.25 ' +
    'o.20.23 20.2o.21 2o.o.1p_21 0.1c.1w o.o.1r_23 o.10.1y_2a 0.40.25 10.20.1w_28 20.10.1t 10.o.25 o.o.23 ' +
    '0.5c.1t_1y o.o.25 o.10.23 10.20.21 40.1o.25_2a_2h 1o.o.23_2a_2f o.o.23_2a_2f o.o.23_2a_2f o.o.21_2a_2d ' +
    'o.o.21_2a_2d o.o.21_2a_2d o.o.20_26_2a_2c o.o.20_26_2a_2c o.10.20_26_2a_2c 10.10.21_2a_2d 10.20.1y_26_2a ' +
    '30.1o.25_2a_2h 1o.o.26_2a_2i o.o.25_2a_2h o.o.23_2a_2f o.o.25_2a_2h o.o.23_2a_2f o.o.21_2a_2d o.o.23_2a_2f ' +
    'o.o.21_2a_2d o.s.2a_2c s.8.2f 8.10.21_2a_2d 10.30.1y_26_2a 30.10.1u_26 10.10.1w_23_28 10.10.20_2c ' +
    '10.10.1y_26_2a 10.10.1u_26 1o.o.1u_20_23_26 o.o.1u_20_23_26 o.o.1u_20_23_26 o.o.1u_20_23_26 o.o.1w_20_23_28 ' +
    'o.20.1u_20_23_26 30.10.1u_26 0.20.21 10.10.1w_28 10.10.21_2d 10.10.1y_2a 0.20.26 10.10.1u 1o.o.1u_1y_23_26 ' +
    'o.o.1u_1y_23_26 o.o.1u_1y_23_26 o.o.1u_1y_23_26 o.o.1w_20_25_28 o.20.1u_1y_23_26 30.10.1u_26 0.30.1y_21 ' +
    '10.10.1w_28 10.10.23_2f 10.10.21_2d 0.20.26_2a 10.10.1y 1o.o.1y_26_2a o.o.1y_26_2a o.o.1y_26_2a o.o.1y_26_2a ' +
    'o.o.20_28_2c o.o.1y_26_2a o.o.21_2a_2d o.o.23_2a_2f o.40.28_2d_2k 40.20.28_2d_2k 20.40.28_2d_2k 40.20.1w_23_28 ' +
    '20.40.1t_1w 1c.c.1k c.c.1p 1c.c.1k c.c.1o o.1c.1w_1z 10.c.1n c.c.1s 0.o.21 c.c.1w c.40.1t_1w 1c.c.1k c.c.1p ' +
    '1c.c.1k c.c.1o o.1c.1w_1z 10.c.1n c.o.1w c.c.1s c.1c.1t_21 1c.o.1w_23 o.20.21_25 20.1c.1t_21 1c.o.21_25 ' +
    'o.o.23_27 o.o.21_25 o.o.1y_21 o.20.1y_21 o.o.1t o.o.1p o.10.1p 10.10.1m 10.40.1y 1c.c.1o c.c.1u 1o.c.1p c.c.1u ' +
    'c.1c.20 1c.c.1w 0.o.25 c.c.1t c.40.1y 1c.c.1o c.c.1u 1o.c.1p c.c.1u c.1c.20 1c.c.1w 0.o.25 c.c.1t c.30.26 ' +
    '2c.c.1u c.c.1y c.10.25 c.c.1u c.c.1y c.10.22 c.c.1u c.c.1y c.10.23 c.c.1u c.c.1y c.40.2a 10.c.1y c.c.26 ' +
    '1o.c.1y c.c.26 o.20.28 10.c.20 c.c.24 o.40.25_28 1c.c.1w c.c.21 1o.c.20 o.1c.28_2b 10.c.1z c.c.24 0.o.2d ' +
    'c.c.28 c.40.25_28 1c.c.1w c.c.21 1o.c.20 o.1c.28_2b 10.c.1z c.o.28 c.c.24 c.1c.2d 10.c.21 c.o.28 c.c.24 ' +
    'c.1c.2g 10.c.24 c.o.2d c.c.28 c.1c.2k 10.c.28 c.o.2g c.c.2b c.20.2k 10.c.28 c.c.2d c.c.29 c.40.2i 10.c.26 ' +
    'c.c.2d c.c.29 1c.c.26 c.c.2d c.c.29 c.40.2i 10.c.26 c.c.2d c.c.29 1c.c.26 c.c.2d c.c.29 c.1c.2l 1c.c.2d 0.o.2p ' +
    'c.c.21 c.40.26 10.c.1u c.c.21 c.c.1x 1c.c.1u c.c.21 c.c.1x c.1c.29 1c.c.24 0.o.2d c.c.29 c.o.2d_2g o.o.2b_2f ' +
    'o.o.29_2d o.10.28_2b 10.1o.26_29 1o.o.24_28 o.o.23_26 o.o.21_24 o.o.1z_23 o.o.1x_21 o.o.1w_1z o.o.1u_1x ' +
    'o.1c.1s_1w o.20.1l o.o.1r_1u o.o.1p_1s o.1c.1i 0.40.1p_1r 1c.o.1k o.1c.1m 20.1c.1r_1u 0.20.1o 1c.o.1r_1u_1y ' +
    'o.1c.1i 0.40.1p_1r 1c.o.1k o.1c.1m 20.1c.1r_1u 0.20.1o 1c.o.1r 0.1c.1u_1y o.o.1p o.o.1w_20_25 o.o.1u_1y_23 ' +
    'o.o.1p 0.20.1u_1y o.o.1m o.o.1p o.o.1m 0.20.1u_1w o.o.1o o.o.1r o.o.1p_1u_1y o.o.1w_20_25 o.o.1u_1y_23 o.o.1p ' +
    '0.20.1u_1y o.o.1m o.o.1p o.o.1m 0.20.1u_1w o.o.1o o.o.1r o.40.23 c.c.1r c.c.1u c.c.1y c.c.1u c.c.1r o.c.1r ' +
    'c.c.1u c.c.1y c.c.1u c.c.1r c.1c.26 1c.c.20 0.o.2a c.c.23 c.40.23 c.c.1r c.c.1u c.c.1y c.c.1u c.c.1r o.c.1r ' +
    'c.c.1u c.c.1y c.c.1u c.c.1r c.1c.26 1c.c.20 0.o.2a c.c.23 c.80.2f 10.c.23 c.c.26 c.c.2a 1c.c.23 c.c.26 c.c.2c ' +
    '1c.c.23 c.c.26 c.c.2a 1c.c.23 c.c.26 c.c.29 c.20.2d 10.c.23 c.c.26 c.c.2b c.20.2f 10.c.23 c.c.26 c.c.29 ' +
    '2c.20.2h_2k 20.2o.2h 2o.o.2c_2f o.o.2d_2h o.4o.2c_2f 4o.o.2a_2d o.o.2c_2f o.10.2d 0.4o.2a 10.20.2d_2h 20.1o.2d ' +
    '1o.o.28_2c o.o.2a_2d o.40.28_2c 4o.o.26_2a o.o.28_2c o.o.2a 0.20.26 o.o.2f o.o.2a o.o.28 0.2o.25 o.o.2a ' +
    'o.1c.28 1c.o.23_26 o.o.25_28 o.20.23_26 20.20.1x 0.2o.25 2o.o.21_25 o.o.23_26 o.o.25 0.20.21 o.o.2a o.o.25 ' +
    'o.o.23 0.20.21 o.o.25 o.1c.23 1c.o.1y_21 o.o.20_23 o.20.1y_21 20.20.1w_20 2o.1c.1h_1k 1c.20.25_28 20.2o.21_25 ' +
    '2o.o.23 0.5c.1u_1y o.o.25 o.4o.23 4o.o.1p_21 0.1c.1w o.o.1r_23 o.20.1w_25_28 20.20.1t_21 0.2o.25 2o.o.23 ' +
    '0.5c.1t_1y o.o.25 o.20.23 20.20.21 2o.o.1p 0.1c.1k o.o.1r o.20.1p_1t_1y 20.20.1k_1p_1t 2o.o.1u 0.1c.1m_1p ' +
    'o.o.1w o.20.1u_1y_21 20.20.1p_1u_1y 2o.o.1y 0.1c.1o_1u o.o.20 o.20.1w_20_25 20.20.1o_1u_1w 3c.c.1k c.c.1p ' +
    '1c.c.1k c.c.1o c.c.1t 1o.c.1k c.c.1p 1c.c.1k c.c.1o c.c.1t c.20.1w_1z 20.20.1s_21 3c.c.1w c.c.21 1c.c.1w ' +
    'c.c.20 c.c.25 1o.c.1w c.c.21 1c.c.1w c.c.20 c.c.25 c.20.2b 0.40.28 20.20.2d 20.20.2b 0.40.28 20.20.2d 20.20.2g ' +
    '20.60.2h_2k 60.40.28_2d_2h_2k',
  clairLower:
    'o.5c.1t_1w 5c.60.1u_1x 60.60.1t_1w 60.60.1r_1u 60.40.1p_1r 40.20.1o_1r 20.40.1m_1p 40.20.1l_1o 20.40.1k ' +
    '0.60.1m 40.20.1i 20.40.1h_1k 40.10.1f 0.20.1i 10.1o.18 10.o.11 1c.4o.1t_1w 4o.40.16 0.60.1d o.5c.1i_1m_1p ' +
    '5c.40.15_1d o.1c.1h_1k 1c.20.1p_1t 20.20.1k_1p 20.40.16 0.60.1d o.5c.1i_1m_1p 5c.60.18 o.1c.1h_1n ' +
    '1c.2o.1n_1p_1t 40.40.1a o.2c.1r 0.5c.1h_1m 2c.30.1p 30.40.r_13 10.1o.1t_1u_1y 1o.o.1r_1u_1y o.o.1r_1u_1y ' +
    'o.o.1r_1u_1y o.o.1p_1u_1y o.o.1p_1u_1y o.o.1p_1u_1y o.o.1o_1u_1y o.o.1o_1u_1y o.10.1o_1u_1y 10.10.1p_1u_1y ' +
    '10.20.1m_1p_1u 20.40.r_13_1a 10.1o.1t_1u_1y 1o.o.1u_1y_23 o.o.1t_1u_1y o.o.1r_1u_1y o.o.1t_1u_1y o.o.1r_1u_1y ' +
    'o.o.1p_1u_1y o.o.1r_1u_1y o.o.1p_1u_1y o.10.1o_1u_1y 10.10.1p_1u_1y 10.20.1m_1r_1u 20.40.w_18 10.10.1i ' +
    '10.10.1k 0.20.1o_1r 20.10.1m 0.20.1r_1u 10.10.1i 10.40.x_19 o.o.1i_1o_1r o.o.1i_1o_1r o.o.1i_1o_1r ' +
    'o.o.1i_1o_1r o.o.1k_1o_1r o.20.1i_1o_1r 20.40.y_1a 10.10.1i 0.20.1m_1p 10.10.1k 10.10.1p 10.10.1m 0.20.1p_1u ' +
    '10.10.1i 10.40.w_18 o.o.1i_1m_1r o.o.1i_1m_1r o.o.1i_1m_1r o.o.1i_1m_1r o.o.1k_1o_1t o.20.1i_1m_1r 20.40.11_1d ' +
    '10.10.1i 0.30.1m_1p 10.10.1k 10.10.1r 10.10.1p 0.20.1u_1y 10.10.1m 10.40.13_1f o.o.1m_1p_1u o.o.1m_1p_1u ' +
    'o.o.1m_1p_1u o.o.1m_1p_1u o.o.1o_1r_1w o.o.1m_1p_1u o.o.1p_1u_1y o.o.1r_1u_1y o.40.1t_1w_21_25 ' +
    '40.20.1s_1w_1y_21_24 20.40.1r_1u_1w_21_23 40.20.1k_1r_1u_20 20.20.11 c.c.18 c.c.1d c.c.1h 10.20.15 c.c.1c ' +
    'c.c.1h 1c.20.18 c.c.1g c.c.1k 1c.20.11 c.c.18 c.c.1d c.c.1h 10.20.15 c.c.1c c.c.1h 1c.20.18 c.c.1g c.c.1k ' +
    '1c.c.11 c.c.18 c.c.1d c.c.1h c.c.1k c.c.1p c.c.1t c.c.1w c.c.1t c.c.1p c.c.1k c.c.1h c.c.1k c.c.1h c.c.1d ' +
    'c.c.18 c.c.1d c.c.18 c.c.13 c.c.1a c.c.1f c.c.1j c.c.1m c.c.1r c.o.1v c.c.1r c.c.1m c.c.1j c.c.1f c.c.1a ' +
    'c.c.13 c.c.1a c.c.1f c.c.1j c.c.1f c.c.1a c.20.18 c.c.1f c.c.1i c.c.1m 10.20.16 c.c.1d c.c.1i c.c.1m 10.20.15 ' +
    'c.c.1c c.c.1h c.c.1k c.o.1o o.20.18 c.c.1f c.c.1i c.c.1m 10.20.16 c.c.1d c.c.1i c.c.1m 10.20.15 c.c.1c c.c.1h ' +
    'c.c.1k c.o.1o o.20.13 c.c.1a c.c.1f c.c.1i c.c.1m c.c.1r c.10.1u 10.10.1t 10.10.1q 10.10.1r 10.20.1q c.c.1u ' +
    'c.c.1y 1c.20.1r c.c.1u c.c.1y 1c.c.1o 0.20.1k c.c.1s c.c.1w 1c.20.1d c.c.1k c.c.1p c.c.1t 10.c.1k 0.20.1h ' +
    'c.c.1o c.c.1t c.c.1w 10.c.1n 0.20.1k c.c.1s c.c.1w 1c.20.1d c.c.1k c.c.1p c.c.1t 10.c.1k 0.20.1h c.c.1o c.c.1t ' +
    'c.c.1w 10.c.1n 0.20.1k c.c.1s c.c.1w 1c.c.1p 0.20.1n c.c.1s c.c.1w c.10.1z 10.c.1s 0.20.1p c.c.1w c.c.1z ' +
    'c.10.21 10.c.1w 0.20.1s c.c.1z c.c.21 c.10.24 10.20.1w c.c.1x c.c.21 1c.20.1u c.c.1x c.c.21 1c.c.1u 0.20.1t ' +
    'c.c.1x c.c.21 1c.c.1u 0.20.1s c.c.1x c.c.21 1c.c.1u 0.20.1r c.c.1x c.c.21 1c.c.1s 0.20.1p c.c.1x c.c.21 c.c.24 ' +
    '10.20.1n c.c.1r c.c.1u 1c.20.1l c.c.1p c.c.1s 1c.20.1k c.c.1p c.c.1s c.c.1x 10.60.1i c.c.1p c.c.1s c.c.1u ' +
    'c.c.1x c.c.21 c.c.24 c.c.26 c.c.24 c.c.21 c.c.1x c.c.1u c.c.1s c.c.1u c.c.1s c.c.1p c.c.1l o.c.16 c.c.1d ' +
    'c.c.1g c.c.1i c.c.1l c.c.1p c.c.1s c.c.1p c.c.1l c.c.1i c.c.1g c.c.1d c.c.16 c.c.1d c.c.16 c.c.1d c.c.16 ' +
    'c.c.1d c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f ' +
    'c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 ' +
    'c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.1f c.c.18 c.c.13 c.c.18 c.c.1f c.c.18 c.c.1f c.c.1k c.c.1f ' +
    'c.c.1k c.c.1r c.c.1k c.c.1f c.c.1k c.c.1f c.c.18 c.c.1f c.c.18 c.c.13 c.c.18 c.c.13 c.c.18 c.c.1f c.c.18 ' +
    'c.c.1f c.c.1k c.c.1f c.c.1k c.c.1r c.c.1k c.c.1f c.c.1k c.c.1f c.c.1k c.c.1f c.c.1k c.c.1f c.1c.1i 0.40.1p ' +
    '1c.o.1k o.1c.1m 20.20.1o c.c.1r c.c.1u c.c.1y 10.1c.1i 0.40.1p 1c.o.1k o.1c.1m 20.20.1o c.c.1r c.c.1u c.c.1y ' +
    '10.60.1u c.c.1y c.c.21 1o.c.1y c.c.21 1o.c.1y c.c.21 1c.60.1u c.c.1x c.c.21 1o.c.1x c.c.21 1o.c.1x c.c.21 ' +
    '1c.40.1t c.c.1w c.c.20 c.c.25 c.c.28 c.c.2c 2c.20.1t 20.40.1t c.c.1x c.c.20 c.c.23 c.c.25 c.c.29 2c.20.1t ' +
    '20.40.1t c.c.1w c.c.1y c.c.21 c.c.25 c.c.28 2c.20.1t 20.40.1r c.c.1u c.c.1w c.c.20 c.c.23 c.c.26 2c.20.1r ' +
    '20.40.1p c.c.1r c.c.1u c.c.1y c.c.21 c.c.23 2c.20.1o_1r_1t_1w_20 20.40.1c c.c.1i c.c.1m c.c.1o c.c.1r c.c.1u ' +
    'c.20.1y 20.20.1h_1o_1r 20.40.1k c.c.1m c.c.1p c.c.1t c.c.1w c.c.1y 2c.20.1i_1m_1p_1r 20.40.1h c.c.1k c.c.1m ' +
    'c.c.1p c.c.1t c.c.1w 2c.10.1f 0.20.1i_1o 10.10.18 10.o.11_18 1c.4o.1t_1w o.40.1n 40.40.16 0.60.1d ' +
    'o.5c.1i_1m_1p 5c.40.18 o.1c.1h_1k 1c.20.1p_1t 0.40.1n 20.20.1p 20.40.1a o.3c.1r 0.5c.1h_1m 3c.20.1p 20.60.15 ' +
    '60.20.13 20.20.1f 20.20.1r 20.40.18 10.10.1f 10.20.28 20.20.1k 20.20.11 c.c.18 c.c.1d c.c.1h 10.20.15 c.c.1c ' +
    'c.c.1h 1c.20.11 c.c.18 c.c.1d c.c.1h 10.20.15 c.c.1c c.c.1h 1c.40.18 c.c.1g c.c.1k c.c.1n c.c.1s c.c.1u ' +
    'c.20.1w 20.20.1d c.c.1k c.c.1p c.c.1t 10.20.1h c.c.1o c.c.1t 1c.20.1d c.c.1k c.c.1p c.c.1t 10.20.1h c.c.1o ' +
    'c.c.1t 1c.40.1k c.c.1n c.c.1s c.c.1w c.c.1z c.2c.24 2c.40.1k c.c.1n c.c.1s c.c.1w c.c.1z c.2c.24 2c.20.18 ' +
    '20.40.11 c.c.18 c.c.1d c.c.1h c.c.1k c.c.1p c.o.1t o.o.1w o.o.21 o.o.25 o.o.28 o.o.2d o.40.1p_1w_21_25',
};

/** A packed part of one of the scores, unpacked. */
export const scorePart = (part: keyof typeof PACKED): ScoreNote[] => unpackScore(PACKED[part]);
