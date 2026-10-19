/**
 * Try it in a game: a little 3D game (a robot hero, a guard and coins: see tryOutScene.ts) that plays the song
 * the way a real game would, through the game kit's own web player. Exploring plays the calm state,
 * The guard spotting the hero switches to the fight state by the song's transition rule and turns the
 * intensity up as it closes in, coins fire the item stinger and a coin sound, and beating the guard or
 * losing plays the win or lose stinger. A panel picks which state, stinger and sound each moment
 * plays (guessed from their names: tryOut.ts). Sounds the song doesn't have come from the sound
 * effects maker.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Gamepad2, Heart, Loader2, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { buildGameKitParts, type AudioManifest } from '../../audio/gameKit';
import { gameKitSong } from '../timeline/gameKitSong';
import { AdaptiveMusic } from '../../gameKit/adaptive-music.js';
import { initAudio, liveMix } from '../../audio/engine';
import { showToast } from '../timeline/toastStore';
import { generateSfx, renderSfxStereo, varySfx, type SfxCategory } from '../../audio/sfx/sfxSynth';
import { ensureSfxRecordings } from '../../audio/sfx/sfxRecordings';
import { guessTryOutMap, intensityFor, TRY_OUT_MOMENTS, type TryOutMap } from '../../store/tryOut';
import type { TryOutScene } from './tryOutScene';

/** Sounds the preview makes itself when the song has none for a moment */
const OWN_SOUNDS: Record<'coinSfx' | 'stepSfx' | 'hurtSfx' | 'jumpSfx' | 'bonkSfx', { kind: SfxCategory; seed: number; volume: number }> = {
  coinSfx: { kind: 'coinModern', seed: 11, volume: 0.8 },
  stepSfx: { kind: 'footstep', seed: 5, volume: 0.45 },
  hurtSfx: { kind: 'hurt', seed: 3, volume: 0.9 },
  jumpSfx: { kind: 'jumpSoft', seed: 8, volume: 0.6 },
  bonkSfx: { kind: 'bounce', seed: 4, volume: 0.9 },
};

type SfxMoment = keyof typeof OWN_SOUNDS;

/** The last song rendered for the preview, so opening it again on an unchanged song is instant. */
let cache: { key: string; manifest: AudioManifest; buffers: Map<string, AudioBuffer> } | null = null;

const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyJ', 'KeyR']);
/** Parameter names the try-out drives: danger with the guard, health with the hearts. */
const DANGER = /danger|threat|tension|enemy|alert/i;
const HEALTH = /health|^hp$|life/i;

