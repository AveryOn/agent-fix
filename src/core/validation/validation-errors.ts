import type {
  MechanicalValidationReport,
  StoredValidationReportArtifact
} from '~/core/validation'

export enum ValidationErrorCode {
  invalid_input = 'invalid_input',
  agent_output_schema = 'agent_output_schema',
  invalid_reference = 'invalid_reference',
  invalid_patch_application = 'invalid_patch_application',
  reproduction_gate_failed = 'reproduction_gate_failed',
  process_check_failed = 'process_check_failed',
  changed_file_policy = 'changed_file_policy',
  report_save_failed = 'report_save_failed',
  validation_failed = 'validation_failed'
}

export interface ValidationErrorOptions {
  readonly cause?: unknown
}

export class ValidationError extends Error {
  readonly code: ValidationErrorCode

  constructor(
    message: string,
    code: ValidationErrorCode,
    options: ValidationErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'ValidationError'
    this.code = code
  }
}

export class ValidationGateError extends ValidationError {
  readonly report: MechanicalValidationReport

  readonly artifact: StoredValidationReportArtifact

  constructor(
    report: MechanicalValidationReport,
    artifact: StoredValidationReportArtifact
  ) {
    super(
      'Deterministic validation failed',
      ValidationErrorCode.validation_failed
    )

    this.name = 'ValidationGateError'
    this.report = report
    this.artifact = artifact
  }
}
