import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const DIST_ENTRY = resolve('dist/index.js');

test('built CLI handles core slash commands in non-interactive mode', { skip: !existsSync(DIST_ENTRY) ? 'Run pnpm run build before CLI smoke tests.' : false }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-cli-smoke-'));
  try {
    const output = await runCli(cwd, ['/help', '/status', '/memory stats', '/diagnostics', '/config validate', '/model', '/workflow list', '/exit']);

    assert.match(output, /RoxyCode v0\.1\.0/);
    assert.match(output, /\/status/);
    assert.match(output, /\/diagnostics/);
    assert.match(output, /会话状态|Session status/);
    assert.match(output, /RoxyCode 记忆统计|Memory statistics/);
    assert.match(output, /RoxyCode 运行诊断|RoxyCode diagnostics/);
    assert.match(output, /配置校验|configuration validation|Config validation/);
    assert.match(output, /模型信息|模型:|Provider:|Current model|Model/);
    assert.match(output, /RoxyCode 工作流|RoxyCode Workflows/);
    assert.match(output, /再见|Goodbye/);
    assert.doesNotMatch(output, /RoxyCode startup failed/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function runCli(cwd: string, commands: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(process.execPath, [DIST_ENTRY], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildSmokeEnv(),
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`CLI exited with ${code}:\n${output}`));
        return;
      }
      resolveOutput(output);
    });
    child.stdin.end(commands.join('\n'));
  });
}
function buildSmokeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (isSensitiveOrStatefulEnv(key)) delete env[key];
  }
  return {
    ...env,
    NO_COLOR: '1',
    NODE_ENV: 'test',
    ROXY_TELEMETRY_DISABLED: '1',
    ROXY_LLM_PROVIDER: 'openai',
    ROXY_LLM_MODEL: 'gpt-4o',
  };
}

function isSensitiveOrStatefulEnv(key: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)$/i.test(key)
    || key.startsWith('ROXY_')
    || key.startsWith('CLAUDE_CODE_');
}
