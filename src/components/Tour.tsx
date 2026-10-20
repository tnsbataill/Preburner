import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { navigate } from '../App';
import { useApp } from '../state/store';
import { Button } from '../ui/primitives';

/** A guided walk through the app after setup: each step spotlights an element
 *  tagged `data-tour="<target>"` on Today and explains it in a callout. Not
 *  persisted — it runs when setup finishes or when started from Settings. */
export const useTour = create<{ open: boolean; start: () => void; close: () => void }>((set) => ({
  open: false,
  start: () => {
    navigate('today');
    window.scrollTo(0, 0);
    set({ open: true });
  },
  close: () => set({ open: false }),
}));

type Step = { target: string; title: string; body: ReactNode };

function steps(demo: boolean): Step[] {
  return [
    { target: 'date-strip', title: 'Pick a day', body: 'Today is selected. Tap any day to see its plan, up to two weeks ahead.' },
    {
      target: 'timeline',
      title: 'Your day, in order',
      body: 'Meals are timed around your rides: fuel before, carbs during, recovery after. Tap a ride to set when it really starts and the meals move with it. Tick meals off as you eat them.',
    },
    { target: 'summary', title: 'Daily targets', body: 'Calories, carbs, protein and fat, set by how hard the day is. Harder days get more carbs; easy days carry most of any weight-loss deficit.' },
    { target: 'fuel-tank', title: 'Fuel tank', body: 'Estimated muscle glycogen through the day. Try to start hard sessions with a full tank.' },
    { target: 'nav-week', title: 'Week', body: 'Training hours, intake and expected weight change across the week, day by day.' },
    { target: 'nav-plan', title: 'Plan', body: 'Your training plan, built from your FTP and goal. It adapts as you rate rides, so review new rides when they show up on Today.' },
    { target: 'nav-fitness', title: 'Fitness', body: 'Fitness, fatigue and form over time, with a projection toward your target event.' },
    { target: 'nav-coach', title: 'Coach', body: 'Ask questions about your training and fuelling. It needs an Anthropic key, which you add in Settings.' },
    demo
      ? { target: 'sync', title: 'Demo data', body: "You're exploring sample data. Tap here to connect Intervals.icu and use your own rides." }
      : { target: 'sync', title: 'Sync', body: 'Rides, FTP and weight come from Intervals.icu. Sync runs when you open the app; tap here to sync now.' },
    { target: 'nav-settings', title: 'Settings', body: 'Goals, meal times, nutrition and connections live here. You can replay this tour from Settings too.' },
  ];
}

/** The visible copy of a target: nav exists twice (sidebar and tab bar), only one is shown. */
function findTarget(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GUTTER = 16;

export function Tour() {
  const open = useTour((t) => t.open);
  const close = useTour((t) => t.close);
  const demo = useApp((s) => s.connection.mode === 'demo');
  const list = useMemo(() => steps(demo), [demo]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect>();
  const [callH, setCallH] = useState(0);
  const callout = useRef<HTMLDivElement>(null);
  const dir = useRef(1);

  const finish = useCallback(() => {
    close();
    setI(0);
    navigate('today');
    window.scrollTo(0, 0);
  }, [close]);

  const go = (d: number) => {
    dir.current = d;
    if (i + d >= list.length) finish();
    else setI(Math.max(0, i + d));
  };

  // Find the step's target (the page may still be mounting), bring it into
  // view, then measure. A target that never appears is skipped.
  useEffect(() => {
    if (!open) return;
    setRect(undefined);
    let cancelled = false;
    let frame = 0;
    const started = performance.now();
    const look = () => {
      if (cancelled) return;
      const el = findTarget(list[i].target);
      if (!el) {
        if (performance.now() - started > 1500) {
          const next = i + dir.current;
          if (next >= list.length || next < 0) finish();
          else setI(next);
        } else frame = requestAnimationFrame(look);
        return;
      }
      const fixed = getComputedStyle(el).position === 'fixed' || el.closest('nav, aside');
      if (!fixed) {
        const r = el.getBoundingClientRect();
        // The phone header is sticky: start a tall target just below it.
        const header = document.querySelector('header')?.getBoundingClientRect();
        const below = header && header.height > 0 ? header.bottom + 12 : 16;
        const tall = r.height > (window.innerHeight - below) * 0.6;
        const y = tall ? r.top - below : r.top + r.height / 2 - (below + window.innerHeight) / 2;
        window.scrollBy({ top: y, behavior: 'smooth' });
      }
      // Let the smooth scroll and the page's fade-in settle before measuring.
      window.setTimeout(() => !cancelled && measure(), fixed ? 0 : 450);
    };
    const measure = () => {
      const el = findTarget(list[i].target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    look();
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [open, i, list, finish]);

  useLayoutEffect(() => {
    if (callout.current) setCallH(callout.current.offsetHeight);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft' && i > 0) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;
  const step = list[i];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Spotlight: the target padded, clipped to the viewport.
  const spot = rect && {
    top: Math.max(4, rect.top - PAD),
    left: Math.max(4, rect.left - PAD),
    right: Math.min(vw - 4, rect.left + rect.width + PAD),
    bottom: Math.min(vh - 4, rect.top + rect.height + PAD),
  };

  // Callout: below the spotlight if it fits, else above, else pinned to the
  // bottom of the screen over the target.
  const width = Math.min(360, vw - GUTTER * 2);
  let top = vh - callH - GUTTER - 70;
  let left = (vw - width) / 2;
  if (spot) {
    const gap = 12;
    if (spot.bottom + gap + callH < vh - GUTTER) top = spot.bottom + gap;
    else if (spot.top - gap - callH > GUTTER) top = spot.top - gap - callH;
    else top = vh - callH - GUTTER;
    const center = (spot.left + spot.right) / 2;
    left = Math.min(Math.max(GUTTER, center - width / 2), vw - width - GUTTER);
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="App tour" data-testid="tour">
      {/* Swallow clicks on the page while touring. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-ember transition-all duration-300"
          style={{ top: spot.top, left: spot.left, width: spot.right - spot.left, height: spot.bottom - spot.top, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
      )}
      <div
        ref={callout}
        key={i}
        className="card absolute animate-fade-up p-4 shadow-xl transition-[top,left] duration-300"
        style={{ top, left, width, visibility: spot ? 'visible' : 'hidden' }}
        data-testid="tour-callout"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="font-semibold">{step.title}</h2>
          <button onClick={finish} aria-label="Skip tour" className="-mr-1 -mt-1 rounded-lg p-1 text-muted hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="num text-xs text-faint">
            {i + 1} / {list.length}
          </span>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="ghost" className="px-2.5 py-1.5 text-sm" onClick={() => go(-1)} aria-label="Previous">
                <ArrowLeft size={15} />
              </Button>
            )}
            <Button variant="primary" className="px-3 py-1.5 text-sm" onClick={() => go(1)}>
              {i === list.length - 1 ? 'Done' : 'Next'} {i < list.length - 1 && <ArrowRight size={15} />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
