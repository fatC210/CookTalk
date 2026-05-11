# CookTalk 产品需求文档 (PRD) v1.0 · 最终版

> **一句话定义**：一个**全语音控制**的 AI 厨房助手网页应用，支持本地视频转菜谱、个性化语音克隆，让你边做饭边和 AI 自然对话，**任何操作都无需触碰屏幕**。

---

## 📑 文档信息

| 项           | 内容                                                     |
| ------------ | -------------------------------------------------------- |
| 产品名       | **CookTalk**（中文名：厨语）                             |
| 版本         | v1.0                                                     |
| 平台         | Web（响应式，优先适配手机/平板，同时支持桌面端）         |
| 数据存储     | 纯本地（IndexedDB + 加密 localStorage）                  |
| 核心技术     | ElevenLabs Conversational AI / TTS / STT / Voice Cloning |
| 默认界面语言 | English（支持中英文切换）                                |
| 图标风格     | 纯线条型（Outline / Stroke）                             |
| LLM 支持     | OpenAI / DeepSeek（用户自配 Key）                        |
| 生图支持     | 自定义 OpenAI 兼容 endpoint（用户自配 Key）              |
| **核心原则** | **🎙️ 全语音可达：所有手动操作都有等价语音指令**          |
| 文档日期     | 2026-05-08                                               |

---

## 1. 产品概述

### 1.1 背景与痛点

做饭时用户的双手长期处于"被污染"状态（油、面粉、生肉），现有数字菜谱产品都需要：

- ❌ 反复用手指/手肘戳屏幕翻步骤
- ❌ 要么提前看完凭记忆做、要么频繁洗手
- ❌ 现有语音助手不懂菜谱上下文，问答割裂
- ❌ 自己存的视频菜谱散落各处，无法结构化复用
- ❌ 即便有语音功能也只覆盖部分操作，关键时刻还得动手

### 1.2 产品愿景

**让用户在厨房里只用嘴和耳朵就能完成做饭全流程**——从打开应用、配置设置、查菜谱、跟做、问答、计时、学新菜、导入导出，**所有操作 100% 可通过语音完成**。

### 1.3 核心原则：Voice-First Everywhere

> ⚡ **铁律**：界面上每一个可点击元素，都必须有对应的语音指令；每一个手动操作流程，都必须有等价的语音操作流程。

| 设计要求            | 含义                                                       |
| ------------------- | ---------------------------------------------------------- |
| 🎙️ **全语音可达**   | 任何手动操作都能用语音完成                                 |
| 👁️ **语音元素可见** | 默认开启「语音徽标」，每个可语音操作元素显示编号或语音提示 |
| 🗣️ **自然语言优先** | "打开第三个菜谱" / "去设置" / "下一页"都能识别             |
| 🪞 **状态语音反馈** | 任何状态变化都有语音确认                                   |

### 1.4 目标用户

| 用户类型          | 核心需求                                 |
| ----------------- | ---------------------------------------- |
| 新手小白          | 保姆级语音指导、随时问"这步啥意思"       |
| 家庭主厨          | 高效跟做、多任务计时、菜谱沉淀           |
| 进阶玩家          | 收藏视频菜谱、个性化语音体验、菜谱知识库 |
| 行动不便/视障人群 | 全语音无障碍体验                         |

### 1.5 核心差异化（护城河）

1. **真·全语音**：从启动到关闭，每个操作都可纯语音完成
2. **个人菜谱知识库**：从喜爱的视频自动提取，AI 搜索时优先用自己的
3. **情感化声音**：可克隆家人声音讲菜谱（"奶奶教你包饺子"）
4. **数据主权**：所有数据仅存本地，用户掌握 API Key

---

## 2. 用户场景与故事

### 场景 A｜全程不碰屏幕做菜（核心场景）

> 小王手机立在台面上，洗菜中："嗨厨语，打开应用。" → "去我的菜谱。" → "打开红烧肉。" → "开始做。" → AI 用妈妈的声音念第一步 → "下一步" → "3 分钟后提醒翻面" → 全程零触碰。

### 场景 B｜首次配置也用语音

> 新用户首次打开 → 引导页 → "我要配置 API Key" → "打开 ElevenLabs 设置" → 用户念出 Key（也支持手动粘贴） → "保存" → "开始使用"。

### 场景 C｜多定时器并行

> "帮我 3 分钟后提醒翻面，同时 8 分钟提醒关火" → AI："好的，已设置两个定时器。" → 到点逐个语音提醒。

### 场景 D｜临时替换问答

> "我家里没生抽，能用啥代替？" → AI："可以用普通酱油+一点点糖代替。要继续下一步吗？" → "继续。"

### 场景 E｜从视频沉淀菜谱

