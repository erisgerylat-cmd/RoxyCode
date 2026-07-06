import type { Tool, ToolExecutionContext } from '../types.js';
import { formatToolResult } from '../executor/ToolExecutor.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type TodoPriority = 'high' | 'medium' | 'low';
export type TodoOperation = 'write' | 'update' | 'read' | 'clear';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  activeForm?: string;
}

export interface TodoSnapshot {
  todos: TodoItem[];
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  activeId?: string;
}

export class TodoStore {
  private todos: TodoItem[] = [];

  getAll(): readonly TodoItem[] {
    return this.todos.map(item => ({ ...item }));
  }

  snapshot(): TodoSnapshot {
    const todos = this.getAll() as TodoItem[];
    const pending = todos.filter(item => item.status === 'pending').length;
    const inProgress = todos.filter(item => item.status === 'in_progress').length;
    const completed = todos.filter(item => item.status === 'completed').length;
    const activeId = todos.find(item => item.status === 'in_progress')?.id;
    return { todos, total: todos.length, pending, inProgress, completed, activeId };
  }

  write(items: TodoItem[]): TodoSnapshot {
    assertSingleInProgress(items);
    this.todos = items.map(item => ({ ...item }));
    return this.snapshot();
  }

  update(id: string, patch: Partial<Omit<TodoItem, 'id'>>): TodoSnapshot {
    const index = this.todos.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`Todo id not found: ${id}`);
    const next = this.todos.map(item => item.id === id ? { ...item, ...patch } : { ...item });
    assertSingleInProgress(next);
    this.todos = next;
    return this.snapshot();
  }

  clear(): TodoSnapshot {
    this.todos = [];
    return this.snapshot();
  }
}

