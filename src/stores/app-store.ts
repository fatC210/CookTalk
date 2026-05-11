import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/lib/i18n";
import { LANGUAGE_COOKIE_NAME } from "@/lib/language";

export const BUILT_IN_WAKE_WORD = "Hey CookTalk";
const LEGACY_WAKE_WORDS = ["嗨厨语"];

function normalizeWakeWord(word: string): string {
  return word.toLowerCase().replace(/[/\s+\-_']+/g, "");
}

export function isBuiltInWakeWord(word: string): boolean {
  return normalizeWakeWord(word) === "heycooktalk";
}

function isLegacyWakeWord(word: string): boolean {
  return LEGACY_WAKE_WORDS.some(
    (legacyWakeWord) => normalizeWakeWord(legacyWakeWord) === normalizeWakeWord(word),
  );
}

function sanitizeWakeWords(wakeWords: string[]): string[] {
  const seenWakeWords = new Set<string>();

  return wakeWords.reduce<string[]>((nextWakeWords, word) => {
    const trimmedWord = word.trim();
    const normalizedWord = normalizeWakeWord(trimmedWord);

    if (
      !trimmedWord ||
      !normalizedWord ||
      isBuiltInWakeWord(trimmedWord) ||
      isLegacyWakeWord(trimmedWord) ||
      seenWakeWords.has(normalizedWord)
    ) {
      return nextWakeWords;
    }

    seenWakeWords.add(normalizedWord);
    nextWakeWords.push(trimmedWord);
    return nextWakeWords;
  }, []);
}

export function getActiveWakeWords(wakeWords: string[]): string[] {
  return [BUILT_IN_WAKE_WORD, ...sanitizeWakeWords(wakeWords)];
}

export type HomeAwakeDetail = {
  phrase: string;
  source: "manual" | "wake-word";
  transcript: string;
};

interface AppState {
  // Theme
  theme: "light" | "dark" | "auto";
  setTheme: (theme: "light" | "dark" | "auto") => void;

  // Language
  language: "en" | "zh";
  setLanguage: (lang: "en" | "zh") => void;

  // Voice badges
  voiceBadgesVisible: boolean;
  toggleVoiceBadges: (state?: boolean) => void;

  // Wake word settings
  wakeWords: string[];
  addWakeWord: (word: string) => void;
  removeWakeWord: (word: string) => void;

  // Sensitivity
  sensitivity: "low" | "medium" | "high";
  setSensitivity: (level: "low" | "medium" | "high") => void;

  // Screen wake lock
  screenWakeLock: boolean;
  setScreenWakeLock: (on: boolean) => void;

  // Listen mode
  listenMode: "always" | "wake-word";
  setListenMode: (mode: "always" | "wake-word") => void;

  // Manual wake fallback
  manualWakeActive: boolean;
  manualWakeExpiresAt: number | null;
  triggerManualWake: (durationMs?: number) => void;
  clearManualWake: () => void;

  // Home conversation state
  homeConversationActive: boolean;
  setHomeConversationActive: (active: boolean) => void;
  pendingHomeAwake: HomeAwakeDetail | null;
  queueHomeAwake: (detail: HomeAwakeDetail) => void;
  clearHomeAwake: () => void;

  // Sound effects
  soundEffects: boolean;
  setSoundEffects: (on: boolean) => void;

  // Speech rate
  speechRate: number;
  setSpeechRate: (rate: number) => void;

  // Voice roles
  conversationVoiceId: string | null;
  cookingVoiceId: string | null;
  setConversationVoiceId: (id: string | null) => void;
  setCookingVoiceId: (id: string | null) => void;

  // Onboarding completed
  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;

  // API keys configured (flags only, actual keys in encrypted storage)
  hasElevenLabsKey: boolean;
  hasLlmKey: boolean;
  hasImageGenKey: boolean;
  setHasElevenLabsKey: (has: boolean) => void;
  setHasLlmKey: (has: boolean) => void;
  setHasImageGenKey: (has: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Theme
      theme: "light",
      setTheme: (theme) => set({ theme }),

      // Language
      language: "en",
      setLanguage: (language) => {
        set({ language });
        if (typeof document !== "undefined") {
          document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
        }
        void i18n.changeLanguage(language);
      },

      // Voice badges
      voiceBadgesVisible: true,
      toggleVoiceBadges: (state) =>
        set((s) => ({ voiceBadgesVisible: state !== undefined ? state : !s.voiceBadgesVisible })),

      // Wake words
      wakeWords: [],
      addWakeWord: (word) =>
        set((s) => {
          const nextWakeWords = sanitizeWakeWords([...s.wakeWords, word]);

          if (nextWakeWords.length === s.wakeWords.length) {
            return {};
          }

          return { wakeWords: nextWakeWords };
        }),
      removeWakeWord: (word) =>
        set((s) =>
          isBuiltInWakeWord(word)
            ? {}
            : { wakeWords: s.wakeWords.filter((existingWord) => existingWord !== word) },
        ),

      // Sensitivity
      sensitivity: "medium",
      setSensitivity: (sensitivity) => set({ sensitivity }),

      // Screen wake lock
      screenWakeLock: true,
      setScreenWakeLock: (screenWakeLock) => set({ screenWakeLock }),

      // Listen mode
      listenMode: "wake-word",
      setListenMode: (listenMode) => set({ listenMode }),

      // Manual wake fallback
      manualWakeActive: false,
      manualWakeExpiresAt: null,
      triggerManualWake: (durationMs = 15000) =>
        set({ manualWakeActive: true, manualWakeExpiresAt: Date.now() + durationMs }),
      clearManualWake: () => set({ manualWakeActive: false, manualWakeExpiresAt: null }),

      // Home conversation state
      homeConversationActive: false,
      setHomeConversationActive: (homeConversationActive) => set({ homeConversationActive }),
      pendingHomeAwake: null,
      queueHomeAwake: (pendingHomeAwake) => set({ pendingHomeAwake }),
      clearHomeAwake: () => set({ pendingHomeAwake: null }),

      // Sound effects
      soundEffects: false,
      setSoundEffects: (soundEffects) => set({ soundEffects }),

      // Speech rate
      speechRate: 1.0,
      setSpeechRate: (speechRate) => set({ speechRate }),

      // Voice roles
      conversationVoiceId: null,
      cookingVoiceId: null,
      setConversationVoiceId: (conversationVoiceId) => set({ conversationVoiceId }),
      setCookingVoiceId: (cookingVoiceId) => set({ cookingVoiceId }),

      // Onboarding
      onboardingCompleted: false,
      setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),

      // API keys
      hasElevenLabsKey: false,
      hasLlmKey: false,
      hasImageGenKey: false,
      setHasElevenLabsKey: (hasElevenLabsKey) => set({ hasElevenLabsKey }),
      setHasLlmKey: (hasLlmKey) => set({ hasLlmKey }),
      setHasImageGenKey: (hasImageGenKey) => set({ hasImageGenKey }),
    }),
    {
      name: "cooktalk-app",
      partialize: ({ manualWakeActive, manualWakeExpiresAt, pendingHomeAwake, ...state }) => state,
      merge: (persistedState, currentState) => {
        const nextState =
          persistedState && typeof persistedState === "object"
            ? (persistedState as Partial<AppState>)
            : {};

        return {
          ...currentState,
          ...nextState,
          wakeWords: sanitizeWakeWords(
            Array.isArray(nextState.wakeWords) ? nextState.wakeWords : currentState.wakeWords,
          ),
        };
      },
      skipHydration: true,
    },
  ),
);
