import * as vscode from 'vscode';
import { mkdirSync, writeFileSync } from 'node:fs';

const LOG_PATH = 'D:\\cfix\\logs\\integration.log';

const lines: string[] = [];
let fails = 0;

function flush(status: string): void {
  try {
    mkdirSync('D:\\cfix\\logs', { recursive: true });
    writeFileSync(LOG_PATH, lines.join('\n') + '\n\n' + status, 'utf8');
  } catch {
    /* ignore */
  }
}

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    lines.push(`OK   ${name}`);
  } else {
    fails++;
    lines.push(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
  flush('RUNNING');
}

function info(name: string, value: string): void {
  lines.push(`INFO ${name} -> ${value}`);
  flush('RUNNING');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function openC(content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language: 'c', content });
  return vscode.window.showTextDocument(doc, { preview: false });
}

async function commitInline(): Promise<string> {
  try {
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    return 'ok';
  } catch (error) {
    return `threw: ${String(error)}`;
  }
}

export async function run(): Promise<void> {
  flush('STARTED');
  try {
    // ---------- 0. 激活 ----------
    // 开发模式下扩展 id 的 publisher 可能与市场版不同，按 packageJSON.name 查找。
    const ext = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON?.name === 'zr-c-fix',
    );
    info('扩展 id', ext?.id ?? '(未找到)');
    ok('扩展已加载', ext !== undefined);
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    ok('扩展已激活', ext?.isActive === true);

    // ---------- A. 补全 ----------
    const editor = await openC('int main(){\n  pr\n}\n');
    const pos = new vscode.Position(1, 4);
    editor.selection = new vscode.Selection(pos, pos);
    await sleep(300);
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    await sleep(400);
    const commit1 = await commitInline();
    await sleep(200);
    const afterComplete = editor.document.getText();
    info('补全后文本', JSON.stringify(afterComplete));
    info('commit 结果', commit1);
    ok('输入 pr 后 Tab 得到 printf', afterComplete.includes('printf('), afterComplete);

    // ---------- B. 纠错：装饰器 + acceptCorrection ----------
    const src = [
      '#include <stdio.h>',
      'int main(){',
      '    int x;',
      '    scanf("%d", x);',
      '    return 0;',
      '}',
      '',
    ].join('\n');
    const ed2 = await openC(src);
    const target = new vscode.Position(3, 4);
    ed2.selection = new vscode.Selection(target, target);
    // 触发一次文档变更，让 300ms 防抖启动
    await ed2.edit((b) => b.insert(new vscode.Position(6, 0), ' '));
    await sleep(800);
    const before = ed2.document.getText();
    await vscode.commands.executeCommand('cfix.acceptCorrection');
    await sleep(300);
    const afterFix = ed2.document.getText();
    info('纠错前', JSON.stringify(before.split('\n')[3]));
    info('纠错后', JSON.stringify(afterFix.split('\n')[3]));
    ok('scanf 缺 & 被补上', afterFix.split('\n')[3] === '    scanf("%d", &x);', afterFix.split('\n')[3]);

    // ---------- D. 不误报 ----------
    const clean = await vscode.workspace.openTextDocument(
      vscode.Uri.file('D:\\cfix\\test\\corpus\\01-hello.c'),
    );
    await vscode.window.showTextDocument(clean, { preview: false });
    await sleep(600);
    const cleanDiags = vscode.languages.getDiagnostics(clean.uri);
    info('01-hello 诊断数', String(cleanDiags.length));
    ok('干净文件零诊断', cleanDiags.length === 0, cleanDiags.map((d) => d.message).join(' | '));

    // ---------- 04-sieve 应当有 unbalanced-braces 诊断 ----------
    const broken = await vscode.workspace.openTextDocument(
      vscode.Uri.file('D:\\cfix\\test\\corpus\\04-sieve.c'),
    );
    await vscode.window.showTextDocument(broken, { preview: false });
    await sleep(800);
    const brokenDiags = vscode.languages.getDiagnostics(broken.uri);
    info('04-sieve 诊断', brokenDiags.map((d) => `L${d.range.start.line + 1}:${d.message}`).join(' | ') || '(none)');
    ok(
      '04-sieve 报出未闭合花括号',
      brokenDiags.some((d) => /unclosed|brace|'\{'/i.test(d.message)),
      String(brokenDiags.length),
    );

    // ---------- C. 抑制：dismissCorrection ----------
    const srcC = [
      '#include <stdio.h>',
      'int main(){',
      '  int y;',
      '  scanf("%d", y);',
      '  return 0;',
      '}',
      '',
    ].join('\n');
    const ed3 = await openC(srcC);
    const p3 = new vscode.Position(3, 2);
    ed3.selection = new vscode.Selection(p3, p3);
    await ed3.edit((b) => b.insert(new vscode.Position(6, 0), ' '));
    await sleep(800);

    await vscode.commands.executeCommand('cfix.dismissCorrection');
    await sleep(200);

    // 再触发一次防抖；抑制表应拦住同一条修正，accept 因此无事可做
    await ed3.edit((b) => b.insert(new vscode.Position(6, 1), ' '));
    await sleep(800);

    const beforeC = ed3.document.getText();
    await vscode.commands.executeCommand('cfix.acceptCorrection');
    await sleep(300);

    const afterC = ed3.document.getText();
    info('抑制前', JSON.stringify(beforeC.split('\n')[3]));
    info('抑制后文本', JSON.stringify(afterC.split('\n')[3]));
    ok('同位置 dismiss 后不再提示', beforeC === afterC, afterC.split('\n')[3]);
  } catch (error) {
    fails++;
    lines.push(`THREW ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }

  console.log(lines.join('\n'));
  console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
  flush(fails === 0 ? 'DONE ALL_OK' : `DONE FAILED ${fails}`);
  if (fails > 0) {
    throw new Error(`integration failures: ${fails}`);
  }
}
