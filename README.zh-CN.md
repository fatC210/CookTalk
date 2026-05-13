<h1 align="center">CookTalk</h1>

<p align="center">
  一个隐私优先、双语支持、以语音驱动的智能厨房助手。
</p>

<p align="center">
  <a href="README.md">English</a>
  ·
  <a href="#核心亮点">核心亮点</a>
  ·
  <a href="#功能一览">功能一览</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#配置说明">配置说明</a>
</p>

---

## 项目简介

CookTalk 将菜谱、做饭视频、语音、计时器和 AI 对话整合成一个安静顺手的厨房工作台。它面向真实烹饪场景设计：你可以用语音搜索菜谱，把烹饪视频导入为结构化菜谱，在跟做模式中一步步听指引，中途询问食材替代方案，并同时运行多个厨房计时器。

应用采用 local-first 思路。菜谱、设置、草稿和 API 凭据默认保存在浏览器中，并通过 IndexedDB 与基于 AES-GCM 的本地凭据保护机制降低敏感信息暴露风险。

## 核心亮点

| 语音优先厨房                                                 | 本地优先隐私                                                   | AI 菜谱工作流                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| 支持唤醒词、手动激活、上下文指令、页面导航、滚动和表单输入。 | 菜谱、设置、凭据、计时器、草稿和声音缓存默认保存在浏览器本地。 | 支持菜谱灵感对话、视频内容结构化、AI 封面生成和推荐保存。 |

## 功能一览

<table>
  <tr>
    <td width="50%"><strong>🎙 全局语音控制</strong><br />通过唤醒词或手动激活完成页面导航、滚动、表单输入和上下文烹饪指令。</td>
    <td width="50%"><strong>🍳 跟做烹饪模式</strong><br />逐步朗读菜谱步骤，支持暂停、继续、重复、上一步、下一步、屏幕常亮和菜谱专属声音。</td>
  </tr>
  <tr>
    <td><strong>⏱ 多计时器并行</strong><br />烹饪过程中可创建、延长、取消和查询多个计时器，适合多菜或多步骤并行。</td>
    <td><strong>🎬 视频转菜谱</strong><br />导入烹饪视频，使用 ffmpeg.wasm 提取音频，转写并整理为食材、步骤、标签和封面。</td>
  </tr>
  <tr>
    <td><strong>🧠 AI 菜谱对话</strong><br />优先搜索本地菜谱，也可请求新灵感、打开菜谱卡片、保存推荐并直接进入跟做模式。</td>
    <td><strong>🗣 声音库管理</strong><br />浏览 ElevenLabs 声音、试听样音、管理克隆声音，并为不同菜谱分配专属声音。</td>
  </tr>
  <tr>
    <td><strong>🖼 菜谱封面</strong><br />支持用户上传封面，也可根据菜谱提示词生成 AI 封面图。</td>
    <td><strong>🌏 中英双语界面</strong><br />内置中文与英文文案，并根据当前语言提供更自然的交互提示。</td>
  </tr>
</table>

## 技术栈

| 层级       | 技术                                                             |
| ---------- | ---------------------------------------------------------------- |
| 应用框架   | TanStack Start, TanStack Router, Vite 7                          |
| UI 层      | React 19, Tailwind CSS 4, Radix UI, shadcn 风格组件, Lucide 图标 |
| 状态与数据 | Zustand, TanStack Query, Dexie, Dexie React Hooks                |
| 本地存储   | IndexedDB / Dexie, 基于 Web Crypto AES-GCM 的本地密钥保护        |
| AI 与语音  | ElevenLabs API, OpenAI 兼容文本与图像接口                        |
| 媒体处理   | ffmpeg.wasm，用于浏览器内视频/音频处理                           |
| 国际化     | i18next, react-i18next                                           |
| 工程质量   | TypeScript, ESLint, Prettier                                     |

## 项目结构

```text
CookTalk/
├─ public/
│  ├─ logo.png
│  ├─ logo-dark.png
│  ├─ timer-worker.js
│  └─ ffmpeg/
├─ server/
│  └─ railway.mjs
├─ src/
│  ├─ components/       # 通用 UI 与应用外壳组件
│  ├─ hooks/            # 语音、计时器、移动端与 ElevenLabs hooks
│  ├─ lib/              # 数据库、加密、LLM、语音、i18n 与工具函数
│  ├─ locales/          # 中文与英文翻译文案
│  ├─ routes/           # TanStack Router 页面
│  ├─ stores/           # Zustand stores
│  ├─ router.tsx
│  └─ client.tsx
├─ package.json
├─ vite.config.ts
├─ railway.json
└─ wrangler.jsonc
```

## 快速开始

### 环境要求

- Node.js **22.12.0 或更高版本**
- npm、Bun 或其他兼容的包管理器
- 推荐使用支持 Web Crypto、IndexedDB、麦克风权限与 Wake Lock 的现代浏览器

### 安装依赖

```bash
npm install
```

或使用 Bun：

```bash
bun install
```

### 本地运行

```bash
npm run dev
```

打开 Vite 输出的本地地址，通常是 `http://localhost:5173`。

### 生产构建

```bash
npm run build
npm run preview
```

## 常用脚本

| 命令                | 说明                       |
| ------------------- | -------------------------- |
| `npm run dev`       | 启动 Vite 开发服务         |
| `npm run build`     | 构建生产版本               |
| `npm run build:dev` | 构建 development mode 版本 |
| `npm run preview`   | 本地预览生产构建           |
| `npm run start`     | 启动 Railway Node 服务     |
| `npm run lint`      | 运行 ESLint                |
| `npm run format`    | 使用 Prettier 格式化文件   |

## 配置说明

大多数运行时凭据都在应用内的 **设置 → API Keys** 中配置，而不是写入环境变量。CookTalk 会将这些值经过基于 AES-GCM 的加密/混淆后存入浏览器本地存储。

| 配置项                       | 用途                                   | 默认值 / 说明                 |
| ---------------------------- | -------------------------------------- | ----------------------------- |
| ElevenLabs API Key           | 语音合成、声音试听、声音克隆与跟做朗读 | 完整语音能力需要配置          |
| LLM Endpoint                 | OpenAI 兼容的文本模型接口              | `https://api.openai.com/v1`   |
| LLM Model                    | 菜谱对话、结构化、优化与问答           | `gpt-4o-mini`                 |
| Image Endpoint / Key / Model | AI 菜谱封面生成                        | 默认图像模型：`gpt-image-1.5` |

服务端部署时通常只需要以下进程变量：

| 变量   | 说明                                  | 默认值    |
| ------ | ------------------------------------- | --------- |
| `PORT` | `server/railway.mjs` 使用的 HTTP 端口 | `3000`    |
| `HOST` | HTTP 服务监听地址                     | `0.0.0.0` |

## 浏览器权限

CookTalk 可能会请求以下权限：

- **麦克风权限**：用于语音命令和声音相关流程
- **Wake Lock 权限**：在跟做模式中保持屏幕常亮
- **本地存储 / IndexedDB**：保存菜谱、设置、草稿、计时器和声音缓存

## 后续方向

- 云同步与多设备菜谱共享
- 更多语音命令包和烹饪场景
- 营养分析与购物清单集成