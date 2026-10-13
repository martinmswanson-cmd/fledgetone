import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw } from 'lucide-react';
import { setBuiltinGui, type BuiltinControls } from '../../audio/plugins/builtinHost';

/**
 * The window of a built-in plugin (see builtinHost.ts): what it does, and a slider for each of
 * its parameters with the value as the plugin shows it. Double-click a slider to put it back.
 * Drawn into the plugin window (PluginWindow) through the plugin's createGui, like a WAM's own.
 */

/** "-3.0000 dB" → "-3 dB", "0.5000" → "0.50": the plugins print four places. */
function tidyValue(text: string): string {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return text.trim();
  const v = Number(m[1]);
  const places = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${Number(v.toFixed(places)).toFixed(places).replace(/^-0(\.0+)?$/, '0$1')}${m[2]}`;
}

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
  return (
    <div className="w-[380px] max-w-[92vw] p-3 flex flex-col gap-2.5 text-xs text-forge-text">
      <p className="text-forge-muted leading-snug">
        {info.about} <span className="text-[10px]">({family.label}, {info.category})</span>
      </p>
      {controls.programs.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="w-[96px]">Preset</span>
          <select
            value={controls.program()}
            onChange={(e) => void controls.setProgram(Number(e.target.value))}
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
        <label key={i} className="grid grid-cols-[96px_1fr_72px] items-center gap-2" title="Double-click to put it back">
          <span className="truncate">{p.name}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={p.value}
            aria-label={p.name}
            onChange={(e) => controls.set(i, Number(e.target.value))}
            onDoubleClick={() => controls.set(i, p.defaultValue)}
            className="accent-fuchsia-400 w-full"
          />
          <span className="font-mono text-[10px] text-right text-forge-muted truncate">{tidyValue(p.text)}</span>
        </label>
      ))}
      {params.length > 0 && (
        <button
          type="button"
          onClick={() => params.forEach((p, i) => p.value !== p.defaultValue && controls.set(i, p.defaultValue))}
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
  root.render(<Panel controls={controls} />);
  // (Closed from the dialog's own cleanup while React is rendering: unmount once that's done)
  return { element, destroy: () => setTimeout(() => root.unmount()) };
});
