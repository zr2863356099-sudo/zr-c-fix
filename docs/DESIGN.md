# cfix 设计定稿

离线 VS Code C 语言自动纠错插件。本文是对话中所有决策的汇总，用于跨会话恢复上下文。
规则明细见 [RULES.md](RULES.md)。

---

## 1. 目标与定位

- **离线可用**：不联网、不依赖运行时下载、不依赖本机编译器。
- **语言范围**：先覆盖 `stdio.h` 与 `string.h`，再扩展通用 C 错误与栈安全。
- **风格**：纯英文、简洁提示，不做教学式长篇解释。
- **主交互**：inline completion（灰色小字 + Tab 接受），诊断只作辅助。
- **典型场景**：C 语言课程 / OJ 刷题，学生代码单文件、100～1200 行。

## 2. 已确定的决策

| # | 决策 | 理由 / 代价 |
|---|---|---|
| D1 | 主入口是 `InlineCompletionItemProvider`，不是 `DiagnosticCollection` | 用户要的是"灰色小字 + Tab"，而非"报错列表" |
| D2 | 补全只做 stdio/string 的 20 个函数 + 参数模板 | 聚焦主题，避免变成通用 snippet 插件 |
| D3 | 补全触发：打字即时，前缀 ≥ 2 字符 | 与纠错的 300ms 节奏分离 |
| D4 | 纠错触发：停顿 **300ms**（初版 500ms，后压缩） | 更快，但必须"先判空再触发"否则会闪 |
| D5 | 纠错呈现：**修正后的整行**替换 | 用户选择；副作用是受"单行"硬约束 |
| D6 | 不做 Esc 抑制 | VS Code 不暴露"用户拒绝建议"事件，拦截 Esc 成本高 |
| D7 | 改为自动一次性提示：`(行内容 hash, ruleId)` 只提示一次，行内容变则重置 | 零按键、零上下文判断；代价是"想再看一眼"需改动该行 |
| D8 | 记住变量类型，**覆盖式**更新（全量替换，不 merge） | 学生改类型后旧值必须消失，否则出幽灵错误 |
| D9 | 抑制键带 `typeFingerprint` | 改声明类型后，使用该变量的行即使未改动也要重新提示 |
| D10 | 不做与其他 AI 补全插件的共存逻辑 | 用户明确不用 |
| D11 | 不使用 LSP，进程内运行 | 单文件场景够用，省一层进程与协议 |
| D12 | 不依赖编译器 / clangd | 离线分发二进制成本高；本机虽有 gcc，但不能假设用户都有 |

## 3. 技术选型

| 决定 | 选择 | 说明 |
|---|---|---|
| 解析器 | `web-tree-sitter` + `tree-sitter-c.wasm` | 纯 WASM、免 node-gyp、跨平台、可增量 |
| 库函数知识 | 内置签名表（约 20 项） | 不解析系统头文件，绕开离线路径/编码问题 |
| 类型信息 | 自建符号表 + 轻量表达式推导 | 覆盖学生级代码即可，推导不出就沉默 |
| 结构 | 规则层与解析前端解耦 | 预留 `clang -Xclang -ast-dump=json` 后端 |
| 状态 | 符号表文件级、按文档 `version` 重建 | 纠错触发仍按行，300ms 才跑得动 |

**关键约束**：`InlineCompletionItem.range` **必须起止在同一行**。由此推出——

- 能用灰色小字做的修复 = **单行原地重写**；
- 必须新增一行或跨越逻辑的修复 = 灯泡（CodeAction），不进灰色小字；
- 整行重写天然可以**合并同一行的多个修复**，所以"多修复区间冲突"问题不存在。

## 4. 架构

```
cfix (TypeScript, 扩展宿主进程内)
├─ parser      web-tree-sitter + tree-sitter-c.wasm（增量解析，防抖）
├─ model       符号表 + 类型模型 + 表达式类型推导
├─ engine
│   ├─ completion  函数模板库 + 前缀 trie → InlineCompletionItem(SnippetString)
│   └─ correction  规则检测 → 合并修复 → 整行重写 → InlineCompletionItem(纯文本)
├─ inline      单个 InlineCompletionItemProvider，合并两个来源
└─ diagnostics 镜像（hover 解释 / 问题面板 / 状态栏计数），非主交互
```

