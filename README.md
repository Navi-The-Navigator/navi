<p align="center">
  <img src="./media/navi.svg" alt="Navi logo" width="120" />
</p>

<h1 align="center">Navi</h1>

<p align="center">
  一个运行在 VS Code 里的导师型编程扩展：用任务分解、聚焦区域和可追踪执行流，引导你完成修改，而不是直接倾倒整段答案。
</p>

<p align="center">
  <a href="https://github.com/JimmyfaQwQ/navi/actions/workflows/pr-tests.yml">
    <img src="https://github.com/JimmyfaQwQ/navi/actions/workflows/pr-tests.yml/badge.svg" alt="PR Tests" />
  </a>
</p>

## Navi 是什么

Navi 是一个基于 VS Code Webview + GitHub Copilot SDK 构建的扩展。它把聊天、任务清单、代码聚焦和子 Agent 协作放在同一个工作流里，目标不是替用户“秒出完整代码”，而是把编码过程拆成可执行、可检查、可回看的步骤。

当前仓库已经不是一个空壳原型，而是具备完整主链路的开发中版本：

- 侧边栏 Chat 视图用于需求输入、会话切换、任务跟踪和 Agent 交互
- Focus 视图用于展示当前待处理代码区域，并支持逐个跳转
- 主 Agent 内置 TODO、错误读取、代码聚焦、聚焦跳转、进度同步等工具
- 主 Agent 可委托多个子 Agent 完成代码探索、任务规划和完成度评估
- 支持 GitHub Copilot 认证，也支持接入任意 OpenAI-compatible BYOK 服务
- 支持通过 MCP 扩展额外工具，并提供图形化的 MCP 配置入口

## 当前能力

### 1. 聊天驱动的编码工作流

Navi 不是单纯的聊天窗口。一次对话会带着以下状态一起推进：

- 当前会话的消息历史
- 当前任务 TODO 列表
- 子 Agent 执行记录
- 当前聚焦代码区域
- 进度状态与阶段性提示

这意味着你在侧边栏里看到的不只是回复文本，而是一条完整的“从理解需求到推进修改”的执行轨迹。

### 2. Focus Regions

Navi 可以把“下一步应该改哪里”映射成明确的代码区域：

- 指向具体文件和行号范围
- 在编辑器中高亮当前 focus
- 在 Focus 面板中列出全部区域
- 支持上一处、下一处跳转
- 支持对选中的 focus 直接发起 Help 或 Review

如果你的任务跨多个文件，Navi 可以把它拆成多个 focus 区域，而不是只给一段模糊说明。

### 3. 内置工具链

主 Agent 当前接入了这些能力：

- `get_errors`: 读取当前工作区 diagnostics
- `manage_todos`: 管理当前会话的 TODO 列表
- `focus_user_code_region`: 创建并高亮待编辑区域
- `clear_focus_code_region`: 清理 focus 区域
- `get_focus_code_regions`: 读取当前会话的所有 focus
- `jump_to_focus`: 跳转到指定或当前 focus
- `update_progress`: 向界面同步阶段性进度

这组工具使 Navi 的执行状态是可见的，而不是“模型内部想了什么你完全不知道”。

### 4. 子 Agent 协作

仓库里已经定义了三个专用子 Agent：

- `planning_agent`: 根据需求和上下文生成任务 TODO
- `code_exploration_agent`: 探索代码库、定位实现和调用链
- `code_review_agent`: 评估当前任务是否真正完成

子 Agent 的执行会以独立 run 的形式出现在聊天时间线中，便于回看每一步做了什么。

### 5. 多会话管理

聊天状态不是一次性的：

- 自动创建新会话
- 基于首条输入生成默认标题
- 支持切换、重命名、删除会话
- 每个会话拥有独立的 TODO 与 focus 状态

### 6. 可视化设置入口

除了 VS Code Settings 外，Navi 本身还提供设置面板，支持：

- 切换认证模式
- 配置 API Key / Endpoint / Model
- 添加、编辑、启停、删除 MCP 服务器

## 适用场景

Navi 更适合这些场景：

- 你希望 AI 先帮你厘清修改点，而不是直接重写一大片代码
- 你在做跨文件修改，需要明确“先改哪里，再改哪里”
- 你希望任务过程可追踪，能看到 TODO、focus 和子 Agent 执行记录
- 你想把 Copilot SDK、MCP、Webview 工作流组合成一个实际可用的扩展原型

