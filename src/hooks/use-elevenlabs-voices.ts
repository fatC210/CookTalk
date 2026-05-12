import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiKey } from "@/lib/crypto";
import type { Voice } from "@/lib/db";
import { ElevenLabsService, type ElevenLabsVoice } from "@/lib/elevenlabs";
import { useAppStore } from "@/stores/app-store";

export type ElevenLabsVoiceOption = {
  label: string;
  value: string;
  description: string;
  displayLabel: string;
  previewUrl: string | null;
};

export function getElevenLabsVoicePreviewUrl(voice: ElevenLabsVoice): string | null {
  return (
    voice.preview_url ??
    voice.verified_languages?.find((language) => language.preview_url)?.preview_url ??
    null
  );
}

export function getElevenLabsVoiceGender(
  voice: ElevenLabsVoice,
  fallbackGender = "unknown",
): string {
  return voice.labels?.gender?.trim() || fallbackGender;
}

export function formatElevenLabsVoiceDisplayLabel(
  voice: ElevenLabsVoice,
  fallbackGender = "unknown",
): string {
  return `${voice.name} - ${getElevenLabsVoiceGender(voice, fallbackGender)}`;
}

export function isSupportedElevenLabsVoice(voice: ElevenLabsVoice): boolean {
  return voice.category?.trim().toLowerCase() !== "cloned";
}

export function getSupportedElevenLabsVoices(voices: ElevenLabsVoice[]): ElevenLabsVoice[] {
  return voices
    .filter((voice) => voice.voice_id && voice.name && isSupportedElevenLabsVoice(voice))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFirstElevenLabsVoiceId(service: ElevenLabsService): Promise<string | null> {
  return getSupportedElevenLabsVoices(await service.listVoices({ showLegacy: true }))[0]?.voice_id ?? null;
}

export async function getFirstElevenLabsVoiceIdFromApiKey(apiKey: string): Promise<string | null> {
  return getFirstElevenLabsVoiceId(new ElevenLabsService(apiKey));
}

export function getDefaultVoiceId(options: ElevenLabsVoiceOption[]): string | null {
  return options[0]?.value ?? null;
}

export function resolveVoiceId(
  voiceId: string | null | undefined,
  options: ElevenLabsVoiceOption[],
  fallbackVoiceId = getDefaultVoiceId(options),
): string | null {
  return voiceId && options.some((option) => option.value === voiceId)
    ? voiceId
    : fallbackVoiceId;
}

export function useDefaultElevenLabsVoiceSelection(
  options: ElevenLabsVoiceOption[],
  fallbackVoiceId: string | null,
  setters: Array<(id: string) => void>,
  values: Array<string | null | undefined>,
): string | null {
  const defaultVoiceId = fallbackVoiceId ?? getDefaultVoiceId(options);

  useEffect(() => {
    if (!defaultVoiceId) return;

    setters.forEach((setVoiceId, index) => {
      const resolvedVoiceId = resolveVoiceId(values[index], options, defaultVoiceId);
      if (resolvedVoiceId && values[index] !== resolvedVoiceId) setVoiceId(resolvedVoiceId);
    });
  }, [defaultVoiceId, options, setters, values]);

  return defaultVoiceId;
}

export function toElevenLabsVoiceOption(
  voice: ElevenLabsVoice,
  fallbackGender?: string,
): ElevenLabsVoiceOption {
  const gender = getElevenLabsVoiceGender(voice, fallbackGender);

  return {
    label: voice.name,
    value: voice.voice_id,
    description: gender,
    displayLabel: formatElevenLabsVoiceDisplayLabel(voice, fallbackGender),
    previewUrl: getElevenLabsVoicePreviewUrl(voice),
  };
}

export function toCombinedVoiceOptions(
  clonedVoices: Voice[],
  elevenLabsVoiceOptions: ElevenLabsVoiceOption[],
  formatClonedVoiceDescription: (voice: Voice) => string,
): ElevenLabsVoiceOption[] {
  const clonedVoiceOptionIds = new Set<string>();
  const clonedVoiceOptions = clonedVoices
    .filter((voice) => voice.elevenLabsVoiceId)
    .map((voice) => {
      const value = voice.elevenLabsVoiceId!;
      clonedVoiceOptionIds.add(value);
      const description = formatClonedVoiceDescription(voice);

      return {
        label: voice.name,
        value,
        description,
        displayLabel: `${voice.name} - ${description}`,
        previewUrl: null,
      };
    });

  return [
    ...clonedVoiceOptions,
    ...elevenLabsVoiceOptions.filter((option) => !clonedVoiceOptionIds.has(option.value)),
  ];
}

export function useElevenLabsVoices(refreshKey?: unknown) {
  const { t } = useTranslation();
  const hasElevenLabsKey = useAppStore((state) => state.hasElevenLabsKey);
  const setHasElevenLabsKey = useAppStore((state) => state.setHasElevenLabsKey);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    if (!hasElevenLabsKey) {
      setVoices([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const apiKey = await getApiKey("elevenlabs");
      if (!apiKey) {
        setHasElevenLabsKey(false);
        setVoices([]);
        setError(null);
        return;
      }

      const nextVoices = await new ElevenLabsService(apiKey).listVoices({ showLegacy: true });
      setVoices(getSupportedElevenLabsVoices(nextVoices));
      setError(null);
    } catch (err) {
      setVoices([]);
      setError(err instanceof Error ? err.message : t("voices.loadElevenLabsVoicesFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [hasElevenLabsKey, setHasElevenLabsKey, t]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices, refreshKey]);

  const options = useMemo(
    () => voices.map((voice) => toElevenLabsVoiceOption(voice, t("common.unknown"))),
    [t, voices],
  );

  return {
    voices,
    options,
    isLoading,
    error,
    hasElevenLabsKey,
    reload: loadVoices,
  };
}