> "导入新菜谱" → "选择视频" → 选好后说"开始处理" → 系统自动 STT + 结构化 → "重新生成封面" → "保存到我的菜谱"。

### 场景 F｜AI 搜索新菜

> "今晚想吃辣的，推荐三个" → AI 先返回本地辣菜+网上 2 个新菜 → "听第二个" → "保存这个" → "开始做"。

### 场景 G｜限定模式搜索

> "只在我自己的菜谱里找川菜" → AI 切换到本地模式。

---

## 3. 功能模块

### 3.1 模块总览

```
CookTalk
├── ① 全局语音控制层 ⭐
├── ② 语音交互引擎
├── ③ 菜谱库（个人知识库）
├── ④ 视频导入与菜谱提取
├── ⑤ AI 菜谱搜索与跟做
├── ⑥ 多定时器与临时问答（杀手锏）
├── ⑦ 语音克隆与声音管理
├── ⑧ 封面图管理
├── ⑨ 设置与数据管理
└── ⑩ 国际化（中英文）
```

---

### 3.2 模块①｜全局语音控制层 ⭐

> **本模块是 v1.0 的灵魂**：让所有 UI 操作都有等价语音指令。

#### 3.2.1 语音控制覆盖矩阵

| UI 操作类型   | 等价语音指令示例                                   | 实现工具                        |
| ------------- | -------------------------------------------------- | ------------------------------- |
| **导航**      | "去首页" / "打开设置" / "返回" / "go to recipes"   | `navigate(target)`              |
| **列表选择**  | "打开第三个" / "选番茄炒蛋" / "open the first one" | `selectListItem(index/keyword)` |
| **滚动翻页**  | "往下滚" / "下一页" / "回到顶部" / "scroll down"   | `scrollControl(direction)`      |
| **按钮点击**  | "点保存" / "点确认" / "click cancel"               | `clickButton(label)`            |
| **表单输入**  | "在标题里写'红烧肉'" / "name it Mom's stew"        | `fillField(field, value)`       |
| **开关切换**  | "打开屏幕常亮" / "关闭深色模式"                    | `toggleSetting(name)`           |
| **下拉/选项** | "选择 OpenAI" / "把语速调到 1.2"                   | `selectOption(field, value)`    |
| **文件操作**  | "上传视频" / "选择封面图" / "导出菜谱"             | `triggerFileAction(action)`     |
| **弹窗**      | "确认" / "取消" / "关闭弹窗"                       | `dialogAction(action)`          |
| **删除/确认** | "删除这个菜谱" → "确认删除"                        | `confirmAction(action)`         |
| **搜索**      | "搜索辣的菜" / "search spicy"                      | `searchInPage(query)`           |
| **筛选/排序** | "只看川菜" / "按时间排序"                          | `filterList(criteria)`          |
| **编辑**      | "把第二步改成大火 5 分钟"                          | `editField(target, value)`      |
| **徽标控制**  | "隐藏语音徽标" / "显示语音徽标"                    | `toggleVoiceBadges(state)`      |

#### 3.2.2 语音徽标（Voice Badges）

**定义**：界面上每个可语音操作的元素旁显示的视觉提示，告知用户该元素可以用什么语音指令操作。

**默认状态**：✅ **开启**

**显示规则**：
| 元素类型 | 徽标形式 | 示例 |
|---|---|---|
| 列表项 | 左上角圆形编号 ①②③ | 用户可说"打开第 3 个" |
| 按钮 | 右下角小麦克风线条图标 | 悬停时提示可说的指令 |
| 表单字段 | 字段下方浅色文字提示 | "可说：在标题里写..." |
| 开关 | 旁边浅色文字提示 | "可说：打开屏幕常亮" |
| 下拉选项 | 选项前编号 | "选第二个" |

**关闭方式**：

- 语音："隐藏语音徽标" / "Hide voice badges"
- 手动：设置页对应开关
- 重新开启："显示语音徽标" / "Show voice badges"

**视觉风格**：

- 徽标本身使用纯线条型设计
- 半透明展示（opacity 60%），不喧宾夺主
- 徽标颜色跟随主题色

#### 3.2.3 语音命令解析架构

```
用户语音输入
   ↓
ElevenLabs Conversational AI Agent
   ↓
LLM 意图识别
   ├─ 全局指令（导航/退出） → Global Tool
   ├─ 页面专属指令（列表选择/编辑） → Page-Scoped Tool
   ├─ 跟做模式指令（步骤/计时） → Cooking Tool
   └─ 自由对话（问答/搜索） → LLM 直接回答
   ↓
执行后语音确认 + UI 状态同步
```

#### 3.2.4 上下文感知

