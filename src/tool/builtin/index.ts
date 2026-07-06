import type { Tool } from '../types.js';
import { withToolDefaults } from '../builder/ToolBuilder.js';
import { editFileTool } from './editFile.js';
import { executeCommandTool } from './executeCommand.js';
import { gitTool } from './git.js';
import { grepSearchTool } from './grepSearch.js';
import { listDirectoryTool } from './listDirectory.js';
import { readFileTool } from './readFile.js';
import { todoWriteTool } from './todoWrite.js';
import { writeFileTool } from './writeFile.js';

export { editFileTool } from './editFile.js';
export { executeCommandTool } from './executeCommand.js';
export { gitTool } from './git.js';
export { grepSearchTool } from './grepSearch.js';
export { listDirectoryTool } from './listDirectory.js';
export { readFileTool } from './readFile.js';
export { todoWriteTool, TodoStore } from './todoWrite.js';
export type { TodoItem, TodoStatus, TodoPriority } from './todoWrite.js';
export { writeFileTool } from './writeFile.js';

export function getBuiltinTools(): Tool[] {
  return [
    withToolDefaults(readFileTool, {
      aliases: ['read', 'cat'],
      searchHint: 'read project text files with line ranges',
      maxResultSizeChars: Infinity,
      concurrency: 'safe',
      interruptBehavior: 'cancel',
    }),
    withToolDefaults(writeFileTool, {
      aliases: ['write'],
      searchHint: 'create or overwrite project files',
      maxResultSizeChars: 20_000,
      strict: true,
      concurrency: 'exclusive',
      interruptBehavior: 'block',
    }),
    withToolDefaults(editFileTool, {
      aliases: ['edit', 'replace'],
      searchHint: 'replace exact text in project files',
      maxResultSizeChars: 20_000,
      strict: true,
      concurrency: 'exclusive',
      interruptBehavior: 'block',
    }),
    withToolDefaults(listDirectoryTool, {
      aliases: ['ls', 'list'],
      searchHint: 'list project directories and file names',
      maxResultSizeChars: 40_000,
      concurrency: 'safe',
      interruptBehavior: 'cancel',
    }),
    withToolDefaults(grepSearchTool, {
      aliases: ['grep', 'search'],
      searchHint: 'search project files for text or regex matches',
      maxResultSizeChars: 50_000,
      shouldDefer: true,
      concurrency: 'safe',
      interruptBehavior: 'cancel',
    }),
    withToolDefaults(executeCommandTool, {
      aliases: ['bash', 'shell', 'powershell'],
      searchHint: 'run local shell commands in the workspace',
      maxResultSizeChars: 40_000,
      strict: true,
      concurrency: 'exclusive',
      interruptBehavior: 'block',
    }),
    withToolDefaults(gitTool, {
      aliases: ['git_status'],
      searchHint: 'inspect git status diff log and branches',
      maxResultSizeChars: 50_000,
      shouldDefer: true,
      concurrency: 'safe',
      interruptBehavior: 'cancel',
    }),
    withToolDefaults(todoWriteTool, {
      aliases: ['todo', 'todos'],
      searchHint: 'track multi-step task list within the session',
      maxResultSizeChars: 20_000,
      concurrency: 'safe',
      interruptBehavior: 'cancel',
    }),
  ];
}