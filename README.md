## Project Overview

CookTalk is a privacy-first, bilingual (Chinese & English) intelligent cooking assistant. Designed around a truly hands-free cooking experience, you can search recipes with your voice, import cooking videos and convert them into structured recipes, manage your recipe library, follow step-by-step cooking mode, ask about substitute ingredients at any time, and run multiple kitchen timers simultaneously.

The project is built with TanStack Start, React 19, TypeScript, Tailwind CSS 4, Dexie/IndexedDB, Zustand, i18next, ElevenLabs, and OpenAI-compatible model APIs.

<p align="center">
  <a href="README.zh-CN.md">中文</a> · <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#configuration">Configuration</a>
</p>

## Core Features

<table>
  <tr>
    <td><strong>🎙 Global Voice-First</strong></td>
    <td>Supports wake words, manual activation, voice badge, page navigation, scrolling, form input, and contextual commands.</td>
  </tr>
  <tr>
    <td><strong>🍳 Guided Cooking Mode</strong></td>
    <td>Reads out recipe steps one by one, with pause, resume, repeat, previous, next, always-on display, and recipe-specific voice.</td>
  </tr>
  <tr>
    <td><strong>⏱ Multiple Parallel Timers</strong></td>
    <td>Create, extend, cancel, and check multiple timers during cooking.</td>
  </tr>
  <tr>
    <td><strong>🎬 Video to Recipe</strong></td>
    <td>Import cooking videos, extract audio using ffmpeg.wasm, transcribe, and organize into ingredients, steps, tags, and covers.</td>
  </tr>
  <tr>
    <td><strong>🧠 AI Recipe Dialog</strong></td>
    <td>Prioritize searching local recipes, request new inspirations, open recipe cards, save recommendations and enter guided cooking directly.</td>
  </tr>
  <tr>
    <td><strong>🗣 Voice Library</strong></td>
    <td>Browse ElevenLabs voices, preview samples, manage cloned voices, and assign voices to specific recipes.</td>
  </tr>
  <tr>
    <td><strong>🖼 Recipe Cover</strong></td>
    <td>Support for user-uploaded covers and AI-generated covers based on recipe prompts.</td>
  </tr>
  <tr>
    <td><strong>🌏 Bilingual Interface</strong></td>
    <td>Built-in English/Chinese localization and more natural interaction prompts based on selected language.</td>
  </tr>
</table>

## Tech Stack

- **App Framework:** TanStack Start, TanStack Router, Vite 7
- **UI Layer:** React 19, Tailwind CSS 4, Radix UI, shadcn-style components, Lucide icons
- **State Management:** Zustand, TanStack Query, Dexie React Hooks
- **Local Storage:** IndexedDB / Dexie, local key encryption/obfuscation based on Web Crypto AES-GCM
- **AI & Voice:** ElevenLabs API, OpenAI-compatible text and image APIs
- **Media Processing:** ffmpeg.wasm for video/audio processing in browser
- **Internationalization:** i18next, react-i18next
- **Code Quality:** TypeScript, ESLint, Prettier

## Project Structure

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
│  ├─ components/       # General UI and application shell components
│  ├─ hooks/            # Voice, timer, mobile, and ElevenLabs hooks
│  ├─ lib/              # Database, crypto, LLM, voice, i18n, and utilities
│  ├─ locales/          # Chinese & English localization messages
│  ├─ routes/           # TanStack Router pages
│  ├─ stores/           # Zustand stores
│  ├─ router.tsx
│  └─ client.tsx
├─ package.json
├─ vite.config.ts
├─ railway.json
└─ wrangler.jsonc
```

## Quick Start

### Requirements

- Node.js **22.12.0 or above**
- npm, Bun, or any compatible package manager
- Modern browser with support for Web Crypto, IndexedDB, microphone permissions, and Wake Lock is recommended

### Install dependencies

```bash
npm install
```

Or, using Bun:

```bash
bun install
```

### Start development server

```bash
npm run dev
```

Then open the local address output by Vite, usually `http://localhost:5173`.

### Build for production

```bash
npm run build
```

### Preview production build locally

```bash
npm run preview
```

## Configuration

Most runtime credentials are configured within the app under **Settings → API Keys**, rather than in environment variables. CookTalk encrypts/obfuscates these values in your browser's local storage using AES-GCM.

| Group                | Purpose                                               | Default / Notes                             |
| -------------------- | ----------------------------------------------------- | ------------------------------------------- |
| ElevenLabs API Key   | Speech synthesis, voice preview, voice cloning, TTS   | Complete functionality requires configuration |
| LLM Endpoint         | OpenAI-compatible text model endpoint                 | `https://api.openai.com/v1`                 |
| LLM Model            | Recipe chat, structuring, optimization, Q&A           | `gpt-4o-mini`                               |
| Image Endpoint / Key / Model | AI-generated recipe covers                   | Default image model: `gpt-image-1.5`        |

When deploying the server, only the following process variables are typically needed:

| Variable | Description                                    | Default  |
| -------- | ---------------------------------------------- | -------- |
| `PORT`   | HTTP port for `server/railway.mjs`             | `3000`   |
| `HOST`   | HTTP server listen address                      | `0.0.0.0`|

## Browser Permissions

CookTalk may request:

- **Microphone permission:** For voice commands and voice features
- **Wake Lock permission:** To keep screen always-on during cooking mode
- **Local storage/IndexedDB:** To save recipes, settings, drafts, and voice cache

## Roadmap

- Cloud sync and multi-device recipe sharing
- More voice command packages
- Nutrition analysis and shopping list integration
