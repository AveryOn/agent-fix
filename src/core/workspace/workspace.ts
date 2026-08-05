export interface WorkspaceSnapshot {
  readonly runId: string

  readonly repositoryPath: string
  readonly repositoryRoot: string
  readonly repositoryRelativePath: string

  readonly workspaceRoot: string
  readonly workspacePath: string

  readonly baseCommit: string
  readonly workspaceRevision: string
}

export interface CreateWorkspaceInput {
  readonly runId: string
  readonly repositoryPath: string
}

export interface WorkspaceManager {
  create(input: CreateWorkspaceInput): Promise<WorkspaceSnapshot>

  rollback(workspace: WorkspaceSnapshot): Promise<WorkspaceSnapshot>

  cleanup(workspace: WorkspaceSnapshot): Promise<void>
}

export interface RepositoryFile {
  readonly path: string
  readonly sizeBytes: number
}

export interface ReadRepositoryFileResult extends RepositoryFile {
  readonly content: string
}

export interface SearchCodeInput {
  readonly query: string
  readonly caseSensitive?: boolean
  readonly maxResults?: number
}

export interface CodeSearchMatch {
  readonly path: string
  readonly line: number
  readonly column: number
  readonly preview: string
}

export interface ApplyPatchResult {
  readonly changedFiles: readonly string[]
  readonly workspaceRevision: string
}

export interface RepositoryTools {
  listFiles(): Promise<readonly RepositoryFile[]>

  searchCode(input: SearchCodeInput): Promise<readonly CodeSearchMatch[]>

  readFile(relativePath: string): Promise<ReadRepositoryFileResult>

  applyPatch(patch: string): Promise<ApplyPatchResult>

  revertPatch(patch: string): Promise<void>

  getDiff(): Promise<string>

  getChangedFiles(): Promise<readonly string[]>

  getWorkspaceRevision(): Promise<string>
}

export interface RepositoryToolsFactory {
  create(workspace: WorkspaceSnapshot): RepositoryTools
}
