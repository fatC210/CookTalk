import { useCallback, useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { db } from "@/lib/db";
import {
  findRecipeToOpenFromTranscript,
  findRecipeToStartCookingFromTranscript,
} from "@/lib/recipe-open-intent";
import { executeVoiceAction } from "@/lib/voice-actions";
import { normalizeSpeechText } from "@/lib/voice-pipeline";
import { getActiveWakeWords, useAppStore } from "@/stores/app-store";

type NavigablePath = "/" | "/recipes" | "/import" | "/voices" | "/settings" | "/onboarding";

interface NavigationIntent {
  path: NavigablePath;
  label: string;
  action?: "select-media" | "settings-data" | "settings-import" | "settings-export" | "clone-voice";
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
  const setTheme = useAppStore((s) => s.setTheme);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setSensitivity = useAppStore((s) => s.setSensitivity);
  const setScreenWakeLock = useAppStore((s) => s.setScreenWakeLock);
  const setSoundEffects = useAppStore((s) => s.setSoundEffects);
  const setSpeechRate = useAppStore((s) => s.setSpeechRate);
  const addWakeWord = useAppStore((s) => s.addWakeWord);

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
      if (pathname === "/voices" && dispatchPageVoiceCommand(transcript)) {
        return;
      }

      const settingsIntent = parseGlobalSettingsIntent(transcript);
      if (settingsIntent?.type === "theme") {
        setTheme(settingsIntent.value);
        toast.success(getThemeSuccessMessage(settingsIntent.value, t));
        return;
      }

      if (settingsIntent?.type === "language") {
        setLanguage(settingsIntent.value);
        toast.success(getLanguageSuccessMessage(settingsIntent.value));
        return;
      }

      if (settingsIntent?.type === "sensitivity") {
        setSensitivity(settingsIntent.value);
        toast.success(t(`settings.voice.${settingsIntent.value}`));
        return;
      }

      if (settingsIntent?.type === "screenWakeLock") {
        setScreenWakeLock(settingsIntent.value);
        toast.success(t("settings.voice.wakeLock"));
        return;
      }

      if (settingsIntent?.type === "soundEffects") {
        setSoundEffects(settingsIntent.value);
        toast.success(t("settings.voice.soundEffects"));
        return;
      }

      if (settingsIntent?.type === "speechRate") {
        setSpeechRate(settingsIntent.value);
        toast.success(`${t("settings.speechRate")} ${settingsIntent.value}x`);
        return;
      }

      if (settingsIntent?.type === "addWakeWord") {
        addWakeWord(settingsIntent.value);
        toast.success(`${t("settings.voice.wakeWords")}: ${settingsIntent.value}`);
        return;
      }

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

      if (pathname === "/recipes" && dispatchPageVoiceCommand(transcript)) {
        return;
      }

      const recipeToCook = await findExistingRecipeToStartCooking(transcript);
      if (recipeToCook) {
        await navigate({ to: "/cook", search: { id: recipeToCook.id, step: 0 } });
        return;
      }

      const recipeToOpen = await findExistingRecipeToOpen(transcript);
      if (recipeToOpen) {
        await navigate({ to: "/recipe-detail", search: { id: recipeToOpen.id } });
        return;
      }

      const intent = parseGlobalNavigationIntent(transcript);
      if (intent) {
        await navigate({ to: intent.path });
        if (intent.action) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("cooktalk:voice-page-action", {
                detail: { action: intent.action, transcript },
              }),
            );
          }, 300);
        }
        toast.success(`${t("voice.opened")} ${intent.label}`);
        return;
      }

      if (dispatchPageVoiceCommand(transcript)) {
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

      return;
    },
    [
      navigate,
      pathname,
      pendingHomeAwake,
      setListenMode,
      setLanguage,
      setScreenWakeLock,
      setSensitivity,
      setSoundEffects,
      setSpeechRate,
      setTheme,
      t,
      toggleVoiceBadges,
      addWakeWord,
    ],
  );

  const shouldHandleSleepingTranscript = useCallback((transcript: string) => {
    return isDirectGlobalVoiceCommand(transcript);
  }, []);

  const voiceSession = useVoiceSession({
    enabled,
    wakeWords: getActiveWakeWords(wakeWords),
    language,
    listenMode: activeListenMode,
    manualWakeActive,
    awakeResetKey: pathname,
    shouldHandleSleepingTranscript,
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
        if (!event.transcript?.trim() || !isDirectGlobalVoiceCommand(event.transcript)) {
          queueHomeAwake({
            phrase: event.phrase,
            source: event.source,
            transcript: event.transcript ?? "",
          });
        }
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

type GlobalSettingsIntent =
  | { type: "theme"; value: "light" | "dark" | "auto" }
  | { type: "language"; value: "en" | "zh" }
  | { type: "sensitivity"; value: "low" | "medium" | "high" }
  | { type: "screenWakeLock"; value: boolean }
  | { type: "soundEffects"; value: boolean }
  | { type: "speechRate"; value: number }
  | { type: "addWakeWord"; value: string };

function parseGlobalSettingsIntent(transcript: string): GlobalSettingsIntent | null {
  const text = normalizeSpeechText(transcript);

  if (
    /(切换到|切换|换成|设为|设置为|打开).*(深色|暗色|深色主题|暗色主题|深色模式|暗色模式)|switch to dark|dark mode|turn on dark/i.test(
      text,
    )
  ) {
    return { type: "theme", value: "dark" };
  }

  if (
    /(切换到|切换|换成|设为|设置为|打开).*(浅色|亮色|浅色主题|亮色主题|浅色模式|亮色模式)|switch to light|light mode|turn on light/i.test(
      text,
    )
  ) {
    return { type: "theme", value: "light" };
  }

  if (/(跟随系统|自动主题|自动模式)|system theme|auto theme|follow system/i.test(text)) {
    return { type: "theme", value: "auto" };
  }

  if (/(切换到中文|改成中文|使用中文)|switch to chinese|use chinese/i.test(text)) {
    return { type: "language", value: "zh" };
  }

  if (/(切换到英文|改成英文|使用英文)|switch to english|use english/i.test(text)) {
    return { type: "language", value: "en" };
  }

  if (/(灵敏度|敏感度|sensitivity)/i.test(text)) {
    if (/(高|最高|high)/i.test(text)) return { type: "sensitivity", value: "high" };
    if (/(低|最低|low)/i.test(text)) return { type: "sensitivity", value: "low" };
    if (/(中|默认|普通|medium|normal)/i.test(text)) return { type: "sensitivity", value: "medium" };
  }

  if (/(屏幕常亮|保持屏幕|不要熄屏|wake lock|screen on|keep screen)/i.test(text)) {
    if (/(关闭|关掉|取消|不要|off|disable)/i.test(text)) {
      return { type: "screenWakeLock", value: false };
    }
    if (/(打开|开启|保持|on|enable|keep)/i.test(text)) {
      return { type: "screenWakeLock", value: true };
    }
  }

  if (/(音效|声音效果|sound effect)/i.test(text)) {
    if (/(关闭|关掉|取消|不要|off|disable)/i.test(text)) {
      return { type: "soundEffects", value: false };
    }
    if (/(打开|开启|on|enable)/i.test(text)) {
      return { type: "soundEffects", value: true };
    }
  }

  if (/(语速|朗读速度|speech rate|speaking rate)/i.test(text)) {
    const rateMatch =
      text.match(/(0(?:\.\d+)?|1(?:\.\d+)?|2(?:\.0)?)(?:\s*)(?:倍|x)?/i) ??
      text.match(/(?:to|at)\s*(0(?:\.\d+)?|1(?:\.\d+)?|2(?:\.0)?)/i);
    if (rateMatch?.[1]) {
      const rate = Math.min(2, Math.max(0.5, Number(rateMatch[1])));
      return { type: "speechRate", value: rate };
    }
  }

  const wakeWordMatch = text.match(
    /(?:添加|新增|设置|设定).*(?:唤醒词|wake word)(?:为|叫|是|to|as)?\s*["'“”‘’]?(.+?)["'“”‘’]?$/i,
  );
  if (wakeWordMatch?.[1]) {
    const value = wakeWordMatch[1].replace(/^(为|叫|是|to|as)\s*/i, "").trim();
    if (value) return { type: "addWakeWord", value };
  }

  return null;
}

function getThemeSuccessMessage(theme: "light" | "dark" | "auto", t: (key: string) => string) {
  if (theme === "dark") return t("settings.appearance.dark");
  if (theme === "light") return t("settings.appearance.light");
  return t("settings.appearance.auto");
}

function getLanguageSuccessMessage(language: "en" | "zh") {
  return language === "zh" ? "中文" : "English";
}

function parseGlobalNavigationIntent(transcript: string): NavigationIntent | null {
  const text = normalizeSpeechText(transcript);

  if (/(打开|进入|跳到|open|go to|show).*(菜谱|菜單|菜单|recipes|recipe library)/i.test(text)) {
    return { path: "/recipes", label: "Recipes" };
  }

  if (/(导出|下载|备份).*(全部|所有|全部菜谱|所有菜谱|菜谱)|export.*(all|recipes)|download.*recipes|backup.*recipes/i.test(text)) {
    return { path: "/settings", label: "Data", action: "settings-export" };
  }

  if (/(导入|上传|恢复).*(菜谱文件|菜谱数据|json|备份)|import.*(recipe file|data|json)|upload.*(recipe file|json)|restore.*recipes/i.test(text)) {
    return { path: "/settings", label: "Data", action: "settings-import" };
  }

  if (/(上传|选择|导入).*(视频|音频|媒体)|upload.*(video|audio|media)|select.*(video|audio|media)|choose.*(video|audio|media)/i.test(text)) {
    return { path: "/import", label: "Import", action: "select-media" };
  }

  if (/(导入|新增|添加).*(菜谱|视频)|import|add recipe|new recipe/i.test(text)) {
    return { path: "/import", label: "Import" };
  }

  if (/(数据管理|导入导出|备份数据|data management|import export)/i.test(text)) {
    return { path: "/settings", label: "Data", action: "settings-data" };
  }

  if (/(添加|新增|克隆).*(声音|音色|voice)|clone.*voice|add.*voice|new.*voice/i.test(text)) {
    return { path: "/voices", label: "Voices", action: "clone-voice" };
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

function isDirectGlobalVoiceCommand(transcript: string): boolean {
  const text = normalizeSpeechText(transcript);
  if (!text) return false;
  if (parseGlobalSettingsIntent(text) || parseGlobalNavigationIntent(text)) return true;
  if (/(开始.*(做|烹饪|烹调|煮)|做这|做那个|做这道|做那道|start.*cook|start.*recipe|cook\s+.+)/i.test(text)) {
    return true;
  }
  if (/(打开|查看|看一下|看下|看看|进入|open|show|view|go to|pull up)\s+.+/i.test(text)) {
    return true;
  }
  if (/show.*badge|显示.*(语音|徽标|编号)/i.test(text)) return true;
  if (/hide.*badge|隐藏.*(语音|徽标|编号)/i.test(text)) return true;
  if (/always.*listen|一直.*(听|监听)|持续.*监听/i.test(text)) return true;
  if (/wake.*word|唤醒词|待唤醒/i.test(text)) return true;
  if (
    /^(返回上一页|后退|go back|back|前进|go forward|forward|回到顶部|到顶部|滚到顶部|scroll to top|top|到底部|滚到底部|scroll to bottom|bottom|继续|下一步|确认|同意|我同意|完成|结束|continue|next|confirm|agree|i agree|done|finish|finished)$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/(点击|点一下|点|按|按下|选择|选中|打开|查看|播放|预览|关闭|取消|导出|下载|导入|上传|生成|重新生成|添加|新增|克隆|开始|暂停|停止|删除|返回|下一步|上一步|继续|确认|同意|我同意|完成|结束)\s*.+/i.test(text)) {
    return true;
  }
  if (/(click|tap|press|select|choose|open|show|play|preview|close|cancel|export|download|import|upload|generate|regenerate|add|new|clone|start|pause|stop|delete|next|previous|back|continue|confirm|agree|done|finish|finished)\s+.+/i.test(text)) {
    return true;
  }
  return false;
}

function dispatchPageVoiceCommand(transcript: string): boolean {
  const event = new CustomEvent("cooktalk:voice-command", {
    cancelable: true,
    detail: { transcript },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function findExistingRecipeToOpen(transcript: string) {
  const recipes = await db.recipes.orderBy("createdAt").reverse().toArray();
  return findRecipeToOpenFromTranscript(transcript, recipes);
}

async function findExistingRecipeToStartCooking(transcript: string) {
  const recipes = await db.recipes.orderBy("createdAt").reverse().toArray();
  return findRecipeToStartCookingFromTranscript(transcript, recipes);
}