Agent 始终知道当前所在页面，不同页面提供不同的工具集：

- 当前页面信息通过 `pageContextUpdate` 推送给 Agent
- 例：在"菜谱列表页"，Agent 知道当前列表项编号和名称，能正确解析"打开第三个"

#### 3.2.5 监听模式

- **始终监听模式**（默认在跟做模式）：进入烹饪后麦克风全程监听
- **唤醒模式**（默认在浏览/设置页）：需说唤醒词激活
- 用户可在设置中切换全局策略
- 顶部状态栏图标（线条型）实时显示当前模式：🎤 监听中 / 🔇 待唤醒

#### 3.2.6 语音操作确认策略

| 操作类型                           | 确认策略                       |
| ---------------------------------- | ------------------------------ |
| 不可逆操作（删除/清空）            | 必须二次语音确认（"确认删除"） |
| 重要状态变更（保存 Key、导入数据） | 语音播报结果                   |
| 普通导航/选择                      | 静默执行 + 短促音效反馈        |
| 模糊指令                           | AI 反问："你是要 A 还是 B？"   |

---

### 3.3 模块②｜语音交互引擎

#### 3.3.1 唤醒与监听

- **默认唤醒词**：`"Hey CookTalk"`（英文）/ `"嗨厨语"`（中文）
- **自定义唤醒词**：
  - 设置页输入框，用户可填写任意短语（建议 2-4 音节）
  - **支持语音添加**：说"添加唤醒词为 XXX"
  - 系统提示自定义词的注意事项（避免过短/过常用）
  - 支持同时启用多个唤醒词
- **实现**：进入应用后，麦克风按当前模式监听，本地通过 Web Audio API + ASR 关键词匹配触发
- **隐私提示**：首次开启时弹窗（也可语音说"我同意"确认）
- **手动启停**：界面提供大按钮可临时静音/重启监听；语音指令"开始监听"/"停止监听"
- **敏感度调节**：低/中/高，"调高敏感度"语音可改

#### 3.3.2 对话核心：ElevenLabs Conversational AI Agent

- **配置**：用户在设置页（语音或手动）输入 ElevenLabs API Key，应用通过 API 创建/复用 CookTalk Agent
- **Client Tools 全集**（执行在浏览器端）：

| 类别         | Tool                                                     | 功能               |
| ------------ | -------------------------------------------------------- | ------------------ |
| **导航**     | `navigate(target)`                                       | 跳转任意页面       |
|              | `goBack()` / `goForward()`                               | 路由历史           |
| **列表**     | `selectListItem(query)`                                  | 编号或关键词选择   |
|              | `scrollControl(direction, amount)`                       | 滚动               |
|              | `filterList(criteria)`                                   | 筛选               |
|              | `sortList(by)`                                           | 排序               |
| **按钮**     | `clickButton(label)`                                     | 触发任意按钮       |
|              | `dialogAction(action)`                                   | 弹窗确认/取消      |
| **表单**     | `fillField(field, value)`                                | 填写字段           |
|              | `selectOption(field, value)`                             | 下拉/单选          |
|              | `toggleSetting(name, state)`                             | 开关切换           |
| **文件**     | `triggerFileAction(action)`                              | 触发文件选择/导出  |
| **菜谱搜索** | `searchLocalRecipes(query, mode)`                        | 本地检索           |
|              | `searchWebRecipes(query)`                                | 联网搜索           |
|              | `getRecipeDetail(id)`                                    | 读完整菜谱         |
|              | `setSearchMode(mode)`                                    | 切换搜索模式       |
| **跟做**     | `startCooking(recipeId)`                                 | 进入跟做           |
|              | `nextStep() / prevStep() / repeatStep() / jumpToStep(n)` | 步骤导航           |
|              | `pauseCooking() / resumeCooking() / endCooking()`        | 状态控制           |
| **定时器**   | `startTimer(seconds, label)`                             | 单个               |
|              | `startMultipleTimers(timers[])`                          | 多个               |
|              | `listActiveTimers()`                                     | 查询               |
|              | `cancelTimer(label) / extendTimer(label, seconds)`       | 取消/延长          |
| **声音**     | `switchVoice(voiceName)`                                 | 临时切换           |
|              | `setDefaultVoice(voiceName)`                             | 设默认             |
|              | `cloneVoice(name)`                                       | 启动克隆流程       |
| **菜谱管理** | `saveCurrentRecipe()`                                    | 保存 AI 推荐到本地 |
|              | `editRecipeField(id, field, value)`                      | 编辑字段           |
|              | `deleteRecipe(id)`                                       | 删除（需二次确认） |
|              | `regenerateCover(id, prompt?)`                           | 重新生成封面       |
| **数据**     | `exportData(scope)`                                      | 导出               |
|              | `importData()`                                           | 触发导入           |
|              | `clearAllData()`                                         | 清空（需二次确认） |
| **系统**     | `changeLanguage(lang)`                                   | 切换语言           |
|              | `changeTheme(theme)`                                     | 切换主题           |
|              | `toggleVoiceBadges(state)`                               | 显示/隐藏语音徽标  |
|              | `pageContextUpdate()`                                    | 推送当前页面上下文 |

