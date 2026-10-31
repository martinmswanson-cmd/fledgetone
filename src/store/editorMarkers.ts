import { formatFrameTimecode, isDropFrame, labelCountToFrame, nominalFps, secondsToFrames } from '../audio/timecode';
import { maxOf } from '../support/minMax';

/**
 * Markers for video editing software: the song's markers as files Premiere Pro (FCP 7 XML),
 * DaVinci Resolve (an EDL of timeline markers), Final Cut Pro (FCPXML) and spreadsheets (CSV)
 * import, so the editor sees the section names and hit points on their own timeline. No browser
 * or store here, so Node can unit-test it.
 */

export interface EditorMarker {
  name: string;
  /** Seconds from the start of the editor's timeline */
  seconds: number;
}

export interface EditorMarkerOptions {
  title: string;
  fps: number;
  dropFrame: boolean;
  /** Where the editor's timeline starts: 0 or 1 hour (Resolve's default is 01:00:00:00) */
  startHour: 0 | 1;
}

export const EDITOR_FORMATS = [
  { id: 'premiere', label: 'Premiere Pro (.xml)', ext: 'xml' },
  { id: 'resolve', label: 'DaVinci Resolve (.edl)', ext: 'edl' },
  { id: 'fcpx', label: 'Final Cut Pro (.fcpxml)', ext: 'fcpxml' },
  { id: 'csv', label: 'Spreadsheet (.csv)', ext: 'csv' },
] as const;
export type EditorFormat = (typeof EDITOR_FORMATS)[number]['id'];

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The frame count of the timeline's first frame (01:00:00:00 is 107892 frames in 29.97 drop-frame). */
const startFrame = (o: EditorMarkerOptions) => labelCountToFrame(o.startHour * 3600 * nominalFps(o.fps), o.fps, o.dropFrame);

/** The timecode of a point `seconds` into the timeline. */
const timecodeAt = (seconds: number, o: EditorMarkerOptions) => formatFrameTimecode(startFrame(o) + secondsToFrames(seconds, o.fps), o.fps, o.dropFrame);

/** The EDL DaVinci Resolve reads as timeline markers (Timeline › Import › Timeline Markers from EDL). */
export function resolveEdl(markers: readonly EditorMarker[], o: EditorMarkerOptions): string {
  const lines = [`TITLE: ${o.title.replace(/[\r\n]+/g, ' ')}`, `FCM: ${isDropFrame(o.fps, o.dropFrame) ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  markers.forEach((m, i) => {
    const tc = timecodeAt(m.seconds, o);
    const next = timecodeAt(m.seconds + 1 / o.fps + 1e-6, o);
    lines.push(`${String(i + 1).padStart(3, '0')}  001      V     C        ${tc} ${next} ${tc} ${next}  `);
    lines.push(` |C:ResolveColorBlue |M:${m.name.replace(/\|/g, '/')} |D:1`);
    lines.push('');
  });
  return lines.join('\r\n');
}

/** An FCP 7 XML sequence carrying the markers, which Premiere Pro imports (File › Import). */
export function premiereXml(markers: readonly EditorMarker[], o: EditorMarkerOptions, lengthSeconds: number): string {
  const timebase = nominalFps(o.fps);
  const ntsc = timebase !== o.fps ? 'TRUE' : 'FALSE';
  const df = isDropFrame(o.fps, o.dropFrame);
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const body = markers
    .map((m) => `      <marker>\n        <comment></comment>\n        <name>${xml(m.name)}</name>\n        <in>${secondsToFrames(m.seconds, o.fps)}</in>\n        <out>-1</out>\n      </marker>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>${xml(o.title)}</name>
    <duration>${Math.max(1, secondsToFrames(lengthSeconds, o.fps))}</duration>
    ${rate}
    <timecode>
      ${rate}
      <string>${timecodeAt(0, o)}</string>
      <frame>${startFrame(o)}</frame>
      <displayformat>${df ? 'DF' : 'NDF'}</displayformat>
    </timecode>
    <media>
      <video><format><samplecharacteristics>${rate}<width>1920</width><height>1080</height></samplecharacteristics></format></video>
      <audio></audio>
    </media>
${body}
  </sequence>
</xmeml>
`;
}

/** Seconds as an FCPXML rational time on the frame grid ("1001/30000s" frames at 29.97). */
function fcpTime(seconds: number, fps: number): string {
  const frames = secondsToFrames(seconds, fps);
  const n = nominalFps(fps);
  return n !== fps ? `${frames * 1001}/${n * 1000}s` : `${frames}/${n}s`;
}

/** An FCPXML project whose timeline carries the markers, for Final Cut Pro (File › Import › XML). */
export function finalCutXml(markers: readonly EditorMarker[], o: EditorMarkerOptions, lengthSeconds: number): string {
  const n = nominalFps(o.fps);
  const frameDuration = n !== o.fps ? `1001/${n * 1000}s` : `1/${n}s`;
  const length = fcpTime(maxOf(lengthSeconds, markers.map((m) => m.seconds + 1)), o.fps);
  const start = o.startHour ? fcpTime(3600, o.fps) : '0s';
  const body = markers.map((m) => `              <marker start="${fcpTime(m.seconds, o.fps)}" duration="${frameDuration}" value="${xml(m.name)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p${n}" frameDuration="${frameDuration}" width="1920" height="1080"/>
  </resources>
  <library>
    <event name="${xml(o.title)}">
      <project name="${xml(o.title)}">
        <sequence format="r1" duration="${length}" tcStart="${start}" tcFormat="${isDropFrame(o.fps, o.dropFrame) ? 'DF' : 'NDF'}">
          <spine>
            <gap name="Markers" offset="${start}" duration="${length}" start="0s">
${body}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

/** Name, timecode and seconds, one marker a row. */
export function markersCsv(markers: readonly EditorMarker[], o: EditorMarkerOptions): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['Name,Timecode,Seconds', ...markers.map((m) => `${cell(m.name)},${timecodeAt(m.seconds, o)},${m.seconds.toFixed(3)}`)].join('\r\n') + '\r\n';
}

/** The file for `format`. */
export function editorMarkerFile(format: EditorFormat, markers: readonly EditorMarker[], o: EditorMarkerOptions, lengthSeconds: number): string {
  const sorted = [...markers].filter((m) => m.seconds >= 0).sort((a, b) => a.seconds - b.seconds);
  switch (format) {
    case 'premiere':
      return premiereXml(sorted, o, lengthSeconds);
    case 'resolve':
      return resolveEdl(sorted, o);
    case 'fcpx':
      return finalCutXml(sorted, o, lengthSeconds);
    default:
      return markersCsv(sorted, o);
  }
}