export const GameTryOut: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TryOutScene | null>(null);
  const music = useRef<AdaptiveMusic | null>(null);
  const own = useRef<Map<SfxMoment, AudioBuffer[]>>(new Map());
  /** The music is loaded (a scene made after this wakes the guard straight away) */
  const musicReady = useRef(false);
  /** The live audio context (Tone's current context is an offline one while the music renders) */
  const liveCtx = useRef<AudioContext | null>(null);
  const [progress, setProgress] = useState('Rendering the music.');
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  const [map, setMap] = useState<TryOutMap | null>(null);
  const mapRef = useRef<TryOutMap | null>(null);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);
  const [hud, setHud] = useState({ hearts: 3, coins: 0, coinsTotal: 8, state: '', intensity: 0.3, chasing: false, beaten: false, over: false });
  const [log, setLog] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  const lastIntensity = useRef(0);

  const say = useCallback((line: string) => setLog((l) => [line, ...l].slice(0, 4)), []);

  // Render the music the way the game kit does, and the preview's own sounds
  useEffect(() => {
    let cancelled = false;
    const st = useTimelineStore.getState();
    // (A Play still waiting for sounds is called off too: it would start under the preview)
    if (st.isPlaying || st.loadingToPlay) st.pause();
    (async () => {
      try {
        await initAudio();
        const ctx = Tone.getContext().rawContext as AudioContext;
        liveCtx.current = ctx;
        // The preview's own sounds first (quick), so the game has sound while the music renders
        for (const [moment, o] of Object.entries(OWN_SOUNDS) as Array<[SfxMoment, (typeof OWN_SOUNDS)[SfxMoment]]>) {
          const base = generateSfx(o.kind, o.seed);
          await ensureSfxRecordings(base);
          own.current.set(
            moment,
            [0, 1, 2].map((i) => {
              const channels = renderSfxStereo(varySfx(base, i, 1), ctx.sampleRate);
              const b = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
              channels.forEach((x, c) => b.copyToChannel(x as Float32Array<ArrayBuffer>, c));
              return b;
            })
          );
        }
        // (The preview plays the song as written: costumes would only make it slower to make)
        const song = { ...gameKitSong(), costumes: [] };
        const key = JSON.stringify(song);
        let manifest: AudioManifest;
        let buffers: Map<string, AudioBuffer>;
        if (cache?.key === key && cache.buffers.values().next().value?.sampleRate === ctx.sampleRate) ({ manifest, buffers } = cache);
        else {
          // The player mixes the stems, so a state's whole mix isn't made when it has them
          const parts = await buildGameKitParts(song, (f, d) => !cancelled && setProgress(`Rendering the music (${d}, ${Math.round(f * 100)}%).`), 44100, true);
          manifest = parts.manifest;
          buffers = new Map<string, AudioBuffer>();
          for (const f of parts.files) buffers.set(f.name, await ctx.decodeAudioData(await f.data.arrayBuffer()));
          cache = { key, manifest, buffers };
        }
        if (cancelled) return;
        const m = new AdaptiveMusic(ctx, liveMix.auditionInput.input as unknown as AudioNode);
        m.loadFrom(manifest, buffers);
        music.current = m;
        const guess = guessTryOutMap(manifest);
        mapRef.current = guess;
        setMap(guess);
        setManifest(manifest);
        if (guess.calm) m.play(guess.calm);
        m.setIntensity(0.3, 0.1);
        // The guard naps until now, so the music is there for the chase
        musicReady.current = true;
        scene.current?.wake();
        say(`Music ready: ${guess.calm || '(no state)'}. The guard woke up!`);
      } catch (err) {
        if (!cancelled) showToast(`Couldn't make the game preview: ${err instanceof Error ? err.message : String(err)}.`);
        onClose();
      }
    })();
    return () => {
      cancelled = true;
      music.current?.stop();
      music.current?.stopSfx();
    };
  }, [onClose, say]);

  /** A sound effect for a moment: the song's, or the preview's own. */
  const sfx = useCallback((moment: SfxMoment, pitch = 0) => {
    const m = music.current;
    const name = mapRef.current?.[moment];
    if (m && name) {
      m.playSfx(name, { pitch });
      return;
    }
    const list = own.current.get(moment);
    if (!list) return;
    const ctx = liveCtx.current;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = 2 ** (pitch / 12);
    const g = ctx.createGain();
    g.gain.value = OWN_SOUNDS[moment].volume;
    src.connect(g).connect(m ? m.sfxOut : (liveMix.auditionInput.input as unknown as AudioNode));
    src.start();
  }, []);

  const stinger = useCallback((name: string | undefined) => {
    if (name) music.current?.stinger(name);
  }, []);

  const toState = useCallback(
    (name: string | undefined, why: string) => {
      const m = music.current;
      if (!m || !name || m.current?.name === name) return;
      const rule = m.data.transitions?.find((r: { from: string; to: string }) => (r.from === m.current?.name || r.from === '*') && r.to === name);
      m.setState(name);
      say(`${why}: ${name}${rule ? ` (${rule.kind})` : ''}`);
    },
    [say]
  );

  /**
   * The song's own parameters, where their names say what they're for: danger (or threat,
   * tension) follows the guard like the intensity does, health follows the hearts.
   */
  const setParams = useCallback((re: RegExp, value: number, seconds: number) => {
    const m = music.current;
    if (!m) return;
    for (const name of m.parameterNames) if (re.test(name)) m.setParameter(name, value, seconds);
  }, []);

  const start = useCallback(() => {
    const m = music.current;
    const mp = mapRef.current;
    if (!m || !mp) return;
    m.stop();
    m.stopSfx();
    m.setEffect('none', 0.1);
    if (mp.calm) m.play(mp.calm);
    m.setIntensity(0.3, 0.1);
    lastIntensity.current = 0.3;
    setParams(DANGER, 0.3, 0.1);
    setParams(HEALTH, 1, 0.1);
    setLog([`Exploring: ${mp.calm || '(no state)'}`]);
  }, [setParams]);

  // The game starts at once; the music joins in when it's rendered
  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let sc: TryOutScene | null = null;
    void import('./tryOutScene').then(({ TryOutScene }) => {
      if (disposed || !host.current) return;
      sc = new TryOutScene(host.current, {
        notice: () => toState(mapRef.current?.fight, 'The guard spotted you'),
        lose: () => {
          toState(mapRef.current?.calm, 'The guard gave up');
          music.current?.setIntensity(0.3, 2);
          setParams(DANGER, 0.3, 2);
          lastIntensity.current = 0.3;
        },
        distance: (d, chasing) => {
          const v = intensityFor(d, chasing);
          if (Math.abs(v - lastIntensity.current) > 0.04) {
            lastIntensity.current = v;
            music.current?.setIntensity(v, 0.4);
            setParams(DANGER, v, 0.4);
          }
        },
        coin: (left) => {
          stinger(mapRef.current?.coinStinger);
          sfx('coinSfx');
          say(left ? `Coin! ${left} left` : 'Every coin!');
        },
        hurt: (hearts) => {
          sfx('hurtSfx');
          // One heart left: the music goes dull and far away (the player's low-health effect)
          if (hearts === 1) music.current?.setEffect('lowHealth', 0.6);
          setParams(HEALTH, hearts / 3, 0.6);
          say(hearts > 0 ? `Ouch: ${hearts} heart${hearts === 1 ? '' : 's'} left` : 'Out of hearts');
        },
        step: () => sfx('stepSfx', Math.random() * 0.6 - 0.3),
        jump: () => sfx('jumpSfx'),
        bonk: () => {
          sfx('bonkSfx');
          const mp = mapRef.current;
          stinger(mp?.winStinger);
          if (mp?.win) toState(mp.win, 'Guard beaten');
          else toState(mp?.calm, 'Guard beaten');
          music.current?.setIntensity(0.6, 1);
        },
        gameOver: () => {
          stinger(mapRef.current?.loseStinger);
          music.current?.setIntensity(0, 2);
          setParams(DANGER, 0, 2);
          say('Game over: press R to try again');
        },
      });
      scene.current = sc;
      if (musicReady.current) sc.wake();
      sc.start();
    });
    // The game takes the keys while it's open (so Space jumps instead of playing the song)
    const keyed = (down: boolean) => (e: KeyboardEvent) => {
      if (!KEYS.has(e.code) || (e.target as HTMLElement)?.closest?.('select, input')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (down && e.code === 'KeyR' && !e.repeat) {
        scene.current?.reset();
        start();
        return;
      }
      if (!e.repeat || !down) scene.current?.key(e.code, down);
    };
    const onDown = keyed(true);
    const onUp = keyed(false);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    const hudTimer = window.setInterval(() => {
      const s = scene.current?.state;
      const m = music.current;
      if (!s || !m) return;
      setHud({ ...s, state: m.current && m.current.startTime <= m.ctx.currentTime + 0.01 ? m.current.name : (m.current?.name ?? '') + ' …', intensity: m.intensity });
    }, 120);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      clearInterval(hudTimer);
      sc?.dispose();
      scene.current = null;
    };
  }, [sfx, stinger, toState, say, start, setParams]);

  // Esc closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options = (what: 'state' | 'stinger' | 'sfx') =>
    what === 'state' ? (manifest?.states ?? []).map((s) => s.name) : what === 'stinger' ? (manifest?.stingers ?? []).map((s) => s.name) : (manifest?.sfx ?? []).filter((s) => !s.loop).map((s) => s.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-label="Try it in a game">
      <div className="w-full max-w-6xl h-[88vh] rounded-xl border border-emerald-500/50 bg-forge-panel shadow-2xl flex flex-col overflow-hidden text-xs text-forge-muted">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-forge-border">
          <Gamepad2 className="w-4 h-4 text-emerald-300" />
          <span className="text-sm font-semibold text-forge-text">Try it in a game</span>
          <span className="hidden md:inline">Arrows or WASD walk · Space jumps (land on the guard to beat it) · R restarts · Esc closes</span>
          <button type="button" onClick={() => setPanel((p) => !p)} aria-pressed={panel} className="ml-auto h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border hover:text-forge-text" title="Which state, stinger and sound each moment plays">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Music wiring
          </button>
          <button
            type="button"
            onClick={() => {
              scene.current?.reset();
              start();
            }}
            className="h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border hover:text-forge-text"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restart
          </button>
          <button type="button" onClick={onClose} className="text-forge-muted hover:text-forge-text" aria-label="Close the game">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="relative flex-1 min-w-0 bg-sky-200">
            <div ref={host} className="absolute inset-0" />
            {!manifest && (
              <div className="absolute left-1/2 -translate-x-1/2 top-3 flex items-center gap-2 rounded-lg bg-black/65 px-3 py-2 text-white text-[11px] pointer-events-none">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> {progress} The guard naps until it's ready: walk around and grab coins meanwhile.
              </div>
            )}
            {(
              <>
                <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-black/55 px-3 py-2 text-white font-mono text-[11px] pointer-events-none">
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <Heart key={i} className={`w-4 h-4 ${i < hud.hearts ? 'fill-rose-400 text-rose-400' : 'text-white/30'}`} />
                    ))}
                    <span className="ml-2 text-amber-300">
                      ● {hud.coins}/{hud.coinsTotal}
                    </span>
                  </div>
                  <div>
                    Music: <b>{hud.state || '(none)'}</b>
                  </div>
                  <div className="flex items-center gap-2">
                    Intensity
                    <span className="inline-block w-24 h-1.5 rounded bg-white/20 overflow-hidden">
                      <span className="block h-full bg-emerald-400" style={{ width: `${Math.round(hud.intensity * 100)}%` }} />
                    </span>
                  </div>
                </div>
                <ul className="absolute left-3 bottom-3 flex flex-col gap-0.5 rounded-lg bg-black/45 px-3 py-2 text-white text-[11px] pointer-events-none" aria-label="What the music did">
                  {log.map((l, i) => (
                    <li key={`${i}-${l}`} className={i ? 'opacity-60' : ''}>
                      {l}
                    </li>
                  ))}
                </ul>
                {(hud.over || hud.beaten) && (
                  <div className="absolute inset-x-0 top-1/3 text-center pointer-events-none">
                    <span className="inline-block rounded-xl bg-black/60 px-5 py-3 text-lg font-bold text-white">{hud.over ? 'Game over: press R' : 'Guard beaten! Press R to play again'}</span>
                  </div>
                )}
              </>
            )}
          </div>
          {panel && map && manifest && (
            <aside className="w-72 shrink-0 border-l border-forge-border p-3 flex flex-col gap-2 overflow-y-auto" aria-label="Music wiring">
              <p>What each moment plays. Sounds left on <i>preview's own</i> come from the sound effects maker; add your own with Add to game in the Sound FX tab.</p>
              {TRY_OUT_MOMENTS.map((m) => (
                <label key={m.key} className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-mono">{m.label}</span>
                  <select
                    value={map[m.key]}
                    onChange={(e) => setMap({ ...map, [m.key]: e.target.value })}
                    className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
                  >
                    <option value="">{m.what === 'sfx' ? "(preview's own)" : '(nothing)'}</option>
                    {options(m.what).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="text-[10px]">Intensity rises from 30% to 100% as the guard closes in, the way a game might drive it.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
