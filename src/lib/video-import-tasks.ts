import { v4 as uuid } from "uuid";
import type {
  PipelineStage,
  StructuredRecipe,
  VideoImportDraftSnapshot,
} from "@/stores/import-draft-store";
import type { Recipe, VideoImportTask, VideoImportTaskProgress } from "@/lib/db";

export const MAX_VIDEO_IMPORT_TASKS = 3;

function cloneStructuredRecipe(recipe: StructuredRecipe | null): StructuredRecipe | null {
  if (!recipe) return null;
  return {
    title: recipe.title,
    ingredients: recipe.ingredients.map((item) => ({ ...item })),
    steps: recipe.steps.map((step) => ({ ...step })),
    tags: {
      ...recipe.tags,
      flavor: recipe.tags.flavor ? [...recipe.tags.flavor] : undefined,
    },
  };
}

export function cloneVideoImportDraftSnapshot(
  snapshot: VideoImportDraftSnapshot,
): VideoImportDraftSnapshot {
  return {
    selectedMediaFile: snapshot.selectedMediaFile ?? null,
    stage: snapshot.stage,
    error: snapshot.error,
    transcript: snapshot.transcript,
    structuredRecipe: cloneStructuredRecipe(snapshot.structuredRecipe),
    coverImage: snapshot.coverImage ?? null,
    videoCoverSource: snapshot.videoCoverSource as Recipe["coverSource"],
    editTitle: snapshot.editTitle,
    editSteps: snapshot.editSteps.map((step) => ({ ...step })),
    editIngredients: snapshot.editIngredients.map((item) => ({ ...item })),
    editDifficulty: snapshot.editDifficulty,
    editTotalTime: snapshot.editTotalTime,
    followUpAnswers: {
      servings: snapshot.followUpAnswers?.servings ?? "",
      spiceLevel: snapshot.followUpAnswers?.spiceLevel ?? "",
      notes: snapshot.followUpAnswers?.notes ?? "",
    },
    followUpProgress: {
      servings: snapshot.followUpProgress?.servings ?? "pending",
      spiceLevel: snapshot.followUpProgress?.spiceLevel ?? "pending",
      notes: snapshot.followUpProgress?.notes ?? "pending",
    },
    followUpIndex: snapshot.followUpIndex ?? 0,
    followUpInput: snapshot.followUpInput ?? "",
    followUpPrompt: snapshot.followUpPrompt ?? "",
    followUpStatus: snapshot.followUpStatus ?? "idle",
    followUpError: snapshot.followUpError ?? null,
    followUpStarted: snapshot.followUpStarted ?? false,
    followUpCompleted: snapshot.followUpCompleted ?? false,
  };
}

export function deriveTaskDisplayTitle(
  snapshot: VideoImportDraftSnapshot,
  fallbackFileName: string,
): string {
  return snapshot.editTitle.trim() || snapshot.structuredRecipe?.title?.trim() || fallbackFileName;
}

export function getTaskProgressMeta(snapshot: VideoImportDraftSnapshot): {
  progress: VideoImportTaskProgress;
  progressPercent: number;
  progressLabelKey: string;
  stage: PipelineStage;
} {
  if (snapshot.stage === "done") {
    return {
      progress: "done",
      progressPercent: 100,
      progressLabelKey: "import.taskProgress.done",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "error") {
    return {
      progress: "error",
      progressPercent: 100,
      progressLabelKey: "import.taskProgress.error",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "saving") {
    return {
      progress: "saving",
      progressPercent: 92,
      progressLabelKey: "import.taskProgress.saving",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "generating-cover") {
    return {
      progress: "cover",
      progressPercent: 84,
      progressLabelKey: "import.taskProgress.cover",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "preview") {
    if (!snapshot.structuredRecipe && snapshot.transcript.trim()) {
      return {
        progress: "cover",
        progressPercent: 76,
        progressLabelKey: "import.taskProgress.transcriptOnly",
        stage: snapshot.stage,
      };
    }

    return {
      progress: "cover",
      progressPercent: 88,
      progressLabelKey: "import.taskProgress.readyToSave",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "structuring") {
    return {
      progress: "structuring",
      progressPercent: 45,
      progressLabelKey: "import.taskProgress.structuring",
      stage: snapshot.stage,
    };
  }

  if (snapshot.stage === "transcribing") {
    return {
      progress: "transcribing",
      progressPercent: 18,
      progressLabelKey: "import.taskProgress.transcribing",
      stage: snapshot.stage,
    };
  }

  return {
    progress: "pending",
    progressPercent: snapshot.selectedMediaFile ? 8 : 0,
    progressLabelKey: snapshot.selectedMediaFile
      ? "import.taskProgress.pending"
      : "import.taskProgress.empty",
    stage: snapshot.stage,
  };
}

export function createVideoImportTask(
  file: File,
  snapshot: VideoImportDraftSnapshot,
): VideoImportTask {
  const now = Date.now();
  const taskSnapshot = cloneVideoImportDraftSnapshot(snapshot);
  const progressMeta = getTaskProgressMeta(taskSnapshot);

  return {
    id: uuid(),
    kind: "media",
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    createdAt: now,
    updatedAt: now,
    recipeTitle: deriveTaskDisplayTitle(taskSnapshot, file.name),
    snapshot: taskSnapshot,
    ...progressMeta,
  };
}

export function createTextImportTask(
  rawText: string,
  snapshot: VideoImportDraftSnapshot,
  fallbackName: string,
): VideoImportTask {
  const now = Date.now();
  const taskSnapshot = cloneVideoImportDraftSnapshot(snapshot);
  const progressMeta = getTaskProgressMeta(taskSnapshot);

  return {
    id: uuid(),
    kind: "text",
    fileName: fallbackName,
    fileSize: new Blob([rawText]).size,
    fileType: "text/plain",
    createdAt: now,
    updatedAt: now,
    recipeTitle: deriveTaskDisplayTitle(taskSnapshot, fallbackName),
    snapshot: taskSnapshot,
    ...progressMeta,
  };
}

export function updateVideoImportTask(
  task: VideoImportTask,
  snapshot: VideoImportDraftSnapshot,
): VideoImportTask {
  const nextSnapshot = cloneVideoImportDraftSnapshot(snapshot);
  const progressMeta = getTaskProgressMeta(nextSnapshot);

  return {
    ...task,
    updatedAt: Date.now(),
    recipeTitle: deriveTaskDisplayTitle(nextSnapshot, task.fileName),
    snapshot: nextSnapshot,
    ...progressMeta,
  };
}
