import type { Dispatch, SetStateAction } from "react";
import { create } from "zustand";
import type { Recipe } from "@/lib/db";

export type PipelineStage =
  | "idle"
  | "transcribing"
  | "structuring"
  | "generating-cover"
  | "preview"
  | "saving"
  | "done"
  | "error";

export type ImportMode = "video" | "manual";
export type FollowUpField = "servings" | "spiceLevel" | "notes";
export type FollowUpStatus =
  | "idle"
  | "speaking"
  | "listening"
  | "transcribing"
  | "refining"
  | "done";
export type FollowUpProgressState = "pending" | "answered" | "skipped";

export type StructuredRecipe = {
  title: string;
  ingredients: { name: string; amount: string }[];
  steps: { order: number; description: string; durationSec?: number; tips?: string }[];
  tags: Recipe["tags"];
};

export type FollowUpAnswers = Record<FollowUpField, string>;
export type FollowUpProgress = Record<FollowUpField, FollowUpProgressState>;
export type ManualIngredient = StructuredRecipe["ingredients"][number];
export type ManualDifficulty = Exclude<Recipe["tags"]["difficulty"], undefined> | "";
export type ManualStep = {
  description: string;
  durationMin: string;
  tips: string;
};

export type ManualTextImportStatus = "idle" | "structuring";

type Setter<T> = Dispatch<SetStateAction<T>>;

type ImportDraftValues = {
  mode: ImportMode;
  isDragging: boolean;
  selectedMediaFile: File | null;
  stage: PipelineStage;
  error: string | null;
  transcript: string;
  structuredRecipe: StructuredRecipe | null;
  coverImage: Blob | null;
  videoCoverSource: Recipe["coverSource"];
  editTitle: string;
  editSteps: StructuredRecipe["steps"];
  editIngredients: StructuredRecipe["ingredients"];
  editDifficulty: ManualDifficulty;
  editTotalTime: string;
  followUpAnswers: FollowUpAnswers;
  followUpProgress: FollowUpProgress;
  followUpIndex: number;
  followUpInput: string;
  followUpPrompt: string;
  followUpStatus: FollowUpStatus;
  followUpError: string | null;
  followUpStarted: boolean;
  followUpCompleted: boolean;
  manualTitle: string;
  manualCuisine: string;
  manualDifficulty: ManualDifficulty;
  manualTotalTime: string;
  manualFlavors: string;
  manualIngredients: ManualIngredient[];
  manualSteps: ManualStep[];
  manualRawText: string;
  isManualTextDialogOpen: boolean;
  manualTextImportStatus: ManualTextImportStatus;
  manualTextImportError: string | null;
  manualCoverImage: Blob | null;
  manualCoverSource: Recipe["coverSource"];
  isManualGeneratingCover: boolean;
  isManualSaving: boolean;
};

type ImportDraftActions = {
  setMode: Setter<ImportMode>;
  setIsDragging: Setter<boolean>;
  setSelectedMediaFile: Setter<File | null>;
  setStage: Setter<PipelineStage>;
  setError: Setter<string | null>;
  setTranscript: Setter<string>;
  setStructuredRecipe: Setter<StructuredRecipe | null>;
  setCoverImage: Setter<Blob | null>;
  setVideoCoverSource: Setter<Recipe["coverSource"]>;
  setEditTitle: Setter<string>;
  setEditSteps: Setter<StructuredRecipe["steps"]>;
  setEditIngredients: Setter<StructuredRecipe["ingredients"]>;
  setEditDifficulty: Setter<ManualDifficulty>;
  setEditTotalTime: Setter<string>;
  setFollowUpAnswers: Setter<FollowUpAnswers>;
  setFollowUpProgress: Setter<FollowUpProgress>;
  setFollowUpIndex: Setter<number>;
  setFollowUpInput: Setter<string>;
  setFollowUpPrompt: Setter<string>;
  setFollowUpStatus: Setter<FollowUpStatus>;
  setFollowUpError: Setter<string | null>;
  setFollowUpStarted: Setter<boolean>;
  setFollowUpCompleted: Setter<boolean>;
  setManualTitle: Setter<string>;
  setManualCuisine: Setter<string>;
  setManualDifficulty: Setter<ManualDifficulty>;
  setManualTotalTime: Setter<string>;
  setManualFlavors: Setter<string>;
  setManualIngredients: Setter<ManualIngredient[]>;
  setManualSteps: Setter<ManualStep[]>;
  setManualRawText: Setter<string>;
  setIsManualTextDialogOpen: Setter<boolean>;
  setManualTextImportStatus: Setter<ManualTextImportStatus>;
  setManualTextImportError: Setter<string | null>;
  setManualCoverImage: Setter<Blob | null>;
  setManualCoverSource: Setter<Recipe["coverSource"]>;
  setIsManualGeneratingCover: Setter<boolean>;
  setIsManualSaving: Setter<boolean>;
  clearFollowUpDraft: () => void;
  clearVideoDraft: () => void;
  clearManualDraft: () => void;
};

type ImportDraftState = ImportDraftValues & ImportDraftActions;

export function createEmptyIngredient(): ManualIngredient {
  return { name: "", amount: "" };
}

export function createEmptyManualStep(): ManualStep {
  return { description: "", durationMin: "", tips: "" };
}

export function createEmptyRecipeStep(order = 1): StructuredRecipe["steps"][number] {
  return { order, description: "", durationSec: undefined, tips: "" };
}

