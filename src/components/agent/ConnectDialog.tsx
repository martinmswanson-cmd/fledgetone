/**
 * "Let an agent connect…": the code the agent gave (and the port, if it said another), what the
 * agent may do (read the song always; see what's selected, suggest changes, listen: each off until
 * ticked), the privacy line, and what to do when the browser blocks the connection. Connected, it
 * says to whom, lets the permissions change, and disconnects (the boxes then back to reading
 * only, for the next pairing). After a wrong code, Try again goes on the same connection only if
 * the port is the same; a port typed anew is dialed afresh.
 */
import React from 'react';
import { Modal } from '../timeline/Modal';
import { agentOpeners, useUiStore } from '../../store/uiStore';
import { connectAgent, DEFAULT_PORT, disconnectAgent, retryCode, setAgentPermissions } from '../../agent/bridgeClient';
import { useSuggestions } from '../../agent/suggestionsStore';
import { DEFAULT_PERMISSIONS, normalizeCode, typedCode, type Permissions } from '../../agent/protocol';
import { returnFocus } from './returnFocus';

/** The privacy line, word for word (also in the guide and the command line's help). */
export const PRIVACY_LINE = 'Fledgetone sends nothing anywhere. Your agent sends what it reads to whoever runs it.';

/** The port as typed, or null if it isn't one. */
const portOf = (text: string): number | null => {
  const n = Number(text.trim());
  return text.trim() && Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};

const PERMISSIONS: Array<{ key: keyof Permissions; label: string; detail: string }> = [
  { key: 'read', label: 'Read the song', detail: 'Its tracks, clips, notes, mix and markers. Always on while connected.' },
  { key: 'see', label: 'See what I select', detail: 'The selected track and clips, the open clip and the playhead.' },
  { key: 'suggest', label: 'Suggest changes', detail: 'Suggestions wait on the Suggestions panel until you accept or dismiss them.' },
  { key: 'listen', label: 'Listen', detail: 'Render a few bars and measure them (loudness, peaks, balance). Nothing plays.' },
];

