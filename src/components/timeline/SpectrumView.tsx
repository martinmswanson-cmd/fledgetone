import React, { useEffect, useRef, useState } from 'react';
import { drawSpectrum, isSkin, SPECTRUM_SKINS, type SkinId, type SkinMemory } from '../../audio/spectrumSkins';
import { readMasterBands, watchMasterSpectrum } from '../../audio/masterSpectrum';
import { frameRate, onFrame } from '../frameTicker';
import { useTimelineStore } from '../../store/timelineStore';

/**
 * The live master spectrum, drawn in one of the readout styles (spectrumSkins.ts): plain bars, or
 * a character that moves to the sound. The style is remembered in this browser.
 */

const STYLE_KEY = 'bosBeatbox.spectrumStyle';
const BANDS = 48;

function savedSkin(): SkinId {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return isSkin(v) ? v : 'city';
  } catch {
    return 'city';
  }
}

/** Songs with more tracks than this get the spectrum at 15 frames a second */
const BIG_SONG_TRACKS = 16;

export const SpectrumView: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [skin, setSkin] = useState<SkinId>(savedSkin);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const stop = watchMasterSpectrum();
    const bands = new Float32Array(BANDS);
    const memory: SkinMemory = {};
    /** When the sound was last above silence: a quiet readout slows to a few frames a second. */
    let lastHeard = 0;
    const frame = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      if (!readMasterBands(bands)) bands.fill(0);
      if (bands.some((b) => b > 0.01)) lastHeard = now;
      // A big song leaves the page less room: the scenes move at half the rate there
      frameRate(frame, now - lastHeard > 1000 ? 4 : useTimelineStore.getState().tracks.length > BIG_SONG_TRACKS ? 15 : 30);
      g.clearRect(0, 0, w, h);
      drawSpectrum(g, skin, { x: 4 * dpr, y: 4 * dpr, w: w - 8 * dpr, h: h - 8 * dpr }, bands, now / 1000, memory);
    };
    // 30 a second while there's sound: the scenes are as smooth to the eye, at half the drawing
    const unlisten = onFrame(frame, 30);
    return () => {
      unlisten();
      stop();
    };
  }, [skin]);

  const pick = (id: SkinId) => {
    setSkin(id);
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {
      // Not remembered, but still shown
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} role="group" aria-label="Spectrum">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-cyan-200">SPECTRUM</span>
        <select
          value={skin}
          onChange={(e) => pick(e.target.value as SkinId)}
          className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text"
          aria-label="Spectrum style"
          title={SPECTRUM_SKINS.find((s) => s.id === skin)?.blurb}
        >
          {SPECTRUM_SKINS.map((s) => (
            <option key={s.id} value={s.id} title={s.blurb}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <canvas ref={canvas} className="w-full flex-1 min-h-0 rounded-md bg-black/40" aria-hidden />
    </div>
  );
};
