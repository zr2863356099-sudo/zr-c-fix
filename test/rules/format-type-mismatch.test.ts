import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('format-type-mismatch', () => {
  it('never reports printf("%f") for a float argument after promotion', async () => {
    await expect(
      runRule('int main(){ float f = 1.0f; printf("%f", f); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('never reports printf("%d") for a char argument after promotion', async () => {
    await expect(
      runRule('int main(){ char c = 65; printf("%d", c); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts scanf("%d", &x) for int', async () => {
    await expect(
      runRule('int main(){ int x; scanf("%d", &x); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('upgrades scanf %f to %lf for a double target', async () => {
    const issues = await runRule(
      'int main(){ double d; scanf("%f", &d); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%lf');
  });

  it('changes printf %d to %lld for long long', async () => {
    const issues = await runRule(
      'int main(){ long long r = 1; printf("%d", r); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%lld');
  });

  it('accepts printf %d for int', async () => {
    await expect(
      runRule('int main(){ int x = 1; printf("%d", x); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('drops the & from printf %d with an address argument', async () => {
    const source = 'int main(){ int x = 1; printf("%d", &x); return 0; }\n';
    const issues = await runRule(source, 'format-type-mismatch');

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("Format '%d' does not match '&x'; drop the '&'");
    expect(issues[0]?.fix?.newText).toBe('');
    expect(issues[0]?.fix?.range).toEqual({
      startLine: 0,
      startChar: source.indexOf('&'),
      endLine: 0,
      endChar: source.indexOf('&') + 1,
    });
  });

  it('changes printf %d to %p for a pointer argument', async () => {
    const issues = await runRule(
      'int main(){ int x = 1; int *p = &x; printf("%d", p); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%p');
  });

  it('accepts printf %s for a char array', async () => {
    await expect(
      runRule('int main(){ char b[10] = "hi"; printf("%s", b); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts printf %s for a char pointer', async () => {
    await expect(
      runRule('int main(){ char *p = "hi"; printf("%s", p); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('changes printf %s to %c for a scalar char', async () => {
    const issues = await runRule(
      'int main(){ char c = 65; printf("%s", c); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%c');
  });

  it('changes printf %s to %d for an int', async () => {
    const issues = await runRule(
      'int main(){ int x = 1; printf("%s", x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe("Format '%s' does not match 'x' (int); use '%d'");
    expect(issues[0]?.fix?.newText).toBe('%d');
  });

  it('changes printf %s to %d for long long', async () => {
    const issues = await runRule(
      'int main(){ long long x = 1; printf("%s", x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%d');
  });

  it('changes printf %s to %f for a double', async () => {
    const issues = await runRule(
      'int main(){ double d = 1.0; printf("%s", d); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%f');
  });

  it('changes printf %c to %s for a char array', async () => {
    const issues = await runRule(
      'int main(){ char b[10] = "hi"; printf("%c", b); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%s');
  });

  it('changes printf %c to %s for a char pointer', async () => {
    const issues = await runRule(
      'int main(){ char *p = "hi"; printf("%c", p); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%s');
  });

  it('accepts printf %c for a scalar char', async () => {
    await expect(
      runRule('int main(){ char c = 65; printf("%c", c); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts printf %c for an int', async () => {
    await expect(
      runRule('int main(){ int c = 65; printf("%c", c); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts printf %p for a pointer', async () => {
    await expect(
      runRule('int main(){ int x = 1; int *p = &x; printf("%p", p); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts printf %p for a cast address', async () => {
    await expect(
      runRule('int main(){ int x = 1; printf("%p", (void*)&x); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('changes printf %p to %d for an int', async () => {
    const issues = await runRule(
      'int main(){ int x = 1; printf("%p", x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%d');
  });

  it('stays silent when the argument type is unknown', async () => {
    await expect(
      runRule('int main(){ printf("%s", mystery); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('reports scanf %s into a scalar char', async () => {
    const issues = await runRule(
      'int main(){ char c; scanf("%s", &c); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%c');
  });

  it('accepts scanf %s into a char array', async () => {
    await expect(
      runRule('int main(){ char b[10]; scanf("%s", b); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts scanf %s into a char pointer', async () => {
    await expect(
      runRule('int main(){ char *p = 0; scanf("%s", p); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('accepts scanf %c into a scalar char', async () => {
    await expect(
      runRule('int main(){ char c; scanf("%c", &c); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('keeps %x when only the scanf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x; scanf("%x", &x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%llx');
  });

  it('keeps %u when only the scanf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x; scanf("%u", &x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%llu');
  });

  it('keeps %d when only the scanf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ long long x; scanf("%d", &x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%lld');
  });

  it('keeps %o when only the scanf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x; scanf("%o", &x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%llo');
  });

  it('accepts scanf %x for unsigned int', async () => {
    await expect(
      runRule('int main(){ unsigned int x; scanf("%x", &x); return 0; }\n', 'format-type-mismatch'),
    ).resolves.toEqual([]);
  });

  it('keeps %x when only the printf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x = 1; printf("%x", x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%llx');
  });

  it('keeps %X case when only the printf length is wrong', async () => {
    const issues = await runRule(
      'int main(){ unsigned long long x = 1; printf("%X", x); return 0; }\n',
      'format-type-mismatch',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.fix?.newText).toBe('%llX');
  });
});
