// Types for adaptive-music.js (the web player shipped in the game kit, also used by the Game preview's audition pads).
export class AdaptiveMusic {
  constructor(context?: BaseAudioContext, destination?: AudioNode);
  ctx: BaseAudioContext;
  current: { name: string; startTime: number } | null;
  intensity: number;
  load(baseUrl?: string): Promise<void>;
  loadFrom(data: unknown, buffers: Map<string, AudioBuffer>): void;
  static filesOf(data: unknown): string[];
  nextLine(unit?: 'bar' | 'beat' | 'now'): number;
  play(name: string): void;
  setState(name: string, unit?: 'bar' | 'beat' | 'now'): void;
  setIntensity(value: number, seconds?: number): void;
  stinger(name: string, unit?: 'bar' | 'beat' | 'now'): void;
  setVolume(volume: number, seconds?: number): void;
  stop(): void;
}
