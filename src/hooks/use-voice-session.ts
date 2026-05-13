import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionConstructor,
  hasWakeWord,
  stripWakeWords,
  transcribeWithElevenLabs,
  type VoiceStatus,
} from "@/lib/voice-pipeline";
import i18n from "@/lib/i18n";
import { useAppStore } from "@/stores/app-store";

interface UseVoiceSessionOptions {
  enabled: boolean;
  wakeWords: string[];
  language: "en" | "zh";
  listenMode: "always" | "wake-word";
  manualWakeActive: boolean;
  awakeResetKey?: string | number | boolean;
  commandDurationMs?: number;
  suppressPureWakeWordTranscript?: boolean;
  shouldHandleSleepingTranscript?: (transcript: string, phrase: string) => boolean;
  onWake?: (event: VoiceWakeEvent) => void;
  onTranscript: (transcript: string) => Promise<void> | void;
  onError?: (message: string) => void;
}

interface UseVoiceSessionResult {
  status: VoiceStatus;
  isSupported: boolean;
  isMuted: boolean;
  lastTranscript: string;
  error: string | null;
  setMuted: (muted: boolean) => void;
  captureCommand: (options?: { force?: boolean }) => Promise<void>;
}

type BrowserSpeechRecognition = InstanceType<
  NonNullable<ReturnType<typeof getSpeechRecognitionConstructor>>
>;

type VoiceWakeEvent = {
  phrase: string;
  source: "manual" | "wake-word" | "always-listen";
  transcript?: string;
};

type VoiceActivityStats = {
  activeMs: number;
  peak: number;
};

