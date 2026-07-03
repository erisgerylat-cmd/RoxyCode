import { renderWorkflowPrompt } from './WorkflowPrompt.js';
import { WorkflowContext, type WorkflowContextOptions } from './WorkflowContext.js';
import { WorkflowExecutor, getRepeatCount, normalizeStep, type WorkflowExecutorOptions } from './WorkflowExecutor.js';
import type { ParsedWorkflowArguments, WorkflowDefinition, WorkflowRunResult, WorkflowStep, WorkflowStepResult } from './types.js';

export interface WorkflowRunnerOptions extends WorkflowContextOptions, WorkflowExecutorOptions {
  runWholeWorkflowWithAgent?: boolean;
}

export class WorkflowRunner {
  private readonly executor: WorkflowExecutor;

  constructor(private readonly options: WorkflowRunnerOptions) {
    this.executor = new WorkflowExecutor(options);
  }

  async run(workflow: WorkflowDefinition, args: ParsedWorkflowArguments): Promise<WorkflowRunResult> {
    const context = new WorkflowContext(workflow, args, this.options);
    const startedAt = new Date().toISOString();
    const errors: string[] = [];
    context.status = 'running';

    for (let index = 0; index < workflow.steps.length; index++) {
      const step = workflow.steps[index]!;
      const repeat = getRepeatCount(step, context);
      for (let iteration = 0; iteration < repeat; iteration++) {
        context.set('stepIndex', index + 1);
        context.set('iteration', iteration + 1);
        const result = await this.executor.executeStep(step, context, context.results.length);
        context.results.push(withIteration(result, repeat, iteration));
        if (result.status === 'failed') errors.push(result.error ?? `Workflow step failed: ${result.id}`);
      }
    }

    if ((this.options.runWholeWorkflowWithAgent ?? true) && this.options.runAgentPrompt) {
      const prompt = renderWorkflowPrompt(workflow, args, this.options);
      const agentStep: WorkflowStep = {
        id: 'agent-run',
        name: 'Run workflow with Agent Loop',
        type: 'agent',
        prompt,
      };
      const result = await this.executor.executeStep(agentStep, context, context.results.length);
      context.results.push(result);
      if (result.status === 'failed') errors.push(result.error ?? 'Workflow agent execution failed.');
    }

    for (const verifyStep of workflow.verify) {
      const normalized = normalizeStep(verifyStep, context.results.length);
      const result = await this.executor.executeStep({
        ...normalized,
        id: normalized.id.startsWith('step-') ? `verify-${context.results.length + 1}` : normalized.id,
        name: `Verify: ${normalized.name}`,
        type: normalized.type === 'tool' ? 'tool' : 'prompt',
      }, context, context.results.length);
      context.results.push(result);
      if (result.status === 'failed') errors.push(result.error ?? `Workflow verification failed: ${result.id}`);
    }

    context.status = errors.length > 0 ? 'failed' : 'completed';
    return {
      workflowId: workflow.id,
      status: context.status,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps: context.results,
      variables: { ...context.variables },
      errors,
    };
  }
}

function withIteration(result: WorkflowStepResult, repeat: number, iteration: number): WorkflowStepResult {
  if (repeat <= 1) return result;
  return {
    ...result,
    id: `${result.id}-${iteration + 1}`,
    name: `${result.name} (${iteration + 1}/${repeat})`,
    metadata: { ...result.metadata, repeat, iteration: iteration + 1 },
  };
}
