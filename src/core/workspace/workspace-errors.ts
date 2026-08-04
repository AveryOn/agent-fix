export enum WorkspaceErrorCode {
  invalid_repository = 'invalid_repository',
  invalid_path = 'invalid_path',
  forbidden_path = 'forbidden_path',
  file_not_found = 'file_not_found',
  symlink_not_allowed = 'symlink_not_allowed',
  binary_file = 'binary_file',
  file_too_large = 'file_too_large',
  invalid_patch = 'invalid_patch',
  git_command_failed = 'git_command_failed'
}

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode
  readonly path?: string

  constructor(
    message: string,
    code: WorkspaceErrorCode,
    options?: {
      readonly path?: string
      readonly cause?: unknown
    }
  ) {
    super(message, {
      cause: options?.cause
    })

    this.name = 'WorkspaceError'
    this.code = code

    if (options?.path !== undefined) {
      this.path = options.path
    }
  }
}
