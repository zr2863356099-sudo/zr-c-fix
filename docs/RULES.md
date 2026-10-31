# cfix 规则清单 v3

面向离线 VS Code 插件的 C 语言检查规则库。主交互是 inline completion（灰色小字），诊断仅作辅助。

- **通道** `G` = 灰色小字可修（单行原地替换）；`H` = 只提示（波浪线 + 灯泡）
- **证据** `✓` = 在 `D:\D` 的 71 份作业或 accoding 1305–1335 的 189 次提交里真实出现过
- **共 48 条**：G 通道 23 条，H 通道 25 条

## 预设

| 预设 | 条数 | 说明 |
|---|---|---|
| `core`（默认） | 25 | 有真实证据 + 低误报，默认开启 |
| `standard` | 45 | core + 类型敏感、需推断的规则 |
| `all` | 48 | 全量，含 3 条默认关闭 |

配置：`cfix.preset`，细粒度用 `cfix.rules.<id>` 覆盖。

---

## A. stdio.h（9 条）

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `scanf-missing-amp` | `scanf("%d", x)`，实参是非指针非数组变量 | 加 `&` | G | | core |
| `format-type-mismatch` | 格式符与实参类型不符（`%d`↔long long、`%d`↔char、`%f`↔`double*`、`%lf`↔`float*`、`%zu`↔int） | 只改格式符，不动变量类型 | G | ✓ | core |
| `format-arg-count` | 格式符数量 ≠ 实参数量 | 补参数或删格式符 | G | ✓ | core |
| `scanf-string-width` | `%s` 无宽度、目标缓冲区已知且 2~256 字节 | `%s` → `%{size-1}s` | G | ✓ | core |
| `sprintf-unsafe` | `sprintf` 写入定长数组 | `snprintf(b, sizeof b, ...)` | G | ✓ | core |
| `scanf-trailing-newline` | 格式串尾部有 `\n` | 删掉 `\n` | G | | standard |
| `scanf-c-newline` | `%c` 前无空格，且前面已有过 `scanf` | `" %c"` | G | | standard |
| `missing-include` | 用了库函数但没 include 对应头 | 灯泡插入 include | H | ✓ | core |
| `unchecked-scanf-return` | 忽略 `scanf` 返回值 | — | H | | 默认关 |

## B. string.h（8 条）

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `string-eq-literal` | `s == "abc"` 用 `==` 比字符串 | `strcmp(s, "abc") == 0` | G | | standard |
| `strcmp-truthiness` | `if (strcmp(a, b))` 拿返回值当布尔 | — 语义有歧义 | H | | standard |
| `strncpy-no-nul` | `strncpy(d, s, sizeof d)` 后没补 `'\0'` | 灯泡追加 `d[sizeof d - 1] = '\0';` | H | | standard |
| `strcpy-overflow` | `strcpy` 目标定长、源为字面量且超长 | `snprintf` 或扩数组 | H | | standard |
| `strcat-overflow` | `strcat` 目标定长、追加后确定超长 | 只提示 | H | | standard |
| `string-literal-write` | `char *s = "…"` 之后写 `s[i]` | — | H | | standard |
| `sizeof-as-length` | 用 `sizeof` 当字符串长度 | — | H | | standard |
| `strlen-int-truncation` | `int n = strlen(s)` | — | H | | 默认关 |

## C. 通用语法与控制流（19 条）

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `assignment-in-condition` | `if (x = 5)`、`if (flag = 0)` | `=` → `==` | G | ✓ | core |
| `missing-semicolon` | 行尾解析出 ERROR 且可能是缺分号 | 补 `;` | G | ✓ | core |
| `nonvoid-missing-return` | 非 void 函数存在不返回值的路径 | — | H | ✓ | core |
| `shadowing` | 内层同名声明的变量遮蔽外层 | 灯泡重命名 | H | ✓ | core |
| `uninitialized-use` | 声明无初始化，且在缺 `else` 的分支路径上被使用 | — | H | ✓ | core |
| `div-by-zero` | `/`、`%` 除数是变量且前文无 `!= 0` 检查；或字面量 0 | — | H | ✓ | core |
| `int-literal-overflow` | 整数字面量超出 `int` 范围 | — | H | ✓ | core |
| `integer-division` | 整型除法结果赋给浮点 | `(double)sum / n` | G | | standard |
| `chained-comparison` | `0 <= x <= 100` 恒真 | — | H | | standard |
| `array-oob-literal` | 下标为字面量且 ≥ 数组长度 | — | H | | standard |
| `loop-off-by-one` | `for (i = 0; i <= n; i++)` 遍历 n 元素数组 | — | H | | 默认关 |
| `oob-read-past-nul` | `s[i]==… && s[i+1]==…`，`s[i]` 为 `'\0'` 时继续读 | — | H | ✓ | core |
| `for-cond-var-never-updated` | `for` 的条件变量在循环内从未被修改 → 死循环 | 修正增量/条件里的标识符 | G | | core |
| `nested-loop-counter-clobber` | 内层循环修改外层循环计数器 | `i++` → `j++` | G | | core |
| `empty-statement-body` | `while (i < n);`、`if (x);` 多打分号 | 删分号 | G | | core |
| `bitwise-precedence` | `if (a & b == c)` 实际是 `a & (b == c)` | 加括号 | G | | standard |
| `switch-fallthrough` | `case` 结尾没 `break`/`return` 且后面还有 `case` | 补 `break` | G | | standard |
| `void-main` | `void main()` | `void` → `int` | G | | standard |
| `unreachable-else-if` | `if (x >= 60) … else if (x >= 80) …` 后段不可达 | — | H | | standard |

