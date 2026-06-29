export interface ProjectScripts {
  dev?: string;
  start?: string;
  build?: string;
  test?: string;
  lint?: string;
  format?: string;
  [name: string]: string | undefined;
}

export interface ProjectStructureSummary {
  kind: 'single-package' | 'monorepo' | 'multi-module' | 'unknown';
  sourceDirs: string[];
  testDirs: string[];
  configFiles: string[];
  aiInstructionFiles: string[];
}

export interface ProjectProfile {
  schemaVersion: 1;
  name: string;
  root: string;
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'maven' | 'gradle' | 'cargo' | 'go' | 'unknown';
  languages: string[];
  frameworks: string[];
  scripts: ProjectScripts;
  structure: ProjectStructureSummary;
  roxy: {
    instructionsFile: 'ROXY.md';
    generatedBy: 'RoxyCode /project init';
  };
  generatedAt: string;
}

export interface ProjectInitOptions {
  force?: boolean;
}

export interface ProjectInitResult {
  roxyPath: string;
  projectPath: string;
  roxyWritten: boolean;
  projectWritten: boolean;
  profile: ProjectProfile;
}
