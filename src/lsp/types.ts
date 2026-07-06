export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  rootUri?: string;
  initializationOptions?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface LspServerCapabilities {
  textDocumentSync?: unknown;
  diagnosticProvider?: unknown;
  [key: string]: unknown;
}

export interface LspInitializeResult {
  capabilities: LspServerCapabilities;
  serverInfo?: {
    name: string;
    version?: string;
  };
}
