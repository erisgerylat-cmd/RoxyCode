import { EventEmitter } from 'node:events';

export type KeyEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'escape' }
  | { type: 'tab' }
  | { type: 'pageup' }
  | { type: 'pagedown' }
  | { type: 'delete' };

export interface RawLineReaderOptions {
  prompt: string;
  history?: string[];
  historyLimit?: number;
}

export interface SetLineOptions {
  emitChange?: boolean;
}

export class RawLineReader extends EventEmitter {
  private buffer = '';
  private cursor = 0;
  private prompt: string;
  private promptWidth = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private savedBuffer = '';
  private savedCursor = 0;
  private historyLimit: number;
  private active = false;

  constructor(options: RawLineReaderOptions) {
    super();
    this.prompt = options.prompt;
    this.promptWidth = visibleLen(options.prompt);
    this.history = options.history ? [...options.history] : [];
    this.historyLimit = options.historyLimit ?? 500;
  }

  get line(): string { return this.buffer; }
  get cursorPos(): number { return this.cursor; }
  get isActive(): boolean { return this.active; }
  getHistory(): string[] { return [...this.history]; }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.attachInput();
    this.buffer = '';
    this.cursor = 0;
    this.refresh();
  }

  pause(): void {
    if (!this.active) return;
    this.active = false;
    process.stdin.removeListener('data', this._onData);
    process.stdin.removeListener('end', this._onEnd);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  resume(options: { redraw?: boolean } = {}): void {
    if (this.active) return;
    this.active = true;
    this.attachInput();
    if (options.redraw ?? true) this.refresh();
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt;
    this.promptWidth = visibleLen(prompt);
  }

  prompt_(): void {
    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = -1;
    this.refresh();
  }

  setLine(text: string, options: SetLineOptions = {}): void {
    this.buffer = text;
    this.cursor = text.length;
    this.refresh();
    if (options.emitChange ?? true) this.emit('change', this.buffer);
  }

  clearLine(): void {
    this.buffer = '';
    this.cursor = 0;
    this.refresh();
    this.emit('change', this.buffer);
  }

  close(): void {
    this.pause();
    this.emit('close');
  }

  redraw(): void {
    this.refresh();
  }

  addToHistory(line: string): void {
    if (!line.trim()) return;
    if (this.history.length > 0 && this.history[this.history.length - 1] === line) return;
    this.history.push(line);
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  clearCurrentLine(): void {
    const cols = process.stdout.columns || 80;
    const totalRows = Math.max(1, Math.ceil((this.promptWidth + this.buffer.length) / cols));
    const currentRow = Math.floor((this.promptWidth + this.cursor) / cols);
    const rowsDown = totalRows - 1 - currentRow;

    if (rowsDown > 0) process.stdout.write(`\x1b[${rowsDown}B`);
    for (let i = 0; i < totalRows; i++) {
      process.stdout.write('\x1b[2K');
      if (i < totalRows - 1) process.stdout.write('\x1b[1A');
    }
    process.stdout.write('\r');
  }

  private attachInput(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this._onData);
    process.stdin.on('end', this._onEnd);
  }

  private _onData = (data: Buffer): void => {
    if (!this.active) return;

    let i = 0;
    while (i < data.length) {
      const byte = data[i];

      if (byte === 0x01) { this.moveHome(); i++; continue; }
      if (byte === 0x05) { this.moveEnd(); i++; continue; }
      if (byte === 0x15) { this.killLineBack(); i++; continue; }
      if (byte === 0x0b) { this.killLineForward(); i++; continue; }
      if (byte === 0x17) { this.killWordBack(); i++; continue; }
      if (byte === 0x03) { process.stdout.write('^C\n'); this.emit('close'); return; }
      if (byte === 0x04) {
        if (this.buffer.length === 0) { this.emit('close'); return; }
        this.deleteForward();
        i++;
        continue;
      }
      if (byte === 0x0c) { process.stdout.write('\x1b[2J\x1b[H'); this.refresh(); i++; continue; }
      if (byte === 0x0d || byte === 0x0a) { this.handleEnter(); i++; continue; }
      if (byte === 0x7f || byte === 0x08) { this.deleteBack(); i++; continue; }
      if (byte === 0x09) { this.emit('key', { type: 'tab' }); i++; continue; }

      if (byte === 0x1b && i + 1 < data.length && data[i + 1] === 0x5b) {
        i += 2;
        const params: number[] = [];
        while (i < data.length && data[i] >= 0x30 && data[i] <= 0x3f) {
          params.push(data[i]);
          i++;
        }
        if (i < data.length) {
          this.handleCSI(params, data[i]);
          i++;
        }
        continue;
      }

      if (byte === 0x1b && i + 1 < data.length && data[i + 1] !== 0x5b) { i += 2; continue; }
      if (byte === 0x1b) { this.emit('key', { type: 'escape' }); i++; continue; }

      if (byte >= 0x20) {
        const charLen = getUtf8CharLen(byte);
        if (i + charLen <= data.length) {
          this.insertChar(data.slice(i, i + charLen).toString('utf8'));
          i += charLen;
        } else {
          i++;
        }
        continue;
      }

      i++;
    }
  };

  private _onEnd = (): void => {
    this.emit('close');
  };

  private handleCSI(params: number[], finalByte: number): void {
    const paramStr = String.fromCharCode(...params);
    switch (finalByte) {
      case 0x41: this.handleUp(); break;
      case 0x42: this.handleDown(); break;
      case 0x43: this.moveRight(); break;
      case 0x44: this.moveLeft(); break;
      case 0x48: this.moveHome(); break;
      case 0x46: this.moveEnd(); break;
      case 0x7e:
        if (paramStr === '3') this.deleteForward();
        else if (paramStr === '5') this.emit('key', { type: 'pageup' });
        else if (paramStr === '6') this.emit('key', { type: 'pagedown' });
        else if (paramStr === '1' || paramStr === '7') this.moveHome();
        else if (paramStr === '4' || paramStr === '8') this.moveEnd();
        break;
    }
  }

  private insertChar(char: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + char + this.buffer.slice(this.cursor);
    this.cursor += char.length;
    this.refresh();
    this.emit('change', this.buffer);
  }

  private deleteBack(): void {
    if (this.cursor === 0) return;
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor--;
    this.refresh();
    this.emit('change', this.buffer);
  }

  private deleteForward(): void {
    if (this.cursor >= this.buffer.length) return;
    this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
    this.refresh();
    this.emit('change', this.buffer);
  }

  private killLineBack(): void {
    if (this.cursor === 0) return;
    this.buffer = this.buffer.slice(this.cursor);
    this.cursor = 0;
    this.refresh();
    this.emit('change', this.buffer);
  }

  private killLineForward(): void {
    if (this.cursor >= this.buffer.length) return;
    this.buffer = this.buffer.slice(0, this.cursor);
    this.refresh();
    this.emit('change', this.buffer);
  }

  private killWordBack(): void {
    if (this.cursor === 0) return;
    let pos = this.cursor - 1;
    while (pos > 0 && this.buffer[pos] === ' ') pos--;
    while (pos > 0 && this.buffer[pos - 1] !== ' ') pos--;
    this.buffer = this.buffer.slice(0, pos) + this.buffer.slice(this.cursor);
    this.cursor = pos;
    this.refresh();
    this.emit('change', this.buffer);
  }

  private moveLeft(): void { if (this.cursor > 0) { this.cursor--; this.refresh(); } }
  private moveRight(): void { if (this.cursor < this.buffer.length) { this.cursor++; this.refresh(); } }
  private moveHome(): void { if (this.cursor !== 0) { this.cursor = 0; this.refresh(); } }
  private moveEnd(): void { if (this.cursor !== this.buffer.length) { this.cursor = this.buffer.length; this.refresh(); } }

  private handleUp(): void {
    if (this.history.length === 0) { this.emit('key', { type: 'up' }); return; }
    if (this.historyIndex === -1) {
      this.savedBuffer = this.buffer;
      this.savedCursor = this.cursor;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      this.emit('key', { type: 'up' });
      return;
    }
    this.buffer = this.history[this.historyIndex];
    this.cursor = this.buffer.length;
    this.refresh();
    this.emit('change', this.buffer);
  }

  private handleDown(): void {
    if (this.historyIndex === -1) { this.emit('key', { type: 'down' }); return; }
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.buffer = this.history[this.historyIndex];
      this.cursor = this.buffer.length;
    } else {
      this.historyIndex = -1;
      this.buffer = this.savedBuffer;
      this.cursor = this.savedCursor;
    }
    this.refresh();
    this.emit('change', this.buffer);
  }

  private handleEnter(): void {
    const line = this.buffer;
    this.clearCurrentLine();
    process.stdout.write('\n');
    this.addToHistory(line);
    this.historyIndex = -1;
    this.buffer = '';
    this.cursor = 0;
    this.emit('line', line);
  }

  private refresh(): void {
    this.clearCurrentLine();
    process.stdout.write('\r');
    process.stdout.write(this.prompt);
    process.stdout.write(this.buffer);

    const cols = process.stdout.columns || 80;
    const cursorCol = (this.promptWidth + this.cursor) % cols;
    const cursorRow = Math.floor((this.promptWidth + this.cursor) / cols);
    const totalChars = this.promptWidth + this.buffer.length;
    const endRow = Math.floor(totalChars / cols);
    if (endRow > cursorRow) process.stdout.write(`\x1b[${endRow - cursorRow}A`);
    process.stdout.write(`\r\x1b[${cursorCol + 1}G`);
  }
}

function visibleLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}

function getUtf8CharLen(firstByte: number): number {
  if (firstByte < 0x80) return 1;
  if (firstByte < 0xe0) return 2;
  if (firstByte < 0xf0) return 3;
  return 4;
}
