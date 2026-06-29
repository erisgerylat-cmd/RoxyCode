import type { MultiAgentPlan, MultiAgentTask } from './types.js';

export interface TaskGraphValidation {
  ok: boolean;
  missingDependencies: Array<{ taskId: string; dependencyId: string }>;
  cycles: string[][];
}

export class TaskGraph {
  private readonly tasks = new Map<string, MultiAgentTask>();

  constructor(plan: MultiAgentPlan) {
    for (const task of plan.tasks) {
      this.tasks.set(task.id, task);
    }
  }

  validate(): TaskGraphValidation {
    const missingDependencies: Array<{ taskId: string; dependencyId: string }> = [];
    for (const task of this.tasks.values()) {
      for (const dependencyId of task.dependsOn) {
        if (!this.tasks.has(dependencyId)) missingDependencies.push({ taskId: task.id, dependencyId });
      }
    }

    return {
      ok: missingDependencies.length === 0 && this.findCycles().length === 0,
      missingDependencies,
      cycles: this.findCycles(),
    };
  }

  readyTasks(tasks: MultiAgentTask[]): MultiAgentTask[] {
    const byId = new Map(tasks.map(task => [task.id, task]));
    return tasks.filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependsOn.every(id => byId.get(id)?.status === 'done');
    });
  }

  markBlockedByValidation(plan: MultiAgentPlan, validation: TaskGraphValidation): MultiAgentPlan {
    if (validation.ok) return plan;
    const blockedIds = new Set<string>();
    for (const item of validation.missingDependencies) blockedIds.add(item.taskId);
    for (const cycle of validation.cycles) for (const id of cycle) blockedIds.add(id);

    return {
      ...plan,
      tasks: plan.tasks.map(task => blockedIds.has(task.id)
        ? {
            ...task,
            status: 'blocked',
            error: formatValidationError(task.id, validation),
          }
        : task),
      notes: [
        ...(plan.notes ?? []),
        'Some tasks were blocked because the dependency graph was invalid.',
      ],
    };
  }

  private findCycles(): string[][] {
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        const start = stack.indexOf(taskId);
        cycles.push(start >= 0 ? stack.slice(start).concat(taskId) : [taskId]);
        return;
      }

      visiting.add(taskId);
      stack.push(taskId);
      const task = this.tasks.get(taskId);
      for (const dependencyId of task?.dependsOn ?? []) {
        if (this.tasks.has(dependencyId)) visit(dependencyId);
      }
      stack.pop();
      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const taskId of this.tasks.keys()) visit(taskId);
    return cycles;
  }
}

function formatValidationError(taskId: string, validation: TaskGraphValidation): string {
  const missing = validation.missingDependencies
    .filter(item => item.taskId === taskId)
    .map(item => item.dependencyId);
  const cycles = validation.cycles.filter(cycle => cycle.includes(taskId));
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing dependencies: ${missing.join(', ')}`);
  if (cycles.length > 0) parts.push(`cycle detected: ${cycles.map(cycle => cycle.join(' -> ')).join('; ')}`);
  return parts.join('; ') || 'dependency graph validation failed';
}
