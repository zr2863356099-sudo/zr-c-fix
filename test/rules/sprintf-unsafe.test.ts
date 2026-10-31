import { describe, expect, it } from 'vitest';
import { runRule } from './helpers';

describe('sprintf-unsafe', () => {
  it('suggests snprintf for a fixed-size destination array', async () => {
    const issues = await runRule(
      'int main(){ char buf[32]; sprintf(buf, "%d", 1); return 0; }\n',
      'sprintf-unsafe',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'sprintf-unsafe',
      channel: 'ghost',
      fix: { newText: 'snprintf(buf, sizeof buf' },
    });
  });

  it('accepts snprintf', async () => {
    await expect(
      runRule(
        'int main(){ char buf[32]; snprintf(buf, sizeof buf, "%d", 1); return 0; }\n',
        'sprintf-unsafe',
      ),
    ).resolves.toEqual([]);
  });

  it('ignores non-array destinations', async () => {
    await expect(
      runRule(
        'int main(){ char *p = 0; sprintf(p, "%d", 1); return 0; }\n',
        'sprintf-unsafe',
      ),
    ).resolves.toEqual([]);
  });
});
