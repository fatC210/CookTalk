import { create } from "zustand";

interface CookingState {
  isActive: boolean;
  recipeId: string | null;
  currentStep: number;
  totalSteps: number;
  isPaused: boolean;

  startCooking: (recipeId: string, totalSteps: number, initialStep?: number) => void;
  endCooking: () => void;
  nextStep: () => void;
  prevStep: () => void;
  jumpToStep: (n: number) => void;
  pauseCooking: () => void;
  resumeCooking: () => void;
}

export const useCookingStore = create<CookingState>()((set, get) => ({
  isActive: false,
  recipeId: null,
  currentStep: 0,
  totalSteps: 0,
  isPaused: false,

  startCooking: (recipeId, totalSteps, initialStep = 0) =>
    set({
      isActive: true,
      recipeId,
      currentStep: Math.max(0, Math.min(initialStep, Math.max(totalSteps - 1, 0))),
      totalSteps,
      isPaused: false,
    }),

  endCooking: () =>
    set({ isActive: false, recipeId: null, currentStep: 0, totalSteps: 0, isPaused: false }),

  nextStep: () =>
    set((s) => ({
      currentStep: Math.min(s.currentStep + 1, s.totalSteps - 1),
    })),

  prevStep: () =>
    set((s) => ({
      currentStep: Math.max(s.currentStep - 1, 0),
    })),

  jumpToStep: (n) =>
    set((s) => ({
      currentStep: Math.max(0, Math.min(n, s.totalSteps - 1)),
    })),

  pauseCooking: () => set({ isPaused: true }),

  resumeCooking: () => set({ isPaused: false }),
}));
