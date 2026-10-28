/**
 * A small "GPL" tag beside a GPL-licensed built-in plugin's name (the plugin browser, the Plugins
 * menu's favourites, a plugin's window): it's free to use in your music; shipping the plugin
 * itself in a game (the web runtime kit) brings its licence along.
 */
import React from 'react';
import { GPL_TAG_TIP } from '../audio/plugins/gplCredits';


export const GplTag: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    title={GPL_TAG_TIP}
    aria-label={GPL_TAG_TIP}
    role="note"
    className={`shrink-0 inline-flex items-center rounded border border-forge-border px-1 font-mono text-[9px] leading-[14px] text-forge-muted ${className}`}
  >
    GPL
  </span>
);
