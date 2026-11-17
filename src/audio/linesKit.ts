/**
 * The Lines picture for other people's pages: what the Tools page's "Instrument lines" download
 * is bundled from (scripts/tools-site.mjs). Only the lines' data and their drawing, which read
 * nothing of the studio's state; the studio itself imports those two files directly.
 */
export { linesData, runPitch, isSounding, rollKick, LINE_ALLOWANCE, LINE_BEND, LINE_ENTRY } from '../store/lines';
export type { LinesData, LineTrack, LineRun } from '../store/lines';
export { drawLines, DEFAULT_LINES_LOOK } from './linesDraw';
export type { LinesLook, LinesDrawOptions } from './linesDraw';