type VoiceActivityMonitor = {
  stop: () => void;
  getStats: () => VoiceActivityStats;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export function useVoiceSession({
  enabled,
  wakeWords,
  language,
  listenMode,
  manualWakeActive,
  awakeResetKey,
  commandDurationMs = 5000,
  suppressPureWakeWordTranscript = true,
  shouldHandleSleepingTranscript,
  onWake,
  onTranscript,
  onError,
}: UseVoiceSessionOptions): UseVoiceSessionResult {
  const hasElevenLabsKey = useAppStore((s) => s.hasElevenLabsKey);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isMuted, setMuted] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCapturingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const speechRecognitionBlockedRef = useRef(false);
  const isAwakeRef = useRef(false);
  const isAssistantSpeakingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onWakeRef = useRef(onWake);
  const onErrorRef = useRef(onError);
  const shouldHandleSleepingTranscriptRef = useRef(shouldHandleSleepingTranscript);
  const isSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (!!getSpeechRecognitionConstructor() || typeof MediaRecorder !== "undefined");

  const voiceT = useCallback(
    (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng: language, ...options }),
    [language],
  );

  const notifyMissingElevenLabsKey = useCallback(() => {
    const message = voiceT("voice.elevenLabsKeyRequired");
    setError(message);
    setStatus("error");
    onErrorRef.current?.(message);
  }, [voiceT]);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onWakeRef.current = onWake;
    onErrorRef.current = onError;
    shouldHandleSleepingTranscriptRef.current = shouldHandleSleepingTranscript;
  }, [onTranscript, onWake, onError, shouldHandleSleepingTranscript]);

  useEffect(() => {
    isAwakeRef.current = false;
    if (enabled && !isMuted && listenMode === "wake-word") {
      setStatus("listening");
    }
  }, [awakeResetKey, enabled, isMuted, listenMode]);

  const clearAssistantResumeTimer = useCallback(() => {
    if (assistantResumeTimerRef.current) {
      clearTimeout(assistantResumeTimerRef.current);
      assistantResumeTimerRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  const restartRecognition = useCallback(() => {
    if (
      !shouldListenRef.current ||
      speechRecognitionBlockedRef.current ||
      isCapturingRef.current ||
      isMuted ||
      isAssistantSpeakingRef.current
    ) {
      return;
    }
    if (!recognitionRef.current) {
      setStatus("idle");
      return;
    }
    try {
      recognitionRef.current.start();
      setStatus(isAwakeRef.current ? "awake" : "listening");
    } catch (error) {
      if (isSpeechRecognitionPolicyError(error)) {
        speechRecognitionBlockedRef.current = true;
        setStatus("idle");
        return;
      }
      restartTimerRef.current = setTimeout(restartRecognition, 600);
    }
  }, [isMuted]);

  useEffect(() => {
    const handleAssistantSpeaking = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active: boolean }>).detail.active);
      isAssistantSpeakingRef.current = active;
      clearAssistantResumeTimer();

      if (active) {
        stopRecognition();
        if (!isCapturingRef.current) setStatus("speaking");
        return;
      }

      if (shouldListenRef.current && !isCapturingRef.current && !isMuted) {
        assistantResumeTimerRef.current = setTimeout(restartRecognition, 250);
      }
    };

    window.addEventListener("cooktalk:assistant-speaking", handleAssistantSpeaking);
    return () => {
      window.removeEventListener("cooktalk:assistant-speaking", handleAssistantSpeaking);
      clearAssistantResumeTimer();
    };
  }, [clearAssistantResumeTimer, isMuted, restartRecognition, stopRecognition]);

  const captureCommand = useCallback(
    async (options?: { force?: boolean }) => {
      if (isCapturingRef.current) return;
      if (!hasElevenLabsKey) {
        notifyMissingElevenLabsKey();
        return;
      }
      if (isMuted && !options?.force) return;
      if (isMuted && options?.force) setMuted(false);
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        setError(voiceT("voice.micUnsupported"));
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        setStatus("unsupported");
        setError(voiceT("voice.micUnsupported"));
        return;
      }

      isCapturingRef.current = true;
      stopRecognition();
      setStatus("recording");
      setError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        const voiceActivity = startVoiceActivityMonitor(stream);

        const mimeType = getSupportedAudioMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;
        const chunks: Blob[] = [];

        const audioBlob = await new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.onerror = () => reject(new Error(voiceT("voice.recordingFailed")));
          recorder.onstop = () => {
            const type = recorder.mimeType || mimeType || "audio/webm";
            resolve(new Blob(chunks, { type }));
          };
          recorder.start();
          window.setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, commandDurationMs);
        });

        voiceActivity.stop();
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (!hasEnoughVoiceActivity(voiceActivity.getStats(), audioBlob)) {
          throw new Error(voiceT("voice.noClearSpeech"));
        }

        setStatus("transcribing");

        const transcript = (await transcribeWithElevenLabs(audioBlob, language)).trim();
        if (!isMeaningfulSpeechPhrase(transcript)) throw new Error(voiceT("voice.noCommandHeard"));
        setLastTranscript(transcript);
        setStatus("thinking");
        await onTranscriptRef.current(transcript);
      } catch (err) {
        const message = getMicrophoneErrorMessage(err, language, voiceT);
        setError(message);
        setStatus("error");
        onErrorRef.current?.(message);
      } finally {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        isCapturingRef.current = false;
        if (shouldListenRef.current && !isMuted) {
          restartTimerRef.current = setTimeout(restartRecognition, 800);
        }
      }
    },
    [
      commandDurationMs,
      hasElevenLabsKey,
      isMuted,
      language,
      notifyMissingElevenLabsKey,
      restartRecognition,
      stopRecognition,
      voiceT,
    ],
  );

  useEffect(() => {
    const wakeManually = () => {
      if (!enabled || isMuted) return;
      if (isCapturingRef.current) return;
      isAwakeRef.current = true;
      setError(null);
      setStatus("awake");
      onWakeRef.current?.({ phrase: "manual", source: "manual" });
      void captureCommand({ force: true });
    };

    window.addEventListener("cooktalk:manual-wake", wakeManually);
    if (manualWakeActive) wakeManually();

    return () => window.removeEventListener("cooktalk:manual-wake", wakeManually);
  }, [captureCommand, enabled, isMuted, manualWakeActive]);

  useEffect(() => {
    speechRecognitionBlockedRef.current = false;
    shouldListenRef.current = enabled && !isMuted;
    if (!enabled || isMuted) {
      isAwakeRef.current = false;
      stopRecognition();
      setStatus("idle");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    if (!Recognition) {
      setStatus("idle");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = language === "zh" ? "zh-CN" : "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let phrase = "";
      for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript) phrase += result[0].transcript;
      }
      phrase = phrase.trim();
      if (!phrase) return;
      if (!isMeaningfulSpeechPhrase(phrase)) return;
      if (isAssistantSpeakingRef.current) return;

      setLastTranscript(phrase);
      if (listenMode === "always") {
        const transcript = getCommandTranscript(phrase, wakeWords);
        onWakeRef.current?.({ phrase, source: "always-listen", transcript });
        if (transcript) void onTranscriptRef.current(transcript);
        return;
      }

      if (isAwakeRef.current) {
        setStatus("awake");
        const transcript = getCommandTranscript(phrase, wakeWords);
        if (transcript) void onTranscriptRef.current(transcript);
        return;
      }

      const hasMatchedWakeWord = hasWakeWord(phrase, wakeWords);
      if (!hasMatchedWakeWord) {
        const transcript = getCommandTranscript(phrase, wakeWords);
        if (shouldHandleSleepingTranscriptRef.current?.(transcript || phrase, phrase)) {
          void onTranscriptRef.current(transcript || phrase);
        }
        return;
      }

      if (hasMatchedWakeWord) {
        const transcript = getCommandTranscript(phrase, wakeWords);
        isAwakeRef.current = true;
        onWakeRef.current?.({ phrase, source: "wake-word", transcript });
        setStatus("awake");
        if (transcript) {
          void onTranscriptRef.current(transcript);
          return;
        }
        if (!suppressPureWakeWordTranscript) {
          void onTranscriptRef.current(phrase);
        }
      }
    };

    recognition.onerror = (event) => {
      if (["no-speech", "aborted"].includes(event.error)) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        speechRecognitionBlockedRef.current = true;
        stopRecognition();
      }
      const message =
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? i18n.t("voice.micDenied", { lng: language })
          : i18n.t("voice.listeningError", { error: event.error, lng: language });
      setError(message);
      onErrorRef.current?.(message);
    };

    recognition.onend = () => {
      if (
        shouldListenRef.current &&
        !speechRecognitionBlockedRef.current &&
        !isCapturingRef.current &&
        !isMuted &&
        !isAssistantSpeakingRef.current
      ) {
        restartTimerRef.current = setTimeout(restartRecognition, 500);
      }
    };

    restartRecognition();

    return () => {
      shouldListenRef.current = false;
      isAwakeRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      stopRecognition();
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, [
    enabled,
    isMuted,
    language,
    listenMode,
    restartRecognition,
    stopRecognition,
    suppressPureWakeWordTranscript,
    wakeWords,
  ]);

  return {
    status,
    isSupported,
    isMuted,
    lastTranscript,
    error,
    setMuted,
    captureCommand,
  };
}

