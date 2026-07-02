import { existsSync, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { CommandLoader, CommandLoaderResult } from './CommandLoader.js';
import type { CommandSourceLoadContext } from './sources/types.js';

export interface CommandWatcherReloadEvent {
  reason: 'manual' | 'change';
  changedPaths: string[];
  watchedPaths: string[];
}

export interface CommandWatcherOptions {
  loader: CommandLoader;
  context?: CommandSourceLoadContext;
  paths?: string[];
  cwd?: string;
  debounceMs?: number;
  recursive?: boolean;
  onReload: (result: CommandLoaderResult, event: CommandWatcherReloadEvent) => Promise<void> | void;
  onError?: (error: Error) => void;
}

const DEFAULT_DEBOUNCE_MS = 250;

export class CommandWatcher {
  private readonly cwd: string;
  private readonly pendingChangedPaths = new Set<string>();
  private watchers: FSWatcher[] = [];
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private activeWatchedPaths: string[] = [];

  constructor(private readonly options: CommandWatcherOptions) {
    this.cwd = options.cwd ?? process.cwd();
  }

  get isRunning(): boolean {
    return this.watchers.length > 0;
  }

  get watchedPaths(): string[] {
    return [...this.activeWatchedPaths];
  }

  async start(): Promise<string[]> {
    this.stop();
    const paths = await this.resolveWatchPaths();
    this.activeWatchedPaths = paths;

    for (const path of paths) {
      try {
        const watcher = watch(path, {
          persistent: false,
          recursive: this.options.recursive ?? process.platform === 'win32',
        }, (eventType, filename) => {
          const changed = filename ? resolve(path, String(filename)) : path;
          this.scheduleReload(changed, eventType);
        });
        watcher.on('error', error => this.options.onError?.(toError(error)));
        this.watchers.push(watcher);
      } catch (error) {
        this.options.onError?.(toError(error));
      }
    }

    return this.watchedPaths;
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    this.activeWatchedPaths = [];
    this.pendingChangedPaths.clear();
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  async reload(reason: CommandWatcherReloadEvent['reason'] = 'manual'): Promise<CommandLoaderResult> {
    const changedPaths = Array.from(this.pendingChangedPaths);
    this.pendingChangedPaths.clear();
    const result = await this.options.loader.load(this.options.context ?? {});
    await this.options.onReload(result, {
      reason,
      changedPaths,
      watchedPaths: this.watchedPaths,
    });
    return result;
  }

  trigger(path = 'manual'): void {
    this.scheduleReload(path, 'manual');
  }

  private async resolveWatchPaths(): Promise<string[]> {
    const rawPaths = this.options.paths ?? await this.options.loader.watchPaths(this.options.context ?? {});
    return rawPaths
      .map(path => isAbsolute(path) ? path : resolve(this.cwd, path))
      .filter((path, index, all) => all.indexOf(path) === index)
      .filter(path => existsSync(path));
  }

  private scheduleReload(path: string, eventType: string): void {
    this.pendingChangedPaths.add(`${eventType}:${path}`);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reload('change').catch(error => this.options.onError?.(toError(error)));
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.reloadTimer.unref?.();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
