import { resolve } from 'node:path';

import { PluginSandbox } from './PluginSandbox.js';
import type { PluginSandboxMetadata } from './types.js';

export function renderPluginVariables(value: string, sandbox: PluginSandboxMetadata | undefined, owner: string): string {
  if (!sandbox) return value;
  validatePluginRootReferences(value, sandbox, owner);
  return value
    .replace(/\$\{ROXY_PLUGIN_ROOT\}/g, sandbox.pluginRoot)
    .replace(/\$\{ROXY_PLUGIN_ID\}/g, sandbox.pluginId);
}

export function createPluginSandboxGuard(sandbox: PluginSandboxMetadata): PluginSandbox {
  return new PluginSandbox({
    pluginRoot: sandbox.pluginRoot,
    allowedPaths: sandbox.allowedPaths,
    allowNetworkAccess: sandbox.allowNetworkAccess,
    allowedHosts: sandbox.allowedHosts,
  });
}

export function validatePluginRootReferences(value: string, sandbox: PluginSandboxMetadata, owner: string): void {
  const guard = createPluginSandboxGuard(sandbox);
  for (const match of value.matchAll(/\$\{ROXY_PLUGIN_ROOT\}([^\s"'`<>{}|]*)/g)) {
    const referencedPath = resolvePluginRootReference(sandbox.pluginRoot, match[1] ?? '');
    const validation = guard.validatePath(referencedPath);
    if (!validation.allowed) {
      throw new Error(`Plugin ${owner} references a path outside its sandbox: ${match[0]}`);
    }
  }
}

function resolvePluginRootReference(pluginRoot: string, suffix: string): string {
  const trimmed = suffix.trim();
  if (!trimmed) return pluginRoot;
  const withoutLeadingSlash = trimmed.replace(/^[\\/]+/, '');
  return resolve(pluginRoot, withoutLeadingSlash);
}
