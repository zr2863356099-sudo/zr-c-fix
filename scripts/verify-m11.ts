import path from 'node:path';
import { createCParser, type CParser } from '../src/core/parser';
import { buildSymbolTable } from '../src/core/symbols';
import { DEFAULT_RULE_CONFIG, runRules, type Issue } from '../src/core/rules';

const lines: string[] = [];
let fails = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    lines.push(`OK   ${name}`);
  } else {
    fails++;
    lines.push(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

async function main(): Promise<void> {
  const wasmDir = path.resolve('dist');
  const parser: CParser = await createCParser({
    wasmPath: path.join(wasmDir, 'tree-sitter-c.wasm'),
    runtimeWasmDir: wasmDir,
  });

  function analyze(body: string): Issue[] {
    const source = '#include <stdio.h>\n' + body + '\n';
    const tree = parser.parse(source);
    try {
      const table = buildSymbolTable(tree.rootNode, source);
      return runRules(
        { text: source, root: tree.rootNode, table, config: DEFAULT_RULE_CONFIG },
        ['format-type-mismatch'],
      );
    } finally {
      tree.delete();
    }
  }

  function hitWithFix(name: string, body: string, newText: string): Issue | undefined {
    const hits = analyze(body);
    const hit = hits[0];
    ok(
      name,
      hits.length === 1 && hit?.fix?.newText === newText,
      `hits=${hits.length} ${hits.map((h) => `${h.message} fix=${JSON.stringify(h.fix?.newText ?? null)}`).join('|')}`,
    );
    return hit;
  }

  function clean(name: string, body: string): void {
    const hits = analyze(body);
    ok(
      name,
      hits.length === 0,
      `hits=${hits.length} ${hits.map((h) => h.message).join('|')}`,
    );
  }

  // The ten cases from the milestone brief.
  const dropAmp = hitWithFix(
    '1. printf %d with &x',
    'int main(){ int x = 1; printf("%d", &x); return 0; }',
    '',
  );
  ok(
    '1a. drop-& message',
    dropAmp?.message === "Format '%d' does not match '&x'; drop the '&'",
    dropAmp?.message,
  );
  ok(
    '1b. drop-& deletes one character',
    dropAmp?.fix !== undefined &&
      dropAmp.fix.newText === '' &&
      dropAmp.fix.range.startLine === dropAmp.fix.range.endLine &&
      dropAmp.fix.range.endChar - dropAmp.fix.range.startChar === 1,
    JSON.stringify(dropAmp?.fix),
  );

  const stringInt = hitWithFix(
    '2. printf %s with int',
    'int main(){ int x = 1; printf("%s", x); return 0; }',
    '%d',
  );
  ok(
    '2a. %s/int message',
    stringInt?.message === "Format '%s' does not match 'x' (int); use '%d'",
    stringInt?.message,
  );

  hitWithFix(
    '3. printf %s with scalar char',
    'int main(){ char c = 65; printf("%s", c); return 0; }',
    '%c',
  );
  hitWithFix(
    '4. printf %c with char array',
    'int main(){ char b[10] = "hi"; printf("%c", b); return 0; }',
    '%s',
  );
  clean(
    '5. printf %d with int',
    'int main(){ int x = 1; printf("%d", x); return 0; }',
  );
  clean(
    '6. printf %s with char array',
    'int main(){ char b[10] = "hi"; printf("%s", b); return 0; }',
  );
  clean(
    '7. printf %s with char pointer',
    'int main(){ char *p = "hi"; printf("%s", p); return 0; }',
  );
  clean(
    '8. printf %p with (void*)&x',
    'int main(){ int x = 1; printf("%p", (void*)&x); return 0; }',
  );
  hitWithFix(
    '9. scanf %s with &char',
    'int main(){ char c; scanf("%s", &c); return 0; }',
    '%c',
  );
  clean(
    '10. scanf %s with char array',
    'int main(){ char b[10]; scanf("%s", b); return 0; }',
  );

  // Remaining judgement-table rows.
  hitWithFix(
    '11. printf %d with pointer',
    'int main(){ int x = 1; int *p = &x; printf("%d", p); return 0; }',
    '%p',
  );
  hitWithFix(
    '12. printf %s with double',
    'int main(){ double d = 1.0; printf("%s", d); return 0; }',
    '%f',
  );
  hitWithFix(
    '13. printf %s with long long',
    'int main(){ long long x = 1; printf("%s", x); return 0; }',
    '%d',
  );
  hitWithFix(
    '14. printf %c with char pointer',
    'int main(){ char *p = "hi"; printf("%c", p); return 0; }',
    '%s',
  );
  clean(
    '15. printf %c with scalar char',
    'int main(){ char c = 65; printf("%c", c); return 0; }',
  );
  hitWithFix(
    '16. printf %p with int',
    'int main(){ int x = 1; printf("%p", x); return 0; }',
    '%d',
  );
  clean(
    '17. printf %p with pointer',
    'int main(){ int x = 1; int *p = &x; printf("%p", p); return 0; }',
  );
  clean(
    '18. unknown argument',
    'int main(){ printf("%s", mystery); return 0; }',
  );

  for (const conversion of ['d', 'i', 'u', 'x', 'X', 'o']) {
    hitWithFix(
      `19. printf %${conversion} with &x`,
      `int main(){ int x = 1; printf("%${conversion}", &x); return 0; }`,
      '',
    );
    hitWithFix(
      `20. printf %${conversion} with pointer`,
      `int main(){ int x = 1; int *p = &x; printf("%${conversion}", p); return 0; }`,
      '%p',
    );
  }

  clean(
    '21. scanf %s with char pointer',
    'int main(){ char *p = 0; scanf("%s", p); return 0; }',
  );
  clean(
    '22. scanf %c with scalar char',
    'int main(){ char c; scanf("%c", &c); return 0; }',
  );

  parser.dispose();
  console.log(lines.join('\n'));
  console.log(fails === 0 ? '\nALL_OK' : `\nFAILED ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

void main();