```
cfix/
├─ package.json
├─ src/
│  ├─ extension.ts
│  ├─ parser/{treesitter.ts,index.ts}
│  ├─ model/{symbols.ts,types.ts,signatures.ts}
│  ├─ rules/{types.ts,index.ts,stdio/*,string/*,common/*,safety/*}
│  ├─ completion/{templates.ts,provider.ts}
│  ├─ correction/{engine.ts,provider.ts,merge.ts}
│  └─ util/{debounce.ts,ranges.ts}
├─ test/fixtures/*.c
└─ dist/                      ← 含 tree-sitter-c.wasm
```

```ts
type Rule = {
  id: string;
  severity: 'error' | 'warning';
  channel: 'ghost' | 'hint';        // ghost 必须能单行原地重写
  check(ctx: RuleContext): Issue[]; // 推断失败返回 []（fail-closed）
};
type Issue = {
  range: Range;                     // 波浪线位置
  message: string;                  // English, terse
  fix?: { range: Range; newText: string };  // 单行内
};

type TypeInfo = {
  base: 'int'|'char'|'float'|'double'|'short'|'long'|'longlong'|'unsigned'|'signed'|'void'|'struct'|'unknown';
  ptr: number;        // char* = 1
  array?: number;
  const?: boolean;
};
```

## 5. 交互规范

### 补全

- 触发：打字时（`triggerKind = Automatic`），光标在代码上下文（注释/字符串内不触发）。
- 光标前标识符前缀 ≥ 2 字符，查前缀 trie。
- `insertText` 用 `SnippetString`：

```
printf("${1:%d}\\n", ${2:});
```

- Tab 接受并落到 `${1}`，再 Tab 跳 `${2}`。

### 纠错（装饰器渲染，v8 起）

> **为什么不用内联建议**：VS Code 的 inline suggestion 本质是"在光标处插入文字"，实测**不会渲染"替换光标之前文字"的建议**——`provideInlineCompletionItems` 返回成功、`commit` 也能提交，但屏幕上什么都不画。补全（`pr` → `printf`）是光标处插入，仍用原生机制；纠错必须自绘。

1. `onDidChangeTextDocument` 起 300ms 定时器，新输入则取消。
2. **先判空**：只有当前行解析出 issue 才继续。
3. 合并该行所有可修 issue → 生成修正后的整行文本。
4. 算最小差异：
   - 该行只有 1 个 fix → 用它自己的 range / newText
   - 多个 fix → `trimCommon(原行, 修正行)` 得到 `prefixLength / oldMiddle / newMiddle`
5. 渲染：
   - `oldMiddle` 非空 → 删除线（`textDecoration: 'line-through'`）
   - `newMiddle` 非空 → 在 `prefixLength + oldMiddle.length` 处挂灰色 `after` 文本
   - 两者都空 → 不显示
6. `setContext('cfix.suggestionVisible', true)`，Tab/Esc 键位据此生效。
7. Tab → `WorkspaceEdit` 整行替换；Esc → 清除并写入抑制表。
8. 清除时机：接受/取消、光标离开、选区变化、文档变化、切换编辑器、失焦、配置变化、关闭文档。

### 抑制

| 学生行为 | 该位置 | 别的位置 |
|---|---|---|
| 忽略，继续在别处打字 | 已消耗，不再重复 | 照常触发 |
| 移走又移回（未编辑） | 仍不提示 | 照常 |
| 编辑了这一行 | 键变化，重新提示 | 照常 |
| Tab 接受 | 问题消失 | 照常 |

可选配置 `cfix.reshowAfterMs`（默认 0 = 不重弹）。

## 6. 状态模型

| 状态 | 键 | 失效条件 | 更新方式 |
|---|---|---|---|
| 符号表 | 文档 `version` | 任何编辑 | **全量替换**，删除已消失的符号 |
| 抑制表 | `(行内容 hash, ruleId, typeFingerprint)` | 行内容变化 / 类型变化 | 追加，按需清理 |
| 补全候选 | 光标前缀 | 每次请求 | 无状态 |

**类型覆盖必须穿透**：改 `int x` → `double x` 后，前文已消耗的提示要重新出现，靠 `typeFingerprint` 变化实现。

