/**
 * The short message at the bottom of the screen (shown by showToast in toastStore.ts).
 */
import React, { useEffect } from 'react';
import { Info } from 'lucide-react';
import { useToast } from './toastStore';

const SHOW_MS = 4000;

/** The message from showToast. It goes away after a few seconds, or when clicked. */
export const Toast: React.FC = () => {
  const text = useToast((s) => s.text);
  const serial = useToast((s) => s.serial);

  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(() => useToast.setState({ text: null }), SHOW_MS);
    return () => clearTimeout(timer);
  }, [text, serial]);

  if (!text) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => useToast.setState({ text: null })}
      className="fixed z-[60] bottom-6 left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-32px)] flex items-start gap-2 px-3 py-2 rounded-md border border-amber-400/60 bg-forge-panelLight shadow-2xl text-xs font-mono text-amber-100 cursor-pointer"
    >
      <Info className="w-3.5 h-3.5 mt-px shrink-0 text-amber-300" />
      {text}
    </div>
  );
};
