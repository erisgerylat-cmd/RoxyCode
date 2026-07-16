import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface CliLaunchOptions {
  workspace?: string;
  help: boolean;
  version: boolean;
}

export function parseCliArguments(args: string[]): CliLaunchOptions {
  let workspace: string | undefined;
  let help = false;
  let version = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }
    if (arg === '--cwd' || arg === '-C') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a workspace directory.`);
      workspace = setWorkspace(workspace, value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      const value = arg.slice('--cwd='.length).trim();
      if (!value) throw new Error('--cwd requires a workspace directory.');
      workspace = setWorkspace(workspace, value);
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    workspace = setWorkspace(workspace, arg);
  }

  return { workspace, help, version };
}

export async function resolveWorkspaceDirectory(input: string | undefined, launchCwd: string): Promise<string> {
  const target = resolve(launchCwd, input || '.');
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new Error(`Workspace does not exist / 工作区不存在: ${target}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Workspace must be a directory / 工作区必须是目录: ${target}`);
  }
  return realpath(target);
}

export function renderCliHelp(version: string): string {
  return [
    `RoxyCode v${version}`,
    '',
    'Usage / 用法:',
    '  roxycode [workspace]',
    '  roxycode --cwd <workspace>',
    '',
    'Options / 选项:',
    '  -C, --cwd <path>  Select workspace / 指定工作区',
    '  -h, --help        Show help / 显示帮助',
    '  -v, --version     Show version / 显示版本',
    '',
    'Examples / 示例:',
    '  roxycode .',
    '  roxycode D:\\Projects\\my-app',
    '  roxycode --cwd D:\\Projects\\my-app',
  ].join('\n');
}

function setWorkspace(current: string | undefined, next: string): string {
  if (current !== undefined) throw new Error('Only one workspace can be specified / 只能指定一个工作区。');
  return next;
}
