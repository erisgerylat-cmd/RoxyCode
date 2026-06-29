import type { Tool } from '../types.js';
import { editFileTool } from './editFile.js';
import { executeCommandTool } from './executeCommand.js';
import { gitTool } from './git.js';
import { grepSearchTool } from './grepSearch.js';
import { listDirectoryTool } from './listDirectory.js';
import { readFileTool } from './readFile.js';
import { writeFileTool } from './writeFile.js';

export { editFileTool } from './editFile.js';
export { executeCommandTool } from './executeCommand.js';
export { gitTool } from './git.js';
export { grepSearchTool } from './grepSearch.js';
export { listDirectoryTool } from './listDirectory.js';
export { readFileTool } from './readFile.js';
export { writeFileTool } from './writeFile.js';

export function getBuiltinTools(): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    grepSearchTool,
    executeCommandTool,
    gitTool,
  ];
}
