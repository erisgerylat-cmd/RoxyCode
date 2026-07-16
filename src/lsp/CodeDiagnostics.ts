import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LSPClient } from './LSPClient.js';
import type { Language } from '../i18n/index.js';
import type { LspDiagnostic } from './types.js';

export type CodeDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';
export type CodeDiagnosticsLanguage = 'typescript' | 'vue' | 'java' | 'unknown';
export type CodeDiagnosticsEngine = 'typescript-language-server' | 'typescript-compiler' | 'none';
export type CodeDiagnosticsStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface CodeDiagnostic {
  file?: string;
  relativePath?: string;
  line?: number;
  column?: number;
  severity: CodeDiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

export interface CodeDiagnosticsReport {
  status: CodeDiagnosticsStatus;
  engine: CodeDiagnosticsEngine;
  language: CodeDiagnosticsLanguage;
  cwd: string;
  filesChecked: string[];
  diagnostics: CodeDiagnostic[];
  counts: Record<CodeDiagnosticSeverity, number>;
  durationMs: number;
  generatedAt: string;
  notes: string[];
  error?: string;
}

export interface CodeDiagnosticsRunnerInput {
  cwd: string;
  files?: string[];
  changedFiles?: string[];
  maxDiagnostics?: number;
  preferLsp?: boolean;
  timeoutMs?: number;
}

export type CodeDiagnosticsRunner = (input: CodeDiagnosticsRunnerInput) => Promise<CodeDiagnosticsReport>;

const DEFAULT_MAX_DIAGNOSTICS = 50;
const DEFAULT_LSP_TIMEOUT_MS = 2500;
const DISCOVERY_LIMIT = 400;

export async function runCodeDiagnostics(input: CodeDiagnosticsRunnerInput): Promise<CodeDiagnosticsReport> {
  const started = Date.now();
  const cwd = resolve(input.cwd);
  const maxDiagnostics = input.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
  const notes: string[] = [];
  try {
    const targets = await resolveDiagnosticTargets(cwd, input);
    if (targets.typeScriptFiles.length === 0 && !targets.hasTypeScriptProject) {
      return createReport({
        status: 'skipped',
        engine: 'none',
        language: targets.detectedLanguage,
        cwd,
        filesChecked: [],
        diagnostics: [],
        started,
        notes: [
          ...notes,
          'No TypeScript project or changed TypeScript files were detected. Vue and Java diagnostics are planned extension points.',
        ],
      });
    }

    const preferLsp = input.preferLsp !== false;
    if (preferLsp && targets.typeScriptFiles.length > 0) {
      const lspReport = await runTypeScriptLspDiagnostics({
        cwd,
        files: targets.typeScriptFiles,
        maxDiagnostics,
        timeoutMs: input.timeoutMs ?? DEFAULT_LSP_TIMEOUT_MS,
        started,
      }).catch(error => {
        notes.push(`typescript-language-server unavailable, falling back to TypeScript compiler: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (lspReport) {
        lspReport.notes.push(...targets.notes, ...notes);
        return lspReport;
      }
    }

    const compilerReport = await runTypeScriptCompilerDiagnostics({
      cwd,
      files: targets.typeScriptFiles,
      filterToTargets: targets.hasExplicitTargets,
      maxDiagnostics,
      started,
    });
    compilerReport.notes.push(...targets.notes, ...notes);
    return compilerReport;
  } catch (error) {
    return createReport({
      status: 'error',
      engine: 'none',
      language: 'unknown',
      cwd,
      filesChecked: [],
      diagnostics: [],
      started,
      notes,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isTypeScriptDiagnosticPath(file: string): boolean {
  const ext = extname(file).toLowerCase();
  return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
}

export function renderCodeDiagnosticsSummary(report: CodeDiagnosticsReport, language: Language): string {
  const zh = language === 'zh-CN';
  const countText = renderCounts(report.counts);
  const engine = report.engine === 'typescript-language-server'
    ? 'typescript-language-server'
    : report.engine === 'typescript-compiler'
      ? 'TypeScript compiler'
      : 'none';
  if (report.status === 'skipped') {
    return zh
      ? `代码诊断已跳过：未检测到可诊断的 TypeScript 文件。`
      : 'Code diagnostics skipped: no diagnosable TypeScript files were detected.';
  }
  if (report.status === 'error') {
    return zh
      ? `代码诊断运行失败：${report.error ?? 'unknown error'}`
      : `Code diagnostics failed to run: ${report.error ?? 'unknown error'}`;
  }
  const prefix = report.status === 'passed'
    ? (zh ? '代码诊断通过' : 'Code diagnostics passed')
    : (zh ? '代码诊断仍有问题' : 'Code diagnostics still has issues');
  return `${prefix}: ${engine}, ${report.filesChecked.length} ${zh ? '个文件' : 'files'}, ${countText}, ${report.durationMs}ms`;
}

export function renderCodeDiagnosticsForPrompt(report: CodeDiagnosticsReport, language: Language, maxItems = 8): string {
  const zh = language === 'zh-CN';
  const lines = [
    zh ? 'RoxyCode 代码诊断反馈：' : 'RoxyCode code diagnostics feedback:',
    renderCodeDiagnosticsSummary(report, language),
    zh
      ? '请优先修复 error 级别问题；只做必要改动，保持既有功能、角色系统、权限链路和用户自定义配置不被破坏。'
      : 'Prioritize error-level diagnostics; make the smallest necessary edits and preserve existing features, character customization, permissions, and user configuration.',
  ];
  for (const diagnostic of report.diagnostics.slice(0, maxItems)) {
    lines.push(`- ${formatDiagnosticLine(diagnostic)}`);
  }
  if (report.diagnostics.length > maxItems) {
    lines.push(zh
      ? `- 还有 ${report.diagnostics.length - maxItems} 条诊断未列出，请在修复后重新运行诊断。`
      : `- ${report.diagnostics.length - maxItems} more diagnostics omitted; rerun diagnostics after the fix.`);
  }
  return lines.join('\n');
}

async function resolveDiagnosticTargets(cwd: string, input: CodeDiagnosticsRunnerInput): Promise<{
  typeScriptFiles: string[];
  hasTypeScriptProject: boolean;
  hasExplicitTargets: boolean;
  detectedLanguage: CodeDiagnosticsLanguage;
  notes: string[];
}> {
  const notes: string[] = [];
  const explicit = [...(input.changedFiles ?? []), ...(input.files ?? [])]
    .map(file => normalizeTargetPath(cwd, file))
    .filter(file => isTypeScriptDiagnosticPath(file));
  const hasExplicitTargets = explicit.length > 0;
  const rootTsconfigPath = join(cwd, 'tsconfig.json');
  let hasTypeScriptProject = existsSync(rootTsconfigPath);
  const files = uniquePaths(explicit);
  if (files.length === 0 && !hasTypeScriptProject) {
    files.push(...await discoverTypeScriptFiles(cwd, DISCOVERY_LIMIT));
  }
  if (files.length === 0 && hasTypeScriptProject) {
    notes.push('TypeScript project detected through tsconfig.json; compiler diagnostics will use project rootNames.');
  }
  const nestedTsconfig = resolveCompilerTsconfig(cwd, files);
  if (!hasTypeScriptProject && nestedTsconfig) {
    hasTypeScriptProject = true;
    notes.push(`Nested TypeScript project detected: ${relativePath(cwd, nestedTsconfig)}.`);
  }
  return {
    typeScriptFiles: files,
    hasTypeScriptProject,
    hasExplicitTargets,
    detectedLanguage: hasTypeScriptProject || files.length > 0 ? 'typescript' : detectUnsupportedLanguage(input),
    notes,
  };
}

async function runTypeScriptLspDiagnostics(input: {
  cwd: string;
  files: string[];
  maxDiagnostics: number;
  timeoutMs: number;
  started: number;
}): Promise<CodeDiagnosticsReport> {
  const command = await resolveTypeScriptLanguageServer(input.cwd);
  const client = new LSPClient({ command: command.command, args: command.args, cwd: input.cwd });
  const diagnostics: CodeDiagnostic[] = [];
  try {
    await client.start();
    for (const file of input.files) {
      const text = await readFile(file, 'utf8');
      const uri = pathToFileURL(file).toString();
      await client.openDocument({ uri, languageId: languageIdForPath(file), text });
      const items = await client.waitForDiagnostics(uri, input.timeoutMs).catch(() => client.getDiagnostics(uri));
      diagnostics.push(...items.map(item => mapLspDiagnostic(input.cwd, file, item)));
      if (diagnostics.length >= input.maxDiagnostics) break;
    }
  } finally {
    await client.stop().catch(() => undefined);
  }
  return createReport({
    status: countDiagnostics(diagnostics).error > 0 ? 'failed' : 'passed',
    engine: 'typescript-language-server',
    language: 'typescript',
    cwd: input.cwd,
    filesChecked: input.files.map(file => relativePath(input.cwd, file)),
    diagnostics: diagnostics.slice(0, input.maxDiagnostics),
    started: input.started,
    notes: ['Diagnostics were collected through the TypeScript LSP publishDiagnostics flow.'],
  });
}

async function runTypeScriptCompilerDiagnostics(input: {
  cwd: string;
  files: string[];
  filterToTargets: boolean;
  maxDiagnostics: number;
  started: number;
}): Promise<CodeDiagnosticsReport> {
  const ts = await import('typescript');
  const tsconfigPath = resolveCompilerTsconfig(input.cwd, input.files);
  let rootNames: string[] = [];
  let options: import('typescript').CompilerOptions = {
    noEmit: true,
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2020,
  };
  const notes: string[] = [];

  if (tsconfigPath) {
    const configFile = ts.readConfigFile(tsconfigPath, path => ts.sys.readFile(path));
    if (configFile.error) {
      const diagnostic = mapTsDiagnostic(input.cwd, ts, configFile.error);
      return createReport({
        status: 'failed',
        engine: 'typescript-compiler',
        language: 'typescript',
        cwd: input.cwd,
        filesChecked: [],
        diagnostics: [diagnostic],
        started: input.started,
        notes: ['tsconfig.json could not be parsed.'],
      });
    }
    const configDirectory = dirname(tsconfigPath);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDirectory);
    rootNames = parsed.fileNames;
    options = { ...parsed.options, noEmit: true };
    notes.push(`Diagnostics were collected through the TypeScript compiler API using ${relativePath(input.cwd, tsconfigPath)}.`);
  } else {
    rootNames = input.files.length > 0 ? input.files : await discoverTypeScriptFiles(input.cwd, DISCOVERY_LIMIT);
    notes.push('No tsconfig.json was found; diagnostics used discovered TypeScript/JavaScript files with conservative compiler options.');
  }

  if (rootNames.length === 0 && input.files.length > 0) rootNames = input.files;
  if (rootNames.length === 0) {
    return createReport({
      status: 'skipped',
      engine: 'typescript-compiler',
      language: 'typescript',
      cwd: input.cwd,
      filesChecked: [],
      diagnostics: [],
      started: input.started,
      notes,
    });
  }

  const targetSet = new Set(input.files.map(file => normalizeFileKey(file)));
  const program = ts.createProgram({ rootNames, options });
  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  const mapped = allDiagnostics
    .map(diagnostic => mapTsDiagnostic(input.cwd, ts, diagnostic))
    .filter(diagnostic => !input.filterToTargets || !diagnostic.file || targetSet.has(normalizeFileKey(diagnostic.file)))
    .sort(compareDiagnostics)
    .slice(0, input.maxDiagnostics);

  return createReport({
    status: countDiagnostics(mapped).error > 0 ? 'failed' : 'passed',
    engine: 'typescript-compiler',
    language: 'typescript',
    cwd: input.cwd,
    filesChecked: input.filterToTargets && input.files.length > 0
      ? input.files.map(file => relativePath(input.cwd, file))
      : rootNames.map(file => relativePath(input.cwd, file)).slice(0, DISCOVERY_LIMIT),
    diagnostics: mapped,
    started: input.started,
    notes,
  });
}

function resolveCompilerTsconfig(cwd: string, files: string[]): string | null {
  const rootConfig = join(cwd, 'tsconfig.json');
  if (existsSync(rootConfig)) return rootConfig;

  const configs = new Set<string>();
  for (const file of files) {
    let directory = dirname(resolve(file));
    while (isWithinWorkspace(cwd, directory)) {
      const candidate = join(directory, 'tsconfig.json');
      if (existsSync(candidate)) {
        configs.add(candidate);
        break;
      }
      if (directory === resolve(cwd)) break;
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (configs.size > 1) return null;
  }
  return configs.values().next().value ?? null;
}

function isWithinWorkspace(cwd: string, target: string): boolean {
  const rel = relative(resolve(cwd), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveTypeScriptLanguageServer(cwd: string): Promise<{ command: string; args: string[] }> {
  const localBin = process.platform === 'win32'
    ? join(cwd, 'node_modules', '.bin', 'typescript-language-server.cmd')
    : join(cwd, 'node_modules', '.bin', 'typescript-language-server');
  const candidates = existsSync(localBin)
    ? [buildCommand(localBin, ['--stdio']), buildCommand('typescript-language-server', ['--stdio'])]
    : [buildCommand('typescript-language-server', ['--stdio'])];
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    const ok = await canSpawn(candidate.command, candidate.args[0] === '--stdio' ? ['--version'] : candidate.args.slice(0, -1).concat('--version'));
    if (ok) return candidate;
    lastError = new Error(`${candidate.command} ${candidate.args.join(' ')}`);
  }
  throw new Error(lastError ? `typescript-language-server not found: ${lastError.message}` : 'typescript-language-server not found');
}

function buildCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };
  const comspec = process.env.ComSpec || 'cmd.exe';
  return { command: comspec, args: ['/d', '/s', '/c', command, ...args] };
}

function canSpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise(resolveOk => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    const timeout = setTimeout(() => {
      child.kill();
      resolveOk(false);
    }, 1500);
    child.once('error', () => {
      clearTimeout(timeout);
      resolveOk(false);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      resolveOk(code === 0);
    });
  });
}

async function discoverTypeScriptFiles(cwd: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  await walk(cwd);
  return out;

  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'coverage' || entry.name === '.roxycode') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isTypeScriptDiagnosticPath(full) && !full.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
}

function detectUnsupportedLanguage(input: CodeDiagnosticsRunnerInput): CodeDiagnosticsLanguage {
  const files = [...(input.changedFiles ?? []), ...(input.files ?? [])];
  if (files.some(file => file.endsWith('.vue'))) return 'vue';
  if (files.some(file => file.endsWith('.java'))) return 'java';
  return 'unknown';
}

function mapLspDiagnostic(cwd: string, file: string, diagnostic: LspDiagnostic): CodeDiagnostic {
  return {
    file,
    relativePath: relativePath(cwd, file),
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    severity: lspSeverity(diagnostic.severity),
    code: diagnostic.code,
    source: diagnostic.source ?? 'lsp',
    message: diagnostic.message,
  };
}

function mapTsDiagnostic(
  cwd: string,
  ts: typeof import('typescript'),
  diagnostic: import('typescript').Diagnostic,
): CodeDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const file = diagnostic.file?.fileName ? resolve(diagnostic.file.fileName) : undefined;
  const position = diagnostic.file && typeof diagnostic.start === 'number'
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined;
  return {
    file,
    relativePath: file ? relativePath(cwd, file) : undefined,
    line: position ? position.line + 1 : undefined,
    column: position ? position.character + 1 : undefined,
    severity: tsSeverity(ts, diagnostic.category),
    code: diagnostic.code,
    source: 'tsc',
    message,
  };
}

function lspSeverity(value: LspDiagnostic['severity']): CodeDiagnosticSeverity {
  if (value === 1) return 'error';
  if (value === 2) return 'warning';
  if (value === 3) return 'info';
  return 'hint';
}

function tsSeverity(ts: typeof import('typescript'), value: import('typescript').DiagnosticCategory): CodeDiagnosticSeverity {
  if (value === ts.DiagnosticCategory.Error) return 'error';
  if (value === ts.DiagnosticCategory.Warning) return 'warning';
  if (value === ts.DiagnosticCategory.Suggestion) return 'hint';
  return 'info';
}

function createReport(input: {
  status: CodeDiagnosticsStatus;
  engine: CodeDiagnosticsEngine;
  language: CodeDiagnosticsLanguage;
  cwd: string;
  filesChecked: string[];
  diagnostics: CodeDiagnostic[];
  started: number;
  notes: string[];
  error?: string;
}): CodeDiagnosticsReport {
  const diagnostics = input.diagnostics.slice();
  return {
    status: input.status,
    engine: input.engine,
    language: input.language,
    cwd: input.cwd,
    filesChecked: uniquePaths(input.filesChecked),
    diagnostics,
    counts: countDiagnostics(diagnostics),
    durationMs: Date.now() - input.started,
    generatedAt: new Date().toISOString(),
    notes: input.notes,
    error: input.error,
  };
}

function countDiagnostics(diagnostics: CodeDiagnostic[]): Record<CodeDiagnosticSeverity, number> {
  return diagnostics.reduce<Record<CodeDiagnosticSeverity, number>>((acc, diagnostic) => {
    acc[diagnostic.severity] += 1;
    return acc;
  }, { error: 0, warning: 0, info: 0, hint: 0 });
}

function compareDiagnostics(a: CodeDiagnostic, b: CodeDiagnostic): number {
  const severityDelta = severityRank(a.severity) - severityRank(b.severity);
  if (severityDelta !== 0) return severityDelta;
  const fileDelta = (a.relativePath ?? '').localeCompare(b.relativePath ?? '');
  if (fileDelta !== 0) return fileDelta;
  return (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0);
}

function severityRank(value: CodeDiagnosticSeverity): number {
  if (value === 'error') return 0;
  if (value === 'warning') return 1;
  if (value === 'info') return 2;
  return 3;
}

function renderCounts(counts: Record<CodeDiagnosticSeverity, number>): string {
  return `errors=${counts.error}, warnings=${counts.warning}, info=${counts.info}, hints=${counts.hint}`;
}

function formatDiagnosticLine(diagnostic: CodeDiagnostic): string {
  const location = diagnostic.relativePath
    ? `${diagnostic.relativePath}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}` : ''}`
    : '<project>';
  const code = diagnostic.code !== undefined ? ` ${diagnostic.source ?? ''}${diagnostic.code}`.trim() : diagnostic.source;
  return `${location} [${diagnostic.severity}${code ? ` ${code}` : ''}] ${diagnostic.message}`;
}

function normalizeTargetPath(cwd: string, file: string): string {
  return isAbsolute(file) ? resolve(file) : resolve(cwd, file);
}

function normalizeFileKey(file: string): string {
  return resolve(file).replace(/\\/g, '/').toLowerCase();
}

function relativePath(cwd: string, file: string): string {
  const rel = relative(cwd, file);
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : file.replace(/\\/g, '/');
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function languageIdForPath(file: string): string {
  const name = basename(file).toLowerCase();
  if (name.endsWith('.tsx')) return 'typescriptreact';
  if (name.endsWith('.jsx')) return 'javascriptreact';
  if (name.endsWith('.js')) return 'javascript';
  return 'typescript';
}
