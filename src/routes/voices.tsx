import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  AlertCircle,
  ChevronDown,
  Pause,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Mic,
  StopCircle,
  Upload,
  CheckCircle2,
  X,
  MessageCircle,
  ChefHat,
} from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, addVoice, deleteVoice, getVoicePreviewAudio, saveVoicePreviewAudio } from "@/lib/db";
import type { Voice } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { getApiKey } from "@/lib/crypto";
import { promptConfigureApiKey } from "@/lib/api-key-prompts";
import i18n from "@/lib/i18n";
import {
  formatElevenLabsVoiceDisplayLabel,
  getElevenLabsVoiceGender,
  getElevenLabsVoicePreviewUrl,
  useElevenLabsVoices,
} from "@/hooks/use-elevenlabs-voices";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppTooltip } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { claimVoicePlayback, type VoicePlaybackHandle } from "@/lib/voice-playback";
import { normalizeSpeechText } from "@/lib/voice-pipeline";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/voices")({
  head: () => ({
    meta: [
      { title: `${i18n.t("voices.title")} — CookTalk` },
      {
        name: "description",
        content: i18n.t("voices.metaDescription"),
      },
    ],
  }),
  component: VoicesPage,
});

type CloneStep = "record" | "name" | "confirm" | "cloning" | "done";

const VOICE_CLONE_RECORDING_MIN_SECONDS = 30;
const VOICE_CLONE_RECORDING_MAX_SECONDS = 180;

type VoiceRoleButtonProps = {
  isSelected: boolean;
  label: string;
  Icon: typeof MessageCircle;
  voiceAliases?: string;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

function VoiceRoleButton({
  isSelected,
  label,
  Icon,
  voiceAliases,
  disabled = false,
  onClick,
}: VoiceRoleButtonProps) {
  const visibilityClass = isSelected
    ? "opacity-100 sm:pointer-events-auto sm:opacity-100"
    : "opacity-100 sm:pointer-events-none sm:opacity-0 sm:group-hover/voice-card:pointer-events-auto sm:group-hover/voice-card:opacity-100 sm:group-focus-within/voice-card:pointer-events-auto sm:group-focus-within/voice-card:opacity-100";

  return (
    <AppTooltip content={label} side="top" align="center" disabled={disabled}>
      <button
        type="button"
        aria-pressed={isSelected}
        disabled={disabled}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border bg-secondary/90 text-foreground/80 shadow-sm backdrop-blur transition-[border-color,background-color,color,opacity,box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
          visibilityClass,
          isSelected
            ? "border-clay bg-clay text-background shadow-sm hover:border-clay hover:bg-clay"
            : "border-border/80 hover:border-clay hover:bg-secondary hover:text-clay",
        )}
        onClick={onClick}
        aria-label={label}
        data-voice-label={label}
        data-voice-aliases={voiceAliases}
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </AppTooltip>
  );
}

function VoiceRoleActionStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5", className)}>
      {children}
    </div>
  );
}

function formatRecordingDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function isVoiceCommandMatch(text: string, pattern: RegExp) {
  return pattern.test(normalizeSpeechText(text));
}