- **System Prompt 模板**（核心人设，按界面语言切换）：

  ```
  You are CookTalk, the user's hands-free kitchen voice assistant.

  CRITICAL: You can control the entire web app via voice. The user
  should NEVER need to touch the screen. For ANY user request—
  navigation, list selection, form filling, settings, file operations,
  cooking, timers—identify the right tool and execute it.

  Rules:
  1. Always know the current page (provided via pageContextUpdate).
     Use page-scoped tools accurately.
  2. For recipe queries, ALWAYS searchLocalRecipes first. Only call
     searchWebRecipes when local has no match OR user explicitly asks.
  3. In cooking mode, keep replies short. After each step, wait for
     user instruction.
  4. For destructive actions (delete, clear), ALWAYS ask for verbal
     confirmation before executing.
  5. For ambiguous commands, ask a clarifying question.
  6. When user requests multiple timers in one sentence, parse and call
     startMultipleTimers in a single call.
  7. Match the user's spoken language (Chinese / English).
  ```

#### 3.3.3 VAD 与打断

- 使用 ElevenLabs Conversational AI 内置的 turn-taking 与 interruption 能力
- 用户随时可打断 AI；静音 1.5s 自动结束当前轮次

---

### 3.4 模块③｜菜谱库

#### 3.4.1 数据结构（IndexedDB，Dexie.js）

```typescript
interface Recipe {
  id: string;
  title: string;
  coverImage?: Blob;
  coverSource: "user" | "ai" | "default";
  sourceUrl?: string;
  ingredients: { name: string; amount: string }[];
  steps: {
    order: number;
    description: string;
    durationSec?: number;
    tips?: string;
  }[];
  tags: {
    flavor?: string[];
    difficulty?: "easy" | "medium" | "hard";
    cuisine?: string;
    totalTimeMin?: number;
  };
  rawVideo?: Blob;
  rawAudio?: Blob;
  rawTranscript?: string;
  voiceId?: string;
  createdAt: number;
  lastCookedAt?: number;
}
```

#### 3.4.2 菜谱列表页

- 移动端卡片流（封面+菜名+标签+用时）
- **每个卡片左上角带语音徽标编号 ①②③** 用于"打开第 X 个"
- 筛选 / 排序 / 搜索 全部支持语音
- 语音示例：
  - "只看川菜" → 筛选
  - "按最近烹饪排序"
  - "打开番茄炒蛋"

#### 3.4.3 菜谱详情页

- 顶部：封面 + 菜名 + 标签 + "🎙️ 开始做" 大按钮
- 食材清单（语音"勾选番茄"可标记）
- 步骤列表（语音"念第三步"可朗读试听）
- 折叠面板（语音"展开原始转录"）
- 操作（全部支持语音）：编辑 / 删除 / 导出 / 切换声音 / 重新生成封面

---

### 3.5 模块④｜视频导入与菜谱提取

#### 3.5.1 流程

```
用户说"导入新菜谱" 或点击导入按钮
   ↓
进入导入页 → "选择视频" 触发文件选择
   ↓
文件选好后 → 用户说"开始处理"（或自动）
   ↓
ffmpeg.wasm 提取音频
   ↓
ElevenLabs STT → 转录文本
   ↓
LLM 结构化为 Recipe JSON
   ↓
"AI 补全问答"对话（语音/文本均可）
   - "这道菜大约几人份？"
   - "辣度等级？"
   ↓
封面图处理（用户上传 / AI 生成 / 默认）
   ↓
预览页 → "保存"语音确认 → 入库
```

#### 3.5.2 关键技术点

- **视频音频分离**：`ffmpeg.wasm` 浏览器内完成
- **STT**：`POST https://api.elevenlabs.io/v1/speech-to-text`
- **结构化 Prompt**：
  ```
  以下是一段烹饪视频的语音转录。请提取为 JSON：
  { "title": "...", "ingredients": [...], "steps": [...], "tags": {...} }
  规则：忽略口播废话/广告；从"煮3分钟"等表述提取时间；
  关键火候/手法提示放入 tips。
  ```
- **大文件处理**：>200MB 提示先剪辑

#### 3.5.3 失败处理

