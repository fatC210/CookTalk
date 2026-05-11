// Timer state
let timers = new Map();
let intervalId = null;

function tick() {
  const now = Date.now();
  const completed = [];

  timers.forEach((timer, id) => {
    if (!timer.isRunning) return;
    const elapsed = (now - timer.lastTick) / 1000;
    timer.remaining = Math.max(0, timer.remaining - elapsed);
    timer.lastTick = now;

    if (timer.remaining <= 0) {
      completed.push({ id, label: timer.label });
      timer.isRunning = false;
    }
  });

  // Send tick update with all timer states
  const states = [];
  timers.forEach((timer, id) => {
    states.push({
      id,
      label: timer.label,
      totalSeconds: timer.totalSeconds,
      remainingSeconds: Math.round(timer.remaining),
      isRunning: timer.isRunning,
    });
  });

  self.postMessage({ type: "tick", timers: states });

  // Send completed notifications
  completed.forEach((t) => {
    self.postMessage({ type: "completed", id: t.id, label: t.label });
  });
}

self.onmessage = function (e) {
  const { type, id, label, seconds } = e.data;

  switch (type) {
    case "start":
      timers.set(id, {
        label,
        totalSeconds: seconds,
        remaining: seconds,
        isRunning: true,
        lastTick: Date.now(),
      });
      if (!intervalId) {
        intervalId = setInterval(tick, 1000);
      }
      break;

    case "cancel":
      timers.delete(id);
      if (timers.size === 0 && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      break;

    case "extend":
      if (timers.has(id)) {
        const timer = timers.get(id);
        timer.remaining += seconds;
        timer.totalSeconds += seconds;
        timer.isRunning = true;
      }
      break;

    case "clear":
      timers.clear();
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      break;
  }
};
