import { describe, expect, it } from 'vitest';
import { buildIncludeInsert } from '../src/core/fixes/includeInsert';

describe('buildIncludeInsert', () => {
  it('inserts at the top of the file when there is no include', () => {
    const text = 'int main(void) {\n  scanf("%d", &n);\n  return 0;\n}\n';
    expect(buildIncludeInsert(text, 'stdio.h')).toEqual({
      line: 0,
      character: 0,
      text: '#include <stdio.h>\n',
    });
  });

  it('inserts after the last of several includes', () => {
    const text =
      '#include <math.h>\n#include <string.h>\n\nint main(void) {}\n';
    expect(buildIncludeInsert(text, 'stdio.h')).toEqual({
      line: 2,
      character: 0,
      text: '#include <stdio.h>\n',
    });
  });

  it('withholds the edit when the same include already exists', () => {
    expect(
      buildIncludeInsert('#include <stdio.h>\nint main(void) {}\n', 'stdio.h'),
    ).toBeUndefined();
    expect(
      buildIncludeInsert(
        '#include <stdio.h>\n#include <math.h>\n',
        'stdio.h',
      ),
    ).toBeUndefined();
  });

  it('appends after a final include line with no trailing newline', () => {
    expect(buildIncludeInsert('#include <math.h>', 'stdio.h')).toEqual({
      line: 0,
      character: 17,
      text: '\n#include <stdio.h>',
    });
  });

  it('rejects a header name that cannot be written verbatim', () => {
    expect(buildIncludeInsert('', 'std io.h')).toBeUndefined();
  });
});