**中间态容错**：打字打到一半（如 `dou`）解析残缺 → 类型标 `unknown` → 规则沉默。

## 7. 规则库

共 **49 条**（G 通道 23 / H 通道 26），分六组：stdio（9）、string（8）、通用控制流（19）、栈安全（4）、类型与函数（2）、语法与拼写（7）。详见 [RULES.md](RULES.md)。

预设：`core`（26，默认）/ `standard`（46）/ `all`（49）。

四条全局约定：

1. 只改格式符，绝不改学生声明的变量类型。
2. 推断不出来就不报（fail-closed）。
3. 文件含 `ERROR` 节点（未写完）时禁止自动应用修复。
4. 同一位置只保留一条主诊断，其余折叠。

## 8. 配置项

| Key | 默认 | 说明 |
|---|---|---|
| `cfix.enable` | `true` | 总开关 |
| `cfix.preset` | `core` | `core` / `standard` / `all` |
| `cfix.completion.enable` | `true` | 补全 |
| `cfix.correction.enable` | `true` | 纠错 |
| `cfix.correction.debounceMs` | `300` | 停顿阈值 |
| `cfix.rules.<id>` | 预设值 | 单条规则覆盖 |
| `cfix.stackLimitKB` | `1024` | 栈帧阈值（递归函数内降到 64 KB） |
| `cfix.reshowAfterMs` | `0` | 同一位置重弹冷却，0 = 不重弹 |

## 9. 里程碑

| 阶段 | 内容 | 估时 |
|---|---|---|
| M0 | 扩展骨架 + WASM 加载 + **两个技术验证** | 0.5d |
| M1 | 补全引擎：20 个模板、前缀 trie、上下文守卫 | 1.5d |
| M2 | 符号表 + 类型模型 + 覆盖语义 + 类型指纹 | 2.5d |
| M3 | 规则引擎 + core 规则 + 拼写建议（编辑距离）+ 夹具测试 | 3.5d |
| M4 | 格式串校验（含 printf 提升 / scanf 指针语义单测） | 1d |
| M5 | 诊断镜像、配置、安全规则、打包验证 | 1d |

合计约 **10 天**。

### M0 的两个技术验证（不过关就改交互）

1. **整行范围 + 光标在行中时的 ghost 渲染**：`range` 从行首到行尾、`insertText` 是整行修正文本时，VS Code 会按公共前缀裁剪，可能只显示"差异尾部"而非完整一行。
   - 退路：退化为片段级替换。
2. **300ms 定时器主动调用 `inlineSuggest.trigger` 是否稳定**（是否需要编辑器保持焦点）。
   - 退路：行尾装饰器 `Tab to fix` + 自定义键绑定。

## 10. 参考数据：真实作业分析

分析了 `D:\D` 下 71 个 `.c` 文件（2026/9/17 – 10/30）：

- 工具链 MinGW64 gcc（`C:\mingw64\bin\gcc.exe`），`tasks.json` **未开 `-Wall`**。
- 15 条规则有真实证据：`if (flag=0)`、`char` 用 `%d` 读、`long long` 用 `%d` 输出、格式符与实参数目不符、`gets`、`sprintf` 定长、缺 `<string.h>` 用了 `strlen`、VLA（`int mi[o][o]`）、3.2 MB 局部数组、`-2147483648`、未初始化变量、除零、变量遮蔽、非 void 函数缺 `return`、越界读。
- 结论：gcc 默认不报这些问题，插件有独立价值。

## 11. 未决 / 下一步

- [ ] M0 尚未开工（等待确认）
- [ ] 同一位置命中多条规则时的"主诊断"选择策略需在 M3 落地
- [ ] `scanf-string-width` 只在缓冲区 ≤ 256 字节时补宽度
- [ ] `gets` 不视为错误（OJ 环境下可正常编译运行），不再提示替换

## 12. 变更记录

| 版本 | 变化 |
|---|---|
| v1 | 初稿：以诊断 + 快速修复为主 |
| v2 | 改为 inline completion 主交互；300ms；去掉 Esc 抑制；加类型覆盖语义与类型指纹 |
| v3 | 规则库定稿 43 条，预设分三层，固化本文与 RULES.md |
