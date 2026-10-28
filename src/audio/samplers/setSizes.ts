/**
 * How big a recorded instrument's recordings are, before they're downloaded: their files (from
 * hostedSets.ts) and about how much memory they take decoded. For the choices samplerManager.ts
 * makes before it decodes anything: which sets are too big to fill in the background or decode at
 * twice the rate live, and how much of a song an export can afford at twice the rate. Pure, so
 * Node can test it.
 */
import { HOSTED_SETS } from '../hostedSets';
import type { SampleSource } from '../instrumentCatalog';

/** A hosted file's set (the folder under fledgetone-samples/), from its address. */
const folderOf = (url: string) => /^fledgetone-samples\/([^/]+)\//.exec(url)?.[1];

/** How many files a hosted set has of its own (a recording shared from another has none). */
function fileCount(folder: string): number {
  const set = HOSTED_SETS[folder];
  if (!set) return 0;
  return Math.max(1, set.notes.length * set.layers * set.takes - Object.keys(set.shared ?? {}).length);
}

/** About how many bytes a recording's file has where the set isn't hosted (a soundfont's note: a few seconds of MP3). */
const OTHER_FILE_BYTES = 60e3;

/**
 * About how many bytes of memory a byte of a recording's MP3 takes decoded, at 48 kHz, for one
 * that isn't hosted (a soundfont's note). A hosted set says how much sound its files hold
 * (HostedSet.audio), so its recordings are reckoned from that instead: by their files' bytes the
 * sets differ too much (from 15 for the grand piano's to 44 for the hand chimes', since their
 * files were encoded at higher quality) for one figure to be right for all.
 */
export const DECODED_PER_FILE_BYTE = 48;

/** About how many bytes one of `source`'s recordings' files has (a note "<note>|<layer>|<take>", or a release sound "rel|<note>|<take>"). */
export function fileBytesOf(source: Pick<SampleSource, 'baseUrl' | 'samples' | 'releases'>, name: string): number {
  const release = name.startsWith('rel|');
  const url = release ? `${source.releases?.baseUrl ?? ''}${source.releases?.samples[name.slice(4)] ?? ''}` : `${source.baseUrl}${source.samples[name] ?? ''}`;
  const folder = folderOf(url);
  const set = folder ? HOSTED_SETS[folder] : undefined;
  return set ? set.bytes / fileCount(folder!) : OTHER_FILE_BYTES;
}

/**
 * About how many bytes of memory one of `source`'s recordings takes decoded at 48 kHz: its set's
 * sound (seconds, each channel counted, as 32-bit samples) shared between its files, never less
 * than the sampler keeps (it cuts silent tails, so this is on the safe side).
 */
export function decodedOf(source: Pick<SampleSource, 'baseUrl' | 'samples' | 'releases'>, name: string): number {
  const release = name.startsWith('rel|');
  const url = release ? `${source.releases?.baseUrl ?? ''}${source.releases?.samples[name.slice(4)] ?? ''}` : `${source.baseUrl}${source.samples[name] ?? ''}`;
  const folder = folderOf(url);
  const set = folder ? HOSTED_SETS[folder] : undefined;
  return set ? (set.audio * 48000 * 4) / fileCount(folder!) : OTHER_FILE_BYTES * DECODED_PER_FILE_BYTE;
}

/**
 * About how many bytes `source`'s files have in all (its notes, not its release sounds): the
 * hosted set's size, or the parts of the sets an ensemble plays (SampleSource.samples naming
 * files in several), counted file by file. Not hosted: 0 (the soundfonts and the like are small).
 */
export function setBytes(source: Pick<SampleSource, 'baseUrl' | 'samples' | 'releases'>): number {
  let bytes = 0;
  const files = new Set<string>();
  for (const [name, file] of Object.entries(source.samples)) {
    if (files.has(file)) continue;
    files.add(file);
    if (folderOf(`${source.baseUrl}${file}`)) bytes += fileBytesOf(source, name);
  }
  return bytes;
}

/** About how many bytes of memory `names` of `source`'s recordings take decoded at `decodeRate`. */
export function decodedBytes(source: Pick<SampleSource, 'baseUrl' | 'samples' | 'releases'>, names: Iterable<string>, decodeRate: number): number {
  let bytes = 0;
  for (const name of names) bytes += decodedOf(source, name);
  return bytes * (decodeRate / 48000);
}

/**
 * About how many bytes of memory `source`'s recordings (its notes, not its release sounds) take
 * decoded at 48 kHz, every one of them: a hosted set's, or the parts of the sets an ensemble plays,
 * each file once. Not hosted: 0 (the soundfonts and the like are small).
 */
export function setDecodedBytes(source: Pick<SampleSource, 'baseUrl' | 'samples' | 'releases'>): number {
  let bytes = 0;
  const files = new Set<string>();
  for (const [name, file] of Object.entries(source.samples)) {
    if (files.has(file)) continue;
    files.add(file);
    if (folderOf(`${source.baseUrl}${file}`)) bytes += decodedOf(source, name);
  }
  return bytes;
}
