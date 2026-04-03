<p align="center">
  <img src="./media/navi.svg" alt="Navi logo" width="120" />
</p>

<h1 align="center">Navi</h1>

<p align="center">
  A VS Code extension for guided coding, task decomposition, and mentor-style AI assistance.
</p>

<p align="center">
  <a href="https://github.com/JimmyfaQwQ/navi/actions/workflows/pr-tests.yml">
    <img src="https://github.com/JimmyfaQwQ/navi/actions/workflows/pr-tests.yml/badge.svg" alt="PR Tests" />
  </a>
</p>

Navi 是一个面向编程场景的 VS Code 扩展，强调“任务驱动 + 思路引导”，目标不是一次性替你写完整答案，而是在关键节点提供清晰、渐进、可操作的帮助。

> [!TIP]
> 如果你希望 AI 更像导师而不是代码生成器，Navi 的设计方向会更贴近这种使用方式。

> [!NOTE]
> 当前版本仍处于早期原型阶段，核心交互已具备基础骨架，但很多产品能力还在演进中。

## Why Navi

很多 AI 工具更偏向“直接生成整段代码”。这在提速上有效，但会削弱理解过程、边界判断和实现掌控感。Navi 的目标不同：

- 先帮助你明确目标和约束，再开始实现
- 把复杂需求拆成一组可推进的小任务
- 在关键位置提供提示，而不是默认直接给出完整答案
- 在完成局部实现后，给出针对性的检查和改进建议

## Core Experience

### 1. 需求输入与任务拆解

用户输入需求后，AI 生成建议的任务结构、实现方向和可推进路径。

### 2. 任务锚点与步骤推进

围绕关键实现点组织任务，让用户可以按步骤完成，而不是在整个代码库里盲目跳转。

### 3. 渐进式提示

每个任务点都可以提供分层引导，从方向提示到更具体的实现建议，默认不直接倾倒完整答案。

### 4. 局部完成后检查

完成某一段实现后，用户可以获得面向该局部的反馈，重点关注：

- 正确性
- 思路是否合理
- 结构与可维护性
- 可继续优化的点

### 5. 导师式聊天

聊天交互以提问、澄清、提示、局部分析为主，帮助用户建立自己的问题解决路径。

## Current Status

当前仓库对应版本 `v0.0.1`，已经具备：

- VS Code 扩展基础脚手架（TypeScript + Webpack）
- Activity Bar 中的 Navi 侧边栏入口
- 基础 Webview 聊天界面
- 主 Agent 可委派的独立 Code Review Agent
- DeepSeek 模型配置入口
- MCP 工具接入配置入口
- 本地测试与 GitHub PR 测试工作流

尚未完成但已在规划中的能力：

- 自动需求解析与任务树生成
- 编辑器内任务锚点插入与导航
- 更细粒度的渐进式提示策略
- “完成后局部检查”闭环
- 更稳定的会话状态管理与导师式策略

> [!IMPORTANT]
> 这个仓库目前更适合继续迭代原型和验证交互，而不是直接作为稳定生产插件发布。

## Quick Start

### Requirements

- Node.js 22+
- npm 10+
- VS Code 1.110.0+

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Run Tests

```bash
npm test
```

### Launch the Extension

1. 在 VS Code 中打开这个项目。
2. 按 `F5` 启动 Extension Development Host。
3. 在左侧 Activity Bar 中打开 `Navi` 侧边栏。

> [!TIP]
> `npm test` 会先执行 TypeScript 编译、Webpack 构建和 ESLint，再运行 VS Code 扩展测试。

## Configuration

Navi 当前暴露了以下主要配置：

| Setting | Description | Default |
| --- | --- | --- |
| `navi.deepseekApiKey` | DeepSeek API Key | `""` |
| `navi.deepseekBaseUrl` | DeepSeek OpenAI-compatible base URL | `https://api.deepseek.com/v1` |
| `navi.deepseekModel` | DeepSeek model name | `deepseek-reasoner` |
| `navi.temperature` | Sampling temperature | `0.2` |
| `navi.mcpEnabled` | Enable MCP-based tools | `false` |
| `navi.mcpServersJson` | JSON string describing MCP servers | `""` |

也可以在 Navi 面板的设置入口里直接修改 API Key、LLM API 端点和模型名，而不需要手动打开 JSON 设置文件。

## MCP Configuration

Navi 支持通过 MCP 为 Agent 注入额外工具。

1. 在 VS Code Settings 中开启 `navi.mcpEnabled`。
2. 配置 `navi.mcpServersJson`，例如：

```json
{
  "math": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-math"]
  }
}
```

也可以通过环境变量 `NAVI_MCP_SERVERS_JSON` 提供同样的 JSON 字符串。

> [!NOTE]
> 如果 MCP 配置 JSON 无效，工具加载会失败。优先先用一个最小示例验证格式，再逐步扩展。

## Project Structure

```text
src/
  agent/             # 模型网关与工具装配
  chat/              # 会话状态管理
  test/              # 扩展与单元测试
  webview/           # 侧边栏 Webview HTML
  extension.ts       # 扩展入口
media/
  navi.svg           # Logo / sidebar icon
  sidebar.css        # Webview styles
.github/workflows/
  pr-tests.yml       # Pull request CI
```

## Development Workflow

- `npm run compile`: 构建扩展代码
- `npm run watch`: 监听扩展代码变更
- `npm run compile-tests`: 编译测试代码到 `out/`
- `npm run watch-tests`: 监听测试代码变更
- `npm test`: 执行完整测试链路

GitHub Actions 会在每个 Pull Request 上运行 [`.github/workflows/pr-tests.yml`](./.github/workflows/pr-tests.yml)。

## Roadmap

- [ ] 需求输入面板与上下文采集
- [ ] 结构化任务分解引擎
- [ ] 编辑器任务锚点渲染与跳转
- [ ] 便签式分层提示交互
- [ ] 局部完成检查与反馈回路
- [ ] 会话记忆与导师式提问策略
- [ ] 可配置提示强度与学习模式

## Contributing

欢迎通过 Issue 和 PR 参与共建，尤其是以下方向：

- VS Code 编辑器交互与装饰能力
- 任务分解与提示策略设计
- 局部代码分析与反馈质量
- 教学式交互和学习体验设计
- 测试、CI 与工程稳定性

## License

当前仓库尚未声明许可证。若准备公开分发，建议先补充 `LICENSE` 文件并明确使用条款。