- STT 失败：保留原视频，语音提示"识别失败，要重试吗？"
- 结构化失败：降级为只保存原始转录

---

### 3.6 模块⑤｜AI 菜谱搜索与跟做

#### 3.6.1 搜索逻辑

```
用户语音查询
   ↓
关键词预处理（提取菜名/口味/食材）
   ↓
查询 IndexedDB 本地菜谱库
   ↓
┌─ 命中 ≥1 → 优先返回本地 + "还要看 AI 推荐的吗"
├─ 完全未命中 → searchWebRecipes
└─ 仅本地模式 → 即使未命中只回复"未找到"
```

#### 3.6.2 联网搜索

- `searchWebRecipes(query)` 调用用户配置的 LLM（OpenAI / DeepSeek，带网页搜索能力）
- 返回结构化菜谱 JSON
- 用户语音"保存这个" → `saveCurrentRecipe` 入库

#### 3.6.3 跟做模式 UI

- **全屏大字模式**：当前步骤序号 + 文字 + 倒计时
- 顶部：当前声音头像 + 菜名
- 中部：步骤大字 + Tips 高亮
- 底部：手势按钮（上一步/暂停/下一步，纯线条图标）作为冗余触控
- 角落：活跃定时器悬浮卡片
- 防熄屏：`navigator.wakeLock.request('screen')`
- 状态栏：🎤 监听中 / 🌐 Hybrid / 📚 Local Only

#### 3.6.4 模式切换

- 语音："只在我自己的菜谱里找" → 切到本地
- 语音："也搜搜网上的" → 切回混合

---

### 3.7 模块⑥｜多定时器与临时问答（杀手锏）

#### 3.7.1 多定时器并行

**核心特性**：

- 一句话同时设多个定时器："3 分钟提醒翻面，8 分钟关火，10 分钟撒葱花"
- LLM 解析 → `startMultipleTimers([{label, seconds}, ...])`
- 跟做界面顶部展示活跃定时器卡片，按剩余时间排序
- 到点：
  - 提示音
  - AI 用绑定声音念："该翻面啦"
  - 卡片高亮闪烁
- 语音查询：
  - "还剩多久" → 列出全部活跃定时器
  - "取消翻面那个" → 模糊匹配 label 取消
  - "再加 2 分钟" → 给最近的定时器延时
- 容量上限：同时最多 10 个
- 持久化：sessionStorage，刷新页面恢复
- 精度：Web Worker + setTimeout 自校正，误差 < 1s

#### 3.7.2 临时替换问答

**触发**：跟做模式下用户提出非步骤相关问题

- "没生抽用啥代替"
- "这一步用大火还是小火？"
- "孩子不能吃辣怎么调整"

**处理**：

- Agent 识别为「问答意图」而非「导航意图」
- 不打断当前步骤上下文
- LLM 结合当前菜谱上下文 + 通用烹饪知识回答
- 回答简短（< 30 字）+ 自动追问"要继续下一步吗？"
- 用户说"记下来"→ 保存到该菜谱备注

---

### 3.8 模块⑦｜语音克隆与声音管理

#### 3.8.1 声音库

- 默认 ElevenLabs 公共预设声音 5-8 个（多语种）
- 用户可创建"我的克隆声音"

#### 3.8.2 克隆流程（全语音可达）

1. 语音"添加新声音" → 进入克隆页
2. 语音"开始录制" → 30 秒倒计时录音；或语音"上传文件"触发文件选择
3. 语音"完成录制" → 调用 ElevenLabs Voice Cloning API
4. 语音"命名为奶奶" → 保存
5. 语音"试听" → 播放示例

#### 3.8.3 声音绑定

- 全局默认：设置页选；语音"把妈妈设为默认"
- 菜谱级：详情页绑定；语音"红烧肉用妈妈的声音"
- 临时切换：跟做中"换成奶奶的声音" → 立即切换

#### 3.8.4 合规与隐私

- 上传声音前：弹窗 + 语音播报授权说明，用户语音"我确认已获得授权"才进行
- 原始样本会发送给 ElevenLabs 完成克隆，CookTalk 本地也保存样本与 voice_id
- 克隆声音在产品内归入"我的克隆声音"，不混入 ElevenLabs 支持音色列表

---

### 3.9 模块⑧｜封面图管理

#### 3.9.1 三种来源策略

```
菜谱保存时
   ↓
用户是否手动上传封面（含语音触发上传）？
   ├─ 是 → 使用用户上传图（'user'）
   └─ 否 ↓
       是否配置了生图 API Key？
           ├─ 是 → 调用生图 API 生成（'ai'）
           └─ 否 → 使用固定默认图（'default'）
```

#### 3.9.2 用户上传

