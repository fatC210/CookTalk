type ActiveVoicePlayback = {
  audio: HTMLAudioElement;
  cleanup?: () => void;
  onStop?: () => void;
  signalAssistantSpeaking: boolean;
};

export type VoicePlaybackHandle = {
  stop: () => void;
  release: () => void;
  isActive: () => boolean;
};

let activePlayback: ActiveVoicePlayback | null = null;

export function claimVoicePlayback(
  audio: HTMLAudioElement,
  options: {
    cleanup?: () => void;
    onStop?: () => void;
    signalAssistantSpeaking?: boolean;
  } = {},
): VoicePlaybackHandle {
  stopActiveVoicePlayback();

  const playback: ActiveVoicePlayback = {
    audio,
    cleanup: options.cleanup,
    onStop: options.onStop,
    signalAssistantSpeaking: options.signalAssistantSpeaking ?? true,
  };
  activePlayback = playback;

  if (playback.signalAssistantSpeaking) {
    emitAssistantSpeaking(true);
  }

  return {
    stop: () => finishPlayback(playback, true),
    release: () => finishPlayback(playback, false),
    isActive: () => activePlayback === playback,
  };
}

export function stopActiveVoicePlayback(): void {
  if (!activePlayback) return;
  finishPlayback(activePlayback, true);
}

function finishPlayback(playback: ActiveVoicePlayback, stopped: boolean): void {
  if (activePlayback !== playback) return;
  activePlayback = null;

  if (stopped) {
    try {
      playback.audio.pause();
      playback.audio.removeAttribute("src");
      playback.audio.load();
    } catch {
      // The element may already be detached or inactive.
    }
  }

  if (playback.signalAssistantSpeaking) {
    emitAssistantSpeaking(false);
  }

  playback.cleanup?.();
  if (stopped) playback.onStop?.();
}

function emitAssistantSpeaking(active: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cooktalk:assistant-speaking", { detail: { active } }));
}