## D. 栈与安全（4 条）

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `stack-large-local` | 函数内局部变量累计 > 1 MB（递归函数阈值 64 KB） | 加 `static` | G | ✓ | core |
| `stack-vla` | 变长数组 `int a[n];` | — | H | ✓ | core |
| `stack-recursion-large-frame` | 递归函数内含大局部数组 | — | H | | standard |
| `stack-no-base-case` | 自递归且看不出终止条件 | — | H | | standard |

## E. 类型与函数（2 条）

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `sizeof-param-array` | `void f(int a[]) { sizeof(a) }` 参数已退化为指针 | — | H | | standard |
| `sign-compare` | `int i < strlen(s)` 有符号与 `size_t` 比较 | — | H | | standard |

## F. 语法与拼写（6 条）

来自 accoding 1305–1335 中 25 个 CE 的根因分析，补齐语法级错误。

| Rule id | 检查什么 | 怎么修 | 通道 | 证据 | 预设 |
|---|---|---|---|---|---|
| `unbalanced-braces` | 未匹配的 `{`（函数/文件未闭合） | 灯泡一键补齐；不进灰色小字 | H | ✓ | core |
| `missing-include-hash` | 行首是 `include` 而非 `#include` | 补 `#` | G | ✓ | core |
| `stray-literal` | `ERROR` 节点处是孤立数字串（误粘贴残留） | 删除 | G | ✓ | core |
| `char-string-literal` | `char` 变量用双引号赋值：`b[i]="\0"` | `"` → `'` | G | ✓ | core |
| `implicit-declaration` | 调用了文件中未定义、签名表里也没有的函数（`puchar`） | 编辑距离 ≤ 2 时 ghost 改成正确函数名；否则沉默 | G/H | ✓ | core |
| `undeclared-variable` | 使用了未声明的**变量**，且与文件内已有符号编辑距离 ≤ 2（`cnt` ↔ `count`） | ghost 改成最近的符号名；无相近候选时仅当文件只包含已知头文件才给提示 | G | | core |

> **`gets` 不视为错误。** OJ 环境（Linux gcc）下 `gets` 仍可编译运行，规则库不再提示替换。

---

## 全局约定

1. **只改格式符，绝不改学生声明的变量类型。**
2. **类型或长度推断不出来就不报。** `format-*`、`stack-*`、`array-*`、`sizeof-*`、`sign-*` 全部 fail-closed。
3. **文件处于未完成状态（含 `ERROR` 节点）时禁止自动应用修复。**
4. **同一位置只保留一条主诊断**（按 severity + 置信度排序），其余折叠为“另外 N 个问题”。

## 新增规则的实现备注

| Rule | 关键判据 | 误报护栏 |
|---|---|---|
| `empty-statement-body` | 语句体是空语句节点 | `while` 条件含赋值或函数调用时跳过（`while((c=getchar())!='\n');` 合法） |
| `bitwise-precedence` | `&`/`\|`/`^` 的操作数是比较表达式 | 操作数已带括号时跳过 |
| `switch-fallthrough` | case 体尾部无 `break`/`return` 且后继还有 case | 有 `/* fallthrough */` 注释时跳过 |
| `void-main` | 返回类型 `void` 且函数名 `main` | 只改返回类型，不补 `return 0`（C99 隐式返回 0） |
| `sizeof-param-array` | `sizeof` 作用在数组类型参数上 | 参数写成 `int a[10]` 与 `int a[]` 均按指针处理 |
| `sign-compare` | 有符号整型与 `size_t`/`unsigned` 比较 | 任一侧有显式 cast 时跳过 |
| `unreachable-else-if` | 同一 `if` 链、同一变量、字面量区间蕴含 | 条件含函数调用或运算表达式时跳过 |
| `unbalanced-braces` | 未匹配 `{` 的位置，以该 `{` 所在行为锚点 | 仅在未闭合块之后**已无后续代码**时才报；打字中间态不报 |
| `missing-include-hash` | 行首标识符为 `include` 且行内有 `<…>` | 只在文件顶层判定 |
| `stray-literal` | `ERROR` 节点文本匹配 `/^\d+(\s+\d+)*$/` | 上下 2 行内需有 `}` 或 `;` 才判为粘贴残留 |
| `char-string-literal` | 赋值左值是 `char`，右值是字符串字面量 | 只在字面量长度为 1 或 `"\0"` 时提示 |
| `implicit-declaration` | 调用名不在文件内任何定义/原型中，也不在内置签名表 | 候选只在签名表内取；有宏定义、函数指针同名时全部跳过；编辑距离 > 2 不报 |
| `undeclared-variable` | 标识符出现在表达式位置、不在符号表、不是函数名/成员/标签/类型名 | 候选只取本文件符号；编辑距离 > 2 不报；全大写标识符跳过（可能是宏）；文件含 ERROR 节点时跳过 |

## 变更记录

- v1（34 条）：stdlib/stdout/string/通用/栈五组初稿
- v2（43 条）：+2 循环结构规则（`for-cond-var-never-updated`、`nested-loop-counter-clobber`）；+7 条本版新增；+3 条默认关闭
- v3（47 条）：接入 accoding 1305–1335 的 189 次提交，25 个 CE 全部溯源；+5 条语法级规则（新增 F 组）；移除 `gets-unsafe`（`gets` 允许使用）
- v4（48 条）：+`implicit-declaration`（拼错函数名，按编辑距离给改名建议）；CE 覆盖 23/25
