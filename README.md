# zr 的 C 语言自动报错和补写小助手

面向 C 语言初学者和 OJ 刷题者的 **VS Code 离线纠错插件**：出错的地方用**灰色小字**标出正确写法，按 `Tab` 一键修正；修不了的给诊断和灯泡。

不联网、不调用编译器、不读系统头文件，装完断网照常工作。

> **English** — *zr's C Helper*: an offline C correction & completion extension for VS Code. Mistakes show up as inline grey text and are fixed with <kbd>Tab</kbd>; everything else becomes a diagnostic or a quick-fix lightbulb. Parsing uses a bundled tree-sitter WASM grammar — no network, no compiler, no telemetry.

## 安装

**方式一：VSCodium / Gitpod / Code OSS 等基于 Open VSX 的编辑器**

在扩展面板搜索 `zr-c-fix`，或命令行：

```bash
ext install zr2863356099-sudo.zr-c-fix
```

**方式二：微软官方 VS Code**

> 微软的扩展面板只搜索微软自己的市场，**搜不到本插件**，需要手动安装 VSIX。

从 [Releases](../../releases) 下载 `zr-c-fix.vsix`，然后任选其一：

- 命令行：`code --install-extension zr-c-fix.vsix`
- 界面：扩展面板右上角 `...` → **从 VSIX 安装**

**方式三：从源码构建**

```bash
git clone <this-repo> && cd zr-c-fix
pnpm install
pnpm build        # 产出 dist/extension.js 与两个 wasm
pnpm package      # 产出 zr-c-fix-<version>.vsix
```

## 它能做什么

### 补全

输入 `stdio.h` / `string.h` 函数名的前两个以上字符（`pr`、`sca`、`strl`…），出现带占位符的模板：

```c
pr  ⏎ Tab →  printf("%d\n", );
             ↑ 光标停在这里，再按 Tab 跳到下一个占位符
```

### 纠错（灰字 + Tab）

光标所在行有可原地修复的问题时，停笔 300 ms 后出现灰色修正：

```c
scanf("%d", x);        // 原始：少了 &
scanf("%d", &x);       // 灰字提示 &，按 Tab 后
```

同一行出现多处问题时合并成一次修改，按一次 Tab 全部应用。

### 灯泡（跨行修复）

声明与使用不在同一行的修复走灯泡（`Ctrl+.`）：

```
💡 初始化为 0              int sum;  →  int sum = 0;
💡 补上缺失的 '}'          未闭合的花括号
💡 插入 #include <stdio.h>  用了 scanf 却没 include
💡 补成 'T--'              while (T-) 里少写一个减号
💡 删除多余的数值           误粘贴进来的数字
```

### 诊断

无法自动修的问题出现在 **Problems** 面板和行内注解里：

```
未声明的标识符 'i'
未声明的标识符 'i'            ⚠ 未声明的标识符 'i'
格式符 '%d' 与 'r' 不匹配，应改为 '%lld'
代码中有非 ASCII 字符 '，'，应改为 ','
```

诊断默认中文，可通过 `cfix.locale` 切英文。

## 覆盖范围

53 条规则，默认预设 `core` 开启 31 条（低误报），`standard` 50 条，`all` 53 条。

| 类别 | 例子 |
|---|---|
| 格式化输入输出 | `scanf` 缺 `&`、格式符与实参类型不符、参数个数不对、`%s` 无宽度、`sprintf` 越界 |
| 字符串 | `char*` 用 `>` 比较（比的是地址）、`s[0] == "P"`（字符比指针）、缺 `#include` |
| 类型与函数 | 未知类型拼错、隐式声明、参数数组退化、有符号/无符号比较 |
| 通用语法 | 条件里误用 `=`、缺分号、表达式残缺、括号不配对、漏写 `#`、误粘贴残留 |
| 安全与栈 | 局部变量超限、变长数组栈溢出风险、除零 |
| 中文输入法 | 全角标点、全角字母数字（NFKC 归一化） |

**只覆盖 `stdio.h` 与 `string.h`**。文件 include 了其它头文件时，规则会对不认识的函数一律沉默——不认识不等于错误。

推断不出来就不报（fail-closed）：类型未知、长度未知、文件有语法错误且问题所在行本身就有错误时，宁可不提示。

## 完全离线

```
dist/extension.js        363 KB
dist/tree-sitter-c.wasm  793 KB   C 语法解析
dist/tree-sitter.wasm    187 KB   解析器运行时
```

两个 WASM 打包在扩展内，运行时从磁盘读取。仓库里的 `scripts/net-guard.js` 是一个验证工具：在扩展宿主进程内挂钩 `dns` / `net` / `tls` / `http` / `https` / `fetch`，只记录调用栈里出现本扩展代码的请求。跑完整集成测试后记录为 **0 条**。

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| `cfix.enable` | `true` | 总开关 |
| `cfix.preset` | `core` | 规则预设 `core` / `standard` / `all` |
| `cfix.locale` | `zh` | 诊断语言 `zh` / `en` |
| `cfix.completion.enable` | `true` | 函数模板补全 |
| `cfix.correction.enable` | `true` | 灰字纠错与诊断 |
| `cfix.correction.debounceMs` | `300` | 停笔多久检查当前行 |
| `cfix.stackLimitKB` | `1024` | 普通函数栈帧阈值，递归函数固定 64 KB |
| `cfix.rules` | `{}` | 逐条覆盖，如 `{"shadowing": "off"}` |

## 命令

| 命令 | 说明 |
|---|---|
| `cfix: 接受修正` | 等同按 Tab |
| `cfix: 忽略修正` | 等同按 Esc |
| `cfix: 检查整个文件` | 忽略可见性过滤，列出全部问题 |
| `cfix: 补上缺失的 }` | 未闭合花括号一键修复 |
| `cfix: 导出分析结果` | 把当前文件的分析写成 JSON，便于排查 |

## 已知限制

- **输出格式（PE）不检查**：该用空格还是换行取决于题面，静态分析无从判断。
- **只覆盖两个头文件**：`<math.h>`、`<ctype.h>`、`<stdlib.h>` 里的函数不做检查，也不会误报。
- **跨行修复走灯泡**：灰字只能做单行原地替换。
- **不检查运行时行为**：数组越界、空指针解引用这类只能在运行时发现的问题不在范围内。

## 开发

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest，410+ 用例
pnpm build         # esbuild 打包
```

回归语料在 `test/corpus/`，`node dist/verify-m4.js` 校验命中集合没有漂移。

## License

MIT
