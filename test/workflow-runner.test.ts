import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import { handleWorkflowCommand } from '../src/commands/builtin/workflow.js';
import type { ConfigManager } from '../src/core/ConfigManager.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from '../src/core/types/config.js';
import { parseWorkflowArguments } from '../src/workflow/WorkflowLoader.js';
import { WorkflowRunner } from '../src/workflow/WorkflowRunner.js';
import type { WorkflowDefinition } from '../src/workflow/types.js';

test('workflow runner evaluates variables, conditions, loops, and verification steps', async () => {
  const workflow = createWorkflow({
    steps: [
      'Plan {{feature}}',
      { id: 'set-ready', name: 'Set ready flag', set: 'ready=true', prompt: 'Ready {{feature}}' },
      { id: 'skip-missing', name: 'Skip missing flag', if: 'missing', prompt: 'Should skip' },
      { id: 'repeat', name: 'Repeat step', repeat: 2, prompt: 'Loop ${iteration} for {{feature}}' },
    ],
    verify: ['Verify {{feature}}'],
  });
  const parsed = parseWorkflowArguments(workflow, ['--feature', 'orders']);

  const result = await new WorkflowRunner({
    cwd: 'D:/project',
    language: 'zh-CN',
    characterName: 'Roxy',
    runWholeWorkflowWithAgent: false,
  }).run(workflow, parsed);

  assert.equal(result.status, 'completed');
  assert.equal(result.errors.length, 0);
  assert.equal(result.variables.ready, 'true');
  assert.equal(result.steps.filter(step => step.status === 'completed').length, 5);
  assert.equal(result.steps.filter(step => step.status === 'skipped').length, 1);
  assert.match(result.steps[0]!.output ?? '', /orders/);
  assert.match(result.steps.find(step => step.id === 'repeat-1')?.output ?? '', /Loop 1/);
  assert.match(result.steps.find(step => step.id === 'repeat-2')?.output ?? '', /Loop 2/);
  assert.match(result.steps.at(-1)?.name ?? '', /Verify/);
});

test('workflow runner can execute tool and agent steps through injected executors', async () => {
  const workflow = createWorkflow({
    steps: [
      { id: 'read', name: 'Read target', type: 'tool', tool: 'read_file', args: 'path={{file}}' },
      { id: 'agent', name: 'Ask agent', type: 'agent', prompt: 'Summarize {{file}}' },
    ],
    verify: [],
  });
  const parsed = parseWorkflowArguments(workflow, ['--file', 'src/index.ts']);
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const agentPrompts: string[] = [];

  const result = await new WorkflowRunner({
    cwd: 'D:/project',
    language: 'zh-CN',
    characterName: 'Roxy',
    runWholeWorkflowWithAgent: false,
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { success: true, output: `tool ${name} ${args.path}`, duration: 1 };
    },
    runAgentPrompt: async prompt => {
      agentPrompts.push(prompt);
    },
  }).run(workflow, parsed);

  assert.equal(result.status, 'completed');
  assert.deepEqual(toolCalls, [{ name: 'read_file', args: { path: 'src/index.ts' } }]);
  assert.deepEqual(agentPrompts, ['Summarize src/index.ts']);
  assert.match(result.steps[0]!.output ?? '', /tool read_file/);
});

test('workflow command run uses WorkflowRunner and still submits the full workflow prompt to the agent loop', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-workflow-command-runner-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    await mkdir(join(cwd, '.roxycode', 'workflows'), { recursive: true });
    await writeFile(join(cwd, '.roxycode', 'workflows', 'demo.yml'), [
      'id: demo',
      'name: Demo Workflow',
      'description: Demo workflow execution',
      'mode: standard',
      'category: custom',
      'inputs:',
      '  - name: feature',
      '    label: Feature',
      '    required: true',
      'prompt: |',
      '  Build the requested feature.',
      'steps:',
      '  - Inspect {{feature}}',
      'verify:',
      '  - Check {{feature}}',
    ].join('\n'), 'utf8');

    const prompts: string[] = [];
    const output = await captureConsole(() => handleWorkflowCommand(['run', 'demo', '--feature', 'orders'], {
      configManager: createConfigManager(createConfig()),
      characterManager: createCharacterManager(),
      sessionId: 'session-test',
      runAgentPrompt: async prompt => { prompts.push(prompt); },
    }));

    assert.match(output, /demo - Demo Workflow/);
    assert.match(output, /steps: completed=/);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Build the requested feature/);
    assert.match(prompts[0]!, /orders/);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

function createWorkflow(patch: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    id: 'demo',
    name: 'Demo Workflow',
    description: 'Demo workflow',
    mode: 'standard',
    category: 'custom',
    tags: [],
    inputs: [{ name: 'feature', label: 'Feature', required: true }],
    prompt: 'Build {{feature}}',
    steps: [],
    allowedTools: ['read_file'],
    verify: [],
    source: 'project',
    ...patch,
  };
}

function createConfig(): RoxyCodeConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.ui.language = 'zh-CN';
  config.workflows.builtin = false;
  config.workflows.directories = ['.roxycode/workflows'];
  return config;
}

function createConfigManager(config: RoxyCodeConfig): ConfigManager {
  return {
    get(path: string): unknown {
      return path.split('.').filter(Boolean).reduce((obj: unknown, key) => (
        obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined
      ), config);
    },
    snapshot(): RoxyCodeConfig {
      return structuredClone(config);
    },
  } as unknown as ConfigManager;
}

function createCharacterManager(): CharacterManager {
  return {
    getCurrentCharacter() {
      return { name: 'Roxy' };
    },
  } as unknown as CharacterManager;
}

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join('\n');
}