- 语音"上传封面" → 触发文件选择
- 支持 jpg / png / webp，单图 ≤ 5MB
- 客户端压缩到 max 1024px 长边后存 Blob
- 语音"换张封面"可随时替换

#### 3.9.3 AI 生成封面

- 设置页配置生图 API（**自定义 OpenAI 兼容 endpoint** + Key + Model）
- 默认 Prompt 模板：
  ```
  Create a mouthwatering, realistic cover photo of the finished dish: {dish_name}.
  The dish should look freshly cooked, hot, juicy, glossy, and ready to eat,
  with visible texture, sauce, herbs, garnish, steam, and rich natural color.
  Use professional restaurant food photography with warm side lighting,
  shallow depth of field, crisp focus on the food, a clean ceramic plate or bowl,
  and a simple elegant tabletop.
  Frame it as an app cover image: square 1:1 composition, the plated dish is
  the clear hero and fills most of the frame, no people, no hands, no utensils
  blocking the dish.
  Do not show raw ingredients as the main subject. No text, no logo, no watermark,
  no menu card, no packaging, no distorted food, no unappetizing colors.
  ```
- 语音"重新生成封面" → 用默认 prompt
- 语音"用复古风格生成封面" → 用自然语言定制 prompt
- 失败 → 降级为默认图，语音提示

#### 3.9.4 默认图

- 应用内置 1 张精美默认封面：**简洁线条插画风格 —— 一口锅 + 食材**
- 风格：单色或双色线条、扁平化、无文字、与应用主题色协调
- 静态资源打包，无需网络

---

### 3.10 模块⑨｜设置与数据管理

#### 3.10.1 API Key 管理（全语音可达）

- **必填**：ElevenLabs API Key
- **可选**：
  - LLM API Key（OpenAI 或 DeepSeek，二选一或都填）
  - 生图 API Key（自定义 OpenAI 兼容 endpoint + Key + Model 名）
- **输入方式**：
  - **手动粘贴**：传统输入框
  - **语音播报**：用户念 Key（提示隐私风险，仅推荐短 Key 场景）
- 加密存储：Web Crypto API（AES-GCM）
- 首次进入引导式配置向导（可全语音完成）
- 语音"显示用量"查询当月调用估算

#### 3.10.2 数据导入导出

- 语音"导出全部菜谱" → 下载 JSON
- 语音"导出红烧肉" → 单菜谱导出
- 语音"导入菜谱" → 触发文件选择 → 冲突时语音询问"覆盖、跳过还是重命名"
- 大文件分块写入

#### 3.10.3 其他设置（全部语音可改）

| 设置项     | 语音指令示例                    |
| ---------- | ------------------------------- |
| 默认声音   | "把妈妈设为默认声音"            |
| 唤醒词     | "添加唤醒词为'小厨'"            |
| 唤醒敏感度 | "把敏感度调到高"                |
| 语速       | "语速调到 1.2 倍"               |
| 屏幕常亮   | "打开屏幕常亮"                  |
| 主题       | "切换到深色模式"                |
| 界面语言   | "切换到中文"                    |
| 监听模式   | "切换到唤醒模式"                |
| 语音徽标   | "隐藏语音徽标" / "显示语音徽标" |
| 清除数据   | "清空所有数据" → 二次确认       |

---

### 3.11 模块⑩｜国际化（i18n）

#### 3.11.1 支持语言

- **English（默认）**
- **简体中文**

#### 3.11.2 切换范围

- 所有 UI 文案
- 默认唤醒词（中：嗨厨语 / 英：Hey CookTalk）
- Agent System Prompt 默认语言
- AI 生成菜谱与 STT 输出（跟随语音输入语言自动）
- 默认生图 Prompt（英文）

#### 3.11.3 实现

- `i18next` / `vue-i18n`
- 资源文件：`/locales/en.json` `/locales/zh.json`
- 首次进入 fallback English
- 语音"切换到中文" / "switch to English" 立即生效
- 写入 localStorage 永久记忆

---

## 4. 视觉与图标规范

### 4.1 图标风格

> ✅ **统一规则**：全应用所有图标使用**纯线条型（Outline / Stroke）** 风格，禁止填充型图标。

- **推荐图标库**：Lucide / Tabler Icons / Heroicons (outline)
- **线条粗细**：1.5px-2px，整体统一
- **圆角**：所有线条端点和拐角使用 `round`
- **尺寸规范**：
  - 小：16px（辅助元素）
  - 中：24px（主要按钮）
  - 大：32px（跟做模式手势按钮）
  - 特大：48px+（首次引导、空状态）
- **颜色**：跟随主题色，不使用多色填充

### 4.2 语音徽标视觉

