type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | YamlScalar[] | Record<string, unknown>[];

export function parseWorkflowYaml(raw: string): Record<string, YamlValue> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const data: Record<string, YamlValue> = {};
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = stripComment(line).trim();
    if (!trimmed) {
      index++;
      continue;
    }

    const indent = countIndent(line);
    if (indent !== 0) {
      index++;
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) {
      index++;
      continue;
    }

    const key = match[1];
    const rest = match[2] ?? '';
    if (rest === '|' || rest === '>') {
      const block = collectBlock(lines, index + 1, indent);
      data[key] = rest === '>' ? foldBlock(block.value) : block.value;
      index = block.nextIndex;
      continue;
    }

    if (rest.length > 0) {
      data[key] = parseScalarOrInlineList(rest);
      index++;
      continue;
    }

    const nested = parseNested(lines, index + 1, indent);
    data[key] = nested.value;
    index = nested.nextIndex;
  }

  return data;
}

function parseNested(lines: string[], startIndex: number, parentIndent: number): { value: YamlValue; nextIndex: number } {
  let index = startIndex;
  while (index < lines.length && !stripComment(lines[index]).trim()) index++;

  if (index >= lines.length || countIndent(lines[index]) <= parentIndent) {
    return { value: '', nextIndex: index };
  }

  const trimmed = stripComment(lines[index]).trim();
  if (!trimmed.startsWith('- ')) {
    return { value: '', nextIndex: index };
  }

  return parseArray(lines, index, parentIndent);
}

function parseArray(lines: string[], startIndex: number, parentIndent: number): { value: YamlScalar[] | Record<string, unknown>[]; nextIndex: number } {
  const items: Array<YamlScalar | Record<string, unknown>> = [];
  let index = startIndex;
  let itemIndent: number | null = null;

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = stripComment(raw).trim();
    if (!trimmed) {
      index++;
      continue;
    }

    const indent = countIndent(raw);
    if (indent <= parentIndent) break;
    if (!trimmed.startsWith('- ')) break;
    if (itemIndent === null) itemIndent = indent;
    if (indent !== itemIndent) break;

    const afterDash = trimmed.slice(2).trim();
    if (looksLikeKeyValue(afterDash)) {
      const obj: Record<string, unknown> = {};
      parseObjectProperty(afterDash, obj);
      index++;
      while (index < lines.length) {
        const childRaw = lines[index];
        const childTrimmed = stripComment(childRaw).trim();
        if (!childTrimmed) {
          index++;
          continue;
        }
        const childIndent = countIndent(childRaw);
        if (childIndent <= itemIndent) break;
        if (childTrimmed.startsWith('- ') && childIndent === itemIndent) break;

        if (looksLikeKeyValue(childTrimmed)) {
          parseObjectProperty(childTrimmed, obj);
        }
        index++;
      }
      items.push(obj);
    } else {
      items.push(parseScalar(afterDash));
      index++;
    }
  }

  return { value: items as YamlScalar[] | Record<string, unknown>[], nextIndex: index };
}

function parseObjectProperty(text: string, target: Record<string, unknown>): void {
  const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(text);
  if (!match) return;
  target[match[1]] = parseScalarOrInlineList(match[2] ?? '');
}

function collectBlock(lines: string[], startIndex: number, parentIndent: number): { value: string; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = countIndent(line);
    if (trimmed && indent <= parentIndent && /^([A-Za-z][A-Za-z0-9_-]*)\s*:/.test(trimmed)) break;
    collected.push(line);
    index++;
  }

  const nonEmpty = collected.filter(line => line.trim().length > 0);
  const minIndent = nonEmpty.length
    ? Math.min(...nonEmpty.map(line => countIndent(line)))
    : parentIndent + 2;
  const value = collected.map(line => line.slice(Math.min(countIndent(line), minIndent))).join('\n').replace(/\s+$/, '');
  return { value, nextIndex: index };
}

function parseScalarOrInlineList(raw: string): YamlScalar | YamlScalar[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(item => parseScalar(item.trim()));
  }
  return parseScalar(trimmed);
}

function parseScalar(raw: string): YamlScalar {
  const trimmed = raw.trim();
  const unquoted = stripQuotes(trimmed);
  const lower = unquoted.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null' || lower === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && quote === null && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function countIndent(line: string): number {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

function looksLikeKeyValue(text: string): boolean {
  return /^([A-Za-z][A-Za-z0-9_-]*)\s*:/.test(text);
}

function foldBlock(value: string): string {
  return value.split('\n').map(line => line.trim()).filter(Boolean).join(' ');
}
