import { type AppLanguage } from "./language";

const ERROR_PAGE_COPY: Record<
  AppLanguage,
  {
    title: string;
    body: string;
    retry: string;
    home: string;
  }
> = {
  en: {
    title: "This page didn't load",
    body: "Something went wrong on our end. You can try refreshing or head back home.",
    retry: "Try again",
    home: "Go home",
  },
  zh: {
    title: "页面加载失败",
    body: "我们这边出了点问题。你可以重试刷新，或回到首页。",
    retry: "重试",
    home: "回到首页",
  },
};

export function renderErrorPage(language: AppLanguage = "en"): string {
  const copy = ERROR_PAGE_COPY[language];

  return `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : "en"}">
  <head>
    <meta charset="utf-8" />
    <title>${copy.title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 12px;
        background: linear-gradient(180deg, #f6f1e8 0%, #f8f4ee 100%);
        color: #2f251c;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
      }
      .shell {
        min-height: calc(100vh - 24px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 64px 24px;
        border-radius: 28px;
        background: #fbf8f3;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
      }
      .card {
        width: 100%;
        max-width: 640px;
        text-align: center;
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 4vw, 40px);
        line-height: 1.1;
        letter-spacing: -0.04em;
        font-weight: 700;
      }
      p {
        margin: 16px auto 0;
        max-width: 560px;
        color: #7f7368;
        font-size: 18px;
        line-height: 1.8;
      }
      .actions {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 40px;
      }
      a, button {
        min-width: 88px;
        padding: 12px 24px;
        border-radius: 18px;
        font: inherit;
        font-size: 18px;
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
        transition: transform 0.2s ease, background-color 0.2s ease;
      }
      a:hover, button:hover {
        transform: translateY(-2px);
      }
      .primary {
        background: #8a6a50;
        color: #fffaf4;
      }
      .primary:hover {
        background: #7d5f47;
      }
      .secondary {
        min-width: 132px;
        background: transparent;
        color: #4a3d33;
        border-color: #dacdbf;
      }
      .secondary:hover {
        background: #f4ede3;
      }
      @media (max-width: 640px) {
        body {
          padding: 10px;
        }
        .shell {
          min-height: calc(100vh - 20px);
          padding: 48px 20px;
          border-radius: 22px;
        }
        p, a, button {
          font-size: 16px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <h1>${copy.title}</h1>
        <p>${copy.body}</p>
        <div class="actions">
          <button class="primary" onclick="location.reload()">${copy.retry}</button>
          <a class="secondary" href="/">${copy.home}</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