- 列表编号：圆形描边 + 数字，半透明（opacity 60%）
- 按钮麦克风提示：纯线条小麦克风图标 + 浅色背景气泡
- 表单字段提示：浅灰色小字，不抢焦点

---

## 5. 非功能需求

### 5.1 性能

| 指标               | 目标             |
| ------------------ | ---------------- |
| 唤醒响应延迟       | < 500ms          |
| 语音指令到 UI 反馈 | < 1.5s           |
| AI 对话首字延迟    | < 1.5s           |
| 视频→菜谱总时长    | 3 分钟视频 < 60s |
| 本地菜谱搜索       | < 100ms          |
| 多定时器精度       | 误差 < 1s        |

### 5.2 兼容性

- Chrome/Edge/Safari 最新两版
- iOS Safari 16+
- Android Chrome 最新版
- 移动端竖屏优先，平板横竖均适配

### 5.3 隐私安全

- 零后端、零用户数据上传（除调用 ElevenLabs/LLM/生图 API 必需部分）
- API Key 本地加密
- 麦克风权限明示
- 声音克隆需用户语音/手动二选一确认授权

### 5.4 离线能力

- 已下载菜谱可纯离线浏览
- 离线时 TTS 降级为 Web Speech API
- 多定时器纯本地，离线可用

### 5.5 无障碍（A11y）

- 全语音控制天然适配视障用户
- 所有 UI 元素配 ARIA 标签
- 高对比度主题
- 字号至少 16px，跟做模式 32px+

---

## 6. 技术架构

```
┌─────────────────────────────────────────┐
│  前端 (React/Vue + TypeScript)           │
├─────────────────────────────────────────┤
│  状态管理: Zustand / Pinia              │
│  UI: TailwindCSS + shadcn/ui            │
│  图标: Lucide (outline) - 纯线条         │
│  路由: React Router / Vue Router        │
│  i18n: i18next / vue-i18n               │
├─────────────────────────────────────────┤
│  全局语音控制层 ⭐                      │
│  ├─ Voice Command Registry（指令注册）  │
│  ├─ Page Context Tracker（页面感知）    │
│  ├─ Tool Dispatcher（工具分发）         │
│  ├─ Voice Badge Renderer（徽标渲染）    │
│  └─ Confirmation Manager（二次确认）    │
├─────────────────────────────────────────┤
│  本地能力层                              │
│  ├─ IndexedDB (Dexie.js)                │
│  ├─ ffmpeg.wasm                         │
│  ├─ Web Audio + VAD                     │
│  ├─ Web Crypto                          │
│  ├─ WakeLock API                        │
│  └─ Timer Worker                        │
├─────────────────────────────────────────┤
│  ElevenLabs SDK 集成                    │
│  ├─ Conversational AI WebSocket         │
│  ├─ Speech-to-Text REST                 │
│  ├─ Text-to-Speech REST/Streaming       │
│  └─ Voice Cloning REST                  │
├─────────────────────────────────────────┤
│  外部 API 适配层（用户自配 Key）        │
│  ├─ LLM: OpenAI / DeepSeek              │
│  └─ 生图: 自定义 OpenAI 兼容 endpoint   │
└─────────────────────────────────────────┘
```

### 6.1 全局语音控制层设计要点

```typescript
// 每个页面注册当前可用的语音指令
interface VoiceCommand {
  id: string;
  patterns: string[];      // 自然语言示例
  toolName: string;        // 对应 Agent Tool
  scope: 'global' | 'page';
  destructive?: boolean;   // 是否需二次确认
}

// 页面挂载时注册，卸载时注销
useVoiceCommands([
  { id: 'open-recipe', patterns: ['打开第N个','open the Nth'],
    toolName: 'selectListItem' },
  // ...
]);

// PageContextTracker 持续向 Agent 同步：
{
  currentRoute: '/recipes',
  visibleItems: [
    { index: 1, id: 'r1', title: '红烧肉' },
    { index: 2, id: 'r2', title: '番茄炒蛋' }
  ],
  availableActions: ['filter', 'sort', 'search', 'open']
}
```

---

## 7. 信息架构（页面）

```
/                       首页 / 菜谱卡片流
/recipe/:id             菜谱详情
/cook/:id               跟做模式（全屏）
/import                 视频导入
/voices                 声音管理
/settings               设置（含 API Key、导入导出、语言切换）
/onboarding             首次引导
```

每个页面均：

- 注册自己的语音指令集
- 挂载时推送 pageContext 给 Agent
- 默认渲染语音徽标（用户可关闭）

---

## 8. 核心流程时序图

### 8.1 首次启动全语音引导

