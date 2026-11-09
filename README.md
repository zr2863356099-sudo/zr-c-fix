# zr 的 C 语言自动报错和补写小助手

面向 C 语言初学者和 OJ 刷题者的 **VS Code 离线纠错插件**：出错的地方用**灰色小字**标出正确写法，按 `Tab` 一键修正；修不了的给诊断和灯泡。

不联网、不调用编译器、不读系统头文件，装完断网照常工作。

> **English** — *zr's C Helper*: an offline C correction & completion extension for VS Code. Mistakes show up as inline grey text and are fixed with <kbd>Tab</kbd>; everything else becomes a diagnostic or a quick-fix lightbulb. Parsing uses a bundled tree-sitter WASM grammar — no network, no compiler, no telemetry.

---

## 安装

**在 VS Code 扩展面板搜索 `zr-c-fix`** 即可安装。

也可以从以下任一渠道手动安装：

| 渠道 | 地址 |
|---|---|
| VS Code Marketplace | https://marketplace.visualstudio.com/items?itemName=zr2863356099-sudo.zr-c-fix |
| Open VSX（VSCodium / Gitpod / Code OSS） | https://open-vsx.org/extension/zr2863356099-sudo/zr-c-fix |
| GitHub Releases（.vsix 文件） | https://github.com/zr2863356099-sudo/zr-c-fix/releases |

手动装 vsix：

```powershell
code --install-extension zr-c-fix.vsix
```

装完按 `Ctrl+Shift+P` → `Reload Window`。

---

## 它能做什么

| 形态 | 触发方式 | 适用场景 |
|---|---|---|
| 灰色小字 | 光标停在某行 0.3 秒 | 当前行有**可原地修好**的错误 |
| 灯泡 `Ctrl+.` | 手动 | 修复要跨行（改声明、插 `#include`、补 `}`） |
| 波浪线 + Problems | 自动 | 能指出问题但修法不确定 |
| 智能补全 | 输入函数名 / 关键字前缀 | 按你**已定义的变量**自动填好参数 |

### 智能补全：会读你的变量表

补全不是固定模板，而是看着你**当前作用域已声明的变量**生成：

```c
int main(){
    int a;
    int b;
    scan     ⏎ Tab →  scanf("%d%d", &a, &b);
}
```

变量读过了就自动跳过：

```c
int main(){
    int a, b, c;
    scanf("%d", &a);        // a 已经读入
    scan     ⏎ Tab →  scanf("%d%d", &b, &c);
}
```

`printf` 只给**已经能用**的变量（初始化过、赋过值、或被 scanf 读过）：

```c
int a, b;
scanf("%d%d", &a, &b);
pri      ⏎ Tab →  printf("%d %d\n", a, b);
```

类型与格式符自动配对，包括最容易错的两处：

| 类型 | `scanf` | `printf` |
|---|---|---|
| `int` | `%d` | `%d` |
| `double` | **`%lf`** | **`%f`** |
| `long long` | `%lld` | `%lld` |
| `char s[10]` | `%9s`（宽度自动、**不加 `&`**） | `%s` |

循环头也能按"最可能的边界变量"生成：

```c
int n;
scanf("%d", &n);
for      ⏎ Tab →  for (int i = 0; i < n; i++)     // i 已声明则不带 int
while    ⏎ Tab →  while (T--)                      // 自动找递减计数的变量
```

边界变量的挑选依据：之前在别的 `for` 里当过上界 > 之前出现在 `while (x--)` 里 > 被 `scanf` 读过 > 名字像 `n`/`m`/`T`/`len` > 类型是 `int`。**当过循环变量 `i++` 的会被排除**。

开头写 `int m` 能直接补出主函数骨架：

```c
int m    ⏎ Tab →  int main() {
                      ▊
                  }
```

光标落在花括号内、已缩进 4 空格。文件里已经有 `main` 时不会重复生成。

