import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { executeVoiceAction } from "@/lib/voice-actions";
import { hasWakeWord, normalizeSpeechText, stripWakeWords } from "@/lib/voice-pipeline";
import { getActiveWakeWords, useAppStore } from "@/stores/app-store";

type NavigablePath = "/" | "/recipes" | "/import" | "/voices" | "/settings" | "/onboarding";

interface NavigationIntent {
  path: NavigablePath;
  label: string;
}

export function GlobalVoiceController() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const wakeWords = useAppStore((s) => s.wakeWords);
  const language = useAppStore((s) => s.language);
  const listenMode = useAppStore((s) => s.listenMode);
  const manualWakeActive = useAppStore((s) => s.manualWakeActive);
  const clearManualWake = useAppStore((s) => s.clearManualWake);
  const homeConversationActive = useAppStore((s) => s.homeConversationActive);
  const pendingHomeAwake = useAppStore((s) => s.pendingHomeAwake);
  const queueHomeAwake = useAppStore((s) => s.queueHomeAwake);
  const toggleVoiceBadges = useAppStore((s) => s.toggleVoiceBadges);
  const setListenMode = useAppStore((s) => s.setListenMode);
  const activeWakeWords = useMemo(() => getActiveWakeWords(wakeWords), [wakeWords]);

  const enabled = pathname !== "/cook";
  const activeListenMode =
    pathname === "/" && homeConversationActive
      ? "always"
      : listenMode === "always"
        ? "always"
        : "wake-word";

  const handleTranscript = useCallback(
    async (transcript: string) => {
      if (pendingHomeAwake) return;

      const text = normalizeSpeechText(transcript);
      if (/show.*badge|显示.*(语音|徽标|编号)/i.test(text)) {
        toggleVoiceBadges(true);
        toast.success(t("voice.badgesShown"));
        return;
      }

      if (/hide.*badge|隐藏.*(语音|徽标|编号)/i.test(text)) {
        toggleVoiceBadges(false);
        toast.success(t("voice.badgesHidden"));
        return;
      }

      if (/always.*listen|一直.*(听|监听)|持续.*监听/i.test(text)) {
        setListenMode("always");
        toast.success(t("voice.alwaysListening"));
        return;
      }

      if (/wake.*word|唤醒词|待唤醒/i.test(text)) {
        setListenMode("wake-word");
        toast.success(t("voice.wakeWordMode"));
        return;
      }

      if (pathname !== "/" && hasWakeWord(transcript, activeWakeWords)) {
        const commandText = stripWakeWords(transcript, activeWakeWords);
        queueHomeAwake({
          phrase: transcript,
          source: "wake-word",
          transcript: normalizeSpeechText(commandText),
        });
        void navigate({ to: "/" });
        return;
      }

      const intent = parseGlobalNavigationIntent(transcript);
      if (intent) {
        await navigate({ to: intent.path });
        toast.success(`${t("voice.opened")} ${intent.label}`);
        return;
      }

      const action = executeVoiceAction(transcript);
      if (action.handled) {
        toast.success(`${t("voice.opened")} ${action.label}`);
        return;
      }

      if (pathname === "/") {
        window.dispatchEvent(
          new CustomEvent("cooktalk:home-transcript", {
            detail: { transcript },
          }),
        );
        return;
      }

      toast.info(t("voice.unhandled"));
    },
    [
      navigate,
      pathname,
      pendingHomeAwake,
      queueHomeAwake,
      setListenMode,
      t,
      toggleVoiceBadges,
      activeWakeWords,
    ],
  );

  const voiceSession = useVoiceSession({
    enabled,
    wakeWords: activeWakeWords,
    language,
    listenMode: activeListenMode,
    manualWakeActive,
    awakeResetKey: pathname,
    onWake: (event) => {
      clearManualWake();
      if (event.source === "always-listen") return;
      if (event.source === "manual") {
        if (pathname === "/") {
          window.dispatchEvent(
            new CustomEvent("cooktalk:home-awake", {
              detail: {
                phrase: event.phrase,
                source: event.source,
                transcript: event.transcript ?? "",
              },
            }),
          );
        }
        return;
      }

      if (pathname !== "/") {
        queueHomeAwake({
          phrase: event.phrase,
          source: event.source,
          transcript: event.transcript ?? "",
        });
        void navigate({ to: "/" });
        return;
      }

      if (event.transcript?.trim()) return;

      window.dispatchEvent(
        new CustomEvent("cooktalk:home-awake", {
          detail: {
            phrase: event.phrase,
            source: event.source,
            transcript: event.transcript ?? "",
          },
        }),
      );
    },
    onTranscript: handleTranscript,
    onError: (message) => toast.error(message),
  });

  useEffect(() => {
    if (!enabled) return;
    window.dispatchEvent(
      new CustomEvent("cooktalk:voice-status", {
        detail: {
          status: voiceSession.status,
          isSupported: voiceSession.isSupported,
          isMuted: voiceSession.isMuted,
          error: voiceSession.error,
          lastTranscript: voiceSession.lastTranscript,
        },
      }),
    );
  }, [
    enabled,
    voiceSession.error,
    voiceSession.isMuted,
    voiceSession.isSupported,
    voiceSession.lastTranscript,
    voiceSession.status,
  ]);

  return null;
}

function parseGlobalNavigationIntent(transcript: string): NavigationIntent | null {
  const text = normalizeSpeechText(transcript);

  if (/(打开|进入|跳到|open|go to|show).*(菜谱|菜單|菜单|recipes|recipe library)/i.test(text)) {
    return { path: "/recipes", label: "Recipes" };
  }

  if (/(导入|新增|添加).*(菜谱|视频)|import|add recipe|new recipe/i.test(text)) {
    return { path: "/import", label: "Import" };
  }

  if (/(声音库|语音库|voice|voices|voice library)/i.test(text)) {
    return { path: "/voices", label: "Voices" };
  }

  if (/(设置|配置|settings|preferences)/i.test(text)) {
    return { path: "/settings", label: "Settings" };
  }

  if (/(引导|初始化|onboarding|setup)/i.test(text)) {
    return { path: "/onboarding", label: "Setup" };
  }

  if (/(首页|主页|home|start page)/i.test(text)) {
    return { path: "/", label: "Home" };
  }

  return null;
}
