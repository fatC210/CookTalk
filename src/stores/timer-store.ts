import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useEffect } from 'react';

export interface Timer {
  id: string;
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  createdAt: number;
}

interface TimerState {
  timers: Timer[];

  startTimer: (label: string, seconds: number) => string;
  startMultipleTimers: (timers: { label: string; seconds: number }[]) => string[];
  cancelTimer: (id: string) => void;
  extendTimer: (id: string, seconds: number) => void;
  tick: () => void;
  getActiveTimers: () => Timer[];
  clearAll: () => void;
}

export const useTimerStore = create<TimerState>()((set, get) => ({
  timers: [],

  startTimer: (label, seconds) => {
    const id = uuidv4();
    const timer: Timer = {
      id,
      label,
      totalSeconds: seconds,
      remainingSeconds: seconds,
      isRunning: true,
      createdAt: Date.now(),
    };
    set((s) => ({ timers: [...s.timers, timer] }));
    return id;
  },

  startMultipleTimers: (timersInput) => {
    const newTimers: Timer[] = timersInput.map(({ label, seconds }) => ({
      id: uuidv4(),
      label,
      totalSeconds: seconds,
      remainingSeconds: seconds,
      isRunning: true,
      createdAt: Date.now(),
    }));
    set((s) => ({ timers: [...s.timers, ...newTimers] }));
    return newTimers.map((t) => t.id);
  },

  cancelTimer: (id) =>
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),

  extendTimer: (id, seconds) =>
    set((s) => ({
      timers: s.timers.map((t) =>
        t.id === id
          ? { ...t, remainingSeconds: t.remainingSeconds + seconds, totalSeconds: t.totalSeconds + seconds }
          : t,
      ),
    })),

  tick: () =>
    set((s) => ({
      timers: s.timers.map((t) => {
        if (!t.isRunning || t.remainingSeconds <= 0) return t;
        const remaining = t.remainingSeconds - 1;
        return { ...t, remainingSeconds: remaining, isRunning: remaining > 0 };
      }),
    })),

  getActiveTimers: () => get().timers.filter((t) => t.isRunning),

  clearAll: () => set({ timers: [] }),
}));

export function useTimerTick(onExpire?: (timer: Timer) => void) {
  const tick = useTimerStore((s) => s.tick);
  const timers = useTimerStore((s) => s.timers);

  useEffect(() => {
    const hasRunning = timers.some((t) => t.isRunning);
    if (!hasRunning) return;

    const interval = setInterval(() => {
      const prevRunning = useTimerStore.getState().timers.filter((t) => t.isRunning);
      tick();
      if (onExpire) {
        const afterTick = useTimerStore.getState().timers;
        for (const before of prevRunning) {
          const after = afterTick.find((t) => t.id === before.id);
          if (after && after.remainingSeconds === 0 && !after.isRunning) {
            onExpire(after);
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [tick, timers, onExpire]);
}