推断不出来时一律回退到普通模板，不会什么都不给。

### 灰字 + Tab

```c
scanf("%d", x);        // 原始代码
scanf("%d", &x);       // 灰色 & 出现在 x 前，按 Tab 后变成这样
```

同一行多处问题会合并成一次修改。按 `Esc` 忽略，同一位置不再提示——除非那一行内容变了，或者相关变量类型变了。

### 灯泡

```
💡 初始化为 0                    int sum;  →  int sum = 0;
💡 初始化为 NULL                 指针类型
💡 补上缺失的 '}'                未闭合的花括号
💡 插入 #include <stdio.h>        用了 scanf 却没 include
💡 补成 'T--'                    while (T-) 少写一个减号
💡 删除多余的数值                 误粘贴进来的测试数据
💡 补上缺失的格式符 '%c'           printf("%d", c, ch) 少写一个 %c
💡 删除多余的实参                 或者多传了一个
```

### 诊断

```
未声明的标识符 'i'
格式符 '%d' 与 'r' 不匹配，应改为 '%lld'
代码中有非 ASCII 字符 '，'，应改为 ','
```

默认中文，`cfix.locale` 可切英文。

### 规则覆盖

53 条规则，默认开启 31 条（`core` 预设）。分六类：

- **格式化输入输出**：`scanf` 缺 `&`、格式符与实参类型不符、参数个数不对、`%s` 无宽度、`sprintf` 越界
- **字符串**：`char*` 用 `>` 比较（比的是地址）、`s[0] == "P"`（字符比指针）、缺 `#include`
- **类型与函数**：未知类型名拼错、隐式声明、参数数组退化、有符号/无符号比较
- **通用语法**：条件里误用 `=`、缺分号、表达式残缺、括号不配对、漏写 `#`、误粘贴残留
- **安全与栈**：局部变量超限、变长数组栈溢出风险、除零
- **中文输入法**：全角标点与全角字母数字（NFKC 归一化）

**只覆盖 `stdio.h` 与 `string.h`**。文件 include 了其它头文件时，对不认识的函数一律沉默——不认识不等于错误。推断不出来就不报（fail-closed）。

---

## ⚠️ 常见问题：和 AI 补全扩展的 Tab 冲突

**这是使用本插件最常见的坑，请先看这一节。**

### 现象

灰色修正出现了，但按 `Tab` 之后：

- 代码被替换成一段 AI 生成的代码，修正没生效
- 或者什么都没发生
- 或者变成缩进

### 原因

`Tab` 在 VS Code 里是「接受建议」的公共键，多个扩展都想抢：

| 扩展 | 默认用 Tab 做什么 |
|---|---|
| GitHub Copilot | 接受 AI 补全 |
| 通义灵码 / 豆包 / Codeium / TabNine / Continue | 同上 |
| Vim / Neovim 插件 | 接管 Tab，当普通按键处理 |
| **本插件** | 接受灰色修正（仅当 `cfix.suggestionVisible` 为真时） |

两边都「可见」时，谁拿到 Tab 取决于键位绑定的匹配顺序，结果不稳定。

### 解决办法（任选其一）

**方案 A —— 给本插件换个键（推荐，改动最小）**

`Ctrl+Shift+P` → `Preferences: Open Keyboard Shortcuts (JSON)`，在 `keybindings.json` 里加：

```json
{
  "key": "ctrl+enter",
  "command": "cfix.acceptCorrection",
  "when": "editorFocus && cfix.suggestionVisible"
}
```

Tab 留给 AI，灰字出现时用 `Ctrl+Enter` 接受。

**方案 B —— 让 AI 换键，Tab 留给本插件**

```json
{
  "key": "alt+]",
  "command": "editor.action.inlineSuggest.commit",
  "when": "inlineSuggestionVisible"
}
```

**方案 C —— 在 .c 文件里关掉 AI 补全**