```
首次访问 → 引导页
TTS: "欢迎使用 CookTalk，请先配置 API Key。说'开始配置'继续。"

User: "开始配置"
  → navigate('/settings')
  → TTS: "请念出你的 ElevenLabs API Key，或说'手动输入'。"

User: "手动输入"
  → TTS: "请在输入框粘贴后说'保存'。"
[用户粘贴]

User: "保存"
  → 验证 → 加密入库
  → TTS: "保存成功，现在可以开始使用了。"
```

### 8.2 跟做对话 + 多定时器 + 临时问答

```
User: "嗨厨语"
  → 唤醒命中 → 建立 ElevenLabs WS

User: "打开我的菜谱"
  → navigate('/recipes')
  → pageContextUpdate(visibleItems)

User: "打开红烧肉"
  → selectListItem("红烧肉")
  → navigate('/recipe/r1')

User: "开始做"
  → startCooking('r1') → /cook/r1
  → TTS（妈妈声）："第一步：把五花肉切成2cm方块。"

User: "下一步"
  → nextStep() → 播报第二步

User: "3分钟后提醒翻面，8分钟提醒关火"
  → startMultipleTimers([
      {label:"翻面", seconds:180},
      {label:"关火", seconds:480}
    ])
  → "好的，两个定时器已设置。"

User: "没冰糖能用什么代替"
  → 识别为问答意图
  → "可以用白糖代替，量减半。要继续下一步吗？"

[3分钟后]
  → Timer Worker 触发
  → TTS（妈妈声）："该翻面啦。"
```

---

## 9. 风险与对策

| 风险                     | 对策                                      |
| ------------------------ | ----------------------------------------- |
| 浏览器麦克风常驻监听耗电 | 提供"按一下启动一次会话"备选模式          |
| ElevenLabs 调用费用过高  | 设置内显示用量预估、配置每日上限提醒      |
| 视频结构化质量不稳       | "AI 补全问答"环节让用户校对、可手动编辑   |
| iOS Safari 限制          | 引导用户首次手势激活；备用 Web Speech API |
| 唤醒词误触发             | 敏感度调节、可改为按钮触发                |
| 多定时器精度             | Web Worker + setTimeout 自校正            |
| 生图 API 失败/费用       | 降级默认图                                |
| 自定义唤醒词识别率低     | 提示选择独特短语，提供测试录音            |
| 语音指令歧义（如"打开"） | Agent 反问澄清、上下文消歧                |
| 语音填表准确率（长文本） | 提供 STT 实时转写预览，错了可"重说"       |
| 误触语音操作（如说梦话） | 关键操作二次确认 + 操作日志可撤销         |

---

## 10. 验收标准（关键功能）

| 功能           | 验收点                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| **全语音可达** | 100% 的 UI 操作都能用至少一种语音指令完成；测试人员全程不碰屏幕完成完整使用流程 |
| 免提唤醒       | 默认/自定义唤醒词 5 米内识别率 ≥ 85%                                            |
| 多定时器       | 一句话同时设 3 个定时器全部正确触发，误差 < 1s                                  |
| 临时问答       | 不打断跟做上下文，回答后能正确"继续下一步"                                      |
| 视频导入       | 3 分钟普通菜谱视频成功生成可用结构化菜谱                                        |
| 语音克隆       | 30s 样本生成的克隆声在 TTS 中可识别为目标人                                     |
| 封面图三态     | 用户上传/AI 生成/默认图均能正确展示与切换                                       |
| 数据本地       | 卸载浏览器数据后所有菜谱与 Key 全部清空                                         |
| 双语切换       | 切换后所有页面文案、唤醒词、Agent prompt 同步更新                               |
| 导入导出       | 导出的 JSON 在另一设备完整还原所有菜谱                                          |
| 二次确认       | 删除/清空类操作必须二次语音确认才执行                                           |
| 上下文感知     | "打开第三个" 在不同列表页都能正确路由到对应项                                   |
| 语音徽标       | 默认开启；语音"隐藏语音徽标"立即生效；设置中可手动切换                          |
| 图标风格       | 全应用图标统一为纯线条型，无填充图标                                            |

---

## ✅ PRD 已最终定稿

所有产品决策已闭环：

- ✅ 全语音控制（含语音徽标默认开启 + 可语音关闭）
- ✅ 纯线条型图标统一规范
- ✅ API Key 输入：手动粘贴 + 语音播报（去除二维码）
- ✅ LLM：OpenAI / DeepSeek
- ✅ 生图：自定义 OpenAI 兼容 endpoint
- ✅ 默认封面：简洁线条插画（一口锅 + 食材）
- ✅ 中英文双语，默认英文
- ✅ 数据全本地（IndexedDB + 加密 localStorage）
- ✅ 多定时器并行 + 临时替换问答 + 声音克隆三大杀手锏
