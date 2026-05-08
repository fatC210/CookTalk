import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { VoiceBadge, VoiceHint } from "@/components/voice-badge";
import {
  FileVideo, UploadCloud, Wand2, CheckCircle2, AudioLines, Mic, ImageIcon,
  Loader2, XCircle, AlertCircle,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import { ElevenLabsService } from "@/lib/elevenlabs";
import {
  DEFAULT_IMAGE_MODEL,
  ImageGenService,
  getConfiguredLLMService,
} from "@/lib/llm";
import { getApiKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Recipe } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import a video — CookTalk" },
      {
        name: "description",
        content:
          "Drop in a cooking video. We'll extract audio, transcribe with ElevenLabs, and structure it into a recipe.",
      },
    ],
  }),
  component: ImportPage,
});

type PipelineStage =
  | "idle"
  | "extracting-audio"
  | "transcribing"
  | "structuring"
  | "generating-cover"
  | "preview"
  | "saving"
  | "done"
  | "error";

type StructuredRecipe = {
  title: string;
  ingredients: { name: string; amount: string }[];
  steps: { order: number; description: string; durationSec?: number; tips?: string }[];
  tags: {
    flavor?: string[];
    difficulty?: "easy" | "medium" | "hard";
    cuisine?: string;
    totalTimeMin?: number;
  };
};

const pipelineStages = [
  {
    icon: UploadCloud,
    labelKey: "import.stages.upload.label",
    bodyKey: "import.stages.upload.body",
  },
  {
    icon: AudioLines,
    labelKey: "import.stages.stt.label",
    bodyKey: "import.stages.stt.body",
  },
  {
    icon: Wand2,
    labelKey: "import.stages.structure.label",
    bodyKey: "import.stages.structure.body",
  },
  {
    icon: ImageIcon,
    labelKey: "import.stages.cover.label",
    bodyKey: "import.stages.cover.body",
  },
];

const stageToIndex: Record<PipelineStage, number> = {
  idle: -1,
  "extracting-audio": 0,
  transcribing: 1,
  structuring: 2,
  "generating-cover": 3,
  preview: 4,
  saving: 4,
  done: 4,
  error: -1,
};

