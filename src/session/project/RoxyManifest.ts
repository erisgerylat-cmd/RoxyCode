import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RoxySection {
  title: string;
  level: number;
  content: string;
}

export interface RoxyManifestSummary {
  path: string;
  exists: boolean;
  title?: string;
  sections: RoxySection[];
  instructions: string[];
  workflows: string[];
}

export class RoxyManifest {
  constructor(private readonly cwd: string = process.cwd()) {}

  getPath(): string {
    return join(this.cwd, 'ROXY.md');
  }

  async load(): Promise<RoxyManifestSummary> {
    const path = this.getPath();
    if (!existsSync(path)) {
      return { path, exists: false, sections: [], instructions: [], workflows: [] };
    }
    return parseRoxyMd(await readFile(path, 'utf-8'), path);
  }
}

export function parseRoxyMd(content: string, path = 'ROXY.md'): RoxyManifestSummary {
  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  const sections = parseSections(content);
  return {
    path,
    exists: true,
    title,
    sections,
    instructions: extractInstructions(sections),
    workflows: extractWorkflows(sections),
  };
}

export function extractInstructions(sections: RoxySection[]): string[] {
  const result: string[] = [];
  for (const section of sections) {
    if (!/(规则|指令|instructions?|rules?|guidance)/i.test(section.title)) continue;
    result.push(...extractListItems(section.content));
  }
  return result;
}

export function extractWorkflows(sections: RoxySection[]): string[] {
  const result: string[] = [];
  for (const section of sections) {
    if (/(工作流|workflow|commands?)/i.test(section.title)) {
      result.push(...extractListItems(section.content));
      continue;
    }
    for (const item of extractListItems(section.content)) {
      if (/\/workflow|\bworkflow\b|工作流/i.test(item)) result.push(item);
    }
  }
  return Array.from(new Set(result));
}

function parseSections(content: string): RoxySection[] {
  const lines = content.split(/\r?\n/);
  const sections: RoxySection[] = [];
  let current: { title: string; level: number; lines: string[] } | null = null;

  for (const line of lines) {
    const heading = /^(#{2,6})\s+(.+)$/.exec(line);
    if (heading) {
      if (current) sections.push({ title: current.title, level: current.level, content: current.lines.join('\n').trim() });
      current = { title: heading[2].trim(), level: heading[1].length, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (current) sections.push({ title: current.title, level: current.level, content: current.lines.join('\n').trim() });
  return sections;
}

function extractListItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}
