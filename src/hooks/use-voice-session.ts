import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionConstructor,
  hasWakeWord,
  stripWakeWords,
  transcribeWithElevenLabs,
  type VoiceStatus,
} from "@/lib/voice-pipeline";
import { useAppStore } from "@/stores/app-store";

interface UseVoiceSessionOptions {
  enabled: boolean;
  wakeWords: string[];
  language: "en" | "zh";
  listenMode: "always" | "wake-word";
  manualWakeActive: boolean;
  awakeResetKey?: string | number | boolean;
  commandDurationMs?: number;
  preserveWakeWordsInTranscript?: boolean;
  suppressPureWakeWordTranscript?: boolean;
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
  preserveWakeWordsInTranscript = false,
  suppressPureWakeWordTranscript = true,
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
  const isCapturingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const isAwakeRef = useRef(false);
  const isAssistantSpeakingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onWakeRef = useRef(onWake);
  const onErrorRef = useRef(onError);
  const isSupported =
    typeof navigator !== "undefined" &&
    !!getSpeechRecognitionConstructor() &&
    !!navigator.mediaDevices?.getUserMedia;

  const notifyMissingElevenLabsKey = useCallback(() => {
    const message = "请先在设置里配置 ElevenLabs API Key，才能使用对话。";
    setError(message);
    setStatus("error");
    onErrorRef.current?.(message);
  }, []);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onWakeRef.current = onWake;
    onErrorRef.current = onError;
  }, [onTranscript, onWake, onError]);

  useEffect(() => {
    isAwakeRef.current = false;
    if (enabled && !isMuted && listenMode === "wake-word") {
      setStatus("listening");
    }
  }, [awakeResetKey, enabled, isMuted, listenMode]);

  useEffect(() => {
    const handleAssistantSpeaking = (event: Event) => {
      isAssistantSpeakingRef.current = Boolean(
        (event as CustomEvent<{ active: boolean }>).detail.active,
      );
    };

    window.addEventListener("cooktalk:assistant-speaking", handleAssistantSpeaking);
    return () => window.removeEventListener("cooktalk:assistant-speaking", handleAssistantSpeaking);
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
    if (!shouldListenRef.current || isCapturingRef.current || isMuted) return;
    try {
      recognitionRef.current?.start();
      setStatus(isAwakeRef.current ? "awake" : "listening");
    } catch {
      restartTimerRef.current = setTimeout(restartRecognition, 600);
    }
  }, [isMuted]);

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
        setError("当前浏览器不支持麦克风录音。");
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
          recorder.onerror = () => reject(new Error("录音失败，请检查麦克风权限。"));
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
          throw new Error("没有检测到清晰语音，请靠近麦克风后再说一次。");
        }

        setStatus("transcribing");

        const transcript = (await transcribeWithElevenLabs(audioBlob)).trim();
        if (!isMeaningfulSpeechPhrase(transcript)) throw new Error("没有听清指令，请再说一次。");
        setLastTranscript(transcript);
        setStatus("thinking");
        await onTranscriptRef.current(transcript);
      } catch (err) {
        const message = err instanceof Error ? err.message : "语音识别失败，请稍后重试。";
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
      notifyMissingElevenLabsKey,
      restartRecognition,
      stopRecognition,
    ],
  );

  useEffect(() => {
    const wakeManually = () => {
      if (!enabled || isMuted) return;
      isAwakeRef.current = true;
      setError(null);
      setStatus("awake");
      onWakeRef.current?.({ phrase: "manual", source: "manual" });
      restartRecognition();
    };

    window.addEventListener("cooktalk:manual-wake", wakeManually);
    if (manualWakeActive) wakeManually();

    return () => window.removeEventListener("cooktalk:manual-wake", wakeManually);
  }, [enabled, isMuted, manualWakeActive, restartRecognition]);

  useEffect(() => {
    shouldListenRef.current = enabled && !isMuted;
    if (!enabled || isMuted) {
      isAwakeRef.current = false;
      stopRecognition();
      setStatus("idle");
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (typeof navigator === "undefined" || !Recognition || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
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
        if (!hasElevenLabsKey) {
          notifyMissingElevenLabsKey();
          return;
        }
        onWakeRef.current?.({ phrase, source: "always-listen", transcript: phrase });
        const transcript = preserveWakeWordsInTranscript
          ? phrase
          : stripWakeWords(phrase, wakeWords) || phrase;
        void onTranscriptRef.current(transcript);
        return;
      }

      if (isAwakeRef.current) {
        if (!hasElevenLabsKey) {
          notifyMissingElevenLabsKey();
          return;
        }
        setStatus("awake");
        const transcript = preserveWakeWordsInTranscript
          ? phrase
          : stripWakeWords(phrase, wakeWords) || phrase;
        void onTranscriptRef.current(transcript);
        return;
      }

      if (hasWakeWord(phrase, wakeWords)) {
        if (!hasElevenLabsKey) {
          notifyMissingElevenLabsKey();
          return;
        }
        const transcript = preserveWakeWordsInTranscript ? phrase : stripWakeWords(phrase, wakeWords);
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
      const message =
        event.error === "not-allowed" ? "麦克风权限被拒绝。" : `语音监听异常：${event.error}`;
      setError(message);
      onErrorRef.current?.(message);
    };

    recognition.onend = () => {
      if (shouldListenRef.current && !isCapturingRef.current && !isMuted) {
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
    hasElevenLabsKey,
    isMuted,
    language,
    listenMode,
    notifyMissingElevenLabsKey,
    preserveWakeWordsInTranscript,
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

function isMeaningfulSpeechPhrase(phrase: string): boolean {
  const normalized = phrase
    .replace(/[，。！？、,.!?\s]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (/^(嗯+|啊+|呃+|额+|唔+|哦+|噢+|um+|uh+|er+)$/i.test(normalized)) return false;
  return true;
}