export function createEmptyFollowUpAnswers(): FollowUpAnswers {
  return {
    servings: "",
    spiceLevel: "",
    notes: "",
  };
}

export function createEmptyFollowUpProgress(): FollowUpProgress {
  return {
    servings: "pending",
    spiceLevel: "pending",
    notes: "pending",
  };
}

function createFollowUpDraft(): Pick<
  ImportDraftValues,
  | "followUpAnswers"
  | "followUpProgress"
  | "followUpIndex"
  | "followUpInput"
  | "followUpPrompt"
  | "followUpStatus"
  | "followUpError"
  | "followUpStarted"
  | "followUpCompleted"
> {
  return {
    followUpAnswers: createEmptyFollowUpAnswers(),
    followUpProgress: createEmptyFollowUpProgress(),
    followUpIndex: 0,
    followUpInput: "",
    followUpPrompt: "",
    followUpStatus: "idle",
    followUpError: null,
    followUpStarted: false,
    followUpCompleted: false,
  };
}

function createInitialImportDraft(): ImportDraftValues {
  return {
    mode: "video",
    isDragging: false,
    selectedMediaFile: null,
    stage: "idle",
    error: null,
    transcript: "",
    structuredRecipe: null,
    coverImage: null,
    videoCoverSource: "default",
    editTitle: "",
    editSteps: [],
    editIngredients: [],
    editDifficulty: "",
    editTotalTime: "",
    ...createFollowUpDraft(),
    manualTitle: "",
    manualCuisine: "",
    manualDifficulty: "",
    manualTotalTime: "",
    manualFlavors: "",
    manualIngredients: [createEmptyIngredient()],
    manualSteps: [createEmptyManualStep()],
    manualRawText: "",
    isManualTextDialogOpen: false,
    manualTextImportStatus: "idle",
    manualTextImportError: null,
    manualCoverImage: null,
    manualCoverSource: "default",
    isManualGeneratingCover: false,
    isManualSaving: false,
  };
}

function resolveSetState<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === "function" ? (value as (current: T) => T)(current) : value;
}

export const useImportDraftStore = create<ImportDraftState>()((set) => {
  const setField =
    <K extends keyof ImportDraftValues>(key: K): Setter<ImportDraftValues[K]> =>
    (value) =>
      set(
        (state) =>
          ({
            [key]: resolveSetState(value, state[key]),
          }) as Pick<ImportDraftValues, K>,
      );

  return {
    ...createInitialImportDraft(),
    setMode: setField("mode"),
    setIsDragging: setField("isDragging"),
    setSelectedMediaFile: setField("selectedMediaFile"),
    setStage: setField("stage"),
    setError: setField("error"),
    setTranscript: setField("transcript"),
    setStructuredRecipe: setField("structuredRecipe"),
    setCoverImage: setField("coverImage"),
    setVideoCoverSource: setField("videoCoverSource"),
    setEditTitle: setField("editTitle"),
    setEditSteps: setField("editSteps"),
    setEditIngredients: setField("editIngredients"),
    setEditDifficulty: setField("editDifficulty"),
    setEditTotalTime: setField("editTotalTime"),
    setFollowUpAnswers: setField("followUpAnswers"),
    setFollowUpProgress: setField("followUpProgress"),
    setFollowUpIndex: setField("followUpIndex"),
    setFollowUpInput: setField("followUpInput"),
    setFollowUpPrompt: setField("followUpPrompt"),
    setFollowUpStatus: setField("followUpStatus"),
    setFollowUpError: setField("followUpError"),
    setFollowUpStarted: setField("followUpStarted"),
    setFollowUpCompleted: setField("followUpCompleted"),
    setManualTitle: setField("manualTitle"),
    setManualCuisine: setField("manualCuisine"),
    setManualDifficulty: setField("manualDifficulty"),
    setManualTotalTime: setField("manualTotalTime"),
    setManualFlavors: setField("manualFlavors"),
    setManualIngredients: setField("manualIngredients"),
    setManualSteps: setField("manualSteps"),
    setManualRawText: setField("manualRawText"),
    setIsManualTextDialogOpen: setField("isManualTextDialogOpen"),
    setManualTextImportStatus: setField("manualTextImportStatus"),
    setManualTextImportError: setField("manualTextImportError"),
    setManualCoverImage: setField("manualCoverImage"),
    setManualCoverSource: setField("manualCoverSource"),
    setIsManualGeneratingCover: setField("isManualGeneratingCover"),
    setIsManualSaving: setField("isManualSaving"),
    clearFollowUpDraft: () => set(createFollowUpDraft()),
    clearVideoDraft: () =>
      set({
        selectedMediaFile: null,
        stage: "idle",
        error: null,
        transcript: "",
        structuredRecipe: null,
        coverImage: null,
        videoCoverSource: "default",
        editTitle: "",
        editIngredients: [],
        editSteps: [],
        editDifficulty: "",
        editTotalTime: "",
        ...createFollowUpDraft(),
      }),
    clearManualDraft: () =>
      set({
        manualTitle: "",
        manualCuisine: "",
        manualDifficulty: "",
        manualTotalTime: "",
        manualFlavors: "",
        manualIngredients: [createEmptyIngredient()],
        manualSteps: [createEmptyManualStep()],
        manualRawText: "",
        isManualTextDialogOpen: false,
        manualTextImportStatus: "idle",
        manualTextImportError: null,
        manualCoverImage: null,
        manualCoverSource: "default",
        isManualGeneratingCover: false,
        isManualSaving: false,
      }),
  };
});
