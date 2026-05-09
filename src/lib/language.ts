export type AppLanguage = "en" | "zh";

export const DEFAULT_LANGUAGE: AppLanguage = "en";
export const LANGUAGE_COOKIE_NAME = "cooktalk-lang";

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value === "en" || value === "zh";
}

export function parseLanguageCookie(cookieHeader: string | null | undefined): AppLanguage {
  if (!cookieHeader) return DEFAULT_LANGUAGE;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName !== LANGUAGE_COOKIE_NAME) continue;

    const value = rawValue.join("=");
    if (isAppLanguage(value)) return value;
  }

  return DEFAULT_LANGUAGE;
}
