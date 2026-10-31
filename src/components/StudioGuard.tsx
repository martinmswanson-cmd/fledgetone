/**
 * Around the whole app (the studio, or Pocket): if something goes wrong while it's drawn, a plain
 * screen takes its place rather than a blank page. It offers to set the song open aside (kept as
 * a version, and offered back by the Restore banner, never opened again by itself: the song may be
 * what stopped it) and start fresh. Nothing else is imported up front: the store loads with the app.
 */
import React from 'react';

type State = { failed: boolean; busy: boolean };

/** The app afresh: the address without a shared song in it. */
const startFresh = () => location.replace(`${location.pathname}${location.search}`);

export class StudioGuard extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false, busy: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(): void {
    // (The song open stays noted as opening: the next startup offers it rather than opening it)
    void import('../store/reopenLastSong').then((m) => m.noteStopped(), () => undefined);
  }

  private setAside = async () => {
    this.setState({ busy: true });
    try {
      const m = await import('../store/reopenLastSong');
      // (Storage that never answers doesn't keep the screen waiting: the song stays noted, and offered)
      await Promise.race([m.setAsideAndStartFresh(), new Promise((r) => setTimeout(r, 4000))]);
    } catch {
      // The app's own code couldn't load: starting again is all that's left
    }
    startFresh();
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen bg-forge-bg text-forge-text font-sans flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl border border-forge-border bg-forge-panel p-5 flex flex-col gap-3">
          <h1 className="text-lg font-semibold">Something went wrong, and Fledgetone stopped showing</h1>
          <p className="text-sm text-forge-muted">
            The song that's open may be what stopped it. Set it aside to start fresh: it isn't deleted. It's kept in Versions, and offered back when Fledgetone opens, but it won't
            open again by itself.
          </p>
          <button
            type="button"
            disabled={this.state.busy}
            onClick={() => void this.setAside()}
            className="self-start rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
          >
            {this.state.busy ? 'Setting it aside…' : 'Set the song aside and start fresh'}
          </button>
        </div>
      </div>
    );
  }
}