function getCommandTranscript(phrase: string, wakeWords: string[]): string {
  const transcript = stripWakeWords(phrase, wakeWords);
  if (transcript) return transcript;
  return hasWakeWord(phrase, wakeWords) ? "" : phrase;
}

function getSupportedAudioMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function startVoiceActivityMonitor(stream: MediaStream): VoiceActivityMonitor {
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return {
      stop: () => undefined,
      getStats: () => ({ activeMs: 1_000, peak: 1 }),
    };
  }

  const context = new AudioContextConstructor();
  const analyser = context.createAnalyser();
  const source = context.createMediaStreamSource(stream);
  analyser.fftSize = 1024;
  const samples = new Uint8Array(analyser.frequencyBinCount);
  let animationFrame = 0;
  let activeMs = 0;
  let peak = 0;
  let lastTime = performance.now();
  let stopped = false;

  source.connect(analyser);

  const tick = () => {
    if (stopped) return;

    analyser.getByteTimeDomainData(samples);
    let total = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      total += normalized * normalized;
    }

    const rms = Math.sqrt(total / samples.length);
    const now = performance.now();
    const elapsed = now - lastTime;
    lastTime = now;

    if (rms >= 0.025) activeMs += elapsed;
    peak = Math.max(peak, rms);
    animationFrame = window.requestAnimationFrame(tick);
  };

  tick();

  return {
    stop: () => {
      stopped = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      source.disconnect();
      void context.close().catch(() => undefined);
    },
    getStats: () => ({ activeMs, peak }),
  };
}

function hasEnoughVoiceActivity(stats: VoiceActivityStats, blob: Blob): boolean {
  return blob.size > 1_000 && stats.activeMs >= 320 && stats.peak >= 0.035;
}

function getMicrophoneErrorMessage(
  error: unknown,
  language: "en" | "zh",
  voiceT: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (isMicrophonePermissionError(error)) {
    return voiceT("voice.micDenied");
  }

  if (isSpeechRecognitionPolicyError(error)) {
    return voiceT("voice.micDenied");
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return language === "zh"
      ? "没有找到可用的麦克风。"
      : "No available microphone was found.";
  }

  if (error instanceof DOMException && error.name === "NotReadableError") {
    return language === "zh"
      ? "麦克风暂时不可用，请确认没有被其他应用占用。"
      : "The microphone is unavailable. Check whether another app is using it.";
  }

  return error instanceof Error ? error.message : voiceT("voice.recognitionFailed");
}

function isMicrophonePermissionError(error: unknown): boolean {
  if (!(error instanceof DOMException || error instanceof Error)) return false;
  return ["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(error.name);
}

function isSpeechRecognitionPolicyError(error: unknown): boolean {
  if (!(error instanceof DOMException || error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    ["NotAllowedError", "SecurityError", "InvalidStateError"].includes(error.name) ||
    message.includes("not allowed by the user agent") ||
    message.includes("current context") ||
    message.includes("denied permission")
  );
}

function isMeaningfulSpeechPhrase(phrase: string): boolean {
  const normalized = phrase
    .replace(/[，。！？、,.!?\s]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (/^(嗯+|啊+|呃+|额+|唔+|哦+|噢+|um+|uh+|er+)$/i.test(normalized)) return false;
  return true;
}
