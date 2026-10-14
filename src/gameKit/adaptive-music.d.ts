// Types for adaptive-music.js (the web player shipped in the game kit, also used by the Game preview's audition pads).
export class AdaptiveMusic {
  constructor(context?: BaseAudioContext, destination?: AudioNode);
  ctx: BaseAudioContext;
  current: { name: string; startTime: number; tempo: number } | null;
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
  /** The costume on now (null: as written) */
  costume: string | null;
  readonly costumeNames: string[];
  setCostume(name: string | null, seconds?: number): void;
  /** The effect on now */
  effect: 'none' | 'underwater' | 'muffled' | 'lowHealth' | 'dream';
  setEffect(name: 'none' | 'underwater' | 'muffled' | 'lowHealth' | 'dream', seconds?: number): void;
  setFilter(hz: number, seconds?: number): void;
  setReverb(amount: number, seconds?: number): void;
  /** The song's parameters' names (see setParameter) */
  readonly parameterNames: string[];
  /** Set a parameter of the song's (0 to 1): what it was set up to move follows, over `seconds` */
  setParameter(name: string, value: number, seconds?: number): void;
  getParameter(name: string): number | undefined;
  readonly sfxNames: string[];
  playSfx(name: string, opts?: { volume?: number; pitch?: number; when?: number }): { stop(fade?: number): void };
  stopSfx(name?: string, fade?: number): void;
  setSfxVolume(volume: number, seconds?: number): void;
  setVolume(volume: number, seconds?: number): void;
  stop(): void;
}
