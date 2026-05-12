<p align="center">
  <strong style="font-size:2em;">CookTalk</strong>
</p>

<p align="center">
  <strong>一个以语音优先为核心的 AI 厨房助手：让双手专注做菜，而不是操作屏幕。</strong>
</p>

---

## 项目简介

CookTalk 是一个本地优先、支持中英文的智能烹饪助手。它围绕“全程免手触控”的体验设计：你可以用语音搜索菜谱、导入烹饪视频并转成结构化菜谱、管理个人菜谱库、在烹饪模式中逐步跟做、临时询问替换食材，还可以同时运行多个厨房计时器。

项目基于 TanStack Start、React 19、TypeScript、Tailwind CSS 4、Dexie/IndexedDB、Zustand、i18next、ElevenLabs 以及 OpenAI 兼容模型接口构建。

<p align="center">
  <a href="README.zh-CN.md">中文</a> · <a href="#features">核心功能</a> · <a href="#quick-start">快速开始</a> · <a href="#configuration">配置</a>
</p>

## 核心功能

<table>
  <tr>
    <td><strong>🎙 全局语音优先</strong></td>
    <td>支持唤醒词、手动唤醒、语音徽标、页面导航、滚动、表单输入与上下文指令。</td>
  </tr>
  <tr>
    <td><strong>🍳 跟做烹饪模式</strong></td>
    <td>逐步朗读菜谱，支持暂停、继续、重复、上一步、下一步、屏幕常亮与菜谱专属声音。</td>
  </tr>
  <tr>
    <td><strong>⏱ 多计时器并行</strong></td>
    <td>烹饪过程中可创建、延长、取消和查看多个计时器。</td>
  </tr>
  <tr>
    <td><strong>🎬 视频转菜谱</strong></td>
    <td>导入烹饪视频，通过 ffmpeg.wasm 提取音频，转写后整理成食材、步骤、标签与封面。</td>
  </tr>
  <tr>
    <td><strong>🧠 AI 菜谱对话</strong></td>
    <td>优先搜索本地菜谱，也可请求新灵感、打开菜谱卡片、保存推荐并直接进入跟做。</td>
  </tr>
  <tr>
    <td><strong>🗣 声音库</strong></td>
    <td>浏览 ElevenLabs 声音、试听样本、管理克隆声音，并将声音绑定到具体菜谱。</td>
  </tr>
  <tr>
    <td><strong>🖼 菜谱封面</strong></td>
    <td>支持用户上传封面，也支持根据菜谱提示词生成 AI 封面图。</td>
  </tr>
  <tr>
    <td><strong>🌏 中英文界面</strong></td>
    <td>内置 English / 中文本地化文案，并按语言生成更自然的交互提示。</td>
  </tr>
</table>

## 技术栈

- **应用框架：** TanStack Start、TanStack Router、Vite 7
- **界面层：** React 19、Tailwind CSS 4、Radix UI、shadcn 风格组件、Lucide 图标
- **状态管理：** Zustand、TanStack Query、Dexie React Hooks
- **本地存储：** IndexedDB / Dexie，基于 Web Crypto AES-GCM 的本地密钥加密/混淆存储
- **AI 与语音：** ElevenLabs API、OpenAI 兼容文本与图像接口
- **媒体处理：** ffmpeg.wasm，在浏览器侧处理视频/音频
- **国际化：** i18next、react-i18next
- **工程质量：** TypeScript、ESLint、Prettier

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
│  ├─ locales/          # 中英文文案
│  ├─ routes/           # TanStack Router 页面
│  ├─ stores/           # Zustand 状态
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

### 启动开发服务

```bash
npm run dev
```

然后打开 Vite 输出的本地地址，通常是 `http://localhost:5173`。

### 构建生产版本

```bash
npm run build
```

### 本地预览生产构建

```bash
npm run preview
```

## 配置说明

大多数运行时凭据都在应用内的 **设置 → API Keys** 中配置，而不是写入环境变量。CookTalk 会将这些值经过 AES-GCM 加密/混淆后存入浏览器本地存储。

| 分组 | 用途 | 默认值 / 说明 |
| --- | --- | --- |
| ElevenLabs API Key | 语音合成、声音试听、声音克隆与跟做朗读 | 完整语音能力需要配置 |
| LLM Endpoint | OpenAI 兼容的文本模型接口 | `https://api.openai.com/v1` |
| LLM Model | 菜谱对话、结构化、优化与问答 | `gpt-4o-mini` |
| Image Endpoint / Key / Model | AI 菜谱封面生成 | 默认图像模型：`gpt-image-1.5` |

服务端部署时通常只需要以下进程变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | `server/railway.mjs` 使用的 HTTP 端口 | `3000` |
| `HOST` | HTTP 服务监听地址 | `0.0.0.0` |

## 浏览器权限

CookTalk 可能会请求：

- **麦克风权限**：用于语音命令和声音相关流程
- **Wake Lock 权限**：烹饪模式中保持屏幕常亮
- **本地存储 / IndexedDB**：保存菜谱、设置、草稿和声音缓存

## 后续方向

- 云同步与多设备菜谱共享
- 更多语音命令包
- 营养分析与购物清单集成