如果你的目标只是一个最轻量的聊天补全窗口，Navi 会比那类工具更强调过程控制。

## 界面概览

扩展会在 Activity Bar 中注册 Navi 容器，并提供两个视图：

- `Chat`: 主聊天与任务执行面板
- `Focus`: 当前 focus 区域列表与导航面板

同时还注册了几个命令：

- `Navi: Switch Focus Region`
- `Navi: Focus Previous Region`
- `Navi: Focus Next Region`

## 安装与运行

### 环境要求

- Node.js 22+
- npm 10+
- VS Code 1.110.0+

### 安装依赖

```bash
npm install
```

### 构建扩展

```bash
npm run compile
```

### 监听构建

```bash
npm run watch
```

### 监听测试编译

```bash
npm run watch-tests
```

### 运行测试

```bash
npm test
```

### 启动扩展调试

1. 用 VS Code 打开当前项目。
2. 按 F5 启动 Extension Development Host。
3. 在左侧 Activity Bar 中打开 Navi。
4. 在 Chat 视图里输入需求，或在 Settings 中先完成模型配置。

## 认证与模型配置

Navi 支持两种认证方式：

### 1. Copilot 模式

配置项：

- `navi.authMode = copilot`

说明：

- 优先尝试使用 VS Code GitHub 认证会话
- 若不可用，可回退到 Copilot SDK 的已登录用户模式
- 适合已经具备 GitHub Copilot 使用条件的环境

### 2. BYOK 模式

配置项：

- `navi.authMode = byok`
- `navi.apiKey`
- `navi.apiBaseUrl`
- `navi.model`

说明：

- 通过 OpenAI-compatible 接口连接外部模型服务
- API Key 可写入 VS Code Settings
- 也可通过环境变量 `NAVI_API_KEY` 提供

### 可配置项一览

| Setting | 说明 | 默认值 |
| --- | --- | --- |
| `navi.authMode` | 认证模式：`copilot` 或 `byok` | `copilot` |
| `navi.apiKey` | BYOK 模式的 API Key | `""` |
| `navi.apiBaseUrl` | OpenAI-compatible 接口地址 | `https://api.openai.com/v1` |
| `navi.model` | 模型名称 | `gpt-5-mini` |
| `navi.streaming` | 是否启用流式会话 | `true` |
| `navi.subagentPseudoStreamChunkSize` | 子 Agent 伪流式分块大小 | `28` |
| `navi.subagentPseudoStreamDelayMs` | 子 Agent 伪流式分块延迟毫秒数 | `18` |
| `navi.temperature` | 采样温度 | `0.2` |
| `navi.recursionLimit` | 单次请求最大推理/工具步数 | `60` |
| `navi.mcpEnabled` | 是否启用 MCP 工具 | `false` |
| `navi.mcpServersJson` | MCP 服务器 JSON 配置 | `""` |
| `navi.copilotCliPath` | Copilot CLI 可执行文件路径 | `""` |
| `navi.debugCopilotCliArgs` | 输出 Copilot CLI 启动参数调试信息 | `false` |
| `navi.debugAgentReplyFlow` | 输出 Agent 回复链路调试日志 | `false` |
| `navi.debugAgentReplyFlowReveal` | 写入日志时自动显示输出通道 | `false` |

### Windows 上的 Copilot CLI 说明

在部分环境中，Copilot CLI 可执行文件可能无法被自动定位。此时可以手动设置：

```json
{
  "navi.copilotCliPath": "node_modules/@github/copilot-win32-x64/copilot.exe"
}
```

如果要排查 CLI 启动参数，可以开启：

```json
{
  "navi.debugCopilotCliArgs": true
}
```

## MCP 配置

Navi 支持从 MCP 服务器加载额外工具。

你可以直接通过 Navi 的 MCP Settings 面板完成添加和管理，也可以手动编辑 `navi.mcpServersJson`。

### 最小示例：stdio

```json
{
  "math": {
    "enabled": true,
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-math"]
  }
}
```

### 最小示例：http

```json
{
  "remote-toolkit": {
    "enabled": true,
    "transport": "http",
    "url": "https://example.com/mcp"
  }
}
```

说明：

- `enabled: false` 的服务器不会被加载
- `stdio` 支持 `command`、`args`，以及可选的 `cwd`
- `http` 使用远端 MCP URL
- 全局开关由 `navi.mcpEnabled` 控制

## 开发工作流

