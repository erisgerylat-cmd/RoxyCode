import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCodeDiagnostics } from '../src/lsp/index.js';

test('runCodeDiagnostics falls back to the TypeScript compiler and reports type errors', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-code-diagnostics-'));
  try {
    await mkdir(join(cwd, 'src'), { recursive: true });
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
      },
      include: ['src/**/*.ts'],
    }, null, 2), 'utf8');
    await writeFile(join(cwd, 'src', 'index.ts'), 'const value: string = 1;\n', 'utf8');

    const report = await runCodeDiagnostics({ cwd, preferLsp: false });

    assert.equal(report.engine, 'typescript-compiler');
    assert.equal(report.status, 'failed');
    assert.equal(report.counts.error > 0, true);
    assert.ok(report.diagnostics.some(diagnostic => diagnostic.relativePath === 'src/index.ts'));
    assert.ok(report.diagnostics.some(diagnostic => /number|assignable|Type/.test(diagnostic.message)));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
