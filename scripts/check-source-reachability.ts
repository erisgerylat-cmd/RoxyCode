import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const cwd = process.cwd();
const sourceRoot = path.resolve(cwd, 'src');
const entry = path.resolve(sourceRoot, 'index.ts');

const files = await collectTypeScriptFiles(sourceRoot);
const fileSet = new Set(files);
const graph = new Map<string, string[]>();

for (const file of files) {
  graph.set(file, await collectDependencies(file, fileSet));
}

const reachable = walkGraph(entry, graph);
const unreachable = files
  .filter(file => !reachable.has(file))
  .map(file => path.relative(cwd, file))
  .sort();

if (unreachable.length > 0) {
  console.error('Unreachable source files detected:');
  for (const file of unreachable) console.error(`- ${file}`);
  console.error('Remove the files or connect them to the CLI composition root.');
  process.exitCode = 1;
} else {
  console.log(`Source reachability check passed: ${reachable.size}/${files.length} files.`);
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const absolute = path.resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : [];
  }));
  return nested.flat();
}

async function collectDependencies(file: string, fileSet: Set<string>): Promise<string[]> {
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies = new Set<string>();

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      const resolved = resolveRelativeImport(file, node.moduleSpecifier.text, fileSet);
      if (resolved) dependencies.add(resolved);
    }

    if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])) {
      const resolved = resolveRelativeImport(file, node.arguments[0].text, fileSet);
      if (resolved) dependencies.add(resolved);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...dependencies];
}

function resolveRelativeImport(from: string, specifier: string, fileSet: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    base.replace(/\.js$/, '.ts'),
    path.resolve(base, 'index.ts'),
    path.resolve(base.replace(/\.js$/, ''), 'index.ts'),
  ];
  return candidates.find(candidate => fileSet.has(candidate)) ?? null;
}

function walkGraph(start: string, graph: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    pending.push(...(graph.get(file) ?? []));
  }
  return seen;
}
