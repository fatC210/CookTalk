import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  AlertCircle,
  ChevronDown,
  Mic,
  Pause,
  Plus,
  Trash2,
  Sparkles,
  Volume2,
  Loader2,
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
import i18n from "@/lib/i18n";
import {
  formatElevenLabsVoiceDisplayLabel,
  getElevenLabsVoiceGender,
  getElevenLabsVoicePreviewUrl,
  useElevenLabsVoices,
} from "@/hooks/use-elevenlabs-voices";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { claimVoicePlayback, type VoicePlaybackHandle } from "@/lib/voice-playback";
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
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

function VoiceRoleButton({
  isSelected,
  label,
  Icon,
  disabled = false,
  onClick,
}: VoiceRoleButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full border bg-secondary/90 text-foreground/80 shadow-sm backdrop-blur transition-[border-color,background-color,color,opacity,box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        "opacity-0 pointer-events-none group-hover/voice-card:pointer-events-auto group-hover/voice-card:opacity-100 group-focus-within/voice-card:pointer-events-auto group-focus-within/voice-card:opacity-100",
        isSelected
          ? "border-clay bg-clay text-background shadow-sm hover:border-clay hover:bg-clay"
          : "border-border/80 hover:border-clay hover:bg-secondary hover:text-clay",
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </button>
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

function VoicesPage() {
  const { i18n: activeI18n, t } = useTranslation();
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
    reload: reloadElevenLabsVoices,
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
      if (!apiKey) throw new Error(t("voices.elevenLabsKeyMissingFull"));

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
          if (!apiKey) throw new Error(t("voices.elevenLabsKeyMissingShort"));

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
        if (!apiKey) throw new Error(t("voices.elevenLabsKeyMissingFull"));

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
      setConversationVoiceId(null);
      toast.success(t("voices.conversationVoiceCleared", { name }));
      return;
    }

    setConversationVoiceId(voiceId);
    toast.success(t("voices.conversationVoiceSuccess", { name }));
  };

  const handleSetCookingVoice = (voiceId: string, name: string) => {
    if (cookingVoiceId === voiceId) {
      setCookingVoiceId(null);
      toast.success(t("voices.cookingVoiceCleared", { name }));
      return;
    }

    setCookingVoiceId(voiceId);
    toast.success(t("voices.cookingVoiceSuccess", { name }));
  };

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="page-kicker">{t("voices.subtitle")}</span>
            <h1 className="page-title">{t("voices.title")}</h1>
            <p className="page-description">{t("voices.description")}</p>
          </div>
          <button
            className="inline-flex items-center gap-2 self-center rounded-full bg-foreground px-4 py-2.5 text-sm text-background hover:bg-clay sm:px-5"
            onClick={openCloneDialog}
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

          <div className="mt-6 grid justify-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,260px))]">
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
                  title={t("voices.preview")}
                  onClick={() => void handlePreviewVoice(v)}
                  onKeyDown={(event) => handleCardKeyDown(event, () => void handlePreviewVoice(v))}
                  className="group/voice-card relative cursor-pointer rounded-3xl border border-border bg-card p-5 transition-colors hover:border-clay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <VoiceBadge n={i + 1} className="absolute top-4 left-4" />
                  <VoiceRoleActionStack>
                    <VoiceRoleButton
                      isSelected={conversationVoiceId === v.elevenLabsVoiceId}
                      disabled={!v.elevenLabsVoiceId}
                      Icon={MessageCircle}
                      label={
                        conversationVoiceId === v.elevenLabsVoiceId
                          ? t("voices.clearConversationVoice")
                          : t("voices.setConversationVoice")
                      }
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
                          ? t("voices.clearCookingVoice")
                          : t("voices.setCookingVoice")
                      }
                      onClick={(event) => {
                        stopCardPreview(event);
                        if (v.elevenLabsVoiceId) {
                          handleSetCookingVoice(v.elevenLabsVoiceId, v.name);
                        }
                      }}
                    />
                  </VoiceRoleActionStack>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-clay/40 bg-secondary">
                      {isLoadingPreview ? (
                        <Loader2 className="h-5 w-5 animate-spin text-clay" strokeWidth={1.5} />
                      ) : isPlayingPreview ? (
                        <Pause className="h-5 w-5 text-clay" strokeWidth={1.5} />
                      ) : (
                        <Volume2 className="h-6 w-6 text-clay" strokeWidth={1.5} />
                      )}
                    </div>
                  </div>

                  <h3 className="mt-4 font-display text-2xl">{v.name}</h3>
                  {/* Waveform */}
                  <div className="mt-4 flex h-10 items-center gap-1">
                    {Array.from({ length: 40 }).map((_, k) => (
                      <span
                        key={k}
                        className={`flex-1 rounded-full bg-clay/40 ${
                          isPlayingPreview ? "voice-preview-wave-bar" : ""
                        }`}
                        style={{
                          height: `${20 + Math.abs(Math.sin(k * 0.6 + i)) * 80}%`,
                          animationDelay: `${k * 34}ms`,
                          animationDuration: `${760 + (k % 7) * 54}ms`,
                        }}
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-2 text-muted-foreground hover:border-border hover:bg-transparent hover:text-destructive focus-visible:border-border"
                      onClick={(event) => {
                        stopCardPreview(event);
                        void handleDelete(v.id, v.name);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </article>
              );
            })}

            {/* New voice slot */}
            <button
              className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border bg-card transition-colors hover:border-clay"
              onClick={openCloneDialog}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-foreground/30 group-hover:border-clay">
                <Mic className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <div className="font-display text-sm leading-snug">{t("voices.record30s")}</div>
                <VoiceHint className="justify-center mt-1">{t("voices.addNewVoice")}</VoiceHint>
              </div>
            </button>
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
            {hasElevenLabsKey ? (
              <button
                type="button"
                onClick={() => void reloadElevenLabsVoices()}
                className="text-sm text-clay hover:underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("common.retry")}
              </button>
            ) : (
              <Link
                to="/settings"
                className="text-sm text-clay hover:underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.configureKey")}
              </Link>
            )}
          </div>

          {!hasElevenLabsKey ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
              <p className="font-display text-xl">{t("voices.configureKeyTitle")}</p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                {t("voices.configureKeyBody")}
              </p>
              <Link
                to="/settings"
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
                const displayLabel = formatElevenLabsVoiceDisplayLabel(voice, t("common.unknown"));
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
                    title={t("voices.preview")}
                    onClick={() => void handlePreviewElevenLabsVoice(voice.voice_id, previewUrl)}
                    onKeyDown={(event) =>
                      handleCardKeyDown(
                        event,
                        () => void handlePreviewElevenLabsVoice(voice.voice_id, previewUrl),
                      )
                    }
                    className="group/voice-card relative flex cursor-pointer flex-col items-start gap-3 rounded-2xl border border-border bg-card px-5 py-4 pr-24 transition-colors hover:border-clay focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
                  >
                    <VoiceRoleActionStack className="top-1/2 flex-row -translate-y-1/2">
                      <VoiceRoleButton
                        isSelected={conversationVoiceId === voice.voice_id}
                        Icon={MessageCircle}
                        label={
                          conversationVoiceId === voice.voice_id
                            ? t("voices.clearConversationVoice")
                            : t("voices.setConversationVoice")
                        }
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
                            ? t("voices.clearCookingVoice")
                            : t("voices.setCookingVoice")
                        }
                        onClick={(event) => {
                          stopCardPreview(event);
                          handleSetCookingVoice(voice.voice_id, voice.name);
                        }}
                      />
                    </VoiceRoleActionStack>
                    <div className="flex min-w-0 items-center gap-3">
                      <VoiceBadge n={i + 1} />
                      <div className="min-w-0">
                        <div className="truncate font-display text-base" title={displayLabel}>
                          {voice.name}
                        </div>
                        <div className="mt-1">
                          <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            {gender}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
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
        <DialogContent className="w-[calc(100vw-1rem)] min-w-0 overflow-x-hidden px-4 py-4 sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:px-6 sm:py-5 md:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl sm:text-2xl">
              {t("voices.cloneDialogTitle")}
            </DialogTitle>
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
                      <span
                        className="block min-w-0 flex-1 truncate text-sm"
                        title={uploadedAudio.name}
                      >
                        {t("voices.audioSelectedWithName", { name: uploadedAudio.name })}
                      </span>
                      <button
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setUploadedAudio(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        type="button"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm hover:border-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
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
                >
                  {t("common.back")}
                </button>
                <button
                  className="flex-1 rounded-full bg-foreground py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                  disabled={!voiceName.trim()}
                  onClick={() => setCloneStep("confirm")}
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
                >
                  {t("common.back")}
                </button>
                <button
                  className="flex-1 rounded-full bg-foreground py-2.5 text-sm text-background hover:bg-clay"
                  onClick={handleCloneVoice}
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
              >
                {t("common.done")}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