export const todoWriteTool: Tool = {
  definition: {
    name: 'todo_write',
    description: [
      'Manage the current RoxyCode session todo list. Use it for complex multi-step tasks, visible progress, and handoffs.',
      'Use operation="write" to replace the full list, operation="update" to update one item, operation="read" to inspect it, and operation="clear" when the session checklist is no longer useful.',
      'Keep at most one item in_progress. Prefer concise content and optional activeForm for UI-friendly present-progress wording.',
      'This tool changes only session state, not project files, so it is allowed in read-only planning mode.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'write | update | read | clear',
          enum: ['write', 'update', 'read', 'clear'],
          default: 'read',
        },
        todos: {
          type: 'array',
          description: 'Todo items. write expects the full list. update expects one item with id and fields to patch.',
          items: {
            type: 'object',
            description: '{ id, content, status, priority, activeForm? }',
          },
        },
      },
      required: ['operation'],
    },
  },
  isReadOnly: true,
  riskLevel: 'low',
  concurrency: 'safe',
  concurrencySafe: true,
  destructive: false,
  interruptBehavior: 'cancel',

  async execute(args, ctx) {
    const started = Date.now();
    const operation = validOperation(args.operation) ?? 'read';
    const store = ctx.todoStore;

    if (!store) {
      return createResult(false, ctx, started, ctx.language === 'en-US'
        ? 'Todo store is not available for this session.'
        : '\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u53ef\u7528\u7684 TodoStore\u3002', { operation });
    }

    try {
      let snapshot: TodoSnapshot;
      if (operation === 'read') {
        snapshot = store.snapshot();
      } else if (operation === 'clear') {
        snapshot = store.clear();
      } else if (operation === 'write') {
        const items = normalizeTodoItems(args.todos, { partial: false });
        snapshot = store.write(items);
      } else {
        const patch = normalizeUpdate(args.todos);
        snapshot = store.update(patch.id, patch.patch);
      }

      ctx.onProgress?.({
        type: 'status',
        toolName: 'todo_write',
        phase: operation === 'read' ? 'complete' : 'execute',
        message: renderProgress(snapshot, ctx.language),
      });

      return createResult(true, ctx, started, renderList(snapshot.todos, ctx.language), {
        operation,
        total: snapshot.total,
        pending: snapshot.pending,
        inProgress: snapshot.inProgress,
        completed: snapshot.completed,
        activeId: snapshot.activeId,
        todos: snapshot.todos,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createResult(false, ctx, started, localizeError(message, ctx.language), { operation });
    }
  },

  getAuditSummary(_args, result) {
    return {
      operation: result?.metadata?.operation,
      total: result?.metadata?.total,
      activeId: result?.metadata?.activeId,
    };
  },
};

function normalizeTodoItems(value: unknown, options: { partial: boolean }): TodoItem[] {
  if (!Array.isArray(value)) throw new Error('todos must be an array.');
  return value.map((raw, index) => normalizeTodoItem(raw, index, options));
}

function normalizeTodoItem(value: unknown, index: number, options: { partial: boolean }): TodoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`todos[${index}] must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id) || `task-${index + 1}`;
  const content = stringValue(record.content);
  const status = validStatus(record.status) ?? (options.partial ? undefined : 'pending');
  const priority = validPriority(record.priority) ?? (options.partial ? undefined : 'medium');
  const activeForm = stringValue(record.activeForm);

  if (!id) throw new Error(`todos[${index}].id is required.`);
  if (!options.partial && !content) throw new Error(`todos[${index}].content is required.`);

  return {
    id,
    content,
    status: status ?? 'pending',
    priority: priority ?? 'medium',
    ...(activeForm ? { activeForm } : {}),
  };
}

function normalizeUpdate(value: unknown): { id: string; patch: Partial<Omit<TodoItem, 'id'>> } {
  const [item] = normalizeTodoItems(value, { partial: true });
  const patch: Partial<Omit<TodoItem, 'id'>> = {};
  if (item.content) patch.content = item.content;
  if (item.status) patch.status = item.status;
  if (item.priority) patch.priority = item.priority;
  if (item.activeForm) patch.activeForm = item.activeForm;
  if (Object.keys(patch).length === 0) throw new Error('update requires at least one field to change.');
  return { id: item.id, patch };
}

function assertSingleInProgress(items: readonly TodoItem[]): void {
  const active = items.filter(item => item.status === 'in_progress');
  if (active.length > 1) throw new Error(`Only one todo can be in_progress. Active ids: ${active.map(item => item.id).join(', ')}`);
}

function renderList(todos: readonly TodoItem[], language?: string): string {
  const zh = language !== 'en-US';
  if (todos.length === 0) return zh ? '\u4efb\u52a1\u6e05\u5355\u4e3a\u7a7a\u3002' : 'Todo list is empty.';
  const header = zh ? `\u4efb\u52a1\u6e05\u5355 (${todos.length} \u9879)` : `Todo list (${todos.length} items)`;
  return [header, ...todos.map(item => {
    const status = labelStatus(item.status, zh);
    const priority = labelPriority(item.priority, zh);
    const active = item.status === 'in_progress' && item.activeForm ? ` - ${item.activeForm}` : '';
    return `- [${item.id}] ${status} / ${priority}: ${item.content}${active}`;
  })].join('\n');
}

function renderProgress(snapshot: TodoSnapshot, language?: string): string {
  if (language === 'en-US') {
    const active = snapshot.activeId ? `, active=${snapshot.activeId}` : '';
    return `Todo updated: ${snapshot.completed}/${snapshot.total} completed${active}`;
  }
  const active = snapshot.activeId ? `\uff0c\u5f53\u524d=${snapshot.activeId}` : '';
  return `Todo \u5df2\u66f4\u65b0\uff1a${snapshot.completed}/${snapshot.total} \u5df2\u5b8c\u6210${active}`;
}

function createResult(success: boolean, ctx: ToolExecutionContext, started: number, body: string, metadata: Record<string, unknown>) {
  return {
    success,
    output: formatToolResult('todo_write', success, body, ctx, { tool: 'todo_write', ...metadata }),
    error: success ? undefined : body,
    duration: Date.now() - started,
    metadata: { tool: 'todo_write', ...metadata },
  };
}

function localizeError(message: string, language?: string): string {
  if (language === 'en-US') return message;
  if (message.startsWith('Only one todo')) return '\u540c\u4e00\u65f6\u95f4\u53ea\u80fd\u6709\u4e00\u4e2a in_progress \u4efb\u52a1\u3002';
  if (message.startsWith('Todo id not found')) return `\u627e\u4e0d\u5230\u4efb\u52a1\uff1a${message.slice('Todo id not found:'.length).trim()}`;
  if (message.includes('todos must be an array')) return 'todos \u5fc5\u987b\u662f\u6570\u7ec4\u3002';
  if (message.includes('update requires')) return 'update \u9700\u8981 todos[0] \u5305\u542b id \u548c\u81f3\u5c11\u4e00\u4e2a\u9700\u8981\u66f4\u65b0\u7684\u5b57\u6bb5\u3002';
  return message;
}

function labelStatus(status: TodoStatus, zh: boolean): string {
  if (!zh) return status;
  return status === 'pending' ? '\u5f85\u529e' : status === 'in_progress' ? '\u8fdb\u884c\u4e2d' : '\u5df2\u5b8c\u6210';
}

function labelPriority(priority: TodoPriority, zh: boolean): string {
  if (!zh) return priority;
  return priority === 'high' ? '\u9ad8\u4f18\u5148\u7ea7' : priority === 'medium' ? '\u4e2d\u4f18\u5148\u7ea7' : '\u4f4e\u4f18\u5148\u7ea7';
}

function validOperation(value: unknown): TodoOperation | undefined {
  return value === 'write' || value === 'update' || value === 'read' || value === 'clear' ? value : undefined;
}

function validStatus(value: unknown): TodoStatus | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : undefined;
}

function validPriority(value: unknown): TodoPriority | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
