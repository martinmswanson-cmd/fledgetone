// Types for adaptive-music.js (the web player shipped in the game kit, also used by the Game preview's audition pads).
export class AdaptiveMusic {
  constructor(context?: BaseAudioContext, destination?: AudioNode);
  ctx: BaseAudioContext;
  current: { name: string; startTime: number } | null;
  /** The manifest */
  data: any;
  /** Where sound effects play into (their own volume) */
  sfxOut: GainNode;
  intensity: number;
  load(baseUrl?: string): Promise<void>;
  loadFrom(data: unknown, buffers: Map<string, AudioBuffer>): void;
  static filesOf(data: unknown): string[];
  nextLine(unit?: 'bar' | 'beat' | 'now'): number;
  play(name: string): void;
  setState(name: string, unit?: 'bar' | 'beat' | 'now'): void;
  setIntensity(value: number, seconds?: number): void;
  stinger(name: string, unit?: 'bar' | 'beat' | 'now'): void;
  readonly sfxNames: string[];
  playSfx(name: string, opts?: { volume?: number; pitch?: number; when?: number }): { stop(fade?: number): void };
  stopSfx(name?: string, fade?: number): void;
  setSfxVolume(volume: number, seconds?: number): void;
  setVolume(volume: number, seconds?: number): void;
  stop(): void;
}
