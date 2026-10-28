/**
 * Before the web runtime kit takes a GPL-licensed plugin along: which ones, what GPL asks of a game
 * that ships them, who made each and how to reach them, and the choice to go ahead or not.
 */
import React from 'react';
import { Modal } from './Modal';
import { GPL_CREDITS, GPL_PLAIN } from '../../audio/plugins/gplCredits';
import type { PluginFamily } from '../../audio/plugins/pluginTypes';

const link = 'text-cyan-300 underline underline-offset-2 hover:text-cyan-200';

export const GplNoticeDialog: React.FC<{ families: PluginFamily[]; onExport: () => void; onCancel: () => void }> = ({ families, onExport, onCancel }) => (
  <Modal title={families.length > 1 ? 'These plugins are GPL-licensed' : `${families[0].label} is GPL-licensed`} onClose={onCancel}>
    <p className="text-forge-text">{GPL_PLAIN}</p>
    <ul className="flex flex-col gap-2">
      {families.map((f) => {
        const c = GPL_CREDITS[f.family];
        return (
          <li key={f.family} className="rounded-md border border-forge-border bg-forge-bg/60 p-2 leading-snug">
            <span className="font-semibold text-forge-text">{c?.name ?? f.label}</span> ({c?.licence ?? f.licence})
            {c && (
              <>
                <br />
                Made by {c.by}.
                <br />
                <a className={link} href={c.project} target="_blank" rel="noopener noreferrer">
                  Project page
                </a>
                {' · '}
                <a className={link} href={c.source} target="_blank" rel="noopener noreferrer">
                  Source code
                </a>
                {' · '}
                <a className={link} href={c.contact} target="_blank" rel="noopener noreferrer">
                  Contact the makers
                </a>
              </>
            )}
          </li>
        );
      })}
    </ul>
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="h-8 px-3 rounded-md border border-forge-border text-xs text-forge-text hover:border-forge-borderLight">
        Cancel
      </button>
      <button type="button" autoFocus onClick={onExport} className="h-8 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25">
        Export with {families.length > 1 ? 'them' : 'it'}
      </button>
    </div>
  </Modal>
);