### 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run compile` | Webpack 构建扩展代码 |
| `npm run watch` | 监听扩展代码变更 |
| `npm run package` | 生产模式打包 |
| `npm run compile-tests` | 编译测试代码到 `out/` |
| `npm run watch-tests` | 监听测试代码变更 |
| `npm run lint` | 对 `src/` 运行 ESLint |
| `npm test` | 编译、构建、lint 并运行 VS Code 扩展测试 |

### 推荐本地开发方式

1. 运行 `npm install`
2. 启动 `npm run watch`
3. 需要测试联动时再启动 `npm run watch-tests`
4. 按 F5 打开 Extension Development Host
5. 在开发宿主里实际操作 Chat / Focus / Settings

## 测试覆盖

当前测试并不只覆盖纯工具函数，还覆盖了这几个核心面：

- 会话状态管理
- 自定义 Agent 定义
- TODO 管理工具
- focus 创建、读取、跳转、清理工具
- 错误读取工具
- Chat / Focus Webview HTML 输出
- 消息与 ID 工具函数

这意味着 README 里提到的主交互链路，大部分在仓库里已经有测试约束，而不是仅存在于文档设想中。

## 项目结构

```text
src/
  agent/
    agents/              # 自定义子 Agent 定义
    tools/               # 主 Agent 可调用的内置工具
    chatGateway.ts       # Copilot SDK 会话管理与流式回复
    config.ts            # 主系统提示词与 focus action prompt
    mainAgent.ts         # 主 Agent 装配
    modelFactory.ts      # Copilot/BYOK 客户端与模型配置
  chat/
    sessionStore.ts        # 多会话、消息、run、todo 状态管理
    chatViewProvider.ts    # Chat WebviewViewProvider（注册 navi.chatWebview）
    inboundRouter.ts       # chat:* 入站消息路由
    generationController.ts# 生成生命周期、abort/cancel、持有 chat gateway
    subagentRunTracker.ts  # 子 Agent run 追踪（4 个 Map + 会话事件处理）
    chatMessenger.ts       # 所有 chat:* 出站消息（唯一线协议出口）
  focus/
    focusController.ts     # focus 区域状态与全部操作
    focusDecorations.ts    # 编辑器高亮装饰
    focusStatusBar.ts      # focus 状态栏项
    focusViewProvider.ts   # Focus WebviewViewProvider + focus:* 路由
  mcp/
    config.ts            # MCP 配置解析与序列化
    settingsManager.ts   # MCP 图形化设置入口
  settings/
    settingsManager.ts   # LLM / MCP 设置入口
  types/
    chat.ts              # 聊天、run、focus 等核心类型
  utils/
    id.ts
    math.ts              # clampInteger 等纯工具
    message.ts
  webview/
    chat/                # Chat Webview：{ view, render, state, html }.ts
      view.ts            #   入口：DOM 绑定 + 入站消息分发
      render.ts          #   渲染：markdown/代码块/run 面板/会话抽屉
      state.ts           #   视图状态对象 + 类型 + 常量 + DOM 引用
      html.ts            #   Chat HTML 模板（Node 侧，getChatHtml）
    focus/               # Focus Webview：{ view, render, state, html }.ts
      view.ts
      render.ts
      state.ts
      html.ts            #   Focus HTML 模板（getFocusHtml）
  extension.ts           # 精简的激活/装配入口（activate 仅做构造与接线）
media/
  navi.svg
  navi.css               # 共享基础样式（tokens / a11y / 图标按钮 / focus 卡片）
  chat.css               # Chat 视图专属样式
  focus.css              # Focus 视图专属样式
test/
  *.test.ts             # 单测与扩展测试
```

## 当前边界与注意事项

- 这是一个正在持续迭代的扩展，不应把 README 理解成“所有工作流都已经彻底产品化”
- 主体交互已经可用，但策略质量仍明显依赖底层模型和提示词设计
- 在 Copilot 模式下，CLI 解析与宿主环境差异仍然是需要重点排查的兼容点
- MCP 配置错误时不会静默修复，建议先从最小可运行配置开始验证

## 这个仓库适合继续做什么

- 打磨导师型 Agent 的执行策略
- 扩展 focus 驱动的编辑器交互
- 继续增强子 Agent 协作和结果可视化
- 完善 BYOK / Copilot / MCP 三条配置链路的稳定性
- 继续补测试，减少行为回归

## License

仓库当前没有附带 LICENSE 文件。如果你准备对外发布或分发，请先补充明确的许可证。
