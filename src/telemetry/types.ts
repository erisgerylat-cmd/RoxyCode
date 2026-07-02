export type TelemetryEventCategory =
  | 'agent'
  | 'command'
  | 'hook'
  | 'llm'
  | 'permission'
  | 'runtime'
  | 'tool';

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | null
  | TelemetryAttributeValue[]
  | { [key: string]: TelemetryAttributeValue };

export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;

export interface TelemetryEvent {
  id: string;
  sequence: number;
  timestamp: string;
  name: string;
  category: TelemetryEventCategory;
  sessionId?: string;
  runtimeId?: string;
  durationMs?: number;
  success?: boolean;
  attributes?: TelemetryAttributes;
}

export interface TelemetryLoggerInit {
  cwd?: string;
  sessionId?: string;
  runtimeId?: string;
  enabled?: boolean;
  maxAttributeChars?: number;
}

export interface TelemetryLogInput {
  name: string;
  category: TelemetryEventCategory;
  durationMs?: number;
  success?: boolean;
  attributes?: Record<string, unknown>;
}

export interface TelemetrySpan {
  id: string;
  name: string;
  startedAt: number;
  end(input?: { success?: boolean; attributes?: Record<string, unknown> }): Promise<void>;
}

export interface TelemetrySnapshot {
  enabled: boolean;
  path: string;
  eventCount: number;
  droppedEvents: number;
  lastEvent?: {
    name: string;
    category: TelemetryEventCategory;
    timestamp: string;
    success?: boolean;
  };
  lastError?: string;
}
