import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { tidyValue } from '../../audio/plugins/tidyValue';
import { createRoot } from 'react-dom/client';
import { Info, RotateCcw } from 'lucide-react';
import { setBuiltinGui, type BuiltinControls } from '../../audio/plugins/builtinHost';
import { FledgeSynthPanel } from './FledgeSynthPanel';
import { editPluginParam, editPluginParams, editPluginProgram, resetAllMoves } from '../../store/pluginEdits';

/**
 * The window of a built-in plugin (see builtinHost.ts): what it does, and a slider for each of
 * its parameters with the value as the plugin shows it. Double-click a slider to put it back.
 * Drawn into the plugin window (PluginWindow) through the plugin's createGui, like a WAM's own.
 */

/** Presets named "Category/Name" (Surge's patches) are grouped by category; others are one list. */
function groupPresets(names: string[]): Array<[string, Array<{ name: string; i: number }>]> {
  const groups = new Map<string, Array<{ name: string; i: number }>>();
  names.forEach((full, i) => {
    const cut = full.lastIndexOf('/');
    const group = cut > 0 ? full.slice(0, cut) : '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ name: cut > 0 ? full.slice(cut + 1) : full, i });
  });
  return [...groups];
}

// The panel is registered with setBuiltinGui below rather than exported
// oxlint-disable-next-line react/only-export-components
const Panel: React.FC<{ controls: BuiltinControls }> = ({ controls }) => {
  const params = useSyncExternalStore(controls.subscribe, controls.params);
  const { info, family } = controls.ref;
  // What it does, in a box that opens over the sliders when asked for (always there, it pushed
  // the sliders half way down the window)
  const [about, setAbout] = useState(false);
  const aboutRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!about) return;
    // A click anywhere else puts it away
    const away = (e: PointerEvent) => {
      if (!aboutRow.current?.contains(e.target as Node)) setAbout(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [about]);
  return (
    <div className="w-[380px] max-w-[92vw] p-3 flex flex-col gap-2.5 text-xs text-forge-text">
      <div ref={aboutRow} className="relative flex items-center gap-2">
        <span className="text-[10px] text-forge-muted truncate">
          {family.label === info.name ? info.category : `${family.label} · ${info.category}`}
        </span>
        <button
          type="button"
          onClick={() => setAbout(!about)}
          // (Esc closes the box first; the next one closes the window)
          onKeyDown={(e) => {
            if (e.key === 'Escape' && about) {
              e.stopPropagation();
              setAbout(false);
            }
          }}
          aria-expanded={about}
          aria-label={`What ${info.name} does`}
          title="What it does, and what each setting is for"
          className={`ml-auto h-6 px-2 flex items-center gap-1 rounded border text-[10px] hover:text-forge-text ${about ? 'border-fuchsia-400 text-forge-text' : 'border-forge-border text-forge-muted'}`}
        >
          <Info className="w-3 h-3" /> What it does
        </button>
        {about && (
          <p role="note" data-plugin-about className="absolute left-0 right-0 top-7 z-10 rounded-md border border-fuchsia-400/60 bg-forge-panel p-2.5 leading-snug text-forge-text shadow-xl">
            {info.about}
          </p>
        )}
      </div>
      {controls.programs.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="w-[96px]">Preset</span>
          <select
            value={controls.program()}
            onChange={(e) => void editPluginProgram(controls, Number(e.target.value))}
            aria-label="Preset"
            className="flex-1 h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
          >
            {controls.program() < 0 && <option value={-1}>(none)</option>}
            {groupPresets(controls.programs).map(([group, list]) =>
              group ? (
                <optgroup key={group} label={group}>
                  {list.map(({ name, i }) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map(({ name, i }) => (
                  <option key={i} value={i}>
                    {i + 1}. {name || 'Untitled'}
                  </option>
                ))
              )
            )}
          </select>
        </label>
      )}
      {params.length === 0 && <p className="text-forge-muted">No settings: it does its one thing.</p>}
      {params.map((p, i) => (
        <label key={i} className={`grid grid-cols-[96px_1fr_72px] items-center gap-2 ${p.held ? 'opacity-70' : ''}`} title={p.held ? 'Automated by a lane: delete the lane to set it here' : 'Double-click to put it back'}>
          <span className="truncate">{p.name}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={p.value}
            aria-label={p.name}
            disabled={p.held}
            // (Every move of one drag is one undo step, the double-click that puts it back too: see pluginEdits.ts)
            onChange={(e) => editPluginParam(controls, i, Number(e.target.value))}
            onDoubleClick={() => p.value !== p.defaultValue && editPluginParam(controls, i, p.defaultValue)}
            className="accent-fuchsia-400 w-full"
          />
          <span className="font-mono text-[10px] text-right text-forge-muted truncate">{tidyValue(p.text)}</span>
        </label>
      ))}
      {params.length > 0 && (
        <button
          type="button"
          // (Parameters a lane holds stay with it: when nothing else is moved, no undo step)
          onClick={() => editPluginParams(controls, resetAllMoves(params))}
          className="self-start h-6 px-2 flex items-center gap-1 rounded border border-forge-border text-[10px] text-forge-muted hover:text-forge-text"
        >
          <RotateCcw className="w-3 h-3" /> Reset all
        </button>
      )}
    </div>
  );
};

setBuiltinGui((controls) => {
  const element = document.createElement('div');
  const root = createRoot(element);
  // Fledgetone's own synth has a panel of its own
  root.render(controls.ref.family.family === 'fledge' ? <FledgeSynthPanel controls={controls} /> : <Panel controls={controls} />);
  // (Closed from the dialog's own cleanup while React is rendering: unmount once that's done)
  return { element, destroy: () => setTimeout(() => root.unmount()) };
});