```json
{
  "github.copilot.enable": {
    "*": true,
    "c": false
  }
}
```

**方案 D —— 用命令面板（永远不受键位影响）**

`Ctrl+Shift+P` → `cfix: 接受修正`

**方案 E —— 使用 Vim 插件时**

Vim 插件会在插入模式下接管 Tab。建议把接受键改成 `Ctrl+Enter`（方案 A），或者只在非插入模式下用命令面板。

### 怎么确认是冲突

灰字出现时按 `Tab`，如果**代码变成了别的内容**（不是灰字显示的那个），就是被别的扩展抢了键。把那个扩展临时禁用，再按一次就知道是谁。

> 本插件不会关闭你的 AI 补全，两者可以共存，只是 `Tab` 的归属需要你选一个。

---

## 其它常见问题

### 光标停在有问题的行上，但没有灰色小字

**① 这个问题本身没有「能自动修」的方案**

下面几类只提示不修，因为它们取决于你的意图：未声明变量（附近没有相近的变量名）、除零、变量遮蔽、`gets()` 缺参数。这类会显示为**行内灰色注解**（带 ⚠），不能按 Tab。

**② 光标不在那一行** —— 灰字只看光标所在行。

**③ 文件有语法错误，且问题就在出错的那几行** —— 出错行上的语义提示会被抑制以避免连锁误报，但其它干净行照常提示。

**④ 扩展没生效** —— 看右下角状态栏有没有 `cfix`；没有的话检查文件语言模式是不是 `C`（右下角显示 `Plain Text` 就点它改成 C）。刚装完记得 `Reload Window`。

排查工具：命令面板 → `cfix: 检查整个文件`，它会**无视一切过滤**列出全部问题。

### 按 Tab 没反应

见上面的「和 AI 补全扩展的 Tab 冲突」。另外 `Tab` 只在本插件有建议时才被接管，平时还是缩进。

### 和 C/C++ 扩展（ms-vscode.cpptools）冲突吗

**不冲突，但会看到两套标记。**

| | C/C++ 扩展 | 本插件 |
|---|---|---|
| 依据 | 真实编译器 / IntelliSense | 内置语法分析 |
| 标记 | 红色波浪线 | 蓝/黄色波浪线 + 灰色小字 |
| 能否修 | 只报 | 能 Tab 一键修 |

嫌红波浪线吵可以关掉：

```json
{ "C_Cpp.errorSquiggles": "disabled" }
```

### C/C++ 扩展报错了，本插件却不给修复

- 问题类型不在覆盖范围（数组越界、空指针解引用只有运行时能发现）
- 只覆盖 `stdio.h` / `string.h`，用 `<math.h>`、`<ctype.h>`、`<stdlib.h>` 时不检查也不误报
- 推断不出来就不报（类型未知、长度未知）
- 文件语法错误且问题就在出错行上

### 中文标点、全角字母能自动改吗

能。`，`、`；`、`（）`、`ｉｎｔ`、`１２３`、`＃include`、弯引号都能转成半角。

无法映射的字符（句号 `。`、顿号 `、`）只提示——因为不知道该换成什么。

**修完全角字符后，一些「未闭合花括号」的假警告会自动消失**，那些错误本来就是全角字符带出来的。

### 粘进一大段测试数据后满屏波浪线

那是误粘贴残留。用灯泡 `💡 删除多余的数值` 一次清掉。

### 它会不会联网 / 上传我的代码

**不会。** 运行时不发起任何网络请求，不调用编译器，不读系统头文件，没有遥测。C 语法解析用的是打包在扩展里的 WASM 文法（约 980 KB），装完断网照常工作。

### 哪些错误它永远不报

- **输出格式错误（PE）**：该用空格还是换行取决于题面，静态分析无从判断
- **运行时问题**：数组越界、空指针解引用、整数溢出
- **其它头文件的函数**
- **宏展开后的错误**

---

## 设置项

