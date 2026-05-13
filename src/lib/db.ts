import Dexie, { type EntityTable } from "dexie";
import { v4 as uuidv4 } from "uuid";
import type { VideoImportDraftSnapshot } from "@/stores/import-draft-store";

export interface Recipe {
  id: string;
  title: string;
  coverImage?: Blob;
  coverSource: "user" | "ai" | "default";
  sourceUrl?: string;
  ingredients: { name: string; amount: string }[];
  steps: {
    order: number;
    description: string;
    durationSec?: number;
    tips?: string;
  }[];
  tags: {
    flavor?: string[];
    difficulty?: "easy" | "medium" | "hard";
    cuisine?: string;
    totalTimeMin?: number;
    servings?: number;
    spiceLevel?: string;
    notes?: string;
  };
  rawVideo?: Blob;
  rawAudio?: Blob;
  rawTranscript?: string;
  voiceId?: string;
  createdAt: number;
  lastCookedAt?: number;
}

export interface Voice {
  id: string;
  name: string;
  elevenLabsVoiceId?: string;
  isCloned: boolean;
  isDefault: boolean;
  language: string;
  description: string;
  sampleBlob?: Blob;
  createdAt: number;
}

export interface VoicePreviewCacheEntry {
  key: string;
  ownerKey: string;
  audioBlob: Blob;
  createdAt: number;
}

export type VideoImportTaskProgress =
  | "pending"
  | "transcribing"
  | "structuring"
  | "follow-up"
  | "cover"
  | "saving"
  | "done"
  | "error";

export interface VideoImportTask {
  id: string;
  kind?: "media" | "text";
  fileName: string;
  fileSize: number;
  fileType: string;
  createdAt: number;
  updatedAt: number;
  progress: VideoImportTaskProgress;
  progressPercent: number;
  progressLabelKey: string;
  recipeTitle: string;
  snapshot: VideoImportDraftSnapshot;
}

class CookTalkDB extends Dexie {
  recipes!: EntityTable<Recipe, "id">;
  voices!: EntityTable<Voice, "id">;
  voicePreviewCache!: EntityTable<VoicePreviewCacheEntry, "key">;
  videoImportTasks!: EntityTable<VideoImportTask, "id">;

  constructor() {
    super("CookTalkDB");
    this.version(1).stores({
      recipes: "id, title, createdAt, lastCookedAt, *tags.flavor",
      voices: "id, name, isDefault, language, createdAt",
    });
    this.version(2).stores({
      recipes: "id, title, createdAt, lastCookedAt, *tags.flavor",
      voices: "id, name, isDefault, language, createdAt",
      voicePreviewCache: "key, ownerKey, createdAt",
    });
    this.version(3).stores({
      recipes: "id, title, createdAt, lastCookedAt, *tags.flavor",
      voices: "id, name, isDefault, language, createdAt",
      voicePreviewCache: "key, ownerKey, createdAt",
      videoImportTasks: "id, updatedAt, createdAt",
    });
  }
}

export const db = new CookTalkDB();

// ── Recipe helpers ──────────────────────────────────────────────────────────

export async function getAllRecipes(): Promise<Recipe[]> {
  return db.recipes.orderBy("createdAt").reverse().toArray();
}

export async function getRecipeById(id: string): Promise<Recipe | undefined> {
  return db.recipes.get(id);
}

export async function addRecipe(
  recipe: Omit<Recipe, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<string> {
  const id = recipe.id ?? uuidv4();
  const createdAt = recipe.createdAt ?? Date.now();
  await db.recipes.add({ ...recipe, id, createdAt });
  return id;
}

export async function updateRecipe(
  id: string,
  changes: Partial<Omit<Recipe, "id">>,
): Promise<void> {
  await db.recipes.update(id, changes);
}

export async function deleteRecipe(id: string): Promise<void> {
  await db.recipes.delete(id);
}

export async function searchRecipes(query: string): Promise<Recipe[]> {
  const q = query.toLowerCase();
  const all = await getAllRecipes();
  return all.filter((r) => {
    if (r.title.toLowerCase().includes(q)) return true;
    if (r.ingredients.some((i) => i.name.toLowerCase().includes(q))) return true;
    const { flavor, cuisine } = r.tags;
    if (cuisine?.toLowerCase().includes(q)) return true;
    if (flavor?.some((f) => f.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ── Voice helpers ────────────────────────────────────────────────────────────

export async function getAllVoices(): Promise<Voice[]> {
  return db.voices.orderBy("createdAt").toArray();
}

export async function addVoice(
  voice: Omit<Voice, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<string> {
  const id = voice.id ?? uuidv4();
  const createdAt = voice.createdAt ?? Date.now();
  await db.voices.add({ ...voice, id, createdAt });
  return id;
}

export async function deleteVoice(id: string): Promise<void> {
  await db.transaction("rw", db.voices, db.voicePreviewCache, async () => {
    await db.voices.delete(id);
    const previewKeys = await db.voicePreviewCache
      .where("ownerKey")
      .equals(`cloned:${id}`)
      .primaryKeys();
    if (previewKeys.length > 0) {
      await db.voicePreviewCache.bulkDelete(previewKeys as string[]);
    }
  });
}

// ── Seed data cleanup ────────────────────────────────────────────────────────

const SAMPLE_RECIPE_IDS = ["seed-001", "seed-002", "seed-003", "seed-004", "seed-005", "seed-006"];

export async function removeSampleRecipes(): Promise<void> {
  await db.recipes.bulkDelete(SAMPLE_RECIPE_IDS);
}

export async function getVoicePreviewAudio(key: string): Promise<Blob | null> {
  const entry = await db.voicePreviewCache.get(key);
  return entry?.audioBlob ?? null;
}

export async function saveVoicePreviewAudio(
  entry: Omit<VoicePreviewCacheEntry, "createdAt"> & { createdAt?: number },
): Promise<void> {
  await db.voicePreviewCache.put({
    ...entry,
    createdAt: entry.createdAt ?? Date.now(),
  });
}

export async function getAllVideoImportTasks(): Promise<VideoImportTask[]> {
  return db.videoImportTasks.orderBy("createdAt").reverse().toArray();
}

export async function saveVideoImportTask(task: VideoImportTask): Promise<void> {
  await db.videoImportTasks.put(task);
}

export async function deleteVideoImportTask(id: string): Promise<void> {
  await db.videoImportTasks.delete(id);
}
