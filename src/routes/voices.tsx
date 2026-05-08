import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  Mic, Play, Plus, Star, Trash2, Sparkles, Volume2,
  Loader2, StopCircle, Upload, CheckCircle2, X,
} from "lucide-react";
import { useState, useRef } from "react";
import type { ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, addVoice, deleteVoice, setDefaultVoice } from "@/lib/db";
import type { Voice } from "@/lib/db";
import { ElevenLabsService } from "@/lib/elevenlabs";
import { getApiKey } from "@/lib/crypto";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/voices")({
  head: () => ({
    meta: [
      { title: "Voice library — CookTalk" },
      {
        name: "description",
        content: "Manage default voices and clone family voices to narrate your recipes.",
      },
    ],
  }),
  component: VoicesPage,
});

const PRESETS = [
  { name: "Aria", voiceId: "9BWtsMINqrJLrRacOk9x", lang: "EN-US · neutral" },
  { name: "Roger", voiceId: "CwhRBWXzGAHq8TQ4Fs17", lang: "EN-US · narrator" },
  { name: "Sarah", voiceId: "EXAVITQu4vr4xnSDxMaL", lang: "EN-GB · cheerful" },
  { name: "Charlotte", voiceId: "XB0fDUnXU5powFXDhCwa", lang: "EN-AU · soft" },
  { name: "晓晓", voiceId: "pFZP5JQG7iQjIQuC4Bku", lang: "ZH-CN · warm" },
  { name: "云希", voiceId: "t0jbNlBVZ17f02VDIeMI", lang: "ZH-CN · bright" },
] as const;

type CloneStep = "record" | "name" | "confirm" | "cloning" | "done";

