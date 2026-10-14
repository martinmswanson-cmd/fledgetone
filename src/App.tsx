/**
 * The app's layout: the header, the arrangement timeline and the dock under it, the footer, and
 * the dialogs and overlays that can open over any of them (search, report a problem, cut to
 * length, the FMOD / Wwise package, the tour, the phone notice, project drops and shared links).
 */
import React from 'react';
import { startPerfMonitor } from './audio/perfMonitor';
import { VideoPreview } from './components/video/VideoPreview';
import { Header } from './components/Header';
import { BottomDock } from './components/dock/BottomDock';
import { EnginesDialog } from './components/dock/EnginesDialog';
import { GameTryOut } from './components/game/GameTryOut';
import { Timeline } from './components/timeline/Timeline';
import { ProjectDrop } from './components/ProjectDrop';
import { MobileNotice } from './components/MobileNotice';
import { SharedLinkOpener } from './components/SharedLinkOpener';
import { SearchPalette } from './components/SearchPalette';
import { ReportProblemDialog } from './components/ReportProblemDialog';
import { LearnDialog } from './components/tour/LearnDialog';
import { CutToLengthDialog } from './components/timeline/CutToLengthDialog';
import { TourOverlay } from './components/tour/TourOverlay';
import { useTourStore } from './tour/tourStore';
import { useUiStore } from './store/uiStore';
import { startErrorLog } from './support/problemReport';
import { LifeBuoy } from 'lucide-react';

/** A computer-sized screen (the phone notice covers small touch screens instead). */
const roomy = () => typeof window !== 'undefined' && window.innerWidth >= 900;

/**
 * Tour and tutorials: the welcome on someone's first visit (not when they arrive through a shared
 * song link, which opens that song), LEARN from the header, and the running lesson.
 */
const Learn: React.FC = () => {
  const open = useUiStore((s) => s.dialog === 'learn');
  const welcomeSeen = useTourStore((s) => s.welcomeSeen);
  const [welcome, setWelcome] = React.useState(() => !welcomeSeen && roomy() && !location.hash.includes('song='));
  const close = () => {
    setWelcome(false);
    useTourStore.getState().markWelcomeSeen();
    if (open) useUiStore.getState().setDialog(null);
  };
  return (
    <>
      {(welcome || open) && <LearnDialog welcome={welcome} onClose={close} />}
      <TourOverlay />
    </>
  );
};

/** The Report a problem dialog, when it's open. */
const ReportProblem: React.FC = () => {
  const open = useUiStore((s) => s.dialog === 'report');
  return open ? <ReportProblemDialog onClose={() => useUiStore.getState().setDialog(null)} /> : null;
};

/** The Cut to length dialog, when it's open. */
const CutToLength: React.FC = () => {
  const open = useUiStore((s) => s.dialog === 'cut');
  return open ? <CutToLengthDialog onClose={() => useUiStore.getState().setDialog(null)} /> : null;
};

/** The FMOD / Wwise package dialog, when it's open. */
const Engines: React.FC = () => {
  const open = useUiStore((s) => s.dialog === 'engines');
  return open ? <EnginesDialog onClose={() => useUiStore.getState().setDialog(null)} /> : null;
};

/** Try it in a game, when it's open. */
const TryOut: React.FC = () => {
  const open = useUiStore((s) => s.dialog === 'tryOut');
  const close = React.useCallback(() => useUiStore.getState().setDialog(null), []);
  return open ? <GameTryOut onClose={close} /> : null;
};

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-forge-bg text-forge-text flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Top DAW Header */}
      <Header />
      <ProjectDrop />
      <VideoPreview />
      <MobileNotice />
      <SharedLinkOpener />
      <SearchPalette />
      <ReportProblem />
      <CutToLength />
      <Engines />
      <TryOut />
      <Learn />

      {/* Main Workstation Canvas: the arrangement, and the dock under it */}
      <main className="flex-1 w-full max-w-[1920px] mx-auto p-3 sm:p-4 flex flex-col gap-3">
        <section aria-label="Arrangement">
          <Timeline />
        </section>
        <BottomDock />
      </main>

      {/* Workstation Footer */}
      <footer className="border-t border-forge-border bg-forge-panel px-6 py-3 text-center text-xs text-forge-muted font-mono flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
          <span>Fledgetone</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => useUiStore.getState().setDialog('report')}
            className="flex items-center gap-1.5 hover:text-forge-text transition-colors"
            title="Something not working? Tell us"
          >
            <LifeBuoy className="w-3.5 h-3.5" /> Report a problem
          </button>
          <a href="https://twobirdsworkshop.com" target="_blank" rel="noopener" className="hover:text-forge-text transition-colors">
            twobirdsworkshop.com
          </a>
        </div>
      </footer>
    </div>
  );
};

export default App;

startPerfMonitor();
startErrorLog();
