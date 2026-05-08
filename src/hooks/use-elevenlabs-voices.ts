import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiKey } from "@/lib/crypto";
import { ElevenLabsService, type ElevenLabsVoice } from "@/lib/elevenlabs";
import { useAppStore } from "@/stores/app-store";

export type ElevenLabsVoiceOption = {
  label: string;
  value: string;
  description: string;
  previewUrl: string | null;
};

export function getElevenLabsVoicePreviewUrl(voice: ElevenLabsVoice): string | null {
  return (
    voice.preview_url ??
    voice.verified_languages?.find((language) => language.preview_url)?.preview_url ??
    null
  );
}

export function describeElevenLabsVoice(
  voice: ElevenLabsVoice,
  fallbackDescription = "ElevenLabs voice",
): string {
  const labels = voice.labels ?? {};
  const languages = voice.verified_languages
    ?.map((language) => language.locale ?? language.language ?? language.accent)
    .filter(Boolean);

  const parts = [
    voice.category,
    labels.description,
    labels.accent,
    labels.gender,
    labels.age,
    labels.use_case,
    ...(languages ?? []),
  ].filter((part): part is string => Boolean(part?.trim()));

  return Array.from(new Set(parts)).join(" · ") || voice.description || fallbackDescription;
}

export function toElevenLabsVoiceOption(
  voice: ElevenLabsVoice,
  fallbackDescription?: string,
): ElevenLabsVoiceOption {
  return {
    label: voice.name,
    value: voice.voice_id,
    description: describeElevenLabsVoice(voice, fallbackDescription),
    previewUrl: getElevenLabsVoicePreviewUrl(voice),
  };
}

export function useElevenLabsVoices(refreshKey?: unknown) {
  const { i18n, t } = useTranslation();
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
      setVoices(
        nextVoices
          .filter((voice) => voice.voice_id && voice.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
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
    () =>
      voices.map((voice) => toElevenLabsVoiceOption(voice, t("voices.elevenLabsVoiceFallback"))),
    [i18n.language, t, voices],
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
