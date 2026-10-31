import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const LOG = 'D:\\cfix\\logs\\shot.log';
const SCRIPT = 'D:\\cfix\\scripts\\shot.ps1';
const lines: string[] = [];

function note(value: string): void {
  lines.push(value);
  try {
    mkdirSync('D:\\cfix\\logs', { recursive: true });
    writeFileSync(LOG, lines.join('\n'), 'utf8');
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function shoot(name: string): Promise<void> {
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, name],
      { stdio: 'pipe' },
    );
    note(`SHOT ${name} -> ok`);
  } catch (error) {
    note(`SHOT ${name} -> failed: ${String(error)}`);
  }
}

export async function run(): Promise<void> {
  try {
    note('START');
    const ext = vscode.extensions.getExtension('cfix.zr-c-fix');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    note(`ext active=${String(ext?.isActive)}`);

    const src = [
      '#include <stdio.h>',
      'int main(){',
      '    int x;',
      '    scanf("%d", x);',
      '    return 0;',
      '}',
      '',
    ].join('\n');

    const doc = await vscode.workspace.openTextDocument({
      language: 'c',
      content: src,
    });
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const target = new vscode.Position(3, 4);
    editor.selection = new vscode.Selection(target, target);

    await vscode.workspace
      .getConfiguration('cfix')
      .update('correction.mode', 'whole-line', vscode.ConfigurationTarget.Global);
    await editor.edit((b) => b.insert(new vscode.Position(6, 0), ' '));
    note('whole-line: edit done, waiting 900ms');
    await sleep(900);
    await shoot('m7-whole-line');

    await vscode.workspace
      .getConfiguration('cfix')
      .update('correction.mode', 'fragment', vscode.ConfigurationTarget.Global);
    note('mode -> fragment');
    await editor.edit((b) => b.insert(new vscode.Position(6, 1), ' '));
    await sleep(900);
    await shoot('m7-fragment');

    try {
      const context = await vscode.commands.executeCommand(
        'getContext',
        'cfix.suggestionVisible',
      );
      note(`suggestionVisible=${String(context)}`);
    } catch (error) {
      note(`getContext unavailable: ${String(error)}`);
    }
    note('DONE');
  } catch (error) {
    note(`THREW ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    note('DONE');
  }
}
