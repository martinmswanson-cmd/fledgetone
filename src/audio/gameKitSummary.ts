/**
 * What a game kit holds, in a sentence, for the message shown once it has downloaded (the Game
 * panel's Export game kit): how many loops, stems, transition sounds, stingers and sound effects,
 * and what comes with them. Counted from the kit's manifest. Pure, so Node can test it.
 */
import type { AudioManifest } from './gameKit';
import type { KitLayout } from './gameKit';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The kit's parts, as counts: "2 seamless loops, 6 stems, 1 stinger". */
export function kitParts(manifest: Pick<AudioManifest, 'states' | 'transitions' | 'stingers' | 'sfx'>): string[] {
  const stems = manifest.states.reduce((n, s) => n + s.stems.length, 0);
  const costumes = manifest.states.reduce((n, s) => n + (s.costumes?.length ?? 0), 0);
  const transitions = new Set(manifest.transitions.map((t) => t.file).filter(Boolean)).size;
  const parts = [count(manifest.states.length, 'seamless loop')];
  if (stems) parts.push(count(stems, 'stem'));
  if (costumes) parts.push(count(costumes, 'costume version'));
  if (transitions) parts.push(count(transitions, 'transition sound'));
  if (manifest.stingers.length) parts.push(count(manifest.stingers.length, 'stinger'));
  if (manifest.sfx?.length) parts.push(count(manifest.sfx.length, 'sound effect'));
  return parts;
}

/** What comes with the sound in each kind of kit. */
const EXTRAS: Record<KitLayout, string> = {
  any: 'audio_manifest.json, players for the web, Godot and Unity, and a README',
  godot: 'audio_manifest.json, the Godot player, an example scene and a README',
  unity: 'audio_manifest.json, the Unity player, an example component and a README',
};

/** The sentence shown once the kit has downloaded. */
export function kitSummary(fileName: string, manifest: Parameters<typeof kitParts>[0], layout: KitLayout): string {
  return `Saved "${fileName}" to your downloads. Inside, as WAV files: ${kitParts(manifest).join(', ')}; with ${EXTRAS[layout]}.`;
}
