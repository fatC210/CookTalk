import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuid } from 'uuid';

export interface TimerInfo {
  id: string;
  label: string;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
}

export function useTimers() {
  const [timers, setTimers] = useState<TimerInfo[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const onCompletedRef = useRef<((id: string, label: string) => void) | null>(null);

  useEffect(() => {
    const worker = new Worker('/timer-worker.js');
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<{ type: string; timers?: TimerInfo[]; id?: string; label?: string }>) => {
      if (e.data.type === 'tick' && e.data.timers) {
        setTimers(e.data.timers);
      } else if (e.data.type === 'completed' && e.data.id && e.data.label) {
        onCompletedRef.current?.(e.data.id, e.data.label);
      }
    };

    return () => worker.terminate();
  }, []);

  const startTimer = useCallback((label: string, seconds: number): string => {
    const id = uuid();
    workerRef.current?.postMessage({ type: 'start', id, label, seconds });
    return id;
  }, []);

  const startMultipleTimers = useCallback(
    (items: { label: string; seconds: number }[]): string[] => {
      return items.map(item => {
        const id = uuid();
        workerRef.current?.postMessage({ type: 'start', id, label: item.label, seconds: item.seconds });
        return id;
      });
    },
    [],
  );

  const cancelTimer = useCallback((id: string): void => {
    workerRef.current?.postMessage({ type: 'cancel', id });
  }, []);

  const extendTimer = useCallback((id: string, seconds: number): void => {
    workerRef.current?.postMessage({ type: 'extend', id, seconds });
  }, []);

  const clearAll = useCallback((): void => {
    workerRef.current?.postMessage({ type: 'clear' });
  }, []);

  const setOnCompleted = useCallback((cb: (id: string, label: string) => void): void => {
    onCompletedRef.current = cb;
  }, []);

  return {
    timers,
    activeTimers: timers.filter(t => t.isRunning),
    startTimer,
    startMultipleTimers,
    cancelTimer,
    extendTimer,
    clearAll,
    setOnCompleted,
  };
}
