import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  AlertCircle,
  Mic,
  Play,
  Plus,
  Star,
  Trash2,
  Sparkles,
  Volume2,
  Loader2,
  StopCircle,
  Upload,
  CheckCircle2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";
import type { ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, addVoice, deleteVoice, setDefaultVoice } from "@/lib/db";
import type { Voice } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { getApiKey } from "@/lib/crypto";
import i18n from "@/lib/i18n";
import {
  describeElevenLabsVoice,
  getElevenLabsVoicePreviewUrl,
  useElevenLabsVoices,
} from "@/hooks/use-elevenlabs-voices";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { claimVoicePlayback, type VoicePlaybackHandle } from "@/lib/voice-playback";

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

function formatRecordingDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function VoicesPage() {
  const { i18n: activeI18n, t } = useTranslation();
  const clonedVoices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];
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
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoicePreviewId, setLoadingVoicePreviewId] = useState<string | null>(null);
  const [previewingPreset, setPreviewingPreset] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackHandleRef = useRef<VoicePlaybackHandle | null>(null);
  const previewRunRef = useRef(0);
  const clonedPreviewUrlCacheRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRecordingOnStopRef = useRef(false);
  const maxRecordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setPlayingVoiceId(null);
    setLoadingVoicePreviewId(null);
    setPreviewingPreset(null);
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      clonedPreviewUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      clonedPreviewUrlCacheRef.current.clear();
    };
  }, [stopAudio]);

  const handlePreviewVoice = async (voice: Voice) => {
    if (playingVoiceId === voice.id || loadingVoicePreviewId === voice.id) {
      stopAudio();
      return;
    }
    if (!voice.elevenLabsVoiceId) {
      toast.error(t("voices.missingElevenLabsVoiceId"));
      return;
    }

    try {
      const runId = previewRunRef.current + 1;
      previewRunRef.current = runId;
      stopAudio(false);
      setLoadingVoicePreviewId(voice.id);

      const cacheKey = `${voice.elevenLabsVoiceId}:${activeI18n.language}`;
      let url = clonedPreviewUrlCacheRef.current.get(cacheKey);
      if (!url) {
        const apiKey = await getApiKey("elevenlabs");
        if (!apiKey) throw new Error(t("voices.elevenLabsKeyMissingShort"));

        const blob = await new ElevenLabsService(apiKey).textToSpeech(
          t("voices.previewText"),
          voice.elevenLabsVoiceId,
        );
        url = URL.createObjectURL(blob);
        clonedPreviewUrlCacheRef.current.set(cacheKey, url);
      }

      const audio = new Audio(url);
      audio.preload = "auto";
      if (previewRunRef.current !== runId) {
        return;
      }
      audioRef.current = audio;
      const finish = () => {
        if (previewRunRef.current !== runId) return;
        setLoadingVoicePreviewId(null);
        setPlayingVoiceId(null);
        if (audioRef.current === audio) audioRef.current = null;
        playbackHandleRef.current = null;
      };
      const playback = claimVoicePlayback(audio, {
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
      setLoadingVoicePreviewId(null);
      setPlayingVoiceId(voice.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("voices.previewFailed"));
      setLoadingVoicePreviewId(null);
      setPlayingVoiceId(null);
    }
  };

  const handlePreviewElevenLabsVoice = async (
    voiceId: string,
    previewUrl: string | null = null,
  ) => {
    if (previewingPreset === voiceId) {
      stopAudio();
      return;
    }

    try {
      const runId = previewRunRef.current + 1;
      previewRunRef.current = runId;
      stopAudio(false);
      setPreviewingPreset(voiceId);

      let objectUrl: string | null = null;
      let audio: HTMLAudioElement;
      if (previewUrl) {
        audio = new Audio(previewUrl);
      } else {
        const apiKey = await getApiKey("elevenlabs");
        if (!apiKey) throw new Error(t("voices.elevenLabsKeyMissingFull"));

        const blob = await new ElevenLabsService(apiKey).textToSpeech(
          t("voices.previewPresetText"),
          voiceId,
        );
        objectUrl = URL.createObjectURL(blob);
        audio = new Audio(objectUrl);
      }

      if (previewRunRef.current !== runId) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      audioRef.current = audio;
      const finish = () => {
        if (previewRunRef.current !== runId) return;
        setPreviewingPreset(null);
        if (audioRef.current === audio) audioRef.current = null;
        playbackHandleRef.current = null;
      };
      const playback = claimVoicePlayback(audio, {
        cleanup: () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        },
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
      void audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("voices.previewFailed"));
      setPreviewingPreset(null);
    }
  };

  // ── Voice management ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string, name: string) => {
    await deleteVoice(id);
    toast.success(t("voices.deleteSuccess", { name }));
  };

  const handleSetDefault = async (id: string, name: string) => {
    await setDefaultVoice(id);
    toast.success(t("voices.defaultSuccess", { name }));
  };

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="page-kicker">{t("voices.subtitle")}</span>
            <h1 className="page-title">{t("voices.title")}</h1>
            <p className="page-description">{t("voices.description")}</p>
          </div>
          <button
            className="inline-flex items-center gap-2 self-start rounded-full bg-foreground px-4 py-2.5 text-sm text-background hover:bg-clay sm:px-5"
            onClick={openCloneDialog}
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> {t("voices.cloneNew")}
          </button>
        </div>
      </section>

      {/* My cloned voices */}
      <section className="border-b border-border/60">
        <div className="page-content-container">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl">{t("voices.myCloned")}</h2>
            <VoiceHint>{t("voices.voiceHint")}</VoiceHint>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {clonedVoices.map((v, i) => (
              <article key={v.id} className="relative rounded-3xl border border-border bg-card p-6">
                <VoiceBadge n={i + 1} className="absolute top-4 left-4" />

                <div className="flex items-center justify-between">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-clay/40 bg-secondary">
                    <Volume2 className="h-6 w-6 text-clay" strokeWidth={1.5} />
                  </div>
                  {v.isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[10px] uppercase tracking-wider text-background">
                      <Star className="h-3 w-3" strokeWidth={2} /> {t("voices.default")}
                    </span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider hover:border-foreground"
                      onClick={() => handleSetDefault(v.id, v.name)}
                    >
                      {t("voices.setDefault")}
                    </button>
                  )}
                </div>

                <h3 className="mt-4 font-display text-2xl">{v.name}</h3>
                <p className="text-xs text-muted-foreground">{formatClonedVoiceDescription(v)}</p>

                {/* Waveform */}
                <div className="mt-4 flex h-10 items-center gap-1">
                  {Array.from({ length: 40 }).map((_, k) => (
                    <span
                      key={k}
                      className={`flex-1 rounded-full bg-clay/40 ${
                        playingVoiceId === v.id ? "voice-preview-wave-bar" : ""
                      }`}
                      style={{
                        height: `${20 + Math.abs(Math.sin(k * 0.6 + i)) * 80}%`,
                        animationDelay: `${k * 34}ms`,
                        animationDuration: `${760 + (k % 7) * 54}ms`,
                      }}
                    />
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-foreground/80 py-2 text-xs hover:bg-foreground hover:text-background"
                    onClick={() => handlePreviewVoice(v)}
                  >
                    {loadingVoicePreviewId === v.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />{" "}
                        {t("voices.generatingPreview")}
                      </>
                    ) : playingVoiceId === v.id ? (
                      <>
                        <StopCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.stop")}
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.preview")}
                      </>
                    )}
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-full border border-border p-2 text-muted-foreground hover:border-destructive hover:text-destructive"
                    onClick={() => handleDelete(v.id, v.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              </article>
            ))}

            {/* New voice slot */}
            <button
              className="group flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border bg-card hover:border-clay transition-colors"
              onClick={openCloneDialog}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-foreground/30 group-hover:border-clay">
                <Mic className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <div className="font-display text-base">{t("voices.record30s")}</div>
                <VoiceHint className="justify-center mt-1">{t("voices.addNewVoice")}</VoiceHint>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* ElevenLabs voices */}
      <section className="flex-1">
        <div className="page-content-container">
          <div className="flex items-end justify-between">
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
                const description = describeElevenLabsVoice(
                  voice,
                  t("voices.elevenLabsVoiceFallback"),
                );
                const previewUrl = getElevenLabsVoicePreviewUrl(voice);

                return (
                  <div
                    key={voice.voice_id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <VoiceBadge n={i + 1} />
                      <div className="min-w-0">
                        <div className="truncate font-display text-base">{voice.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{description}</div>
                      </div>
                    </div>
                    <button
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-foreground/30 hover:bg-foreground hover:text-background"
                      onClick={() => handlePreviewElevenLabsVoice(voice.voice_id, previewUrl)}
                      aria-label={t("voices.preview")}
                    >
                      {previewingPreset === voice.voice_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                      ) : (
                        <Play className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
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
        <DialogContent className="w-[calc(100vw-2rem)] min-w-0 overflow-x-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {t("voices.cloneDialogTitle")}
            </DialogTitle>
          </DialogHeader>

          {/* Step 1: Record or upload */}
          {cloneStep === "record" && (
            <div className="min-w-0 space-y-4">
              <p className="text-sm text-muted-foreground">{t("voices.recordOrUpload")}</p>
              <div className="min-w-0 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">{t("voices.samplePromptTitle")}</p>
                <p className="break-words">{t("voices.samplePrompt")}</p>
              </div>

              <div className="rounded-2xl border border-border p-5 text-center">
                {isRecording ? (
                  <div className="space-y-3">
                    {/* Live waveform bars */}
                    <div className="flex h-14 items-center justify-center gap-0.5">
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
                    <p className="font-display text-3xl tabular-nums">
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
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => {
                        setRecordedAudio(null);
                        setRecordingTime(0);
                        void startRecording();
                      }}
                    >
                      {t("voices.rerecord")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex h-14 items-center justify-center">
                      <Mic className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
                    </div>
                    <button
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-2.5 text-sm text-background hover:bg-clay"
                      onClick={startRecording}
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
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm hover:border-foreground"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" /> {t("voices.uploadAudio")}
                  </button>
                )}
              </div>

              <button
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground py-3 text-sm text-background hover:bg-clay disabled:opacity-50"
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
              >
                {t("common.continue")}
              </button>
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
              <div className="flex gap-2">
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
              <div className="flex gap-2">
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