export const ConnectDialog: React.FC = () => {
  const close = React.useCallback(() => useUiStore.getState().setAgentConnectOpen(false), []);
  const info = useSuggestions((s) => s.connection);
  const permissions = useSuggestions((s) => s.permissions);
  const [code, setCode] = React.useState('');
  // (the usual port each time, never the last one typed: the agent says the port with every code,
  // and an old one remembered could be dialed after its helper moved, to whatever holds it now)
  const [portText, setPortText] = React.useState(() => String(DEFAULT_PORT));
  const port = portOf(portText);
  // (a new pairing starts from reading only, whatever a previous agent was allowed)
  const [ask, setAsk] = React.useState<Permissions>(() => (info.state === 'paired' ? { ...permissions } : { ...DEFAULT_PERMISSIONS }));
  const connected = info.state === 'paired';
  const busy = info.state === 'waiting' || info.state === 'proving';
  const valid = normalizeCode(code) !== null && port !== null;

  // Closed: focus goes back to what opened it
  React.useEffect(() => () => returnFocus(agentOpeners.connect), []);

  // Paired: show the panel and get out of the way. No longer paired (Disconnect here, or the
  // connection went): the boxes go back to reading only, so the next pairing starts from that
  const wasConnected = React.useRef(connected);
  React.useEffect(() => {
    if (connected && !wasConnected.current) {
      useUiStore.getState().setAgentPanelOpen(true);
      close();
    } else if (!connected && wasConnected.current) setAsk({ ...DEFAULT_PERMISSIONS });
    wasConnected.current = connected;
  }, [connected, close]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || port === null) return;
    // (what's ticked now goes with every try, a second one too; on the connection that's open only
    // if the port is still the one it dialed, else to the port typed now, afresh)
    if (info.state === 'wrong_code' && retryCode(code, port, ask)) return;
    connectAgent(code, port, ask);
  };

  const toggle = (key: keyof Permissions, on: boolean) => {
    const next = { ...ask, [key]: on, read: true };
    setAsk(next);
    if (connected) setAgentPermissions(next);
  };

  const status =
    info.state === 'waiting'
      ? 'Connecting to your agent’s helper…'
      : info.state === 'proving'
        ? 'Checking the code…'
        : info.state === 'wrong_code'
          ? `${info.message ?? 'That code doesn’t match.'}${info.attemptsLeft !== undefined ? ` ${info.attemptsLeft} ${info.attemptsLeft === 1 ? 'try' : 'tries'} left.` : ''}`
          : info.state === 'refused' || (info.state === 'closed' && info.message)
            ? (info.message ?? 'The connection closed.')
            : '';

  return (
    <Modal title={connected ? 'Agent connected' : 'Let an agent connect'} onClose={close}>
      <form onSubmit={submit} data-agent-ui="" className="flex flex-col gap-3 p-4 text-[13px] text-forge-muted max-w-md">
        {connected ? (
          <p className="text-forge-text">
            Connected to your agent{info.agent ? <> (<span className="font-semibold">{info.agent}</span>)</> : null}. It can read this song{ask.suggest ? ' and suggest changes' : ''}{ask.listen ? ', and listen' : ''}.
          </p>
        ) : (
          <>
            <p>
              An agent you already use (one that works with MCP) can read this song and suggest changes. You hear each one before and after, and accept it or not. Start its helper first
              (<span className="font-mono text-forge-text">fledgetone mcp</span>, see the guide), then ask it to connect: it gives you a code.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider font-mono">Code from your agent</span>
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(typedCode(e.target.value))}
                placeholder="K7QM-3XPD-9TBW"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                aria-describedby="agent-connect-status"
                className="h-10 px-3 rounded-md border border-forge-border bg-forge-bg font-mono text-lg tracking-[0.2em] text-forge-text focus:border-cyan-500 outline-none"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-mono">Port</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={portText}
                onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                className="h-8 w-24 px-2 rounded-md border border-forge-border bg-forge-bg font-mono text-forge-text"
                aria-label="Port the helper listens on"
              />
              <span className="text-[11px]">{port === null ? 'A port is a number from 1 to 65535.' : port === DEFAULT_PORT ? 'The usual one. Change it only if your agent says another.' : 'Only the one your agent said.'}</span>
            </label>
          </>
        )}
        <fieldset className="flex flex-col gap-1.5 border border-forge-border rounded-md p-3">
          <legend className="px-1 text-[11px] uppercase tracking-wider font-mono">The agent may</legend>
          {PERMISSIONS.map((p) => (
            <label key={p.key} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-cyan-500" checked={p.key === 'read' || ask[p.key]} disabled={p.key === 'read'} onChange={(e) => toggle(p.key, e.target.checked)} />
              <span>
                <span className="text-forge-text">{p.label}</span>
                <span className="block text-[11px]">{p.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-forge-text">{PRIVACY_LINE}</p>
        <p id="agent-connect-status" role="status" aria-live="polite" className={info.state === 'wrong_code' || info.state === 'refused' ? 'text-amber-300' : ''}>
          {status}
        </p>
        {!connected && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-forge-text">Nothing happens?</summary>
            <p className="mt-1">
              Chrome may ask whether this page can reach devices on your local network: allow it (the helper runs on this computer). Safari and Brave can block the connection to a helper on this
              computer: start the helper with <span className="font-mono">--studio</span> and open the studio from the address it gives (at 127.0.0.1:47200), on this computer. Check too that the port matches what your agent said.
            </p>
          </details>
        )}
        <div className="flex justify-end gap-2">
          {connected || busy ? (
            <button type="button" onClick={() => disconnectAgent()} className="h-9 px-3 rounded-md border border-forge-border text-forge-text hover:border-red-400/70">
              Disconnect
            </button>
          ) : null}
          {!connected && (
            <button type="submit" disabled={!valid || busy} className="h-9 px-4 rounded-md border border-cyan-500/60 bg-cyan-500/15 font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50">
              {info.state === 'wrong_code' ? 'Try again' : 'Connect'}
            </button>
          )}
          {connected && (
            <button type="button" onClick={close} className="h-9 px-4 rounded-md border border-cyan-500/60 bg-cyan-500/15 font-semibold text-cyan-100">
              Done
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
};