const stageLabelKeys: Partial<Record<PipelineStage, string>> = {
  "extracting-audio": "import.extractingAudio",
  transcribing: "import.transcribing",
  structuring: "import.structuring",
  "generating-cover": "import.generatingCover",
  saving: "import.saving",
  done: "import.saved",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [structuredRecipe, setStructuredRecipe] = useState<StructuredRecipe | null>(null);
  const [coverImage, setCoverImage] = useState<Blob | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSteps, setEditSteps] = useState<StructuredRecipe["steps"]>([]);
  const [editIngredients, setEditIngredients] = useState<StructuredRecipe["ingredients"]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const MAX_SIZE = 200 * 1024 * 1024;

  const validateFile = (file: File): string | null => {
    const validExts = /\.(mp4|mov|webm)$/i;
    const validMimes = ["video/mp4", "video/quicktime", "video/webm"];
    if (!validMimes.includes(file.type) && !validExts.test(file.name)) {
      return t("import.invalidVideo");
    }
    if (file.size > MAX_SIZE) {
      return t("import.fileTooLargeWithSize", { size: formatBytes(file.size) });
    }
    return null;
  };

  const selectFile = (file: File) => {
    const err = validateFile(file);
    if (err) { toast.error(err); return; }
    setSelectedFile(file);
    setStage("idle");
    setError(null);
    setStructuredRecipe(null);
    setTranscript("");
    setCoverImage(null);
    setEditMode(false);
  };

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
  };

  const startPipeline = async () => {
    if (!selectedFile) return;

    try {
      // ── Step 1: Extract audio ──────────────────────────────────
      setStage("extracting-audio");
      let audioBlob: Blob = selectedFile;

      try {
        if (!ffmpegRef.current) ffmpegRef.current = new FFmpeg();
        const ffmpeg = ffmpegRef.current;

        if (!ffmpeg.loaded) {
          await ffmpeg.load({
            coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
            wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
          });
        }

        const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "mp4";
        const inputName = `input.${ext}`;
        await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));
        await ffmpeg.exec([
          "-i", inputName,
          "-vn", "-acodec", "libmp3lame", "-q:a", "4",
          "output.mp3",
        ]);
        const data = await ffmpeg.readFile("output.mp3");
        audioBlob = new Blob([data as Uint8Array<ArrayBuffer>], { type: "audio/mp3" });
      } catch (ffErr) {
        console.warn("FFmpeg audio extraction failed, using raw video:", ffErr);
        toast.warning(t("import.audioExtractionWarning"));
      }

      // ── Step 2: Transcribe ─────────────────────────────────────
      setStage("transcribing");
      const elevenLabsKey = await getApiKey("elevenlabs");
      if (!elevenLabsKey) {
        throw new Error(t("import.elevenLabsKeyMissing"));
      }
      const sttService = new ElevenLabsService(elevenLabsKey);
      const rawTranscript = await sttService.speechToText(audioBlob);
      setTranscript(rawTranscript);

      // ── Step 3: Structure with LLM ─────────────────────────────
      setStage("structuring");
      let recipe: StructuredRecipe | null = null;
      const llmService = await getConfiguredLLMService();

      if (!llmService) {
        toast.warning(t("import.llmKeyWarning"));
      } else {
        recipe = (await llmService.structureRecipe(rawTranscript)) as StructuredRecipe;
        setStructuredRecipe(recipe);
        setEditTitle(recipe.title);
        setEditIngredients([...recipe.ingredients]);
        setEditSteps([...recipe.steps]);
      }

      // ── Step 4: Generate cover (optional) ─────────────────────
      setStage("generating-cover");
      if (recipe) {
        const imageKey = await getApiKey("imagegen-key");
        const imageEndpoint = await getApiKey("imagegen-endpoint");
        const imageModel = await getApiKey("imagegen-model");

        if (imageKey && imageEndpoint) {
          try {
            const imgService = new ImageGenService(
              imageEndpoint,
              imageKey,
              imageModel?.trim() || DEFAULT_IMAGE_MODEL,
            );
            const prompt = await llmService.generateCoverPrompt(recipe.title);
            const cover = await imgService.generateImage(prompt);
            setCoverImage(cover);
          } catch (coverErr) {
            console.warn("Cover generation failed:", coverErr);
            toast.warning(t("import.coverGenerationWarning"));
          }
        }
      }

      setStage("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("import.pipelineFailed");
      setError(msg);
      setStage("error");
      toast.error(msg);
    }
  };

  const handleSave = async () => {
    setStage("saving");
    try {
      const title = editMode && editTitle ? editTitle : (structuredRecipe?.title ?? t("import.untitledRecipe"));
      const ingredients = editMode ? editIngredients : (structuredRecipe?.ingredients ?? []);
      const steps = (editMode ? editSteps : (structuredRecipe?.steps ?? [])).map((s, i) => ({
        ...s,
        order: i + 1,
      }));

      const recipe: Recipe = {
        id: uuid(),
        title,
        ingredients,
        steps,
        tags: structuredRecipe?.tags ?? {},
        coverSource: coverImage ? "ai" : "default",
        ...(coverImage ? { coverImage } : {}),
        rawTranscript: transcript,
        createdAt: Date.now(),
      };
      await db.recipes.add(recipe);
      setStage("done");
      toast.success(t("import.recipeSaved"));
      setTimeout(() => navigate({ to: "/recipes" }), 900);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("import.saveFailed");
      setError(msg);
      setStage("error");
      toast.error(msg);
    }
  };

  const reset = () => {
    setSelectedFile(null);
    setStage("idle");
    setError(null);
    setTranscript("");
    setStructuredRecipe(null);
    setCoverImage(null);
    setEditMode(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isRunning = [
    "extracting-audio",
    "transcribing",
    "structuring",
    "generating-cover",
    "saving",
  ].includes(stage);
  const activeIdx = stageToIndex[stage];

  return (
    <div className="app-page-bg min-h-screen flex flex-col">
      <SiteHeader />

      <section className="page-hero">
        <div className="page-hero-container">
          <span className="page-kicker">
            {t("import.subtitle")}
          </span>
          <h1 className="page-title">
            {t("import.title")}
          </h1>
          <p className="page-description">
            {t("import.description")} {t("import.orSay")}{" "}
            <span className="font-mono text-foreground">"{t("import.importNewRecipe")}"</span>.
          </p>
        </div>
      </section>

      <section className="flex-1">
        <div className="page-content-container">
          <div className="grid gap-8 lg:grid-cols-12">

            {/* ── Left: drop zone / progress / preview ── */}
            <div className="lg:col-span-7 space-y-6">

              {/* Idle drop zone */}
              {stage === "idle" && (
                <div
                  className={`relative rounded-3xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-clay bg-clay/5"
                      : "border-border bg-card hover:border-clay/60"
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <VoiceBadge n={1} className="absolute top-4 left-4" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                    className="hidden"
                    onChange={handleInputChange}
                  />

                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-foreground/30">
                    <FileVideo className="h-9 w-9" strokeWidth={1.25} />
                  </div>

                  {selectedFile ? (
                    <>
                      <h3 className="mt-6 font-display text-2xl truncate max-w-xs mx-auto">
                        {selectedFile.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatBytes(selectedFile.size)}
                      </p>
                      <button
                        className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay"
                        onClick={(e) => { e.stopPropagation(); startPipeline(); }}
                      >
                        <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.startProcessing")}
                      </button>
                    </>
                  ) : (
                    <>
                      <h3 className="mt-6 font-display text-2xl">{t("import.dropVideo")}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t("import.orClickBrowse")}
                      </p>
                      <button
                        className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      >
                        <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
                        {t("import.chooseVideo")}
                      </button>
                    </>
                  )}

                  <VoiceHint className="mt-6 justify-center">{t("import.orSaySelect")}</VoiceHint>
                </div>
              )}

              {/* Processing */}
              {isRunning && (
                <div className="relative rounded-3xl border border-border bg-card p-12 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-foreground/30">
                    <Loader2 className="h-9 w-9 animate-spin" strokeWidth={1.25} />
                  </div>
                  <h3 className="mt-6 font-display text-2xl">{stageLabelKeys[stage] ? t(stageLabelKeys[stage]) : ""}</h3>
                  <p className="mt-2 text-sm text-muted-foreground truncate max-w-xs mx-auto">
                    {selectedFile?.name}
                  </p>
                  {/* Progress dots */}
                  <div className="mt-8 flex gap-2 justify-center">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-2 w-12 rounded-full transition-colors ${
                          i <= activeIdx ? "bg-clay" : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {stage === "error" && (
                <div className="relative rounded-3xl border border-destructive/40 bg-destructive/5 p-12 text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-destructive/30">
                    <XCircle className="h-9 w-9 text-destructive" strokeWidth={1.25} />
                  </div>
                  <h3 className="mt-6 font-display text-2xl text-destructive">{t("import.failed")}</h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">{error}</p>
                  <button
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm text-background hover:bg-clay"
                    onClick={reset}
                  >
                    {t("import.retry")}
                  </button>
                </div>
              )}

              {/* Preview — structured recipe */}
              {(stage === "preview" || stage === "saving" || stage === "done") && structuredRecipe && (
                <div className="rounded-3xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-lg">{t("import.extractionPreview")}</h4>
                    <span className="inline-flex items-center gap-1.5 text-xs text-clay">
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("import.readyToSave")}
                    </span>
                  </div>

                  {/* Title */}
                  {editMode ? (
                    <input
                      className="mt-4 w-full rounded-xl border border-border bg-background px-4 py-2.5 font-display text-xl outline-none focus:border-clay"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  ) : (
                    <h3 className="mt-4 font-display text-3xl">{structuredRecipe.title}</h3>
                  )}

                  {/* Tags */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {structuredRecipe.tags.cuisine && (
                      <span className="rounded-full border border-border px-3 py-1 text-xs">
                        {structuredRecipe.tags.cuisine}
                      </span>
                    )}
                    {structuredRecipe.tags.difficulty && (
                      <span className="rounded-full border border-border px-3 py-1 text-xs capitalize">
                        {structuredRecipe.tags.difficulty}
                      </span>
                    )}
                    {structuredRecipe.tags.totalTimeMin && (
                      <span className="rounded-full border border-border px-3 py-1 text-xs">
                        {t("recipes.minutes", { count: structuredRecipe.tags.totalTimeMin })}
                      </span>
                    )}
                  </div>

                  {/* Steps */}
                  <div className="mt-4 space-y-2">
                    {(editMode ? editSteps : structuredRecipe.steps).map((s, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 rounded-xl border border-border bg-background p-3"
                      >
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-foreground/40 font-display text-xs">
                          {i + 1}
                        </span>
                        {editMode ? (
                          <textarea
                            className="flex-1 bg-transparent text-sm outline-none resize-none"
                            value={s.description}
                            rows={2}
                            onChange={(e) => {
                              const updated = [...editSteps];
                              updated[i] = { ...updated[i], description: e.target.value };
                              setEditSteps(updated);
                            }}
                          />
                        ) : (
                          <div className="flex-1">
                            <span className="text-sm">{s.description}</span>
                            {s.tips && (
                              <p className="mt-1 text-xs text-clay">{s.tips}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                      onClick={handleSave}
                      disabled={stage === "saving" || stage === "done"}
                    >
                      {stage === "saving" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> {t("import.saving")}</>
                      ) : stage === "done" ? (
                        <><CheckCircle2 className="h-4 w-4" /> {t("import.saved")}</>
                      ) : (
                        <>
                          <VoiceBadge
                            n={2}
                            className="!border-background/40 !text-background !bg-transparent !opacity-100"
                          />
                          {t("import.saveToRecipes")}
                        </>
                      )}
                    </button>
                    <button
                      className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground"
                      onClick={() => setEditMode((v) => !v)}
                    >
                      {editMode ? t("import.doneEditing") : t("import.editFields")}
                    </button>
                    <button
                      className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground"
                      onClick={reset}
                    >
                      {t("import.startOver")}
                    </button>
                  </div>
                </div>
              )}

              {/* Preview — transcript only (no LLM) */}
              {(stage === "preview" || stage === "saving" || stage === "done") &&
                !structuredRecipe &&
                transcript && (
                  <div className="rounded-3xl border border-border bg-card p-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-lg">{t("import.transcriptOnly")}</h4>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("import.noLlmKey")}
                      </span>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground line-clamp-8">{transcript}</p>
                    <div className="mt-5 flex gap-2">
                      <button
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:bg-clay disabled:opacity-50"
                        onClick={handleSave}
                        disabled={stage === "saving" || stage === "done"}
                      >
                        {stage === "saving" ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> {t("import.saving")}</>
                        ) : stage === "done" ? (
                          <><CheckCircle2 className="h-4 w-4" /> {t("import.saved")}</>
                        ) : (
                          t("import.saveTranscript")
                        )}
                      </button>
                      <button
                        className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-foreground"
                        onClick={reset}
                      >
                        {t("import.startOver")}
                      </button>
                    </div>
                  </div>
                )}
            </div>

            {/* ── Right: pipeline sidebar ── */}
            <div className="lg:col-span-5">
              <h4 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("import.pipeline")}</h4>
              <ol className="mt-3 space-y-3">
                {pipelineStages.map((s, i) => {
                  const isActive = isRunning && activeIdx === i;
                  const isDone =
                    (activeIdx > i && activeIdx !== -1) ||
                    stage === "preview" ||
                    stage === "saving" ||
                    stage === "done";
                  return (
                    <li
                      key={s.labelKey}
                      className={`flex gap-4 rounded-2xl border p-4 transition-colors ${
                        isActive
                          ? "border-clay bg-clay/5"
                          : isDone
                          ? "border-border bg-card opacity-70"
                          : "border-border bg-card"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          isActive ? "bg-clay text-background" : "bg-secondary"
                        }`}
                      >
                        {isActive ? (
                          <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
                        ) : isDone ? (
                          <CheckCircle2 className="h-5 w-5 text-clay" strokeWidth={1.5} />
                        ) : (
                          <s.icon className="h-5 w-5" strokeWidth={1.5} />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-display text-base">{t(s.labelKey)}</span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t("import.step", { count: i + 1 })}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{t(s.bodyKey)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-6 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-clay" strokeWidth={1.75} />
                  <span className="text-sm font-medium">{t("import.aiFollowUp")}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("import.aiFollowUpBody")}
                </p>
                <button
                  onClick={() => navigate({ to: "/recipes" })}
                  className="mt-4 inline-flex text-sm text-clay hover:underline"
                >
                  {t("import.viewRecipes")} →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