function VoicesPage() {
  const { t } = useTranslation();
  const voices = useLiveQuery(() => db.voices.orderBy("createdAt").toArray(), []) ?? [];

  // Clone dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [cloneStep, setCloneStep] = useState<CloneStep>("record");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<Blob | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  // Playback state
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [previewingPreset, setPreviewingPreset] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const audioBlob = recordedAudio ?? uploadedAudio;

  // ── Dialog helpers ───────────────────────────────────────────────────────────

  const openCloneDialog = () => {
    setShowDialog(true);
    setCloneStep("record");
    setIsRecording(false);
    setRecordedAudio(null);
    setUploadedAudio(null);
    setVoiceName("");
    setRecordingTime(0);
  };

  const closeCloneDialog = () => {
    stopRecording();
    setShowDialog(false);
  };

  // ── Recording ────────────────────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        setRecordedAudio(new Blob(chunks, { type: "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);

      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 30_000);
    } catch {
      toast.error(t("voices.micDenied"));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const handleAudioUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedAudio(file);
      setRecordedAudio(null);
    }
  };

  // ── Clone API ────────────────────────────────────────────────────────────────

  const handleCloneVoice = async () => {
    if (!audioBlob || !voiceName.trim()) return;
    setCloneStep("cloning");
    try {
      const apiKey = await getApiKey("elevenlabs");
      if (!apiKey) throw new Error("ElevenLabs API key not configured. Please add it in Settings.");

      const service = new ElevenLabsService(apiKey);
      const result = await service.cloneVoice(voiceName.trim(), [audioBlob]);

      await addVoice({
        name: voiceName.trim(),
        elevenLabsVoiceId: result.voice_id,
        isCloned: true,
        isDefault: false,
        language: "zh",
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

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId(null);
    setPreviewingPreset(null);
  };

  const handlePreviewVoice = async (voice: Voice) => {
    if (playingVoiceId === voice.id) { stopAudio(); return; }
    if (!voice.elevenLabsVoiceId) { toast.error(t("voices.missingElevenLabsVoiceId")); return; }

    try {
      stopAudio();
      setPlayingVoiceId(voice.id);
      const apiKey = await getApiKey("elevenlabs");
      if (!apiKey) throw new Error("ElevenLabs API key not configured.");

      const blob = await new ElevenLabsService(apiKey).textToSpeech(
        "Hello! I love cooking delicious food.",
        voice.elevenLabsVoiceId,
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setPlayingVoiceId(null); };
      audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("voices.previewFailed"));
      setPlayingVoiceId(null);
    }
  };

  const handlePreviewPreset = async (voiceId: string) => {
    if (previewingPreset === voiceId) { stopAudio(); return; }

    try {
      stopAudio();
      setPreviewingPreset(voiceId);
      const apiKey = await getApiKey("elevenlabs");
      if (!apiKey) throw new Error("ElevenLabs API key not configured. Please add it in Settings.");

      const blob = await new ElevenLabsService(apiKey).textToSpeech(
        "Hello! I love cooking delicious food for everyone.",
        voiceId,
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewingPreset(null); };
      audio.play();
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
            <span className="page-kicker">
              Voice cloning · ElevenLabs
            </span>
            <h1 className="page-title">{t("voices.title")}</h1>
            <p className="page-description">
              Preset narrators for everyday cooking, plus your own cloned family voices. Bind a
              voice per recipe — or globally.
            </p>
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
            {voices.map((v, i) => (
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
                <p className="text-xs text-muted-foreground">{v.language} · {v.description}</p>

                {/* Waveform decoration */}
                <div className="mt-4 flex h-10 items-center gap-1">
                  {Array.from({ length: 40 }).map((_, k) => (
                    <span
                      key={k}
                      className="flex-1 rounded-full bg-clay/40"
                      style={{ height: `${20 + Math.abs(Math.sin(k * 0.6 + i)) * 80}%` }}
                    />
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-foreground/80 py-2 text-xs hover:bg-foreground hover:text-background"
                    onClick={() => handlePreviewVoice(v)}
                  >
                    {playingVoiceId === v.id ? (
                      <><StopCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.stop")}</>
                    ) : (
                      <><Play className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.preview")}</>
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

      {/* Preset narrators */}
      <section className="flex-1">
        <div className="page-content-container">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl">{t("voices.presetNarrators")}</h2>
              <p className="text-sm text-muted-foreground">{t("voices.presetFree")}</p>
            </div>
            <Link
              to="/settings"
              className="text-sm text-clay hover:underline inline-flex items-center gap-1"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("voices.configureKey")}
            </Link>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {PRESETS.map((p, i) => (
              <div
                key={p.name}
                className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <VoiceBadge n={i + 1} />
                  <div>
                    <div className="font-display text-base">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.lang}</div>
                  </div>
                </div>
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-foreground/30 hover:bg-foreground hover:text-background"
                  onClick={() => handlePreviewPreset(p.voiceId)}
                >
                  {previewingPreset === p.voiceId ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  ) : (
                    <Play className="h-4 w-4" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Clone Voice Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeCloneDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">{t("voices.cloneDialogTitle")}</DialogTitle>
          </DialogHeader>

          {/* Step 1: Record or upload */}
          {cloneStep === "record" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("voices.recordOrUpload")}
              </p>

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
                      {recordingTime}
                      <span className="text-sm font-sans text-muted-foreground"> / {t("voices.seconds30")}</span>
                    </p>
                    <button
                      className="inline-flex items-center gap-2 rounded-full bg-destructive px-6 py-2.5 text-sm text-white hover:bg-destructive/80"
                      onClick={stopRecording}
                    >
                      <StopCircle className="h-4 w-4" /> {t("voices.stopRecording")}
                    </button>
                  </div>
                ) : recordedAudio ? (
                  <div className="space-y-3">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-clay" strokeWidth={1.5} />
                    <p className="text-sm">{t("voices.recordedAudio", { count: recordingTime })}</p>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => { setRecordedAudio(null); setRecordingTime(0); }}
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
                  <div className="flex items-center justify-between rounded-xl border border-border p-3">
                    <span className="text-sm truncate">{t("voices.audioSelected")}</span>
                    <button
                      className="ml-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setUploadedAudio(null)}
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
                disabled={!audioBlob}
                onClick={() => setCloneStep("name")}
              >
                {t("common.continue")}
              </button>
            </div>
          )}

          {/* Step 2: Name */}
          {cloneStep === "name" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("voices.namePrompt")}
              </p>
              <input
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-clay"
                placeholder="e.g. Mom, Grandma, Dad…"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && voiceName.trim()) setCloneStep("confirm"); }}
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
              <h3 className="font-display text-xl">Cloning voice…</h3>
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