function getSpokenVoiceName(transcript: string): string {
  const cleaned = transcript
    .trim()
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .trim();
  const namedMatch = cleaned.match(
    /^(?:命名为|名字叫|叫做|名称为|name(?: it)?|call(?: it)?)\s*["'“”‘’]?(.+?)["'“”‘’]?$/i,
  );
  return (namedMatch?.[1] ?? cleaned)
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .trim();
}

function isCloneNameControlCommand(text: string): boolean {
  return isVoiceCommandMatch(
    text,
    /^(?:返回|上一步|back|previous|继续|下一步|确认|同意|我同意|完成|结束|continue|next|confirm|agree|i agree|done|finish|finished)$/i,
  );
}

function VoicesPage() {
  const { i18n: activeI18n, t } = useTranslation();
  const navigate = useNavigate();
  const clonedVoices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];
  const conversationVoiceId = useAppStore((s) => s.conversationVoiceId);
  const cookingVoiceId = useAppStore((s) => s.cookingVoiceId);
  const setConversationVoiceId = useAppStore((s) => s.setConversationVoiceId);
  const setCookingVoiceId = useAppStore((s) => s.setCookingVoiceId);
  const {
    voices: elevenLabsVoices,
    isLoading: isLoadingElevenLabsVoices,
    error: elevenLabsVoicesError,
    hasElevenLabsKey,
  } = useElevenLabsVoices();

  // Clone dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [cloneStep, setCloneStep] = useState<CloneStep>("record");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  // Playback state
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [loadingPreviewKey, setLoadingPreviewKey] = useState<string | null>(null);
  const [pausedPreviewKey, setPausedPreviewKey] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackHandleRef = useRef<VoicePlaybackHandle | null>(null);
  const previewRunRef = useRef(0);
  const previewObjectUrlCacheRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRecordingOnStopRef = useRef(false);
  const maxRecordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = `${t("voices.title")} - CookTalk`;
  }, [t, activeI18n.language]);

  const audioBlob = recordedAudio ?? uploadedAudio;
  const isRecordedAudioLongEnough =
    !recordedAudio || recordingTime >= VOICE_CLONE_RECORDING_MIN_SECONDS;
  const canContinueWithAudio = Boolean(audioBlob) && isRecordedAudioLongEnough;
  const clonedVoiceLanguage = activeI18n.language.startsWith("zh") ? "zh" : "en";
  const formatClonedVoiceDescription = (voice: Voice) => {
    const languageLabel = voice.language
      ? t(`voices.languages.${voice.language}`, { defaultValue: voice.language })
      : t("common.unknown");
    const description =
      voice.description === "Cloned voice" ? t("voices.clonedVoice") : voice.description;

    return `${languageLabel} · ${description || t("voices.clonedVoice")}`;
  };

  // ── Dialog helpers ───────────────────────────────────────────────────────────

  const getClonedPreviewKey = (voice: Voice) =>
    `cloned:${voice.elevenLabsVoiceId}:${activeI18n.language}`;
  const getClonedPreviewOwnerKey = (voice: Voice) => `cloned:${voice.id}`;
  const getPresetPreviewKey = (voiceId: string, previewUrl: string | null) =>
    previewUrl
      ? `preset:${voiceId}:url:${previewUrl}`
      : `preset:${voiceId}:tts:${activeI18n.language}`;
  const handleCardKeyDown = (event: KeyboardEvent, preview: () => void) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    preview();
  };
  const stopCardPreview = (event: MouseEvent) => event.stopPropagation();

  const openCloneDialog = () => {
    if (!hasElevenLabsKey) {
      promptConfigureApiKey("elevenlabs", t, navigate);
      return;
    }

    setShowDialog(true);
    setCloneStep("record");
    setIsRecording(false);
    setRecordedAudio(null);
    setUploadedAudio(null);
    setVoiceName("");
    setRecordingTime(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeCloneDialog = () => {
    stopRecording(true);
    setShowDialog(false);
  };

  // ── Recording ────────────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      discardRecordingOnStopRef.current = false;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const shouldDiscard = discardRecordingOnStopRef.current;
        discardRecordingOnStopRef.current = false;
        const startedAt = recordingStartedAtRef.current;
        const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : recordingTime;
        const cappedDuration = Math.min(duration, VOICE_CLONE_RECORDING_MAX_SECONDS);
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (maxRecordingTimeoutRef.current) clearTimeout(maxRecordingTimeoutRef.current);
        timerRef.current = null;
        maxRecordingTimeoutRef.current = null;
        recordingStartedAtRef.current = null;
        if (shouldDiscard) return;

        setRecordedAudio(new Blob(chunks, { type: "audio/webm" }));
        setRecordingTime(cappedDuration);
        if (cappedDuration < VOICE_CLONE_RECORDING_MIN_SECONDS) {
          toast.error(t("voices.recordingTooShort"));
        } else if (cappedDuration >= VOICE_CLONE_RECORDING_MAX_SECONDS) {
          toast.info(t("voices.recordingMaxReached"));
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordedAudio(null);
      setUploadedAudio(null);
      setRecordingTime(0);
      recordingStartedAtRef.current = Date.now();
      if (fileInputRef.current) fileInputRef.current.value = "";

      timerRef.current = setInterval(() => {
        const startedAt = recordingStartedAtRef.current;
        if (!startedAt) return;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setRecordingTime(Math.min(elapsed, VOICE_CLONE_RECORDING_MAX_SECONDS));
      }, 1000);

      maxRecordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, VOICE_CLONE_RECORDING_MAX_SECONDS * 1000);
    } catch {
      toast.error(t("voices.micDenied"));
    }
  };

  const stopRecording = (discard = false) => {
    if (mediaRecorderRef.current?.state === "recording") {
      discardRecordingOnStopRef.current = discard;
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    if (maxRecordingTimeoutRef.current) clearTimeout(maxRecordingTimeoutRef.current);
    timerRef.current = null;
    maxRecordingTimeoutRef.current = null;
    setIsRecording(false);
  };

  const handleAudioUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedAudio(file);
      setRecordedAudio(null);
      setRecordingTime(0);
    }
  };

  // ── Clone API ────────────────────────────────────────────────────────────────

  const handleCloneVoice = async () => {
    if (!audioBlob || !voiceName.trim()) return;
    setCloneStep("cloning");
    try {
      const apiKey = await getApiKey("elevenlabs");
      if (!apiKey) {
        promptConfigureApiKey("elevenlabs", t, navigate);
        throw new Error(t("voices.elevenLabsKeyMissingFull"));
      }

      const service = new ElevenLabsService(apiKey);
      const result = await service.cloneVoice(voiceName.trim(), [audioBlob]);

      await addVoice({
        name: voiceName.trim(),
        elevenLabsVoiceId: result.voice_id,
        isCloned: true,
        isDefault: false,
        language: clonedVoiceLanguage,
        description: "Cloned voice",
        sampleBlob: audioBlob,
      });

      setCloneStep("done");
      toast.success(t("voices.cloneSuccessWithName", { name: voiceName.trim() }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("voices.cloneFailed");
      toast.error(msg);
      setCloneStep("confirm");
    }
  };

  // ── Playback ─────────────────────────────────────────────────────────────────

  const stopAudio = useCallback((cancelPending = true) => {
    if (cancelPending) previewRunRef.current += 1;
    playbackHandleRef.current?.stop();
    playbackHandleRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setActivePreviewKey(null);
    setLoadingPreviewKey(null);
    setPausedPreviewKey(null);
  }, []);

  const getCachedPreviewUrl = useCallback(
    async (
      cacheKey: string,
      ownerKey: string,
      createBlob: () => Promise<Blob>,
    ): Promise<string> => {
      const cachedObjectUrl = previewObjectUrlCacheRef.current.get(cacheKey);
      if (cachedObjectUrl) return cachedObjectUrl;

      let previewBlob = await getVoicePreviewAudio(cacheKey);
      if (!previewBlob) {
        previewBlob = await createBlob();
        await saveVoicePreviewAudio({
          key: cacheKey,
          ownerKey,
          audioBlob: previewBlob,
        });
      }

      const objectUrl = URL.createObjectURL(previewBlob);
      previewObjectUrlCacheRef.current.set(cacheKey, objectUrl);
      return objectUrl;
    },
    [],
  );

  const toggleCurrentPreview = useCallback(
    async (previewKey: string) => {
      if (loadingPreviewKey === previewKey) {
        stopAudio();
        return true;
      }
      if (!audioRef.current) return false;
      if (activePreviewKey === previewKey) {
        audioRef.current.pause();
        setActivePreviewKey(null);
        setPausedPreviewKey(previewKey);
        return true;
      }
      if (pausedPreviewKey === previewKey) {
        await audioRef.current.play();
        setPausedPreviewKey(null);
        setActivePreviewKey(previewKey);
        return true;
      }
      return false;
    },
    [activePreviewKey, loadingPreviewKey, pausedPreviewKey, stopAudio],
  );

  useEffect(() => {
    const cachedPreviewUrls = previewObjectUrlCacheRef.current;

    return () => {
      stopAudio();
      cachedPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      cachedPreviewUrls.clear();
    };
  }, [stopAudio]);

  const handlePreviewVoice = async (voice: Voice) => {
    if (!voice.elevenLabsVoiceId) {
      toast.error(t("voices.missingElevenLabsVoiceId"));
      return;
    }

    try {
      const previewKey = getClonedPreviewKey(voice);
      if (await toggleCurrentPreview(previewKey)) return;

      const runId = previewRunRef.current + 1;
      previewRunRef.current = runId;
      stopAudio(false);
      setLoadingPreviewKey(previewKey);

      const url = await getCachedPreviewUrl(
        previewKey,
        getClonedPreviewOwnerKey(voice),
        async () => {
          const apiKey = await getApiKey("elevenlabs");
          if (!apiKey) {
            promptConfigureApiKey("elevenlabs", t, navigate);
            throw new Error(t("voices.elevenLabsKeyMissingShort"));
          }

          return new ElevenLabsService(apiKey).textToSpeech(
            t("voices.previewText"),
            voice.elevenLabsVoiceId!,
          );
        },
      );

      const audio = new Audio(url);
      audio.preload = "auto";
      if (previewRunRef.current !== runId) {
        return;
      }
      audioRef.current = audio;
      const finish = () => {
        if (previewRunRef.current !== runId) return;
        setLoadingPreviewKey(null);
        setPausedPreviewKey(null);
        setActivePreviewKey(null);
        if (audioRef.current === audio) audioRef.current = null;
        playbackHandleRef.current = null;
      };
      const playback = claimVoicePlayback(audio, {
        signalAssistantSpeaking: false,
        onStop: finish,
      });
      playbackHandleRef.current = playback;
      audio.onended = () => {
        playback.release();
        finish();
      };
      audio.onerror = () => {
        playback.release();
        finish();
      };
      await audio.play().catch((error: unknown) => {
        playback.release();
        throw error;
      });
      if (previewRunRef.current !== runId) {
        playback.stop();
        return;
      }
      setLoadingPreviewKey(null);
      setPausedPreviewKey(null);
      setActivePreviewKey(previewKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("voices.previewFailed"));
      setLoadingPreviewKey(null);
      setActivePreviewKey(null);
      setPausedPreviewKey(null);
    }
  };

  const handlePreviewElevenLabsVoice = async (
    voiceId: string,
    previewUrl: string | null = null,
  ) => {
    try {
      const previewKey = getPresetPreviewKey(voiceId, previewUrl);
      if (await toggleCurrentPreview(previewKey)) return;

      const runId = previewRunRef.current + 1;
      previewRunRef.current = runId;
      stopAudio(false);
      setLoadingPreviewKey(previewKey);

      const objectUrl = await getCachedPreviewUrl(previewKey, `preset:${voiceId}`, async () => {
        if (previewUrl) {
          const response = await fetch(previewUrl);
          if (!response.ok) throw new Error(t("voices.previewFailed"));
          return response.blob();
        }

        const apiKey = await getApiKey("elevenlabs");
        if (!apiKey) {
          promptConfigureApiKey("elevenlabs", t, navigate);
          throw new Error(t("voices.elevenLabsKeyMissingFull"));
        }

        return new ElevenLabsService(apiKey).textToSpeech(t("voices.previewPresetText"), voiceId);
      });

      const audio = new Audio(objectUrl);
      audio.preload = "auto";
      if (previewRunRef.current !== runId) {
        return;
      }
      audioRef.current = audio;
      const finish = () => {
        if (previewRunRef.current !== runId) return;
        setLoadingPreviewKey(null);
        setPausedPreviewKey(null);
        setActivePreviewKey(null);
        if (audioRef.current === audio) audioRef.current = null;
        playbackHandleRef.current = null;
      };
      const playback = claimVoicePlayback(audio, {
        signalAssistantSpeaking: false,
        onStop: finish,
      });
      playbackHandleRef.current = playback;
      audio.onended = () => {
        playback.release();
        finish();
      };
      audio.onerror = () => {
        playback.release();
        finish();
      };
      await audio.play().catch((error: unknown) => {
        playback.release();
        throw error;
      });
      if (previewRunRef.current !== runId) {
        playback.stop();
        return;
      }
      setLoadingPreviewKey(null);
      setPausedPreviewKey(null);
      setActivePreviewKey(previewKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("voices.previewFailed"));
      setLoadingPreviewKey(null);
      setActivePreviewKey(null);
      setPausedPreviewKey(null);
    }
  };

  // ── Voice management ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string, name: string) => {
    await deleteVoice(id);
    toast.success(t("voices.deleteSuccess", { name }));
  };

  const handleSetConversationVoice = (voiceId: string, name: string) => {
    if (conversationVoiceId === voiceId) {
      toast.success(t("voices.conversationVoiceSuccess", { name }));
      return;
    }

    setConversationVoiceId(voiceId);
    toast.success(t("voices.conversationVoiceSuccess", { name }));
  };

  const handleSetCookingVoice = (voiceId: string, name: string) => {
    if (cookingVoiceId === voiceId) {
      toast.success(t("voices.cookingVoiceSuccess", { name }));
      return;
    }

    setCookingVoiceId(voiceId);
    toast.success(t("voices.cookingVoiceSuccess", { name }));
  };

  const getVisibleVoiceTargets = useCallback(() => {
    const clonedTargets = clonedVoices
      .filter((voice) => voice.elevenLabsVoiceId)
      .map((voice, index) => ({
        kind: "cloned" as const,
        voiceId: voice.elevenLabsVoiceId!,
        name: voice.name,
        index,
        preview: () => void handlePreviewVoice(voice),
      }));

    const presetTargets = elevenLabsVoices.map((voice, index) => ({
      kind: "preset" as const,
      voiceId: voice.voice_id,
      name: voice.name,
      index,
      preview: () =>
        void handlePreviewElevenLabsVoice(voice.voice_id, getElevenLabsVoicePreviewUrl(voice)),
    }));

    return [...clonedTargets, ...presetTargets];
  }, [clonedVoices, elevenLabsVoices, handlePreviewElevenLabsVoice, handlePreviewVoice]);

  const findVoiceTarget = useCallback(
    (text: string) => {
      const normalized = normalizeSpeechText(text);
      const allTargets = getVisibleVoiceTargets();
      const numberMatch =
        normalized.match(/(?:第\s*)?([0-9]+)\s*(?:个|号|项|条|张)?/) ??
        normalized.match(/(?:number|voice)\s*([0-9]+)/i);
      if (numberMatch?.[1]) {
        const index = Number(numberMatch[1]) - 1;
        return allTargets[index] ?? null;
      }

      const compactText = normalized.replace(/\s+/g, "").toLowerCase();
      return (
        allTargets.find((target) => {
          const compactName = target.name.replace(/\s+/g, "").toLowerCase();
          return compactName.length > 0 && compactText.includes(compactName);
        }) ?? null
      );
    },
    [getVisibleVoiceTargets],
  );

  const handlePageVoiceCommand = useCallback(
    (event: Event) => {
      const customEvent = event as CustomEvent<{ transcript?: string; action?: string }>;
      const transcript = customEvent.detail?.transcript ?? "";
      const text = normalizeSpeechText(transcript);
      const pageAction = customEvent.detail?.action;

      if (
        !showDialog &&
        (pageAction === "clone-voice" ||
          isVoiceCommandMatch(
            text,
            /(添加|新增|克隆).*(声音|音色|voice)|clone.*voice|add.*voice|new.*voice/i,
          ))
      ) {
        customEvent.preventDefault();
        openCloneDialog();
        return;
      }

      if (
        isVoiceCommandMatch(
          text,
          /(暂停|停止|停一下|stop|pause).*(试听|播放|音频|声音|音色|preview|audio|voice)|^(暂停|停止|pause|stop)$/i,
        )
      ) {
        customEvent.preventDefault();
        stopAudio();
        return;
      }

      if (showDialog) {
        if (cloneStep === "record") {
          if (isVoiceCommandMatch(text, /(开始|录制|录音|start|record)/i) && !isRecording) {
            customEvent.preventDefault();
            void startRecording();
            return;
          }

          if (
            isVoiceCommandMatch(
              text,
              /(停止|结束|完成).*(录制|录音)|stop.*record|finish.*record/i,
            ) &&
            isRecording
          ) {
            customEvent.preventDefault();
            stopRecording();
            return;
          }

          if (
            isVoiceCommandMatch(
              text,
              /(上传|选择).*(音频|文件|audio|file)|upload.*audio|choose.*audio|select.*audio/i,
            )
          ) {
            customEvent.preventDefault();
            fileInputRef.current?.click();
            return;
          }

          if (isVoiceCommandMatch(text, /(继续|下一步|continue|next)/i)) {
            customEvent.preventDefault();
            if (canContinueWithAudio) {
              setCloneStep("name");
            } else if (recordedAudio && !isRecordedAudioLongEnough) {
              toast.error(t("voices.recordingTooShort"));
            }
            return;
          }
        }

        if (cloneStep === "name") {
          if (isVoiceCommandMatch(text, /(返回|上一步|back)/i)) {
            customEvent.preventDefault();
            setCloneStep("record");
            return;
          }

          if (
            isVoiceCommandMatch(text, /(继续|下一步|确认|continue|next|confirm)/i) &&
            voiceName.trim()
          ) {
            customEvent.preventDefault();
            setCloneStep("confirm");
            return;
          }

          if (!isCloneNameControlCommand(text)) {
            const spokenName = getSpokenVoiceName(transcript);
            if (spokenName) {
              customEvent.preventDefault();
              setVoiceName(spokenName);
              return;
            }
          }
        }

        if (cloneStep === "confirm") {
          if (isVoiceCommandMatch(text, /(返回|上一步|back)/i)) {
            customEvent.preventDefault();
            setCloneStep("name");
            return;
          }

          if (
            isVoiceCommandMatch(
              text,
              /(同意|我同意|确认|授权|开始克隆|克隆|agree|i agree|agree and clone|i agree and clone|clone|confirm)/i,
            )
          ) {
            customEvent.preventDefault();
            void handleCloneVoice();
            return;
          }
        }

        if (cloneStep === "done" && isVoiceCommandMatch(text, /(完成|结束|关闭|done|finish|finished|close)/i)) {
          customEvent.preventDefault();
          closeCloneDialog();
          return;
        }

        customEvent.preventDefault();
        return;
      }

      const target = findVoiceTarget(text);
      if (!target) return;

      if (isVoiceCommandMatch(text, /(设为|设置为|用作|切换为|选择).*(对话|聊天|conversation)/i)) {
        customEvent.preventDefault();
        handleSetConversationVoice(target.voiceId, target.name);
        return;
      }

      if (
        isVoiceCommandMatch(text, /(设为|设置为|用作|切换为|选择).*(烹饪|做菜|朗读|cooking|cook)/i)
      ) {
        customEvent.preventDefault();
        handleSetCookingVoice(target.voiceId, target.name);
        return;
      }

      if (isVoiceCommandMatch(text, /(播放|预览|试听|打开|play|preview)/i)) {
        customEvent.preventDefault();
        target.preview();
      }
    },
    [
      canContinueWithAudio,
      cloneStep,
      closeCloneDialog,
      findVoiceTarget,
      handleCloneVoice,
      handleSetConversationVoice,
      handleSetCookingVoice,
      isRecordedAudioLongEnough,
      isRecording,
      openCloneDialog,
      recordedAudio,
      showDialog,
      startRecording,
      stopAudio,
      stopRecording,
      t,
      voiceName,
    ],
  );

  useEffect(() => {
    window.addEventListener("cooktalk:voice-command", handlePageVoiceCommand);
    window.addEventListener("cooktalk:voice-page-action", handlePageVoiceCommand);
    return () => {
      window.removeEventListener("cooktalk:voice-command", handlePageVoiceCommand);
      window.removeEventListener("cooktalk:voice-page-action", handlePageVoiceCommand);
    };
  }, [handlePageVoiceCommand]);

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container flex flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">{t("voices.title")}</h1>
          </div>
          <button
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-sm text-background hover:bg-clay sm:gap-2 sm:px-5 sm:py-2.5"
            onClick={openCloneDialog}
            type="button"
            data-voice-label={t("voices.cloneNew")}
            data-voice-aliases="添加新声音 新增声音 克隆声音 克隆新声音 add new voice clone new voice"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> {t("voices.cloneNew")}
          </button>
        </div>
      </section>

      {/* My cloned voices */}
      <section className="border-b border-border/60">
        <div className="page-content-container">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl">{t("voices.myCloned")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("voices.myClonedDesc")}</p>
            </div>
            <VoiceHint>{t("voices.voiceHint")}</VoiceHint>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {clonedVoices.map((v, i) => {
              const previewKey = getClonedPreviewKey(v);
              const isLoadingPreview = loadingPreviewKey === previewKey;
              const isPlayingPreview = activePreviewKey === previewKey;
              const isPausedPreview = pausedPreviewKey === previewKey;

              return (
                <article
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    isPlayingPreview
                      ? t("cook.pause")
                      : isPausedPreview
                        ? t("cook.resume")
                        : t("voices.preview")
                  }
                  data-voice-label={`${t("voices.preview")} ${v.name}`}
                  data-voice-aliases={`play ${v.name} preview ${v.name} pause ${v.name}`}
                  onClick={() => void handlePreviewVoice(v)}
                  onKeyDown={(event) => handleCardKeyDown(event, () => void handlePreviewVoice(v))}
                  className="group/voice-card relative flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-clay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:justify-between sm:px-5 sm:pr-36"
                >
                  <VoiceRoleActionStack className="static order-3 shrink-0 flex-row items-center sm:absolute sm:top-1/2 sm:order-none sm:-translate-y-1/2">
                    <VoiceRoleButton
                      isSelected={conversationVoiceId === v.elevenLabsVoiceId}
                      disabled={!v.elevenLabsVoiceId}
                      Icon={MessageCircle}
                      label={
                        conversationVoiceId === v.elevenLabsVoiceId
                          ? t("voices.currentConversationVoice")
                          : t("voices.setConversationVoice")
                      }
                      voiceAliases={`set ${v.name} as conversation voice`}
                      onClick={(event) => {
                        stopCardPreview(event);
                        if (v.elevenLabsVoiceId) {
                          handleSetConversationVoice(v.elevenLabsVoiceId, v.name);
                        }
                      }}
                    />
                    <VoiceRoleButton
                      isSelected={cookingVoiceId === v.elevenLabsVoiceId}
                      disabled={!v.elevenLabsVoiceId}
                      Icon={ChefHat}
                      label={
                        cookingVoiceId === v.elevenLabsVoiceId
                          ? t("voices.currentCookingVoice")
                          : t("voices.setCookingVoice")
                      }
                      voiceAliases={`set ${v.name} as cooking voice`}
                      onClick={(event) => {
                        stopCardPreview(event);
                        if (v.elevenLabsVoiceId) {
                          handleSetCookingVoice(v.elevenLabsVoiceId, v.name);
                        }
                      }}
                    />
                    <AppTooltip content={t("common.delete")} side="top" align="center">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-secondary/90 text-foreground/80 shadow-sm backdrop-blur transition-[border-color,background-color,color,opacity,box-shadow] hover:border-destructive hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:pointer-events-none sm:opacity-0 sm:group-hover/voice-card:pointer-events-auto sm:group-hover/voice-card:opacity-100 sm:group-focus-within/voice-card:pointer-events-auto sm:group-focus-within/voice-card:opacity-100"
                        aria-label={t("common.delete")}
                        data-voice-label={`${t("common.delete")} ${v.name}`}
                        data-voice-aliases={`delete ${v.name}`}
                        onClick={(event) => {
                          stopCardPreview(event);
                          void handleDelete(v.id, v.name);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </AppTooltip>
                  </VoiceRoleActionStack>

                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                    <VoiceBadge n={i + 1} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-display text-sm leading-snug sm:truncate sm:text-base">
                        {v.name}
                      </div>
                      <div className="mt-1">
                        <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] tracking-[0.08em] text-muted-foreground">
                          {formatClonedVoiceDescription(v)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="order-2 flex shrink-0 items-center gap-1 sm:order-none">
                    {isLoadingPreview ? (
                      <Loader2 className="h-4 w-4 animate-spin text-clay" strokeWidth={1.5} />
                    ) : isPlayingPreview ? (
                      <Pause className="h-4 w-4 text-clay" strokeWidth={1.5} />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ElevenLabs voices */}
      <section className="flex-1">
        <div className="page-content-container">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl">{t("voices.elevenLabsVoices")}</h2>
              <p className="text-sm text-muted-foreground">
                {hasElevenLabsKey
                  ? t("voices.elevenLabsVoicesDesc", { count: elevenLabsVoices.length })
                  : t("voices.elevenLabsVoicesLocked")}
              </p>
            </div>
            {!hasElevenLabsKey ? (
              <Link
                to="/settings"
                data-voice-label={t("voices.configureKey")}
                data-voice-aliases="配置密钥 设置密钥 ElevenLabs 密钥 configure key settings key"
                className="text-sm text-clay hover:underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.configureKey")}
              </Link>
            ) : null}
          </div>

          {!hasElevenLabsKey ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
              <p className="font-display text-xl">{t("voices.configureKeyTitle")}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                {t("voices.configureKeyBody")}
              </p>
              <Link
                to="/settings"
                data-voice-label={t("voices.configureKey")}
                data-voice-aliases="配置密钥 设置密钥 ElevenLabs 密钥 configure key settings key"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay"
              >
                <Sparkles className="h-4 w-4" strokeWidth={1.75} /> {t("voices.configureKey")}
              </Link>
            </div>
          ) : isLoadingElevenLabsVoices ? (
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              {t("voices.loadingElevenLabsVoices")}
            </div>
          ) : elevenLabsVoicesError ? (
            <div className="mt-6 rounded-2xl border border-destructive/30 bg-card px-5 py-4">
              <p className="text-sm text-destructive">{t("voices.loadElevenLabsVoicesFailed")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{elevenLabsVoicesError}</p>
            </div>
          ) : elevenLabsVoices.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
              {t("voices.noElevenLabsVoices")}
            </div>
          ) : (
            <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {elevenLabsVoices.map((voice, i) => {
                const gender = getElevenLabsVoiceGender(voice, t("common.unknown"));
                const previewUrl = getElevenLabsVoicePreviewUrl(voice);
                const previewKey = getPresetPreviewKey(voice.voice_id, previewUrl);
                const isLoadingPreview = loadingPreviewKey === previewKey;
                const isPlayingPreview = activePreviewKey === previewKey;
                const isPausedPreview = pausedPreviewKey === previewKey;

                return (
                  <div
                    key={voice.voice_id}
                    role="button"
                    tabIndex={0}
                    aria-label={
                      isPlayingPreview
                        ? t("cook.pause")
                        : isPausedPreview
                          ? t("cook.resume")
                          : t("voices.preview")
                    }
                    data-voice-label={`${t("voices.preview")} ${voice.name}`}
                    data-voice-aliases={`播放${voice.name} 试听${voice.name} 预览${voice.name} 暂停${voice.name} pause ${voice.name} play ${voice.name} preview ${voice.name}`}
                    onClick={() => void handlePreviewElevenLabsVoice(voice.voice_id, previewUrl)}
                    onKeyDown={(event) =>
                      handleCardKeyDown(
                        event,
                        () => void handlePreviewElevenLabsVoice(voice.voice_id, previewUrl),
                      )
                    }
                    className="group/voice-card relative flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-clay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:justify-between sm:px-5 sm:pr-24"
                  >
                    <VoiceRoleActionStack className="static order-3 shrink-0 flex-row items-center sm:absolute sm:top-1/2 sm:order-none sm:-translate-y-1/2">
                      <VoiceRoleButton
                        isSelected={conversationVoiceId === voice.voice_id}
                        Icon={MessageCircle}
                        label={
                          conversationVoiceId === voice.voice_id
                            ? t("voices.currentConversationVoice")
                            : t("voices.setConversationVoice")
                        }
                        voiceAliases={`设为对话音色 设置${voice.name}为对话音色 用${voice.name}对话 clear conversation voice set ${voice.name} as conversation voice`}
                        onClick={(event) => {
                          stopCardPreview(event);
                          handleSetConversationVoice(voice.voice_id, voice.name);
                        }}
                      />
                      <VoiceRoleButton
                        isSelected={cookingVoiceId === voice.voice_id}
                        Icon={ChefHat}
                        label={
                          cookingVoiceId === voice.voice_id
                            ? t("voices.currentCookingVoice")
                            : t("voices.setCookingVoice")
                        }
                        voiceAliases={`设为烹饪音色 设置${voice.name}为烹饪音色 用${voice.name}做菜 用${voice.name}朗读 set ${voice.name} as cooking voice`}
                        onClick={(event) => {
                          stopCardPreview(event);
                          handleSetCookingVoice(voice.voice_id, voice.name);
                        }}
                      />
                    </VoiceRoleActionStack>
                    <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                      <VoiceBadge n={i + 1} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-display text-sm leading-snug sm:truncate sm:text-base">
                          {voice.name}
                        </div>
                        <div className="mt-1">
                          <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            {gender}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="order-2 flex shrink-0 items-center gap-1 sm:order-none">
                      {isLoadingPreview ? (
                        <Loader2 className="h-4 w-4 animate-spin text-clay" strokeWidth={1.5} />
                      ) : isPlayingPreview ? (
                        <Pause className="h-4 w-4 text-clay" strokeWidth={1.5} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Clone Voice Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!open) closeCloneDialog();
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] min-w-0 overflow-x-hidden rounded-[1.75rem] border-border p-0 sm:w-[calc(100vw-2rem)] sm:max-w-2xl md:max-w-3xl">
          <div className="p-6 sm:p-7">
            <DialogHeader>
              <DialogTitle className="font-display text-xl sm:text-2xl">
                {t("voices.cloneDialogTitle")}
              </DialogTitle>
              <DialogDescription>{t("voices.cloneDialogDescription")}</DialogDescription>
            </DialogHeader>

            {/* Step 1: Record or upload */}
            {cloneStep === "record" && (
              <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:items-start">
                <div className="min-w-0 space-y-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t("voices.recordOrUpload")}
                  </p>
                  <div className="rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground md:hidden">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left">
                        <span className="min-w-0 flex-1 font-medium text-foreground">
                          {t("voices.samplePromptTitle")}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 break-words">{t("voices.samplePrompt")}</p>
                    </details>
                  </div>
                  <div className="hidden rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground md:block">
                    <p className="mb-1 font-medium text-foreground">
                      {t("voices.samplePromptTitle")}
                    </p>
                    <p className="break-words">{t("voices.samplePrompt")}</p>
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="rounded-2xl border border-border p-4 text-center sm:p-5">
                    {isRecording ? (
                      <div className="space-y-3">
                        <div className="flex h-12 items-center justify-center gap-0.5 sm:h-14">
                          {Array.from({ length: 24 }).map((_, k) => (
                            <span
                              key={k}
                              className="w-1 rounded-full bg-clay animate-pulse"
                              style={{
                                height: `${24 + Math.abs(Math.sin(k * 0.9)) * 24}px`,
                                animationDelay: `${k * 40}ms`,
                              }}
                            />
                          ))}
                        </div>
                        <p className="font-display text-3xl tabular-nums sm:text-4xl">
                          {formatRecordingDuration(recordingTime)}
                          <span className="text-sm font-sans text-muted-foreground">
                            {" "}
                            / {formatRecordingDuration(VOICE_CLONE_RECORDING_MAX_SECONDS)}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("voices.recordingMinimumHint")}
                        </p>
                        <button
                          className="inline-flex items-center gap-2 rounded-full bg-destructive px-6 py-2.5 text-sm text-white hover:bg-destructive/80"
                          onClick={() => stopRecording()}
                          type="button"
                          data-voice-label={t("voices.stopRecording")}
                          data-voice-aliases="停止录音 完成录音 结束录音 stop recording finish recording"
                        >
                          <StopCircle className="h-4 w-4" /> {t("voices.stopRecording")}
                        </button>
                      </div>
                    ) : recordedAudio ? (
                      <div className="space-y-3">
                        {isRecordedAudioLongEnough ? (
                          <CheckCircle2 className="mx-auto h-10 w-10 text-clay" strokeWidth={1.5} />
                        ) : (
                          <AlertCircle
                            className="mx-auto h-10 w-10 text-destructive"
                            strokeWidth={1.5}
                          />
                        )}
                        <div>
                          <p className="text-sm">
                            {t("voices.recordedAudio", { count: recordingTime })}
                          </p>
                          {!isRecordedAudioLongEnough && (
                            <p className="mt-1 text-xs text-destructive">
                              {t("voices.recordingTooShortInline")}
                            </p>
                          )}
                        </div>
                        <button
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                          onClick={() => {
                            setRecordedAudio(null);
                            setRecordingTime(0);
                            void startRecording();
                          }}
                          type="button"
                          data-voice-label={t("voices.rerecord")}
                          data-voice-aliases="重新录制 重新录音 重录 rerecord record again"
                        >
                          {t("voices.rerecord")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex h-12 items-center justify-center sm:h-14">
                          <Mic className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-2.5 text-sm text-background hover:bg-clay"
                          onClick={startRecording}
                          type="button"
                          data-voice-label={t("voices.startRecording")}
                          data-voice-aliases="开始录音 开始录制 录制声音 start recording record voice"
                        >
                          <Mic className="h-4 w-4" /> {t("voices.startRecording")}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-xs text-muted-foreground">{t("common.or")}</span>
                    <div className="flex-1 border-t border-border" />
                  </div>

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={handleAudioUpload}
                    />
                    {uploadedAudio ? (
                      <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border p-3">
                        <span className="block min-w-0 flex-1 truncate text-sm">
                          {t("voices.audioSelectedWithName", { name: uploadedAudio.name })}
                        </span>
                        <button
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setUploadedAudio(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          type="button"
                          aria-label={t("common.delete")}
                          data-voice-label={t("common.delete")}
                          data-voice-aliases="删除音频 移除音频 清除音频 remove audio clear audio"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm hover:border-foreground"
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                        data-voice-label={t("voices.uploadAudio")}
                        data-voice-aliases="上传音频 上传音频文件 选择音频 选择音频文件 upload audio choose audio"
                      >
                        <Upload className="h-4 w-4" /> {t("voices.uploadAudio")}
                      </button>
                    )}
                  </div>

                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
                    disabled={!canContinueWithAudio}
                    onClick={() => {
                      if (!canContinueWithAudio) {
                        if (recordedAudio && !isRecordedAudioLongEnough) {
                          toast.error(t("voices.recordingTooShort"));
                        }
                        return;
                      }
                      setCloneStep("name");
                    }}
                    type="button"
                    data-voice-label={t("common.continue")}
                    data-voice-aliases="继续 下一步 continue next"
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Name */}
            {cloneStep === "name" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("voices.namePrompt")}</p>
                <input
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                  placeholder={t("voices.namePlaceholder")}
                  aria-label={t("voices.nameVoice")}
                  data-voice-label={t("voices.nameVoice")}
                  data-voice-aliases="声音名称 命名 声音名字 voice name name this voice"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && voiceName.trim()) setCloneStep("confirm");
                  }}
                  autoFocus
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    className="flex-1 rounded-full border border-border py-2.5 text-sm hover:border-foreground"
                    onClick={() => setCloneStep("record")}
                    type="button"
                    data-voice-label={t("common.back")}
                    data-voice-aliases="返回 上一步 back previous"
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="flex-1 rounded-full bg-foreground py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                    disabled={!voiceName.trim()}
                    onClick={() => setCloneStep("confirm")}
                    type="button"
                    data-voice-label={t("common.continue")}
                    data-voice-aliases="继续 下一步 确认 continue next confirm"
                  >
                    {t("common.continue")}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm authorization */}
            {cloneStep === "confirm" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-secondary/50 p-4 text-sm space-y-2">
                  <p className="font-medium text-foreground">{t("voices.authorizationRequired")}</p>
                  <p className="text-muted-foreground">{t("voices.authorizationIntro")}</p>
                  <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                    <li>{t("voices.authorizationRight")}</li>
                    <li>{t("voices.authorizationConsent")}</li>
                    <li>{t("voices.authorizationPersonal")}</li>
                  </ul>
                </div>
                <p className="text-sm">
                  {t("voices.voiceName")} <span className="font-medium">{voiceName}</span>
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    className="flex-1 rounded-full border border-border py-2.5 text-sm hover:border-foreground"
                    onClick={() => setCloneStep("name")}
                    type="button"
                    data-voice-label={t("common.back")}
                    data-voice-aliases="返回 上一步 back previous"
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className="flex-1 rounded-full bg-foreground py-2.5 text-sm text-background hover:bg-clay"
                    onClick={handleCloneVoice}
                    type="button"
                    data-voice-label={t("voices.agreeClone")}
                    data-voice-aliases="我同意 我同意并克隆 确认授权 开始克隆 agree i agree agree and clone i agree and clone clone confirm authorization"
                  >
                    {t("voices.agreeClone")}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Cloning */}
            {cloneStep === "cloning" && (
              <div className="py-8 text-center space-y-4">
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-clay" strokeWidth={1.25} />
                <h3 className="font-display text-xl">{t("voices.cloning")}</h3>
                <p className="text-sm text-muted-foreground">{t("voices.cloningWait")}</p>
              </div>
            )}

            {/* Step 5: Done */}
            {cloneStep === "done" && (
              <div className="py-8 text-center space-y-4">
                <CheckCircle2 className="mx-auto h-12 w-12 text-clay" strokeWidth={1.25} />
                <h3 className="font-display text-xl">{t("voices.cloned")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("voices.availableInLibrary", { name: voiceName })}
                </p>
                <button
                  className="w-full rounded-full bg-foreground py-3 text-sm text-background hover:bg-clay"
                  onClick={closeCloneDialog}
                  type="button"
                  data-voice-label={t("common.done")}
                  data-voice-aliases="完成 结束 关闭 done finish finished close"
                >
                  {t("common.done")}
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
