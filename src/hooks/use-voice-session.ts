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
  commandDurationMs?: number;
  onWake?: (phrase: string) => void;
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

export function useVoiceSession({
  enabled,
  wakeWords,
  language,
  listenMode,
  manualWakeActive,
  commandDurationMs = 5000,
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
      setStatus("listening");
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

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStatus("transcribing");

        const transcript = (await transcribeWithElevenLabs(audioBlob)).trim();
        if (!transcript) throw new Error("没有听清指令，请再说一次。");
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
    [commandDurationMs, hasElevenLabsKey, isMuted, notifyMissingElevenLabsKey, restartRecognition, stopRecognition],
  );

  useEffect(() => {
    const wakeManually = () => {
      if (!enabled || isMuted) return;
      onWakeRef.current?.("manual");
      void captureCommand({ force: true });
    };

    window.addEventListener("cooktalk:manual-wake", wakeManually);
    if (manualWakeActive) wakeManually();

    return () => window.removeEventListener("cooktalk:manual-wake", wakeManually);
  }, [captureCommand, enabled, isMuted, manualWakeActive]);

  useEffect(() => {
    shouldListenRef.current = enabled && !isMuted;
    if (!enabled || isMuted) {
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

      setLastTranscript(phrase);
      if (listenMode === "always") {
        if (!hasElevenLabsKey) {
          notifyMissingElevenLabsKey();
          return;
        }
        onWakeRef.current?.("always-listen");
        void onTranscriptRef.current(stripWakeWords(phrase, wakeWords) || phrase);
        return;
      }

      if (hasWakeWord(phrase, wakeWords)) {
        if (!hasElevenLabsKey) {
          notifyMissingElevenLabsKey();
          return;
        }
        onWakeRef.current?.(phrase);
        setStatus("awake");
        void captureCommand({ force: true });
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
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      stopRecognition();
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, [
    captureCommand,
    enabled,
    hasElevenLabsKey,
    isMuted,
    language,
    listenMode,
    notifyMissingElevenLabsKey,
    restartRecognition,
    stopRecognition,
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
