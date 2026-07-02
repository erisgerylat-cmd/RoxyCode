export interface DiffPreview {
  oldLines: number;
  newLines: number;
  addedLines: number;
  removedLines: number;
  preview: string;
  truncated: boolean;
}

export function createDiffPreview(oldContent: string, newContent: string, maxLines = 80): DiffPreview {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const rows = buildLcsRows(oldLines, newLines);
  const diffLines: string[] = [];
  let addedLines = 0;
  let removedLines = 0;

  for (const row of rows) {
    if (row.type === 'same') {
      diffLines.push(` ${row.value}`);
    } else if (row.type === 'remove') {
      removedLines++;
      diffLines.push(`-${row.value}`);
    } else {
      addedLines++;
      diffLines.push(`+${row.value}`);
    }
  }

  const compacted = compactUnchangedRuns(diffLines);
  const truncated = compacted.length > maxLines;
  return {
    oldLines: countLogicalLines(oldContent),
    newLines: countLogicalLines(newContent),
    addedLines,
    removedLines,
    preview: (truncated ? compacted.slice(0, maxLines) : compacted).join('\n'),
    truncated,
  };
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.replaceAll('\r\n', '\n').split('\n');
}

function countLogicalLines(content: string): number {
  if (content.length === 0) return 0;
  return splitLines(content).length;
}

type DiffRow =
  | { type: 'same'; value: string }
  | { type: 'remove'; value: string }
  | { type: 'add'; value: string };

function buildLcsRows(oldLines: string[], newLines: string[]): DiffRow[] {
  const rows = oldLines.length;
  const cols = newLines.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const output: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      output.push({ type: 'same', value: oldLines[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      output.push({ type: 'remove', value: oldLines[i] });
      i++;
    } else {
      output.push({ type: 'add', value: newLines[j] });
      j++;
    }
  }
  while (i < rows) output.push({ type: 'remove', value: oldLines[i++] });
  while (j < cols) output.push({ type: 'add', value: newLines[j++] });
  return output;
}

function compactUnchangedRuns(lines: string[]): string[] {
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith(' ')) {
      output.push(lines[index]);
      index++;
      continue;
    }

    const start = index;
    while (index < lines.length && lines[index].startsWith(' ')) index++;
    const run = lines.slice(start, index);
    if (run.length <= 6) {
      output.push(...run);
    } else {
      output.push(...run.slice(0, 3));
      output.push(`... ${run.length - 6} unchanged lines ...`);
      output.push(...run.slice(-3));
    }
  }
  return output;
}