| 设置 | 默认值 | 说明 |
|---|---|---|
| `cfix.enable` | `true` | 插件总开关 |
| `cfix.preset` | `core` | 规则预设：`core`(31) / `standard`(50) / `all`(53) |
| `cfix.locale` | `zh` | 诊断语言 `zh` / `en` |
| `cfix.completion.enable` | `true` | 函数模板补全 |
| `cfix.correction.enable` | `true` | 灰色小字纠错与诊断 |
| `cfix.correction.debounceMs` | `300` | 停笔多久后检查当前行（毫秒） |
| `cfix.stackLimitKB` | `1024` | 普通函数栈帧阈值；递归函数固定 64 KB |
| `cfix.rules` | `{}` | 逐条覆盖，如 `{"shadowing": "off"}` |

## 命令

| 命令 | 说明 |
|---|---|
| `cfix: 接受修正` | 等同 Tab |
| `cfix: 忽略修正` | 等同 Esc |
| `cfix: 检查整个文件` | 无视过滤列出全部问题（排查用） |
| `cfix: 补上缺失的 }` | 未闭合花括号一键修复 |
| `cfix: 导出分析结果` | 把当前文件的分析写成 JSON |

## 最近更新（0.4.x）

| 版本 | 内容 |
|---|---|
| 0.6.2 | `fo`、`wh` 等打字中间阶段也能出补全（之前要打完整个关键字） |
| 0.6.1 | 无限递归检测：`int f(int n){ return f(n-1); }` 会提示"没有终止条件，会栈溢出" |
| 0.6.0 | 语法错误只抑制**出错那一行**，不再让整份文件的提示消失 |
| 0.5.9 | 循环里 `scanf("%c")` 提醒加空格；循环里输出提醒换行 |
| 0.5.8 | `while (gets(s) != '\0');` 的空循环体提示 |
| 0.5.7 | 关键字补全：`cont`→`continue;`、`bre`→`break;`、`ret`→`return 0;` |
| 0.5.5 | 还没写 `main` 时（文件作用域）也能补全参数 |
| 0.5.4 | `scanf("%d", &arr)` 提示补下标：循环里 `&arr[i]`，否则 `&arr[0]` |
| 0.5.3 | `scanf` 不再补循环变量 `i`；循环里自动补 `数组[i]` |
| 0.5.2 | 已知函数的指针参数类型不匹配（如 `int[]` 传给 `gets`） |
| 0.5.1 | `printf` 只补最近写入的那一个变量（算完 `dum` 就补 `dum`） |
| 0.5.0 | `printf` 优先补"上次输出之后改过的变量"，而不是全部变量 |
| 0.4.9 | `for(...)` 还没写循环体时不再误报"空语句体" |
| 0.4.8 | 补全与纠错同时可见时，`Tab` 优先给补全（不再被"补分号"抢走） |
| 0.4.7 | 接受修正后光标自动落到修改末尾（补完 `;` 光标跟着走） |
| 0.4.6 | `int main();` 只有声明没有函数体时提示，灯泡可一键改成定义 |
| 0.4.5 | 全局变量时 `scan` 也能带出智能参数；`sca` 不再误报"未声明" |
| 0.4.4 | 不再对 `gets` 报警（课程和 OJ 仍在用） |
| 0.4.2 | 输入 `int m` 自动补出 `int main()` 骨架 |
| 0.4.0 | 智能补全：按已声明变量自动填 `scanf` / `printf` 参数，循环头推断边界变量 |

---

## 开发

```bash
git clone https://github.com/zr2863356099-sudo/zr-c-fix.git
cd zr-c-fix
pnpm install
pnpm build        # 产出 dist/extension.js + 两个 wasm
pnpm package      # 产出 zr-c-fix-<version>.vsix
pnpm test         # vitest，410+ 用例
```

完整开发文档与回归语料见仓库 `docs/`。

## License

MIT
