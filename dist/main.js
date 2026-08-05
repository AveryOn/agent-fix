import path14 from 'path';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import dotenv from 'dotenv';
import { parseArgs } from 'util';
import { createInterface } from 'readline/promises';
import { stat, access, readFile, mkdir, writeFile, rename, appendFile, lstat, realpath, mkdtemp, rm } from 'fs/promises';
import { execFile, spawn } from 'child_process';
import pino from 'pino';
import { performance } from 'perf_hooks';
import { tmpdir } from 'os';

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/app.ts
function createApp(dependencies) {
  let status = "created";
  return {
    async start() {
      if (status === "started") {
        return;
      }
      if (status === "stopped") {
        throw new Error("Application cannot be started after shutdown");
      }
      status = "started";
    },
    execute(argv) {
      if (status !== "started") {
        throw new Error(
          "Application must be started before command execution"
        );
      }
      return dependencies.cli.execute(argv);
    },
    async stop() {
      if (status === "stopped") {
        return;
      }
      status = "stopped";
    }
  };
}
__name(createApp, "createApp");

// src/core/execution/execution-errors.ts
var ExecutionError = class extends Error {
  static {
    __name(this, "ExecutionError");
  }
  code;
  kind;
  retryable;
  fatal;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    const kind = options.kind ?? (options.retryable === true ? "retryable" /* retryable */ : "non_retryable" /* non_retryable */);
    this.name = "ExecutionError";
    this.code = code;
    this.kind = kind;
    this.retryable = kind === "retryable" /* retryable */;
    this.fatal = kind === "fatal" /* fatal */;
  }
};
var AttemptsExhaustedError = class extends ExecutionError {
  static {
    __name(this, "AttemptsExhaustedError");
  }
  attempts;
  lastError;
  constructor(attempts, lastError) {
    super(
      `Maximum attempt limit reached after ${attempts} attempts`,
      "attempts_exhausted" /* attempts_exhausted */,
      {
        kind: "non_retryable" /* non_retryable */,
        cause: lastError
      }
    );
    this.name = "AttemptsExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
};
function getExecutionFailureKind(error) {
  if (isBooleanProperty(error, "fatal", true)) {
    return "fatal" /* fatal */;
  }
  if (isBooleanProperty(error, "retryable", true)) {
    return "retryable" /* retryable */;
  }
  return "non_retryable" /* non_retryable */;
}
__name(getExecutionFailureKind, "getExecutionFailureKind");
function isRetryableError(error) {
  return getExecutionFailureKind(error) === "retryable" /* retryable */;
}
__name(isRetryableError, "isRetryableError");
function isBooleanProperty(value, property, expected) {
  return typeof value === "object" && value !== null && property in value && value[property] === expected;
}
__name(isBooleanProperty, "isBooleanProperty");

// src/application/execution/implementation-retry.ts
var ImplementationRetryRecovery = class {
  constructor(workspaceManager, repositoryToolsFactory) {
    this.workspaceManager = workspaceManager;
    this.repositoryToolsFactory = repositoryToolsFactory;
  }
  workspaceManager;
  repositoryToolsFactory;
  static {
    __name(this, "ImplementationRetryRecovery");
  }
  async restoreReproductionWorkspace(workspace, reproduction) {
    let rolledBackWorkspace;
    try {
      rolledBackWorkspace = await this.workspaceManager.rollback(workspace);
    } catch (error) {
      throw new ExecutionError(
        "Failed to rollback implementation attempt",
        "rollback_failed" /* rollback_failed */,
        {
          kind: "fatal" /* fatal */,
          cause: error
        }
      );
    }
    const repositoryTools = this.repositoryToolsFactory.create(
      rolledBackWorkspace
    );
    try {
      const result = await repositoryTools.applyPatch(reproduction.patch);
      if (result.workspaceRevision !== reproduction.workspaceRevision) {
        throw new ExecutionError(
          "Reapplied reproduction patch produced another workspace revision",
          "stale_checkpoint" /* stale_checkpoint */,
          {
            kind: "fatal" /* fatal */
          }
        );
      }
      return {
        ...rolledBackWorkspace,
        workspaceRevision: result.workspaceRevision
      };
    } catch (error) {
      if (error instanceof ExecutionError) {
        throw error;
      }
      throw new ExecutionError(
        "Failed to restore reproduction patch after rollback",
        "rollback_failed" /* rollback_failed */,
        {
          kind: "fatal" /* fatal */,
          cause: error
        }
      );
    }
  }
};

// src/application/execution/retry-executor.ts
var RetryExecutor = class {
  constructor(maximumAttempts) {
    this.maximumAttempts = maximumAttempts;
    if (!Number.isInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new ExecutionError(
        "Maximum attempt limit must be a positive integer",
        "invalid_attempt_limit" /* invalid_attempt_limit */,
        {
          kind: "fatal" /* fatal */
        }
      );
    }
  }
  maximumAttempts;
  static {
    __name(this, "RetryExecutor");
  }
  async execute(input) {
    let validationFeedback = [];
    let lastError;
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      const context = {
        attempt,
        maximumAttempts: this.maximumAttempts,
        validationFeedback
      };
      try {
        return await input.operation(context);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error)) {
          throw error;
        }
        if (attempt >= this.maximumAttempts) {
          break;
        }
        const feedback = await input.onRetry?.(error, context);
        if (feedback !== void 0) {
          validationFeedback = [...validationFeedback, ...feedback];
        }
      }
    }
    throw new AttemptsExhaustedError(this.maximumAttempts, lastError);
  }
};
var StepExecutor = class {
  constructor(checkpointStore) {
    this.checkpointStore = checkpointStore;
  }
  checkpointStore;
  static {
    __name(this, "StepExecutor");
  }
  async execute(input) {
    const inputHash = hashValue(input.input);
    const executionId = createExecutionId(
      input.runId,
      input.step,
      input.attempt,
      inputHash
    );
    const checkpoint = await this.checkpointStore.load(
      input.runId,
      executionId
    );
    if (checkpoint !== null) {
      this.assertValidCheckpoint(
        checkpoint.inputHash,
        inputHash,
        checkpoint.outputHash,
        checkpoint.output
      );
      if (input.workspaceRevision !== void 0 && checkpoint.workspaceRevision !== null && input.workspaceRevision !== checkpoint.workspaceRevision) {
        throw new ExecutionError(
          `Checkpoint ${executionId} belongs to another workspace revision`,
          "stale_checkpoint" /* stale_checkpoint */,
          {
            kind: "non_retryable" /* non_retryable */
          }
        );
      }
      return {
        executionId,
        inputHash,
        outputHash: checkpoint.outputHash,
        resumed: true,
        output: checkpoint.output
      };
    }
    const output = await input.execute();
    const outputHash = hashValue(output);
    await this.checkpointStore.save({
      runId: input.runId,
      step: input.step,
      executionId,
      inputHash,
      outputHash,
      attempt: input.attempt,
      workspaceRevision: input.workspaceRevision ?? null,
      output
    });
    return {
      executionId,
      inputHash,
      outputHash,
      resumed: false,
      output
    };
  }
  assertValidCheckpoint(storedInputHash, expectedInputHash, storedOutputHash, output) {
    if (storedInputHash !== expectedInputHash) {
      throw new ExecutionError(
        "Checkpoint input hash does not match current step input",
        "checkpoint_input_mismatch" /* checkpoint_input_mismatch */,
        {
          kind: "fatal" /* fatal */
        }
      );
    }
    if (hashValue(output) !== storedOutputHash) {
      throw new ExecutionError(
        "Checkpoint output hash verification failed",
        "checkpoint_corrupted" /* checkpoint_corrupted */,
        {
          kind: "fatal" /* fatal */
        }
      );
    }
  }
};
function createExecutionId(runId, step, attempt, inputHash) {
  const digest = createHash("sha256").update(runId).update("\0").update(step).update("\0").update(String(attempt)).update("\0").update(inputHash).digest("hex").slice(0, 24);
  return `${step}-${digest}`;
}
__name(createExecutionId, "createExecutionId");
function hashValue(value) {
  return `sha256:${createHash("sha256").update(stableSerialize(value)).digest("hex")}`;
}
__name(hashValue, "hashValue");
function stableSerialize(value) {
  return JSON.stringify(normalizeValue(value));
}
__name(stableSerialize, "stableSerialize");
function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value;
  const result = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== void 0) {
      result[key] = normalizeValue(entry);
    }
  }
  return result;
}
__name(normalizeValue, "normalizeValue");

// src/core/context/agent-context.ts
var AgentRole = /* @__PURE__ */ ((AgentRole2) => {
  AgentRole2["investigator"] = "investigator";
  AgentRole2["reproducer"] = "reproducer";
  AgentRole2["implementer"] = "implementer";
  AgentRole2["reviewer"] = "reviewer";
  return AgentRole2;
})(AgentRole || {});

// src/core/context/context-budget.ts
var ApproximateTokenEstimator = class {
  static {
    __name(this, "ApproximateTokenEstimator");
  }
  estimate(value) {
    const serialized = JSON.stringify(value) ?? "";
    return Math.ceil(serialized.length / 4);
  }
};

// src/core/context/context-errors.ts
var ContextBudgetExceededError = class extends Error {
  static {
    __name(this, "ContextBudgetExceededError");
  }
  agent;
  estimatedTokens;
  tokenBudget;
  constructor(agent, estimatedTokens, tokenBudget) {
    super(
      `Context budget exceeded for ${agent}: ${estimatedTokens} tokens estimated, ${tokenBudget} allowed`
    );
    this.name = "ContextBudgetExceededError";
    this.agent = agent;
    this.estimatedTokens = estimatedTokens;
    this.tokenBudget = tokenBudget;
  }
};
var StaleWorkspaceContextError = class extends Error {
  static {
    __name(this, "StaleWorkspaceContextError");
  }
  referenceId;
  expectedRevision;
  actualRevision;
  constructor(referenceId, expectedRevision, actualRevision) {
    super(
      `Context reference ${referenceId} belongs to workspace ${actualRevision}, expected ${expectedRevision}`
    );
    this.name = "StaleWorkspaceContextError";
    this.referenceId = referenceId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
};
var StaleAgentResultError = class extends Error {
  static {
    __name(this, "StaleAgentResultError");
  }
  expectedRevision;
  actualRevision;
  constructor(expectedRevision, actualRevision) {
    super(
      `Agent result belongs to workspace ${actualRevision}, expected ${expectedRevision}`
    );
    this.name = "StaleAgentResultError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
};

// src/core/context/context-policy.ts
var policies = {
  ["investigator" /* investigator */]: {
    allowedArtifactTypes: /* @__PURE__ */ new Set(["repository.snapshot" /* repository_snapshot */]),
    includeEvidence: false,
    requireConfirmedEvidence: false,
    allowRepositoryTools: true,
    taskVisibility: "original" /* original */
  },
  ["reproducer" /* reproducer */]: {
    allowedArtifactTypes: /* @__PURE__ */ new Set([
      "investigation.result" /* investigation_result */,
      "investigation.evidence" /* investigation_evidence */,
      "test.structure" /* test_structure */
    ]),
    includeEvidence: true,
    requireConfirmedEvidence: true,
    allowRepositoryTools: false,
    taskVisibility: "original" /* original */
  },
  ["implementer" /* implementer */]: {
    allowedArtifactTypes: /* @__PURE__ */ new Set([
      "investigation.evidence" /* investigation_evidence */,
      "reproduction.test" /* reproduction_test */,
      "implementation.allowed-file-scope" /* allowed_file_scope */
    ]),
    includeEvidence: true,
    requireConfirmedEvidence: true,
    allowRepositoryTools: false,
    taskVisibility: "derived" /* derived */,
    derivedTask: "Implement the confirmed reproduction failure within the allowed file scope."
  },
  ["reviewer" /* reviewer */]: {
    allowedArtifactTypes: /* @__PURE__ */ new Set([
      "review.final-diff" /* final_diff */,
      "review.validation-report" /* validation_report */,
      "review.changed-files" /* changed_files */
    ]),
    includeEvidence: false,
    requireConfirmedEvidence: false,
    allowRepositoryTools: false,
    taskVisibility: "derived" /* derived */,
    derivedTask: "Review the final diff using the validation report and changed file list."
  }
};
function getAgentVisibilityPolicy(agent) {
  return policies[agent];
}
__name(getAgentVisibilityPolicy, "getAgentVisibilityPolicy");

// src/core/context/agent-context-manager.ts
var AgentContextManager = class {
  static {
    __name(this, "AgentContextManager");
  }
  tokenBudget;
  tokenEstimator;
  now;
  constructor(options) {
    if (!Number.isInteger(options.tokenBudget) || options.tokenBudget <= 0) {
      throw new Error("Context token budget must be a positive integer");
    }
    this.tokenBudget = options.tokenBudget;
    this.tokenEstimator = options.tokenEstimator ?? new ApproximateTokenEstimator();
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
  }
  createSnapshot(input) {
    assertNonEmpty(input.runId, "runId");
    assertNonEmpty(input.workspaceRevision, "workspaceRevision");
    const policy = getAgentVisibilityPolicy(input.agent);
    const artifacts = this.selectArtifacts(input, policy);
    const evidence = this.selectEvidence(input, policy);
    this.assertFreshReferences(
      input.workspaceRevision,
      artifacts,
      evidence
    );
    let context = this.buildContext(input, policy, artifacts, evidence);
    let estimatedTokens = this.tokenEstimator.estimate(context);
    if (estimatedTokens > this.tokenBudget && input.investigation !== void 0 && canSummarizeInvestigation(input.agent)) {
      context = this.buildSummarizedContext(
        input,
        policy,
        artifacts,
        evidence,
        input.investigation
      );
      estimatedTokens = this.tokenEstimator.estimate(context);
    }
    if (estimatedTokens > this.tokenBudget) {
      throw new ContextBudgetExceededError(
        input.agent,
        estimatedTokens,
        this.tokenBudget
      );
    }
    return {
      agent: input.agent,
      createdAt: this.now().toISOString(),
      estimatedTokens,
      context
    };
  }
  assertFreshResult(snapshot, result) {
    const expectedRevision = snapshot.context.workspaceRevision;
    if (result.workspaceRevision !== expectedRevision) {
      throw new StaleAgentResultError(
        expectedRevision,
        result.workspaceRevision
      );
    }
  }
  selectArtifacts(input, policy) {
    return input.artifacts.filter(
      (artifact) => policy.allowedArtifactTypes.has(artifact.type)
    );
  }
  selectEvidence(input, policy) {
    if (!policy.includeEvidence) {
      return [];
    }
    if (!policy.requireConfirmedEvidence) {
      return [...input.evidence];
    }
    return input.evidence.filter((evidence) => evidence.confirmed);
  }
  assertFreshReferences(expectedRevision, artifacts, evidence) {
    for (const artifact of artifacts) {
      if (artifact.workspaceRevision !== expectedRevision) {
        throw new StaleWorkspaceContextError(
          artifact.id,
          expectedRevision,
          artifact.workspaceRevision
        );
      }
    }
    for (const reference of evidence) {
      if (reference.workspaceRevision !== expectedRevision) {
        throw new StaleWorkspaceContextError(
          reference.id,
          expectedRevision,
          reference.workspaceRevision
        );
      }
    }
  }
  buildContext(input, policy, artifacts, evidence) {
    return {
      runId: input.runId,
      task: resolveTask(input.task, policy),
      workspaceRevision: input.workspaceRevision,
      artifactIds: uniqueStrings(artifacts.map((artifact) => artifact.id)),
      evidence,
      constraints: uniqueStrings(input.constraints)
    };
  }
  buildSummarizedContext(input, policy, artifacts, evidence, investigation) {
    const compactEvidence = evidence.slice(0, 20).map(compactEvidenceReference);
    const summary = createInvestigationSummary(
      investigation,
      compactEvidence
    );
    return {
      runId: input.runId,
      task: resolveTask(input.task, policy),
      workspaceRevision: input.workspaceRevision,
      artifactIds: uniqueStrings(artifacts.map((artifact) => artifact.id)),
      evidence: compactEvidence,
      constraints: uniqueStrings(input.constraints),
      summary
    };
  }
};
function resolveTask(originalTask, policy) {
  if (policy.taskVisibility === "original" /* original */) {
    return originalTask;
  }
  return policy.derivedTask ?? "Complete the assigned pipeline step.";
}
__name(resolveTask, "resolveTask");
function canSummarizeInvestigation(agent) {
  return agent === "reproducer" /* reproducer */ || agent === "implementer" /* implementer */;
}
__name(canSummarizeInvestigation, "canSummarizeInvestigation");
function compactEvidenceReference(evidence) {
  return {
    ...evidence,
    claim: limitText(evidence.claim, 160)
  };
}
__name(compactEvidenceReference, "compactEvidenceReference");
function createInvestigationSummary(investigation, evidence) {
  const parts = [
    `Hypothesis: ${limitText(investigation.hypothesis, 600)}`
  ];
  const relatedFiles = uniqueStrings(investigation.relatedFiles).slice(
    0,
    20
  );
  if (relatedFiles.length > 0) {
    parts.push(`Related files: ${relatedFiles.join(", ")}`);
  }
  if (evidence.length > 0) {
    const locations = evidence.map(formatEvidenceLocation);
    parts.push(`Confirmed evidence: ${locations.join("; ")}`);
  }
  return parts.join("\n");
}
__name(createInvestigationSummary, "createInvestigationSummary");
function formatEvidenceLocation(evidence) {
  const lineRange = evidence.lineStart === void 0 ? "" : evidence.lineEnd === void 0 ? `:${evidence.lineStart}` : `:${evidence.lineStart}-${evidence.lineEnd}`;
  const symbol = evidence.symbol === void 0 ? "" : `#${evidence.symbol}`;
  return `${evidence.filePath}${lineRange}${symbol}`;
}
__name(formatEvidenceLocation, "formatEvidenceLocation");
function limitText(value, maximumLength) {
  if (value.length <= maximumLength) {
    return value;
  }
  return `${value.slice(0, maximumLength - 1)}\u2026`;
}
__name(limitText, "limitText");
function uniqueStrings(values) {
  return [...new Set(values)];
}
__name(uniqueStrings, "uniqueStrings");
function assertNonEmpty(value, fieldName) {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}
__name(assertNonEmpty, "assertNonEmpty");

// src/core/implementation/implementation.ts
var repositoryRelativePathSchema = z.string().trim().min(1).max(500).refine(isRepositoryRelativePath, {
  message: "Path must be repository-relative"
});
var confirmedEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  artifactId: z.string().trim().min(1).max(200),
  filePath: repositoryRelativePathSchema,
  claim: z.string().trim().min(1).max(2e3),
  confirmed: z.literal(true),
  workspaceRevision: z.string().trim().min(1),
  symbol: z.string().trim().min(1).max(200),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive()
}).strict().superRefine((evidence, context) => {
  if (evidence.lineEnd < evidence.lineStart) {
    context.addIssue({
      code: "custom",
      path: ["lineEnd"],
      message: "lineEnd must be greater than or equal to lineStart"
    });
  }
});
var allowedFileScopeSchema = z.object({
  files: z.array(repositoryRelativePathSchema).min(1).max(100),
  workspaceRevision: z.string().trim().min(1)
}).strict().superRefine((scope, context) => {
  const uniqueFiles = new Set(scope.files);
  if (uniqueFiles.size !== scope.files.length) {
    context.addIssue({
      code: "custom",
      path: ["files"],
      message: "Allowed file scope contains duplicate paths"
    });
  }
});
var failingCommandResultSchema = z.object({
  executionId: z.string().trim().min(1),
  exitCode: z.number().int().refine((value) => value !== 0, {
    message: "Failing reproduction command must have a non-zero exit code"
  }),
  timedOut: z.literal(false),
  succeeded: z.literal(false),
  stdout: z.string().max(5e5),
  stderr: z.string().max(5e5)
}).strict();
var reproductionFailureSnapshotSchema = z.object({
  testFiles: z.array(repositoryRelativePathSchema).min(1).max(20),
  expectedFailureMarker: z.string().trim().min(1).max(400),
  workspaceRevision: z.string().trim().min(1),
  commandResult: failingCommandResultSchema
}).strict().superRefine((reproduction, context) => {
  const commandOutput = `${reproduction.commandResult.stdout}
` + reproduction.commandResult.stderr;
  if (!commandOutput.includes(reproduction.expectedFailureMarker)) {
    context.addIssue({
      code: "custom",
      path: ["commandResult"],
      message: "Failing command output does not contain the expected marker"
    });
  }
  const uniqueTestFiles = new Set(reproduction.testFiles);
  if (uniqueTestFiles.size !== reproduction.testFiles.length) {
    context.addIssue({
      code: "custom",
      path: ["testFiles"],
      message: "Reproduction snapshot contains duplicate test files"
    });
  }
});
var implementerContextSnapshotSchema = z.object({
  agent: z.literal("implementer" /* implementer */),
  createdAt: z.string().trim().min(1),
  estimatedTokens: z.number().int().nonnegative(),
  context: z.object({
    runId: z.string().trim().min(1),
    task: z.string().trim().min(1),
    workspaceRevision: z.string().trim().min(1),
    artifactIds: z.array(z.string().trim().min(1)),
    evidence: z.array(z.unknown()),
    constraints: z.array(z.string()),
    summary: z.string().optional()
  }).strict()
}).strict();
var workspaceSnapshotSchema = z.object({
  runId: z.string().trim().min(1),
  repositoryPath: z.string().trim().min(1),
  repositoryRoot: z.string().trim().min(1),
  repositoryRelativePath: z.string(),
  workspaceRoot: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  baseCommit: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1)
}).strict();
var implementationInputSchema = z.object({
  context: implementerContextSnapshotSchema,
  evidence: z.array(confirmedEvidenceSchema).min(1).max(50),
  reproduction: reproductionFailureSnapshotSchema,
  allowedFileScope: allowedFileScopeSchema,
  workspace: workspaceSnapshotSchema
}).strict().superRefine((input, context) => {
  const expectedRevision = input.context.context.workspaceRevision;
  if (input.context.context.runId !== input.workspace.runId) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "runId"],
      message: "Context and workspace run identifiers do not match"
    });
  }
  if (input.workspace.workspaceRevision !== expectedRevision) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "workspaceRevision"],
      message: "Context and workspace revisions do not match"
    });
  }
  if (input.reproduction.workspaceRevision !== expectedRevision) {
    context.addIssue({
      code: "custom",
      path: ["reproduction", "workspaceRevision"],
      message: "Reproduction and context revisions do not match"
    });
  }
  if (input.allowedFileScope.workspaceRevision !== expectedRevision) {
    context.addIssue({
      code: "custom",
      path: ["allowedFileScope", "workspaceRevision"],
      message: "Allowed file scope and context revisions do not match"
    });
  }
  for (const evidence of input.evidence) {
    if (evidence.workspaceRevision !== expectedRevision) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: `Evidence ${evidence.id} belongs to a stale workspace`
      });
    }
  }
  const reproductionTestFiles = new Set(input.reproduction.testFiles);
  for (const filePath of input.allowedFileScope.files) {
    if (reproductionTestFiles.has(filePath)) {
      context.addIssue({
        code: "custom",
        path: ["allowedFileScope", "files"],
        message: `Reproduction test ${filePath} must not be included in the implementation scope`
      });
    }
  }
});
var implementationPlanSchema = z.object({
  summary: z.string().trim().min(1).max(2e3),
  patch: z.string().trim().min(1).max(5e5),
  changedFiles: z.array(repositoryRelativePathSchema).min(1).max(100),
  risks: z.array(z.string().trim().min(1).max(1e3)).max(20),
  workspaceRevision: z.string().trim().min(1)
}).strict().superRefine((plan, context) => {
  const uniqueFiles = new Set(plan.changedFiles);
  if (uniqueFiles.size !== plan.changedFiles.length) {
    context.addIssue({
      code: "custom",
      path: ["changedFiles"],
      message: "Implementation output contains duplicate changed files"
    });
  }
});
function isRepositoryRelativePath(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isRepositoryRelativePath, "isRepositoryRelativePath");

// src/core/implementation/implementer-errors.ts
var ImplementerError = class extends Error {
  static {
    __name(this, "ImplementerError");
  }
  code;
  retryable;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "ImplementerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
};

// src/core/process/process-runner-errors.ts
var ProcessRunnerError = class extends Error {
  static {
    __name(this, "ProcessRunnerError");
  }
  code;
  operation;
  constructor(message, code, options) {
    super(message, {
      cause: options?.cause
    });
    this.name = "ProcessRunnerError";
    this.code = code;
    if (options?.operation !== void 0) {
      this.operation = options.operation;
    }
  }
};

// src/application/implementer/implementation-gate.ts
var ImplementationGate = class {
  static {
    __name(this, "ImplementationGate");
  }
  assertReproductionFixed(commandResult, expectedFailureMarker) {
    if (commandResult.operation !== "runTests" /* run_tests */) {
      throw new ImplementerError(
        "Implementation gate received a non-test command result",
        "test_execution_failed" /* test_execution_failed */
      );
    }
    if (commandResult.timedOut) {
      throw new ImplementerError(
        "Post-implementation test run timed out",
        "test_execution_failed" /* test_execution_failed */,
        {
          retryable: true
        }
      );
    }
    if (!commandResult.succeeded || commandResult.exitCode !== 0) {
      throw new ImplementerError(
        "Reproduction test still fails after implementation",
        "reproduction_test_failed" /* reproduction_test_failed */,
        {
          retryable: true
        }
      );
    }
    const output = normalizeOutput(
      `${commandResult.stdout}
${commandResult.stderr}`
    );
    if (output.includes(expectedFailureMarker)) {
      throw new ImplementerError(
        "Successful test output still contains the reproduction marker",
        "reproduction_test_failed" /* reproduction_test_failed */,
        {
          retryable: true
        }
      );
    }
  }
};
function normalizeOutput(output) {
  return output.replaceAll(
    // eslint-disable-next-line no-control-regex
    /\u001B\[[0-?]*[ -/]*[@-~]/g,
    ""
  ).replaceAll("\r\n", "\n");
}
__name(normalizeOutput, "normalizeOutput");

// src/application/implementer/implementation-patch-validator.ts
var diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/gm;
var forbiddenPatchMarkers = [
  "GIT binary patch",
  "Binary files ",
  "rename from ",
  "rename to ",
  "deleted file mode "
];
var ImplementationPatchValidator = class {
  static {
    __name(this, "ImplementationPatchValidator");
  }
  validate(plan, allowedFileScope, reproduction, expectedWorkspaceRevision) {
    if (plan.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ImplementerError(
        "Implementation patch was produced from a stale workspace",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
    if (allowedFileScope.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ImplementerError(
        "Allowed file scope belongs to a stale workspace",
        "stale_workspace" /* stale_workspace */
      );
    }
    for (const marker of forbiddenPatchMarkers) {
      if (plan.patch.includes(marker)) {
        throw new ImplementerError(
          `Implementation patch contains forbidden marker: ${marker}`,
          "invalid_patch" /* invalid_patch */,
          {
            retryable: true
          }
        );
      }
    }
    const patchFiles = extractChangedFiles(plan.patch);
    if (patchFiles.length === 0) {
      throw new ImplementerError(
        "Implementation patch does not contain changed files",
        "invalid_patch" /* invalid_patch */,
        {
          retryable: true
        }
      );
    }
    assertSameFiles(patchFiles, plan.changedFiles);
    const allowedFiles = new Set(allowedFileScope.files);
    const reproductionTestFiles = new Set(reproduction.testFiles);
    for (const filePath of patchFiles) {
      if (!isSafeRelativePath(filePath)) {
        throw new ImplementerError(
          `Implementation patch contains unsafe path: ${filePath}`,
          "invalid_patch" /* invalid_patch */
        );
      }
      if (reproductionTestFiles.has(filePath)) {
        throw new ImplementerError(
          `Implementation patch modifies reproduction test: ${filePath}`,
          "reproduction_test_modified" /* reproduction_test_modified */
        );
      }
      if (!allowedFiles.has(filePath)) {
        throw new ImplementerError(
          `Implementation patch changes file outside allowed scope: ` + filePath,
          "forbidden_file_change" /* forbidden_file_change */
        );
      }
    }
    return patchFiles;
  }
};
function extractChangedFiles(patch) {
  const files = [];
  let match;
  diffHeaderPattern.lastIndex = 0;
  while ((match = diffHeaderPattern.exec(patch)) !== null) {
    const sourcePath = match[1];
    const targetPath = match[2];
    if (sourcePath === void 0 || targetPath === void 0 || sourcePath !== targetPath) {
      throw new ImplementerError(
        "Implementation patch contains a rename or invalid diff header",
        "invalid_patch" /* invalid_patch */
      );
    }
    if (!files.includes(targetPath)) {
      files.push(targetPath);
    }
  }
  return files;
}
__name(extractChangedFiles, "extractChangedFiles");
function assertSameFiles(patchFiles, declaredFiles) {
  const normalizedPatchFiles = [...patchFiles].sort();
  const normalizedDeclaredFiles = [...declaredFiles].sort();
  if (normalizedPatchFiles.length !== normalizedDeclaredFiles.length) {
    throw new ImplementerError(
      "Declared changed files do not match implementation patch",
      "changed_files_mismatch" /* changed_files_mismatch */,
      {
        retryable: true
      }
    );
  }
  for (let index = 0; index < normalizedPatchFiles.length; index += 1) {
    if (normalizedPatchFiles[index] !== normalizedDeclaredFiles[index]) {
      throw new ImplementerError(
        "Declared changed files do not match implementation patch",
        "changed_files_mismatch" /* changed_files_mismatch */,
        {
          retryable: true
        }
      );
    }
  }
}
__name(assertSameFiles, "assertSameFiles");
function isSafeRelativePath(filePath) {
  if (filePath.startsWith("/") || filePath.startsWith("\\") || filePath.includes("\\") || /^[a-zA-Z]:/.test(filePath)) {
    return false;
  }
  return filePath.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isSafeRelativePath, "isSafeRelativePath");

// src/core/trace/trace-recorder.ts
var TraceRecorder = class {
  constructor(writer, now = () => /* @__PURE__ */ new Date()) {
    this.writer = writer;
    this.now = now;
  }
  writer;
  now;
  static {
    __name(this, "TraceRecorder");
  }
  usageByRun = /* @__PURE__ */ new Map();
  record(event) {
    this.recordUsage(event);
    return this.writer.write({
      timestamp: this.now().toISOString(),
      ...event
    });
  }
  getUsageSummary(runId) {
    const usage = this.usageByRun.get(runId);
    if (usage === void 0) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null
      };
    }
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.hasEstimatedCost ? usage.estimatedCostUsd : null
    };
  }
  flush() {
    return this.writer.flush();
  }
  recordUsage(event) {
    if (event.tokenUsage === void 0 && event.estimatedCostUsd === void 0) {
      return;
    }
    const usage = this.usageByRun.get(event.runId) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      hasEstimatedCost: false
    };
    if (event.tokenUsage !== void 0) {
      usage.inputTokens += event.tokenUsage.inputTokens;
      usage.outputTokens += event.tokenUsage.outputTokens;
      usage.totalTokens += event.tokenUsage.totalTokens;
    }
    if (event.estimatedCostUsd !== void 0) {
      usage.estimatedCostUsd += event.estimatedCostUsd;
      usage.hasEstimatedCost = true;
    }
    this.usageByRun.set(event.runId, usage);
  }
};

// src/application/implementer/implementer-agent.ts
var implementerStep = "implementer";
var ModelImplementerAgent = class {
  constructor(modelProvider, promptRegistry, repositoryToolsFactory, processRunnerFactory, artifactStore, traceRecorder, logger, patchValidator = new ImplementationPatchValidator(), implementationGate = new ImplementationGate()) {
    this.modelProvider = modelProvider;
    this.promptRegistry = promptRegistry;
    this.repositoryToolsFactory = repositoryToolsFactory;
    this.processRunnerFactory = processRunnerFactory;
    this.artifactStore = artifactStore;
    this.traceRecorder = traceRecorder;
    this.logger = logger;
    this.patchValidator = patchValidator;
    this.implementationGate = implementationGate;
  }
  modelProvider;
  promptRegistry;
  repositoryToolsFactory;
  processRunnerFactory;
  artifactStore;
  traceRecorder;
  logger;
  patchValidator;
  implementationGate;
  static {
    __name(this, "ModelImplementerAgent");
  }
  async execute(input) {
    this.assertValidInput(input);
    const sourceWorkspaceRevision = input.context.context.workspaceRevision;
    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: "implementer" /* implementer */,
      workspaceRevision: sourceWorkspaceRevision
    });
    let promptVersion;
    try {
      const prompt = await this.promptRegistry.load("implementer" /* implementer */);
      promptVersion = prompt.id;
      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      );
      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      );
      const modelResult = await this.modelProvider.generate({
        input: [
          {
            type: "message",
            role: "system",
            content: prompt.content
          },
          {
            type: "message",
            role: "user",
            content: JSON.stringify({
              context: {
                runId: input.context.context.runId,
                task: input.context.context.task,
                workspaceRevision: sourceWorkspaceRevision,
                constraints: input.context.context.constraints
              },
              confirmedEvidence: input.evidence,
              failingTest: {
                testFiles: input.reproduction.testFiles,
                expectedFailureMarker: input.reproduction.expectedFailureMarker,
                workspaceRevision: input.reproduction.workspaceRevision,
                commandResult: input.reproduction.commandResult
              },
              allowedFileScope: input.allowedFileScope
            })
          }
        ],
        outputSchemaName: "implementation_plan",
        outputSchema: implementationPlanSchema
      });
      await this.recordModelCall(input, prompt.id, modelResult);
      if (modelResult.toolCalls.length > 0) {
        throw new ImplementerError(
          "Implementer returned an unexpected tool call",
          "unexpected_tool_call" /* unexpected_tool_call */
        );
      }
      if (modelResult.output === void 0) {
        throw new ImplementerError(
          "Implementer returned no structured output",
          "missing_output" /* missing_output */,
          {
            retryable: true
          }
        );
      }
      const plan = this.parsePlan(modelResult.output);
      const expectedChangedFiles = this.patchValidator.validate(
        plan,
        input.allowedFileScope,
        input.reproduction,
        sourceWorkspaceRevision
      );
      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      );
      const applyResult = await this.applyPatch(
        input,
        prompt.id,
        repositoryTools,
        plan
      );
      assertChangedFilesMatch(
        expectedChangedFiles,
        applyResult.changedFiles
      );
      assertReproductionTestsUnchanged(
        applyResult.changedFiles,
        input.reproduction.testFiles
      );
      const patchedWorkspace = {
        ...input.workspace,
        workspaceRevision: applyResult.workspaceRevision
      };
      const processRunner = this.processRunnerFactory.create(patchedWorkspace);
      const commandResult = await this.runTests(
        input,
        prompt.id,
        processRunner.runTests.bind(processRunner),
        applyResult.workspaceRevision
      );
      this.implementationGate.assertReproductionFixed(
        commandResult,
        input.reproduction.expectedFailureMarker
      );
      const artifacts = await this.artifactStore.save({
        runId: input.context.context.runId,
        plan,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        reproduction: input.reproduction,
        commandResult
      });
      const result = {
        summary: plan.summary,
        patch: plan.patch,
        changedFiles: plan.changedFiles,
        risks: plan.risks,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        commandResult,
        artifacts
      };
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: implementerStep,
        agent: "implementer" /* implementer */,
        workspaceRevision: result.workspaceRevision,
        type: "agent.result" /* agent_result */,
        promptVersion: prompt.id,
        output: {
          summary: result.summary,
          changedFiles: result.changedFiles,
          risks: result.risks,
          implementationArtifact: result.artifacts.implementation,
          patchArtifact: result.artifacts.patch,
          commandArtifact: result.artifacts.command
        }
      });
      logger.info("Implementation completed", {
        changedFiles: result.changedFiles,
        commandExecutionId: commandResult.executionId
      });
      return result;
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger);
      logger.error("Implementation failed", {
        error
      });
      throw error;
    }
  }
  assertValidInput(input) {
    const result = implementationInputSchema.safeParse(input);
    if (!result.success) {
      throw new ImplementerError(
        "Implementation input failed schema validation: " + z.prettifyError(result.error),
        "invalid_input" /* invalid_input */,
        {
          cause: result.error
        }
      );
    }
  }
  parsePlan(value) {
    const result = implementationPlanSchema.safeParse(value);
    if (!result.success) {
      throw new ImplementerError(
        "Implementation output failed schema validation: " + z.prettifyError(result.error),
        "invalid_output" /* invalid_output */,
        {
          retryable: true,
          cause: result.error
        }
      );
    }
    return result.data;
  }
  async assertFreshWorkspace(repositoryTools, expectedRevision) {
    const currentRevision = await repositoryTools.getWorkspaceRevision();
    if (currentRevision !== expectedRevision) {
      throw new ImplementerError(
        "Implementer context contains a stale workspace revision",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
  }
  async applyPatch(input, promptVersion, repositoryTools, plan) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: "implementer" /* implementer */,
      workspaceRevision: input.workspace.workspaceRevision,
      type: "tool.call" /* tool_call */,
      promptVersion,
      input: {
        name: "applyImplementationPatch",
        changedFiles: plan.changedFiles
      }
    });
    try {
      const result = await repositoryTools.applyPatch(plan.patch);
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: implementerStep,
        agent: "implementer" /* implementer */,
        workspaceRevision: result.workspaceRevision,
        type: "tool.result" /* tool_result */,
        promptVersion,
        output: {
          name: "applyImplementationPatch",
          changedFiles: result.changedFiles,
          workspaceRevision: result.workspaceRevision
        }
      });
      return result;
    } catch (error) {
      throw new ImplementerError(
        "Failed to apply implementation patch",
        "patch_application_failed" /* patch_application_failed */,
        {
          retryable: true,
          cause: error
        }
      );
    }
  }
  async runTests(input, promptVersion, runTests, workspaceRevision) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: "implementer" /* implementer */,
      workspaceRevision,
      type: "tool.call" /* tool_call */,
      promptVersion,
      input: {
        name: "runTests"
      }
    });
    const result = await runTests();
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: "implementer" /* implementer */,
      workspaceRevision,
      type: "tool.result" /* tool_result */,
      promptVersion,
      durationMs: result.durationMs,
      output: {
        name: "runTests",
        executionId: result.executionId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        succeeded: result.succeeded,
        artifact: result.artifact
      }
    });
    return result;
  }
  recordModelCall(input, promptVersion, result) {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: implementerStep,
      agent: "implementer" /* implementer */,
      workspaceRevision: input.workspace.workspaceRevision,
      type: "agent.call" /* agent_call */,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      output: {
        returnedStructuredOutput: result.output !== void 0,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    });
  }
  async recordFailure(input, promptVersion, error, logger) {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: implementerStep,
        agent: "implementer" /* implementer */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "failure" /* failure */,
        error: toTraceError(error),
        ...promptVersion === void 0 ? {} : {
          promptVersion
        }
      });
    } catch (traceError) {
      logger.warn("Failed to record implementer failure", {
        traceError
      });
    }
  }
};
function assertChangedFilesMatch(expectedFiles, actualFiles) {
  const expected = [...expectedFiles].sort();
  const actual = [...actualFiles].sort();
  if (expected.length !== actual.length) {
    throw new ImplementerError(
      "Applied implementation patch changed unexpected files",
      "changed_files_mismatch" /* changed_files_mismatch */
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new ImplementerError(
        "Applied implementation patch changed unexpected files",
        "changed_files_mismatch" /* changed_files_mismatch */
      );
    }
  }
}
__name(assertChangedFilesMatch, "assertChangedFilesMatch");
function assertReproductionTestsUnchanged(changedFiles, reproductionTestFiles) {
  const testFiles = new Set(reproductionTestFiles);
  const changedTest = changedFiles.find(
    (filePath) => testFiles.has(filePath)
  );
  if (changedTest !== void 0) {
    throw new ImplementerError(
      `Implementation modified reproduction test: ${changedTest}`,
      "reproduction_test_modified" /* reproduction_test_modified */
    );
  }
}
__name(assertReproductionTestsUnchanged, "assertReproductionTestsUnchanged");
function toTraceError(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown implementer failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError, "toTraceError");
var investigationEvidenceArtifactId = "investigation-evidence";
var repositoryRelativePathSchema2 = z.string().trim().min(1).max(500).refine(isRepositoryRelativePath2, {
  message: "Path must be repository-relative"
});
var investigationEvidenceReferenceSchema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  artifactId: z.literal(investigationEvidenceArtifactId),
  filePath: repositoryRelativePathSchema2,
  claim: z.string().trim().min(1).max(2e3),
  confirmed: z.literal(true),
  workspaceRevision: z.string().trim().min(1),
  symbol: z.string().trim().min(1).max(200).regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive()
}).strict().superRefine((evidence, context) => {
  if (evidence.lineEnd < evidence.lineStart) {
    context.addIssue({
      code: "custom",
      path: ["lineEnd"],
      message: "lineEnd must be greater than or equal to lineStart"
    });
  }
});
var investigationResultSchema = z.object({
  hypothesis: z.string().trim().min(1).max(4e3),
  evidence: z.array(investigationEvidenceReferenceSchema).min(1).max(50),
  relatedFiles: z.array(repositoryRelativePathSchema2).min(1).max(100),
  workspaceRevision: z.string().trim().min(1)
}).strict().superRefine((result, context) => {
  const evidenceIds = /* @__PURE__ */ new Set();
  const relatedFiles = /* @__PURE__ */ new Set();
  for (const filePath of result.relatedFiles) {
    if (relatedFiles.has(filePath)) {
      context.addIssue({
        code: "custom",
        path: ["relatedFiles"],
        message: `Duplicate related file: ${filePath}`
      });
    }
    relatedFiles.add(filePath);
  }
  for (const evidence of result.evidence) {
    if (evidenceIds.has(evidence.id)) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: `Duplicate evidence identifier: ${evidence.id}`
      });
    }
    evidenceIds.add(evidence.id);
    if (!relatedFiles.has(evidence.filePath)) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: `Evidence file ${evidence.filePath} is not included in relatedFiles`
      });
    }
  }
});
var investigatorContextSnapshotSchema = z.object({
  agent: z.literal("investigator" /* investigator */),
  createdAt: z.string().min(1),
  estimatedTokens: z.number().int().nonnegative(),
  context: z.object({
    runId: z.string().trim().min(1),
    task: z.string().trim().min(1),
    workspaceRevision: z.string().trim().min(1),
    artifactIds: z.array(z.string().trim().min(1)),
    evidence: z.array(z.unknown()).max(0),
    constraints: z.array(z.string()),
    summary: z.string().optional()
  }).strict()
}).strict();
var workspaceSnapshotSchema2 = z.object({
  runId: z.string().trim().min(1),
  repositoryPath: z.string().trim().min(1),
  repositoryRoot: z.string().trim().min(1),
  repositoryRelativePath: z.string(),
  workspaceRoot: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  baseCommit: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1)
}).strict();
var investigationInputSchema = z.object({
  context: investigatorContextSnapshotSchema,
  workspace: workspaceSnapshotSchema2
}).strict().superRefine((input, context) => {
  if (input.context.context.runId !== input.workspace.runId) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "runId"],
      message: "Context and workspace run identifiers do not match"
    });
  }
  if (input.context.context.workspaceRevision !== input.workspace.workspaceRevision) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "workspaceRevision"],
      message: "Context and workspace revisions do not match"
    });
  }
});
function isRepositoryRelativePath2(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isRepositoryRelativePath2, "isRepositoryRelativePath");

// src/core/investigation/investigator-errors.ts
var InvestigatorError = class extends Error {
  static {
    __name(this, "InvestigatorError");
  }
  code;
  retryable;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "InvestigatorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
};

// src/application/investigator/investigation-validator.ts
var InvestigationValidator = class {
  static {
    __name(this, "InvestigationValidator");
  }
  async validate(result, expectedWorkspaceRevision, repositoryTools) {
    const schemaResult = investigationResultSchema.safeParse(result);
    if (!schemaResult.success) {
      throw new InvestigatorError(
        "Investigation result failed schema validation: " + z.prettifyError(schemaResult.error),
        "invalid_output" /* invalid_output */,
        {
          retryable: true,
          cause: schemaResult.error
        }
      );
    }
    const investigation = schemaResult.data;
    await this.assertFreshWorkspace(
      investigation,
      expectedWorkspaceRevision,
      repositoryTools
    );
    const repositoryFiles = await repositoryTools.listFiles();
    const existingFiles = new Set(repositoryFiles.map((file) => file.path));
    for (const filePath of investigation.relatedFiles) {
      if (!existingFiles.has(filePath)) {
        throw new InvestigatorError(
          `Investigator referenced a missing file: ${filePath}`,
          "hallucinated_file" /* hallucinated_file */,
          {
            retryable: true
          }
        );
      }
    }
    const fileContents = /* @__PURE__ */ new Map();
    for (const evidence of investigation.evidence) {
      if (!existingFiles.has(evidence.filePath)) {
        throw new InvestigatorError(
          `Evidence references a missing file: ` + evidence.filePath,
          "hallucinated_file" /* hallucinated_file */,
          {
            retryable: true
          }
        );
      }
      const content = await this.getFileContent(
        evidence.filePath,
        repositoryTools,
        fileContents
      );
      this.assertLineRange(
        evidence.filePath,
        evidence.lineStart,
        evidence.lineEnd,
        content
      );
      this.assertSymbolExists(
        evidence.filePath,
        evidence.symbol,
        evidence.lineStart,
        evidence.lineEnd,
        content
      );
    }
    this.assertGroundedHypothesis(investigation);
    return investigation;
  }
  async assertFreshWorkspace(result, expectedWorkspaceRevision, repositoryTools) {
    if (result.workspaceRevision !== expectedWorkspaceRevision) {
      throw new InvestigatorError(
        "Investigation result was produced from a stale workspace",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
    const currentWorkspaceRevision = await repositoryTools.getWorkspaceRevision();
    if (currentWorkspaceRevision !== expectedWorkspaceRevision) {
      throw new InvestigatorError(
        "Workspace changed during investigation",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
  }
  async getFileContent(filePath, repositoryTools, cache) {
    const cachedContent = cache.get(filePath);
    if (cachedContent !== void 0) {
      return cachedContent;
    }
    const file = await repositoryTools.readFile(filePath);
    cache.set(filePath, file.content);
    return file.content;
  }
  assertLineRange(filePath, lineStart, lineEnd, content) {
    const lineCount = content.split(/\r?\n/).length;
    if (lineStart > lineCount || lineEnd > lineCount || lineEnd < lineStart) {
      throw new InvestigatorError(
        `Evidence contains an invalid line range for ${filePath}: ${lineStart}-${lineEnd}`,
        "invalid_line_range" /* invalid_line_range */,
        {
          retryable: true
        }
      );
    }
  }
  assertSymbolExists(filePath, symbol, lineStart, lineEnd, content) {
    const selectedContent = content.split(/\r?\n/).slice(lineStart - 1, lineEnd).join("\n");
    const symbolPattern = new RegExp(
      `(^|[^a-zA-Z0-9_$])${escapeRegularExpression(symbol)}([^a-zA-Z0-9_$]|$)`
    );
    if (!symbolPattern.test(selectedContent)) {
      throw new InvestigatorError(
        `Investigator referenced missing symbol ${symbol} at ${filePath}:${lineStart}-${lineEnd}`,
        "hallucinated_symbol" /* hallucinated_symbol */,
        {
          retryable: true
        }
      );
    }
  }
  assertGroundedHypothesis(result) {
    const normalizedHypothesis = result.hypothesis.toLowerCase();
    const referencesKnownSymbol = result.evidence.some(
      (evidence) => normalizedHypothesis.includes(evidence.symbol.toLowerCase())
    );
    if (!referencesKnownSymbol) {
      throw new InvestigatorError(
        "Bug hypothesis does not reference any confirmed symbol",
        "ungrounded_hypothesis" /* ungrounded_hypothesis */,
        {
          retryable: true
        }
      );
    }
  }
};
function escapeRegularExpression(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegularExpression, "escapeRegularExpression");
var listFilesInputSchema = z.object({}).strict();
var searchCodeInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(100).optional()
}).strict();
var readFileInputSchema = z.object({
  path: z.string().trim().min(1).max(500),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional()
}).strict().superRefine((input, context) => {
  if (input.lineStart !== void 0 && input.lineEnd !== void 0 && input.lineEnd < input.lineStart) {
    context.addIssue({
      code: "custom",
      path: ["lineEnd"],
      message: "lineEnd must be greater than or equal to lineStart"
    });
  }
  if (input.lineStart !== void 0 && input.lineEnd !== void 0 && input.lineEnd - input.lineStart > 399) {
    context.addIssue({
      code: "custom",
      path: ["lineEnd"],
      message: "A single readFile call is limited to 400 lines"
    });
  }
});
var getWorkspaceRevisionInputSchema = z.object({}).strict();
var investigatorTools = [
  {
    name: "listFiles",
    description: "List readable repository files inside the isolated workspace.",
    inputSchema: listFilesInputSchema
  },
  {
    name: "searchCode",
    description: "Search repository source lines for an exact text query.",
    inputSchema: searchCodeInputSchema
  },
  {
    name: "readFile",
    description: "Read up to 400 lines from one repository-relative file.",
    inputSchema: readFileInputSchema
  },
  {
    name: "getWorkspaceRevision",
    description: "Return the current immutable workspace revision identifier.",
    inputSchema: getWorkspaceRevisionInputSchema
  }
];
var InvestigatorRepositoryTools = class {
  constructor(repositoryTools) {
    this.repositoryTools = repositoryTools;
  }
  repositoryTools;
  static {
    __name(this, "InvestigatorRepositoryTools");
  }
  definitions = investigatorTools;
  async execute(toolCall) {
    switch (toolCall.name) {
      case "listFiles":
        return this.listFiles(toolCall.arguments);
      case "searchCode":
        return this.searchCode(toolCall.arguments);
      case "readFile":
        return this.readFile(toolCall.arguments);
      case "getWorkspaceRevision":
        return this.getWorkspaceRevision(toolCall.arguments);
      default:
        throw new InvestigatorError(
          `Unsupported investigator tool: ${toolCall.name}`,
          "unsupported_tool" /* unsupported_tool */
        );
    }
  }
  async listFiles(argumentsValue) {
    parseToolArguments(listFilesInputSchema, argumentsValue, "listFiles");
    const files = await this.repositoryTools.listFiles();
    const output = {
      files,
      totalFiles: files.length
    };
    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    };
  }
  async searchCode(argumentsValue) {
    const input = parseToolArguments(
      searchCodeInputSchema,
      argumentsValue,
      "searchCode"
    );
    const matches = await this.repositoryTools.searchCode({
      query: input.query,
      ...input.caseSensitive === void 0 ? {} : {
        caseSensitive: input.caseSensitive
      },
      ...input.maxResults === void 0 ? {} : {
        maxResults: input.maxResults
      }
    });
    const output = {
      query: input.query,
      matches,
      totalMatches: matches.length
    };
    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    };
  }
  async readFile(argumentsValue) {
    const input = parseToolArguments(
      readFileInputSchema,
      argumentsValue,
      "readFile"
    );
    const file = await this.repositoryTools.readFile(input.path);
    const lines = file.content.split(/\r?\n/);
    const lineStart = input.lineStart ?? 1;
    if (lineStart > lines.length) {
      throw new InvestigatorError(
        `readFile lineStart ${lineStart} exceeds ${lines.length} lines in ${input.path}`,
        "invalid_tool_arguments" /* invalid_tool_arguments */,
        {
          retryable: true
        }
      );
    }
    const requestedLineEnd = input.lineEnd ?? lineStart + 399;
    const lineEnd = Math.min(requestedLineEnd, lines.length);
    const content = lines.slice(lineStart - 1, lineEnd).join("\n");
    const output = {
      path: file.path,
      sizeBytes: file.sizeBytes,
      lineStart,
      lineEnd,
      totalLines: lines.length,
      truncated: lineStart > 1 || lineEnd < lines.length,
      content
    };
    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    };
  }
  async getWorkspaceRevision(argumentsValue) {
    parseToolArguments(
      getWorkspaceRevisionInputSchema,
      argumentsValue,
      "getWorkspaceRevision"
    );
    const workspaceRevision = await this.repositoryTools.getWorkspaceRevision();
    const output = {
      workspaceRevision
    };
    return {
      modelOutput: JSON.stringify(output),
      traceOutput: output
    };
  }
};
function parseToolArguments(schema, value, toolName) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvestigatorError(
      `Invalid arguments for ${toolName}: ` + z.prettifyError(result.error),
      "invalid_tool_arguments" /* invalid_tool_arguments */,
      {
        retryable: true,
        cause: result.error
      }
    );
  }
  return result.data;
}
__name(parseToolArguments, "parseToolArguments");

// src/application/investigator/investigator-agent.ts
var investigatorStep = "investigator";
var ModelInvestigatorAgent = class {
  constructor(modelProvider, promptRegistry, repositoryToolsFactory, traceRecorder, logger, validator = new InvestigationValidator(), options = {}) {
    this.modelProvider = modelProvider;
    this.promptRegistry = promptRegistry;
    this.repositoryToolsFactory = repositoryToolsFactory;
    this.traceRecorder = traceRecorder;
    this.logger = logger;
    this.validator = validator;
    const maximumToolIterations = options.maximumToolIterations ?? 20;
    if (!Number.isInteger(maximumToolIterations) || maximumToolIterations <= 0) {
      throw new Error("maximumToolIterations must be a positive integer");
    }
    this.maximumToolIterations = maximumToolIterations;
  }
  modelProvider;
  promptRegistry;
  repositoryToolsFactory;
  traceRecorder;
  logger;
  validator;
  static {
    __name(this, "ModelInvestigatorAgent");
  }
  maximumToolIterations;
  async execute(input) {
    this.assertValidInput(input);
    const expectedWorkspaceRevision = input.context.context.workspaceRevision;
    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: investigatorStep,
      agent: "investigator" /* investigator */,
      workspaceRevision: expectedWorkspaceRevision
    });
    let promptVersion;
    try {
      const prompt = await this.promptRegistry.load("investigator" /* investigator */);
      promptVersion = prompt.id;
      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      );
      await this.assertInitialWorkspaceRevision(
        expectedWorkspaceRevision,
        repositoryTools
      );
      const investigatorTools2 = new InvestigatorRepositoryTools(
        repositoryTools
      );
      let modelInput = [
        {
          type: "message",
          role: "system",
          content: prompt.content
        },
        {
          type: "message",
          role: "user",
          content: JSON.stringify({
            agentContext: input.context.context
          })
        }
      ];
      let previousResponseId;
      for (let iteration = 1; iteration <= this.maximumToolIterations; iteration += 1) {
        const modelResult = await this.modelProvider.generate({
          input: modelInput,
          outputSchemaName: "investigation_result",
          outputSchema: investigationResultSchema,
          tools: investigatorTools2.definitions,
          ...previousResponseId === void 0 ? {} : {
            previousResponseId
          }
        });
        await this.recordModelCall(
          input,
          prompt.id,
          iteration,
          modelResult
        );
        if (modelResult.toolCalls.length > 0) {
          if (modelResult.responseId === void 0) {
            throw new InvestigatorError(
              "Model returned tool calls without a response identifier",
              "missing_response_id" /* missing_response_id */,
              {
                retryable: true
              }
            );
          }
          modelInput = await this.executeToolCalls(
            input,
            prompt.id,
            investigatorTools2,
            modelResult.toolCalls
          );
          previousResponseId = modelResult.responseId;
          continue;
        }
        if (modelResult.output === void 0) {
          throw new InvestigatorError(
            "Investigator returned no structured output",
            "missing_output" /* missing_output */,
            {
              retryable: true
            }
          );
        }
        const investigation = await this.validator.validate(
          modelResult.output,
          expectedWorkspaceRevision,
          repositoryTools
        );
        await this.traceRecorder.record({
          runId: input.context.context.runId,
          step: investigatorStep,
          agent: "investigator" /* investigator */,
          workspaceRevision: expectedWorkspaceRevision,
          type: "agent.result" /* agent_result */,
          promptVersion: prompt.id,
          output: investigation
        });
        logger.info("Investigation completed", {
          evidenceCount: investigation.evidence.length,
          relatedFileCount: investigation.relatedFiles.length
        });
        return investigation;
      }
      throw new InvestigatorError(
        `Investigator exceeded ${this.maximumToolIterations} tool iterations`,
        "tool_loop_exhausted" /* tool_loop_exhausted */,
        {
          retryable: true
        }
      );
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger);
      logger.error("Investigation failed", {
        error
      });
      throw error;
    }
  }
  assertValidInput(input) {
    const result = investigationInputSchema.safeParse(input);
    if (!result.success) {
      throw new InvestigatorError(
        "Investigation input failed schema validation: " + z.prettifyError(result.error),
        "invalid_input" /* invalid_input */,
        {
          cause: result.error
        }
      );
    }
  }
  async assertInitialWorkspaceRevision(expectedRevision, repositoryTools) {
    const currentRevision = await repositoryTools.getWorkspaceRevision();
    if (currentRevision !== expectedRevision) {
      throw new InvestigatorError(
        "Investigator context contains a stale workspace revision",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
  }
  async executeToolCalls(input, promptVersion, tools, toolCalls) {
    const toolResults = [];
    for (const toolCall of toolCalls) {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: investigatorStep,
        agent: "investigator" /* investigator */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "tool.call" /* tool_call */,
        promptVersion,
        input: {
          callId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      });
      const toolResult = await tools.execute(toolCall);
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: investigatorStep,
        agent: "investigator" /* investigator */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "tool.result" /* tool_result */,
        promptVersion,
        output: {
          callId: toolCall.id,
          name: toolCall.name,
          result: toolResult.traceOutput
        }
      });
      toolResults.push({
        type: "tool_result",
        callId: toolCall.id,
        output: toolResult.modelOutput
      });
    }
    return toolResults;
  }
  recordModelCall(input, promptVersion, iteration, result) {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: investigatorStep,
      agent: "investigator" /* investigator */,
      workspaceRevision: input.context.context.workspaceRevision,
      type: "agent.call" /* agent_call */,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      input: {
        iteration
      },
      output: {
        returnedStructuredOutput: result.output !== void 0,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    });
  }
  async recordFailure(input, promptVersion, error, logger) {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: investigatorStep,
        agent: "investigator" /* investigator */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "failure" /* failure */,
        error: toTraceError2(error),
        ...promptVersion === void 0 ? {} : {
          promptVersion
        }
      });
    } catch (traceError) {
      logger.warn("Failed to record investigator failure", {
        traceError
      });
    }
  }
};
function toTraceError2(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown investigator failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError2, "toTraceError");

// src/application/orchestrator/pipeline-orchestrator.ts
var PipelineOrchestrator = class {
  constructor(dependencies) {
    this.dependencies = dependencies;
  }
  dependencies;
  static {
    __name(this, "PipelineOrchestrator");
  }
  async execute(input) {
    let state = input.state;
    let workspace = input.workspace;
    const retries = createRetrySummary();
    try {
      const investigationExecution = await this.executeInvestigator(
        state,
        workspace,
        retries
      );
      state = investigationExecution.state;
      const investigation = investigationExecution.result;
      const reproductionExecution = await this.executeReproducer(
        state,
        workspace,
        investigation,
        retries
      );
      state = reproductionExecution.state;
      workspace = reproductionExecution.workspace;
      const reproduction = reproductionExecution.result;
      const implementationExecution = await this.executeImplementer(
        state,
        workspace,
        investigation,
        reproduction,
        retries
      );
      state = implementationExecution.state;
      workspace = implementationExecution.workspace;
      const implementation = implementationExecution.result;
      const validationExecution = await this.executeValidation(
        state,
        workspace,
        investigation,
        reproduction,
        implementation
      );
      state = validationExecution.state;
      const validation = validationExecution.result;
      const reviewExecution = await this.executeReviewer(
        state,
        workspace,
        validation,
        retries
      );
      state = reviewExecution.state;
      const review = reviewExecution.result;
      const tokenUsage = this.getTokenUsage(state.runId);
      this.printPipelineSummary(
        state,
        implementation,
        validation,
        review,
        retries,
        tokenUsage
      );
      state = await this.dependencies.runService.startStep(
        state,
        "human_approval" /* human_approval */,
        "awaiting_approval" /* awaiting_approval */
      );
      const decision = await this.dependencies.approvalPrompt.requestApproval({
        runId: state.runId,
        repositoryPath: state.repositoryPath,
        task: state.task,
        finalDiff: validation.finalDiff,
        changedFiles: validation.changedFiles,
        validation: validation.report,
        review,
        retries,
        tokenUsage
      });
      state = await this.dependencies.runService.recordApproval(
        state,
        decision
      );
      state = await this.dependencies.runService.startStep(
        state,
        decision === "approved" /* approved */ ? "finalize" /* finalize */ : "rollback" /* rollback */,
        "running" /* running */
      );
      if (decision === "rejected" /* rejected */) {
        workspace = await this.dependencies.workspaceManager.rollback(workspace);
        state = await this.dependencies.runService.updateWorkspaceRevision(
          state,
          workspace
        );
        state = await this.dependencies.runService.completeRun(
          state,
          "rolled_back" /* rolled_back */,
          "Human rejected final changes; workspace rolled back"
        );
        return {
          state,
          decision
        };
      }
      await this.dependencies.finalArtifactStore.save({
        schemaVersion: 1,
        runId: state.runId,
        task: state.task,
        repositoryPath: state.repositoryPath,
        workspaceRevision: workspace.workspaceRevision,
        finalDiff: validation.finalDiff,
        changedFiles: validation.changedFiles,
        validationPassed: validation.report.passed,
        reviewRecommendation: review.recommendation,
        approvalDecision: decision,
        retries,
        tokenUsage,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      state = await this.dependencies.runService.completeRun(
        state,
        "completed" /* completed */,
        "Final diff approved and saved"
      );
      return {
        state,
        decision
      };
    } catch (error) {
      if (state.currentStep !== null) {
        state = await this.dependencies.runService.failStep(state, error);
      }
      try {
        await this.dependencies.workspaceManager.rollback(workspace);
      } catch (rollbackError) {
        this.dependencies.logger.error("Pipeline rollback failed", {
          runId: state.runId,
          error: rollbackError
        });
      }
      await this.dependencies.traceRecorder.record({
        runId: state.runId,
        step: state.currentStep ?? "pipeline",
        type: "failure" /* failure */,
        workspaceRevision: workspace.workspaceRevision,
        error: toTraceError3(error)
      });
      throw error;
    }
  }
  async executeInvestigator(state, workspace, retries) {
    state = await this.dependencies.runService.startStep(
      state,
      "investigator" /* investigator */,
      "running" /* running */
    );
    const result = await this.dependencies.retryExecutor.execute({
      operation: /* @__PURE__ */ __name(async (attemptContext) => {
        retries.investigator = attemptContext.attempt - 1;
        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: "investigator" /* investigator */,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: "repository",
              type: "repository.snapshot" /* repository_snapshot */,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: [],
          constraints: createRetryConstraints(attemptContext)
        });
        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: "investigator" /* investigator */,
          attempt: attemptContext.attempt,
          input: {
            context,
            workspaceRevision: workspace.workspaceRevision
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: /* @__PURE__ */ __name(() => this.dependencies.investigatorAgent.execute({
            context,
            workspace
          }), "execute")
        });
        return execution.output;
      }, "operation"),
      onRetry: /* @__PURE__ */ __name((error, attempt) => this.recordRetry(
        state.runId,
        "investigator" /* investigator */,
        error,
        attempt,
        workspace.workspaceRevision
      ), "onRetry")
    });
    state = await this.dependencies.runService.completeStep(
      state,
      "investigator" /* investigator */,
      "ready" /* ready */,
      "Investigation and evidence validation completed"
    );
    return {
      state,
      result
    };
  }
  async executeReproducer(state, initialWorkspace, investigation, retries) {
    state = await this.dependencies.runService.startStep(
      state,
      "reproducer" /* reproducer */,
      "running" /* running */
    );
    let workspace = initialWorkspace;
    const result = await this.dependencies.retryExecutor.execute({
      operation: /* @__PURE__ */ __name(async (attemptContext) => {
        retries.reproducer = attemptContext.attempt - 1;
        if (attemptContext.attempt > 1) {
          workspace = await this.dependencies.workspaceManager.rollback(workspace);
        }
        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: "reproducer" /* reproducer */,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: "investigation-result",
              type: "investigation.result" /* investigation_result */,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: "investigation-evidence",
              type: "investigation.evidence" /* investigation_evidence */,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: rebindEvidence(
            investigation.evidence,
            workspace.workspaceRevision
          ),
          constraints: createRetryConstraints(attemptContext),
          investigation
        });
        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: "reproducer" /* reproducer */,
          attempt: attemptContext.attempt,
          input: {
            context,
            investigation
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: /* @__PURE__ */ __name(() => this.dependencies.reproducerAgent.execute({
            context,
            investigation: rebindInvestigation(
              investigation,
              workspace.workspaceRevision
            ),
            workspace
          }), "execute")
        });
        const reproduction = execution.output;
        workspace = {
          ...workspace,
          workspaceRevision: reproduction.workspaceRevision
        };
        return reproduction;
      }, "operation"),
      onRetry: /* @__PURE__ */ __name((error, attempt) => this.recordRetry(
        state.runId,
        "reproducer" /* reproducer */,
        error,
        attempt,
        workspace.workspaceRevision
      ), "onRetry")
    });
    state = await this.dependencies.runService.updateWorkspaceRevision(
      state,
      workspace
    );
    state = await this.dependencies.runService.completeStep(
      state,
      "reproducer" /* reproducer */,
      "ready" /* ready */,
      "Failing reproduction test confirmed"
    );
    return {
      state,
      workspace,
      result
    };
  }
  async executeImplementer(state, initialWorkspace, investigation, reproduction, retries) {
    state = await this.dependencies.runService.startStep(
      state,
      "implementer" /* implementer */,
      "running" /* running */
    );
    let workspace = initialWorkspace;
    const result = await this.dependencies.retryExecutor.execute({
      operation: /* @__PURE__ */ __name(async (attemptContext) => {
        retries.implementer = attemptContext.attempt - 1;
        if (attemptContext.attempt > 1) {
          workspace = await this.dependencies.implementationRecovery.restoreReproductionWorkspace(
            workspace,
            reproduction
          );
        }
        const evidence = rebindEvidence(
          investigation.evidence,
          workspace.workspaceRevision
        );
        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: "implementer" /* implementer */,
          task: state.task,
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: "investigation-evidence",
              type: "investigation.evidence" /* investigation_evidence */,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: "reproduction-test",
              type: "reproduction.test" /* reproduction_test */,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: "allowed-file-scope",
              type: "implementation.allowed-file-scope" /* allowed_file_scope */,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence,
          constraints: createRetryConstraints(attemptContext),
          investigation
        });
        const allowedFiles = investigation.relatedFiles.filter(
          (filePath) => !reproduction.testFiles.includes(filePath)
        );
        if (allowedFiles.length === 0) {
          throw new Error(
            "Investigation did not produce an implementation file scope"
          );
        }
        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: "implementer" /* implementer */,
          attempt: attemptContext.attempt,
          input: {
            context,
            evidence,
            reproduction,
            allowedFiles
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: /* @__PURE__ */ __name(() => this.dependencies.implementerAgent.execute({
            context,
            evidence,
            reproduction: {
              testFiles: reproduction.testFiles,
              expectedFailureMarker: reproduction.expectedFailureMarker,
              workspaceRevision: workspace.workspaceRevision,
              commandResult: {
                executionId: reproduction.commandResult.executionId,
                exitCode: reproduction.commandResult.exitCode,
                timedOut: false,
                succeeded: false,
                stdout: reproduction.commandResult.stdout,
                stderr: reproduction.commandResult.stderr
              }
            },
            allowedFileScope: {
              files: allowedFiles,
              workspaceRevision: workspace.workspaceRevision
            },
            workspace
          }), "execute")
        });
        const implementation = execution.output;
        workspace = {
          ...workspace,
          workspaceRevision: implementation.workspaceRevision
        };
        return implementation;
      }, "operation"),
      onRetry: /* @__PURE__ */ __name((error, attempt) => this.recordRetry(
        state.runId,
        "implementer" /* implementer */,
        error,
        attempt,
        workspace.workspaceRevision
      ), "onRetry")
    });
    state = await this.dependencies.runService.updateWorkspaceRevision(
      state,
      workspace
    );
    state = await this.dependencies.runService.completeStep(
      state,
      "implementer" /* implementer */,
      "ready" /* ready */,
      "Implementation passed the reproduction test"
    );
    return {
      state,
      workspace,
      result
    };
  }
  async executeValidation(state, workspace, investigation, reproduction, implementation) {
    state = await this.dependencies.runService.startStep(
      state,
      "mechanical_validation" /* mechanical_validation */,
      "validating" /* validating */
    );
    const result = await this.dependencies.validationService.execute({
      runId: state.runId,
      investigation,
      reproduction,
      implementation,
      evidence: investigation.evidence,
      workspace,
      filePolicy: {
        allowedFiles: [
          .../* @__PURE__ */ new Set([
            ...reproduction.testFiles,
            ...implementation.changedFiles
          ])
        ],
        forbiddenFiles: ["package-lock.json"],
        forbiddenPrefixes: [".git", "node_modules", ".runs"]
      }
    });
    state = await this.dependencies.runService.completeStep(
      state,
      "mechanical_validation" /* mechanical_validation */,
      "ready" /* ready */,
      result.report.passed ? "Mechanical validation passed" : "Mechanical validation completed with failures"
    );
    return {
      state,
      result
    };
  }
  async executeReviewer(state, workspace, validation, retries) {
    state = await this.dependencies.runService.startStep(
      state,
      "reviewer" /* reviewer */,
      "running" /* running */
    );
    const result = await this.dependencies.retryExecutor.execute({
      operation: /* @__PURE__ */ __name(async (attemptContext) => {
        retries.reviewer = attemptContext.attempt - 1;
        const context = this.dependencies.contextManager.createSnapshot({
          runId: state.runId,
          agent: "reviewer" /* reviewer */,
          task: "Review the final diff using the mechanical validation report.",
          workspaceRevision: workspace.workspaceRevision,
          artifacts: [
            {
              id: "final-diff",
              type: "review.final-diff" /* final_diff */,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: "validation-report",
              type: "review.validation-report" /* validation_report */,
              workspaceRevision: workspace.workspaceRevision
            },
            {
              id: "changed-files",
              type: "review.changed-files" /* changed_files */,
              workspaceRevision: workspace.workspaceRevision
            }
          ],
          evidence: [],
          constraints: createRetryConstraints(attemptContext)
        });
        const execution = await this.dependencies.stepExecutor.execute({
          runId: state.runId,
          step: "reviewer" /* reviewer */,
          attempt: attemptContext.attempt,
          input: {
            context,
            finalDiff: validation.finalDiff,
            validationReport: validation.report
          },
          workspaceRevision: workspace.workspaceRevision,
          execute: /* @__PURE__ */ __name(() => this.dependencies.reviewerAgent.execute({
            context,
            finalDiff: validation.finalDiff,
            changedFiles: validation.changedFiles,
            validationReport: validation.report
          }), "execute")
        });
        return execution.output;
      }, "operation"),
      onRetry: /* @__PURE__ */ __name((error, attempt) => this.recordRetry(
        state.runId,
        "reviewer" /* reviewer */,
        error,
        attempt,
        workspace.workspaceRevision
      ), "onRetry")
    });
    state = await this.dependencies.runService.completeStep(
      state,
      "reviewer" /* reviewer */,
      "ready" /* ready */,
      `Review completed: ${result.recommendation}`
    );
    return {
      state,
      result
    };
  }
  async recordRetry(runId, step, error, attempt, workspaceRevision) {
    const feedback = createValidationFeedback(error);
    await this.dependencies.traceRecorder.record({
      runId,
      step,
      attempt: attempt.attempt,
      workspaceRevision,
      type: "retry" /* retry */,
      error: toTraceError3(error),
      output: {
        nextAttempt: attempt.attempt + 1,
        feedback
      }
    });
    return feedback;
  }
  getTokenUsage(runId) {
    return this.dependencies.traceRecorder.getUsageSummary(runId);
  }
  printPipelineSummary(state, implementation, validation, review, retries, usage) {
    const logger = this.dependencies.logger.child({
      runId: state.runId,
      step: "pipeline-summary"
    });
    logger.info("Pipeline ready for human approval", {
      changedFiles: validation.changedFiles,
      validationPassed: validation.report.passed,
      reviewRecommendation: review.recommendation,
      implementationRisks: implementation.risks,
      reviewRisks: review.risks,
      retries,
      tokenUsage: usage
    });
  }
};
function createRetrySummary() {
  return {
    investigator: 0,
    reproducer: 0,
    implementer: 0,
    reviewer: 0
  };
}
__name(createRetrySummary, "createRetrySummary");
function createRetryConstraints(context) {
  const constraints = [
    `Execution attempt ${context.attempt} of ${context.maximumAttempts}.`
  ];
  if (context.validationFeedback.length === 0) {
    return constraints;
  }
  return [
    ...constraints,
    "The previous output was rejected mechanically.",
    "Return a corrected complete output.",
    ...context.validationFeedback.map(
      (feedback, index) => `Validation feedback ${index + 1}: ${feedback}`
    )
  ];
}
__name(createRetryConstraints, "createRetryConstraints");
function createValidationFeedback(error) {
  if (!(error instanceof Error)) {
    return ["Unknown pipeline failure"];
  }
  const feedback = [error.message];
  if ("code" in error && typeof error.code === "string") {
    feedback.push(`Error code: ${error.code}`);
  }
  return feedback;
}
__name(createValidationFeedback, "createValidationFeedback");
function rebindInvestigation(investigation, workspaceRevision) {
  return {
    ...investigation,
    workspaceRevision,
    evidence: rebindEvidence(investigation.evidence, workspaceRevision)
  };
}
__name(rebindInvestigation, "rebindInvestigation");
function rebindEvidence(evidence, workspaceRevision) {
  return evidence.map((reference) => ({
    ...reference,
    workspaceRevision
  }));
}
__name(rebindEvidence, "rebindEvidence");
function toTraceError3(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown pipeline failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError3, "toTraceError");
var repositoryRelativePathSchema3 = z.string().trim().min(1).max(500).refine(isRepositoryRelativePath3, {
  message: "Path must be repository-relative"
});
var testFilePathSchema = repositoryRelativePathSchema3.refine(
  isTestFilePath,
  {
    message: "Path must reference a test file"
  }
);
var expectedFailureMarkerSchema = z.string().trim().min(1).max(400).regex(
  /^AGENT_FIX_REPRODUCTION: [^\r\n]+$/,
  "Expected failure marker must start with AGENT_FIX_REPRODUCTION:"
);
var reproductionPlanSchema = z.object({
  summary: z.string().trim().min(1).max(2e3),
  patch: z.string().trim().min(1).max(2e5),
  testFiles: z.array(testFilePathSchema).min(1).max(20),
  expectedFailureMarker: expectedFailureMarkerSchema,
  workspaceRevision: z.string().trim().min(1)
}).strict().superRefine((plan, context) => {
  const uniqueFiles = new Set(plan.testFiles);
  if (uniqueFiles.size !== plan.testFiles.length) {
    context.addIssue({
      code: "custom",
      path: ["testFiles"],
      message: "testFiles contains duplicate paths"
    });
  }
});
var reproducerContextSnapshotSchema = z.object({
  agent: z.literal("reproducer" /* reproducer */),
  createdAt: z.string().trim().min(1),
  estimatedTokens: z.number().int().nonnegative(),
  context: z.object({
    runId: z.string().trim().min(1),
    task: z.string().trim().min(1),
    workspaceRevision: z.string().trim().min(1),
    artifactIds: z.array(z.string().trim().min(1)),
    evidence: z.array(z.unknown()),
    constraints: z.array(z.string()),
    summary: z.string().optional()
  }).strict()
}).strict();
var workspaceSnapshotSchema3 = z.object({
  runId: z.string().trim().min(1),
  repositoryPath: z.string().trim().min(1),
  repositoryRoot: z.string().trim().min(1),
  repositoryRelativePath: z.string(),
  workspaceRoot: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  baseCommit: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1)
}).strict();
var reproductionInputSchema = z.object({
  context: reproducerContextSnapshotSchema,
  investigation: investigationResultSchema,
  workspace: workspaceSnapshotSchema3
}).strict().superRefine((input, context) => {
  const contextRevision = input.context.context.workspaceRevision;
  if (input.context.context.runId !== input.workspace.runId) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "runId"],
      message: "Context and workspace run identifiers do not match"
    });
  }
  if (contextRevision !== input.workspace.workspaceRevision) {
    context.addIssue({
      code: "custom",
      path: ["workspace", "workspaceRevision"],
      message: "Context and workspace revisions do not match"
    });
  }
  if (contextRevision !== input.investigation.workspaceRevision) {
    context.addIssue({
      code: "custom",
      path: ["investigation", "workspaceRevision"],
      message: "Investigation and context revisions do not match"
    });
  }
});
function isTestFilePath(filePath) {
  const normalizedPath = filePath.toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? "";
  const hasTestDirectory = normalizedPath.startsWith("test/") || normalizedPath.startsWith("tests/") || normalizedPath.includes("/test/") || normalizedPath.includes("/tests/") || normalizedPath.includes("/__tests__/");
  const hasTestFileName = fileName.includes(".test.") || fileName.includes(".spec.");
  const hasSupportedExtension = /\.(?:[cm]?[jt]sx?)$/.test(fileName);
  return hasSupportedExtension && (hasTestDirectory || hasTestFileName);
}
__name(isTestFilePath, "isTestFilePath");
function isRepositoryRelativePath3(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isRepositoryRelativePath3, "isRepositoryRelativePath");

// src/core/reproduction/reproducer-errors.ts
var ReproducerError = class extends Error {
  static {
    __name(this, "ReproducerError");
  }
  code;
  retryable;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "ReproducerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
};

// src/application/reproducer/reproduction-gate.ts
var unrelatedFailurePatterns = [
  /\bno test files found\b/i,
  /\bno tests found\b/i,
  /\bcannot find module\b/i,
  /\berr_module_not_found\b/i,
  /\bfailed to resolve import\b/i,
  /\btest suite failed to run\b/i,
  /\bsyntaxerror\b/i,
  /\bts\d{4}:/i,
  /\bmissing script:\s*["']?test/i,
  /\bcommand not found\b/i
];
var ReproductionGate = class {
  static {
    __name(this, "ReproductionGate");
  }
  assertExpectedFailure(commandResult, expectedFailureMarker) {
    if (commandResult.operation !== "runTests" /* run_tests */) {
      throw new ReproducerError(
        "Reproduction gate received a non-test command result",
        "test_execution_failed" /* test_execution_failed */
      );
    }
    if (commandResult.timedOut) {
      throw new ReproducerError(
        "Reproduction test timed out",
        "test_execution_failed" /* test_execution_failed */,
        {
          retryable: true
        }
      );
    }
    if (commandResult.succeeded || commandResult.exitCode === 0) {
      throw new ReproducerError(
        "Reproduction test passed before implementation",
        "test_already_passes" /* test_already_passes */,
        {
          retryable: true
        }
      );
    }
    if (commandResult.exitCode === null) {
      throw new ReproducerError(
        "Reproduction test did not produce an exit code",
        "test_execution_failed" /* test_execution_failed */,
        {
          retryable: true
        }
      );
    }
    const output = normalizeOutput2(
      `${commandResult.stdout}
${commandResult.stderr}`
    );
    if (!output.includes(expectedFailureMarker)) {
      throw new ReproducerError(
        "Reproduction test failed for an unrelated reason",
        "unrelated_test_failure" /* unrelated_test_failure */,
        {
          retryable: true
        }
      );
    }
    const unrelatedFailure = unrelatedFailurePatterns.find(
      (pattern) => pattern.test(output)
    );
    if (unrelatedFailure !== void 0) {
      throw new ReproducerError(
        "Reproduction output contains an infrastructure or test setup failure",
        "unrelated_test_failure" /* unrelated_test_failure */,
        {
          retryable: true
        }
      );
    }
  }
};
function normalizeOutput2(output) {
  return output.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replaceAll("\r\n", "\n");
}
__name(normalizeOutput2, "normalizeOutput");

// src/application/reproducer/reproduction-patch-validator.ts
var diffHeaderPattern2 = /^diff --git a\/(.+) b\/(.+)$/gm;
var forbiddenPatchMarkers2 = [
  "GIT binary patch",
  "Binary files ",
  "rename from ",
  "rename to ",
  "deleted file mode "
];
var ReproductionPatchValidator = class {
  static {
    __name(this, "ReproductionPatchValidator");
  }
  validate(plan, expectedWorkspaceRevision) {
    if (plan.workspaceRevision !== expectedWorkspaceRevision) {
      throw new ReproducerError(
        "Reproduction patch was produced from a stale workspace",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
    for (const marker of forbiddenPatchMarkers2) {
      if (plan.patch.includes(marker)) {
        throw new ReproducerError(
          `Reproduction patch contains forbidden marker: ${marker}`,
          "invalid_patch" /* invalid_patch */,
          {
            retryable: true
          }
        );
      }
    }
    const changedFiles = extractChangedFiles2(plan.patch);
    if (changedFiles.length === 0) {
      throw new ReproducerError(
        "Reproduction patch does not contain changed files",
        "invalid_patch" /* invalid_patch */,
        {
          retryable: true
        }
      );
    }
    for (const filePath of changedFiles) {
      if (!isSafeRelativePath2(filePath)) {
        throw new ReproducerError(
          `Reproduction patch contains unsafe path: ${filePath}`,
          "invalid_patch" /* invalid_patch */
        );
      }
      if (!isTestFilePath(filePath)) {
        throw new ReproducerError(
          `Reproducer attempted to modify non-test file: ${filePath}`,
          "forbidden_file_change" /* forbidden_file_change */
        );
      }
    }
    assertOnlyAdditions(plan.patch);
    assertSameFiles2(changedFiles, plan.testFiles);
    const addedContent = extractAddedContent(plan.patch);
    if (!addedContent.includes(plan.expectedFailureMarker)) {
      throw new ReproducerError(
        "Reproduction patch does not contain the expected failure marker",
        "invalid_patch" /* invalid_patch */,
        {
          retryable: true
        }
      );
    }
    return changedFiles;
  }
};
function extractChangedFiles2(patch) {
  const files = [];
  let match;
  diffHeaderPattern2.lastIndex = 0;
  while ((match = diffHeaderPattern2.exec(patch)) !== null) {
    const sourcePath = match[1];
    const targetPath = match[2];
    if (sourcePath === void 0 || targetPath === void 0 || sourcePath !== targetPath) {
      throw new ReproducerError(
        "Reproduction patch contains a rename or invalid diff header",
        "invalid_patch" /* invalid_patch */
      );
    }
    if (!files.includes(targetPath)) {
      files.push(targetPath);
    }
  }
  return files;
}
__name(extractChangedFiles2, "extractChangedFiles");
function assertOnlyAdditions(patch) {
  const lines = patch.split(/\r?\n/);
  let additionCount = 0;
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    if (line.startsWith("-")) {
      throw new ReproducerError(
        "Reproduction patch may only add test code",
        "invalid_patch" /* invalid_patch */,
        {
          retryable: true
        }
      );
    }
    if (line.startsWith("+")) {
      additionCount += 1;
    }
  }
  if (additionCount === 0) {
    throw new ReproducerError(
      "Reproduction patch does not add test code",
      "invalid_patch" /* invalid_patch */,
      {
        retryable: true
      }
    );
  }
}
__name(assertOnlyAdditions, "assertOnlyAdditions");
function extractAddedContent(patch) {
  return patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).map((line) => line.slice(1)).join("\n");
}
__name(extractAddedContent, "extractAddedContent");
function assertSameFiles2(patchFiles, declaredFiles) {
  const normalizedPatchFiles = [...patchFiles].sort();
  const normalizedDeclaredFiles = [...declaredFiles].sort();
  if (normalizedPatchFiles.length !== normalizedDeclaredFiles.length) {
    throw new ReproducerError(
      "Declared test files do not match patch files",
      "invalid_patch" /* invalid_patch */,
      {
        retryable: true
      }
    );
  }
  for (let index = 0; index < normalizedPatchFiles.length; index += 1) {
    if (normalizedPatchFiles[index] !== normalizedDeclaredFiles[index]) {
      throw new ReproducerError(
        "Declared test files do not match patch files",
        "invalid_patch" /* invalid_patch */,
        {
          retryable: true
        }
      );
    }
  }
}
__name(assertSameFiles2, "assertSameFiles");
function isSafeRelativePath2(filePath) {
  if (filePath.startsWith("/") || filePath.startsWith("\\") || filePath.includes("\\") || /^[a-zA-Z]:/.test(filePath)) {
    return false;
  }
  return filePath.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isSafeRelativePath2, "isSafeRelativePath");

// src/application/reproducer/test-structure-inspector.ts
var defaultMaximumTestFiles = 12;
var defaultMaximumContentLength = 8e4;
var TestStructureInspector = class {
  static {
    __name(this, "TestStructureInspector");
  }
  maximumTestFiles;
  maximumContentLength;
  constructor(options = {}) {
    this.maximumTestFiles = options.maximumTestFiles ?? defaultMaximumTestFiles;
    this.maximumContentLength = options.maximumContentLength ?? defaultMaximumContentLength;
  }
  async inspect(repositoryTools, workspaceRevision) {
    const repositoryFiles = await repositoryTools.listFiles();
    const packageFile = repositoryFiles.find(
      (file) => file.path === "package.json"
    );
    const configFiles = repositoryFiles.filter(isTestConfigFile).sort(compareRepositoryFiles);
    const testFiles = repositoryFiles.filter(isTestSourceFile).sort(compareRepositoryFiles).slice(0, this.maximumTestFiles);
    let remainingContentLength = this.maximumContentLength;
    const loadedConfigFiles = [];
    const loadedTestFiles = [];
    let packageContent = null;
    if (packageFile !== void 0) {
      const loadedPackage = await this.readBoundedFile(
        packageFile,
        repositoryTools,
        remainingContentLength
      );
      loadedConfigFiles.push(loadedPackage.file);
      remainingContentLength -= loadedPackage.consumedLength;
      packageContent = loadedPackage.file.content;
    }
    for (const file of configFiles) {
      if (file.path === "package.json" || remainingContentLength <= 0) {
        continue;
      }
      const loaded = await this.readBoundedFile(
        file,
        repositoryTools,
        remainingContentLength
      );
      loadedConfigFiles.push(loaded.file);
      remainingContentLength -= loaded.consumedLength;
    }
    for (const file of testFiles) {
      if (remainingContentLength <= 0) {
        break;
      }
      const loaded = await this.readBoundedFile(
        file,
        repositoryTools,
        remainingContentLength
      );
      loadedTestFiles.push(loaded.file);
      remainingContentLength -= loaded.consumedLength;
    }
    const packageMetadata = parsePackageMetadata(packageContent);
    return {
      framework: packageMetadata.framework,
      testScript: packageMetadata.testScript,
      configFiles: loadedConfigFiles,
      testFiles: loadedTestFiles,
      workspaceRevision
    };
  }
  async readBoundedFile(file, repositoryTools, maximumLength) {
    const result = await repositoryTools.readFile(file.path);
    const content = result.content.slice(0, maximumLength);
    return {
      file: {
        path: result.path,
        content,
        truncated: content.length < result.content.length
      },
      consumedLength: content.length
    };
  }
};
function parsePackageMetadata(content) {
  if (content === null) {
    return {
      framework: null,
      testScript: null
    };
  }
  try {
    const parsed = JSON.parse(content);
    const packageRecord = toRecord(parsed);
    if (packageRecord === null) {
      return {
        framework: null,
        testScript: null
      };
    }
    const scripts = toStringRecord(packageRecord.scripts);
    const dependencies = {
      ...toStringRecord(packageRecord.dependencies),
      ...toStringRecord(packageRecord.devDependencies)
    };
    return {
      framework: detectTestFramework(dependencies, scripts.test),
      testScript: scripts.test ?? null
    };
  } catch {
    return {
      framework: null,
      testScript: null
    };
  }
}
__name(parsePackageMetadata, "parsePackageMetadata");
function detectTestFramework(dependencies, testScript) {
  if ("vitest" in dependencies) {
    return "vitest";
  }
  if ("jest" in dependencies) {
    return "jest";
  }
  if ("mocha" in dependencies) {
    return "mocha";
  }
  if ("@playwright/test" in dependencies) {
    return "playwright";
  }
  if (testScript !== void 0 && testScript.includes("node --test")) {
    return "node:test";
  }
  return null;
}
__name(detectTestFramework, "detectTestFramework");
function toRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value;
}
__name(toRecord, "toRecord");
function toStringRecord(value) {
  const record = toRecord(value);
  if (record === null) {
    return {};
  }
  const result = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    if (typeof nestedValue === "string") {
      result[key] = nestedValue;
    }
  }
  return result;
}
__name(toStringRecord, "toStringRecord");
function isTestConfigFile(file) {
  return file.path === "package.json" || /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$/.test(
    file.path
  ) || /(^|\/)tsconfig(?:\.[a-zA-Z0-9_-]+)?\.json$/.test(file.path);
}
__name(isTestConfigFile, "isTestConfigFile");
function isTestSourceFile(file) {
  const normalizedPath = file.path.toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? "";
  const testDirectory = normalizedPath.startsWith("test/") || normalizedPath.startsWith("tests/") || normalizedPath.includes("/test/") || normalizedPath.includes("/tests/") || normalizedPath.includes("/__tests__/");
  const testFileName = fileName.includes(".test.") || fileName.includes(".spec.");
  return /\.(?:[cm]?[jt]sx?)$/.test(fileName) && (testDirectory || testFileName);
}
__name(isTestSourceFile, "isTestSourceFile");
function compareRepositoryFiles(left, right) {
  return left.path.localeCompare(right.path);
}
__name(compareRepositoryFiles, "compareRepositoryFiles");

// src/application/reproducer/reproducer-agent.ts
var reproducerStep = "reproducer";
var ModelReproducerAgent = class {
  constructor(modelProvider, promptRegistry, repositoryToolsFactory, processRunnerFactory, artifactStore, traceRecorder, logger, testStructureInspector = new TestStructureInspector(), patchValidator = new ReproductionPatchValidator(), reproductionGate = new ReproductionGate()) {
    this.modelProvider = modelProvider;
    this.promptRegistry = promptRegistry;
    this.repositoryToolsFactory = repositoryToolsFactory;
    this.processRunnerFactory = processRunnerFactory;
    this.artifactStore = artifactStore;
    this.traceRecorder = traceRecorder;
    this.logger = logger;
    this.testStructureInspector = testStructureInspector;
    this.patchValidator = patchValidator;
    this.reproductionGate = reproductionGate;
  }
  modelProvider;
  promptRegistry;
  repositoryToolsFactory;
  processRunnerFactory;
  artifactStore;
  traceRecorder;
  logger;
  testStructureInspector;
  patchValidator;
  reproductionGate;
  static {
    __name(this, "ModelReproducerAgent");
  }
  async execute(input) {
    this.assertValidInput(input);
    const sourceWorkspaceRevision = input.context.context.workspaceRevision;
    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision: sourceWorkspaceRevision
    });
    let promptVersion;
    try {
      const prompt = await this.promptRegistry.load("reproducer" /* reproducer */);
      promptVersion = prompt.id;
      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      );
      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      );
      const testStructure = await this.inspectTestStructure(
        input,
        prompt.id,
        repositoryTools,
        sourceWorkspaceRevision
      );
      const modelResult = await this.modelProvider.generate({
        input: [
          {
            type: "message",
            role: "system",
            content: prompt.content
          },
          {
            type: "message",
            role: "user",
            content: JSON.stringify({
              agentContext: input.context.context,
              investigation: input.investigation,
              testStructure
            })
          }
        ],
        outputSchemaName: "reproduction_plan",
        outputSchema: reproductionPlanSchema
      });
      await this.recordModelCall(input, prompt.id, modelResult);
      if (modelResult.toolCalls.length > 0) {
        throw new ReproducerError(
          "Reproducer returned an unexpected tool call",
          "unexpected_tool_call" /* unexpected_tool_call */
        );
      }
      if (modelResult.output === void 0) {
        throw new ReproducerError(
          "Reproducer returned no structured output",
          "missing_output" /* missing_output */,
          {
            retryable: true
          }
        );
      }
      const plan = this.parsePlan(modelResult.output);
      const patchFiles = this.patchValidator.validate(
        plan,
        sourceWorkspaceRevision
      );
      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      );
      const applyResult = await this.applyPatch(
        input,
        prompt.id,
        repositoryTools,
        plan
      );
      assertChangedFilesMatch2(patchFiles, applyResult.changedFiles);
      const patchedWorkspace = {
        ...input.workspace,
        workspaceRevision: applyResult.workspaceRevision
      };
      const processRunner = this.processRunnerFactory.create(patchedWorkspace);
      const commandResult = await this.runTests(
        input,
        prompt.id,
        processRunner.runTests.bind(processRunner),
        applyResult.workspaceRevision
      );
      this.reproductionGate.assertExpectedFailure(
        commandResult,
        plan.expectedFailureMarker
      );
      const artifacts = await this.artifactStore.save({
        runId: input.context.context.runId,
        plan,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        commandResult
      });
      const result = {
        summary: plan.summary,
        patch: plan.patch,
        testFiles: plan.testFiles,
        expectedFailureMarker: plan.expectedFailureMarker,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        commandResult,
        artifacts
      };
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: "reproducer" /* reproducer */,
        workspaceRevision: applyResult.workspaceRevision,
        type: "agent.result" /* agent_result */,
        promptVersion: prompt.id,
        output: {
          summary: result.summary,
          testFiles: result.testFiles,
          expectedFailureMarker: result.expectedFailureMarker,
          commandArtifact: result.commandResult.artifact,
          reproductionArtifact: result.artifacts.reproduction,
          patchArtifact: result.artifacts.patch
        }
      });
      logger.info("Reproduction confirmed", {
        testFiles: result.testFiles,
        commandExecutionId: commandResult.executionId
      });
      return result;
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger);
      logger.error("Reproduction failed", {
        error
      });
      throw error;
    }
  }
  assertValidInput(input) {
    const result = reproductionInputSchema.safeParse(input);
    if (!result.success) {
      throw new ReproducerError(
        "Reproduction input failed schema validation: " + z.prettifyError(result.error),
        "invalid_input" /* invalid_input */,
        {
          cause: result.error
        }
      );
    }
  }
  parsePlan(value) {
    const result = reproductionPlanSchema.safeParse(value);
    if (!result.success) {
      throw new ReproducerError(
        "Reproduction output failed schema validation: " + z.prettifyError(result.error),
        "invalid_output" /* invalid_output */,
        {
          retryable: true,
          cause: result.error
        }
      );
    }
    return result.data;
  }
  async assertFreshWorkspace(repositoryTools, expectedRevision) {
    const currentRevision = await repositoryTools.getWorkspaceRevision();
    if (currentRevision !== expectedRevision) {
      throw new ReproducerError(
        "Reproducer context contains a stale workspace revision",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
  }
  async inspectTestStructure(input, promptVersion, repositoryTools, workspaceRevision) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision,
      type: "tool.call" /* tool_call */,
      promptVersion,
      input: {
        name: "inspectTestStructure"
      }
    });
    const result = await this.testStructureInspector.inspect(
      repositoryTools,
      workspaceRevision
    );
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision,
      type: "tool.result" /* tool_result */,
      promptVersion,
      output: {
        name: "inspectTestStructure",
        framework: result.framework,
        testScript: result.testScript,
        configFiles: result.configFiles.map((file) => file.path),
        testFiles: result.testFiles.map((file) => file.path)
      }
    });
    return result;
  }
  async applyPatch(input, promptVersion, repositoryTools, plan) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision: input.workspace.workspaceRevision,
      type: "tool.call" /* tool_call */,
      promptVersion,
      input: {
        name: "applyReproductionPatch",
        testFiles: plan.testFiles
      }
    });
    try {
      const result = await repositoryTools.applyPatch(plan.patch);
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: "reproducer" /* reproducer */,
        workspaceRevision: result.workspaceRevision,
        type: "tool.result" /* tool_result */,
        promptVersion,
        output: {
          name: "applyReproductionPatch",
          changedFiles: result.changedFiles,
          workspaceRevision: result.workspaceRevision
        }
      });
      return result;
    } catch (error) {
      throw new ReproducerError(
        "Failed to apply reproduction test patch",
        "patch_application_failed" /* patch_application_failed */,
        {
          retryable: true,
          cause: error
        }
      );
    }
  }
  async runTests(input, promptVersion, runTests, workspaceRevision) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision,
      type: "tool.call" /* tool_call */,
      promptVersion,
      input: {
        name: "runTests"
      }
    });
    const result = await runTests();
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision,
      type: "tool.result" /* tool_result */,
      promptVersion,
      durationMs: result.durationMs,
      output: {
        name: "runTests",
        executionId: result.executionId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        succeeded: result.succeeded,
        artifact: result.artifact
      }
    });
    return result;
  }
  recordModelCall(input, promptVersion, result) {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: "reproducer" /* reproducer */,
      workspaceRevision: input.workspace.workspaceRevision,
      type: "agent.call" /* agent_call */,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      output: {
        returnedStructuredOutput: result.output !== void 0,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    });
  }
  async recordFailure(input, promptVersion, error, logger) {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: "reproducer" /* reproducer */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "failure" /* failure */,
        error: toTraceError4(error),
        ...promptVersion === void 0 ? {} : {
          promptVersion
        }
      });
    } catch (traceError) {
      logger.warn("Failed to record reproducer failure", {
        traceError
      });
    }
  }
};
function assertChangedFilesMatch2(expectedFiles, actualFiles) {
  const expected = [...expectedFiles].sort();
  const actual = [...actualFiles].sort();
  if (expected.length !== actual.length) {
    throw new ReproducerError(
      "Applied patch changed unexpected files",
      "changed_files_mismatch" /* changed_files_mismatch */
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new ReproducerError(
        "Applied patch changed unexpected files",
        "changed_files_mismatch" /* changed_files_mismatch */
      );
    }
  }
}
__name(assertChangedFilesMatch2, "assertChangedFilesMatch");
function toTraceError4(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown reproducer failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError4, "toTraceError");
var MechanicalValidationCheckStatus = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped"
};
var ValidationCheckId = {
  agent_output_schema: "agent_output_schema",
  evidence_references: "evidence_references",
  patch_application: "patch_application",
  reproduction_failure: "reproduction_failure",
  reproduction_success: "reproduction_success",
  full_test_suite: "full_test_suite",
  typecheck: "typecheck",
  lint: "lint",
  build: "build",
  changed_file_policy: "changed_file_policy"
};
var checkStatusSchema = z.enum([
  MechanicalValidationCheckStatus.passed,
  MechanicalValidationCheckStatus.failed,
  MechanicalValidationCheckStatus.skipped
]);
var repositoryRelativePathSchema4 = z.string().trim().min(1).max(500).refine(isRepositoryRelativePath4, {
  message: "Path must be repository-relative"
});
var repositoryPathPrefixSchema = z.string().trim().min(1).max(500).refine(isRepositoryRelativePrefix, {
  message: "Path prefix must be repository-relative"
});
var validationArtifactSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  relativePath: repositoryRelativePathSchema4
}).strict();
var mechanicalValidationCheckSchema = z.object({
  id: z.enum([
    ValidationCheckId.agent_output_schema,
    ValidationCheckId.evidence_references,
    ValidationCheckId.patch_application,
    ValidationCheckId.reproduction_failure,
    ValidationCheckId.reproduction_success,
    ValidationCheckId.full_test_suite,
    ValidationCheckId.typecheck,
    ValidationCheckId.lint,
    ValidationCheckId.build,
    ValidationCheckId.changed_file_policy
  ]),
  status: checkStatusSchema,
  required: z.boolean(),
  message: z.string().trim().min(1).max(4e3),
  artifact: validationArtifactSchema.optional()
}).strict();
var mechanicalValidationReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1),
  generatedAt: z.string().trim().min(1),
  passed: z.boolean(),
  changedFiles: z.array(repositoryRelativePathSchema4).max(200),
  forbiddenFiles: z.array(repositoryRelativePathSchema4).max(200),
  checks: z.array(mechanicalValidationCheckSchema).min(1).max(100)
}).strict().superRefine((report, context) => {
  assertUniqueStrings(
    report.changedFiles,
    ["changedFiles"],
    "Validation report contains duplicate changed files",
    context
  );
  assertUniqueStrings(
    report.forbiddenFiles,
    ["forbiddenFiles"],
    "Validation report contains duplicate forbidden files",
    context
  );
  assertUniqueStrings(
    report.checks.map((check) => check.id),
    ["checks"],
    "Validation report contains duplicate check identifiers",
    context
  );
  const requiredChecksPassed = report.checks.filter((check) => check.required).every(
    (check) => check.status === MechanicalValidationCheckStatus.passed
  );
  const expectedPassed = requiredChecksPassed && report.forbiddenFiles.length === 0;
  if (report.passed !== expectedPassed) {
    context.addIssue({
      code: "custom",
      path: ["passed"],
      message: "Validation report passed state does not match its checks"
    });
  }
});
var validationFilePolicySchema = z.object({
  allowedFiles: z.array(repositoryRelativePathSchema4).min(1).max(200),
  forbiddenFiles: z.array(repositoryRelativePathSchema4).max(200),
  forbiddenPrefixes: z.array(repositoryPathPrefixSchema).max(100)
}).strict().superRefine((policy, context) => {
  assertUniqueStrings(
    policy.allowedFiles,
    ["allowedFiles"],
    "Allowed file policy contains duplicate paths",
    context
  );
  assertUniqueStrings(
    policy.forbiddenFiles,
    ["forbiddenFiles"],
    "Forbidden file policy contains duplicate paths",
    context
  );
  assertUniqueStrings(
    policy.forbiddenPrefixes,
    ["forbiddenPrefixes"],
    "Forbidden prefix policy contains duplicate paths",
    context
  );
});
function assertUniqueStrings(values, path19, message, context) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path: [...path19],
      message
    });
  }
}
__name(assertUniqueStrings, "assertUniqueStrings");
function isRepositoryRelativePath4(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isRepositoryRelativePath4, "isRepositoryRelativePath");
function isRepositoryRelativePrefix(value) {
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  return normalized.length > 0 && isRepositoryRelativePath4(normalized);
}
__name(isRepositoryRelativePrefix, "isRepositoryRelativePrefix");

// src/core/validation/validation-errors.ts
var ValidationError = class extends Error {
  static {
    __name(this, "ValidationError");
  }
  code;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "ValidationError";
    this.code = code;
  }
};
var ValidationGateError = class extends ValidationError {
  static {
    __name(this, "ValidationGateError");
  }
  report;
  artifact;
  constructor(report, artifact) {
    super(
      "Deterministic validation failed",
      "validation_failed" /* validation_failed */
    );
    this.name = "ValidationGateError";
    this.report = report;
    this.artifact = artifact;
  }
};

// src/core/review/review.ts
var ReviewRecommendation = {
  approve: "approve",
  request_changes: "request_changes",
  reject: "reject"
};
var ReviewSeverity = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical"
};
var ReviewFindingCategory = {
  correctness: "correctness",
  security: "security",
  maintainability: "maintainability",
  test_quality: "test_quality",
  suspicious_change: "suspicious_change",
  unrelated_change: "unrelated_change",
  excessive_change: "excessive_change",
  validation: "validation"
};
var PublicApiChangeKind = {
  added: "added",
  modified: "modified",
  removed: "removed"
};
var DiffLineType = {
  addition: "addition",
  deletion: "deletion",
  context: "context"
};
var recommendationSchema = z.enum([
  ReviewRecommendation.approve,
  ReviewRecommendation.request_changes,
  ReviewRecommendation.reject
]);
var severitySchema = z.enum([
  ReviewSeverity.low,
  ReviewSeverity.medium,
  ReviewSeverity.high,
  ReviewSeverity.critical
]);
var findingCategorySchema = z.enum([
  ReviewFindingCategory.correctness,
  ReviewFindingCategory.security,
  ReviewFindingCategory.maintainability,
  ReviewFindingCategory.test_quality,
  ReviewFindingCategory.suspicious_change,
  ReviewFindingCategory.unrelated_change,
  ReviewFindingCategory.excessive_change,
  ReviewFindingCategory.validation
]);
var publicApiChangeKindSchema = z.enum([
  PublicApiChangeKind.added,
  PublicApiChangeKind.modified,
  PublicApiChangeKind.removed
]);
var diffLineTypeSchema = z.enum([
  DiffLineType.addition,
  DiffLineType.deletion,
  DiffLineType.context
]);
var repositoryRelativePathSchema5 = z.string().trim().min(1).max(500).refine(isRepositoryRelativePath5, {
  message: "Path must be repository-relative"
});
var diffEvidenceReferenceSchema = z.object({
  filePath: repositoryRelativePathSchema5,
  hunkHeader: z.string().trim().min(1).max(500).startsWith("@@"),
  lineType: diffLineTypeSchema,
  lineNumber: z.number().int().positive(),
  lineContent: z.string().max(4e3)
}).strict();
var reviewFindingSchema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  category: findingCategorySchema,
  severity: severitySchema,
  blocking: z.boolean(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(3e3),
  evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
}).strict();
var reviewRiskSchema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  severity: severitySchema,
  blocking: z.boolean(),
  description: z.string().trim().min(1).max(3e3),
  mitigation: z.string().trim().min(1).max(2e3).optional(),
  evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
}).strict();
var publicApiChangeSchema = z.object({
  kind: publicApiChangeKindSchema,
  filePath: repositoryRelativePathSchema5,
  symbol: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().min(1).max(3e3),
  evidence: z.array(diffEvidenceReferenceSchema).min(1).max(20)
}).strict();
var reviewDecisionSchema = z.object({
  recommendation: recommendationSchema,
  summary: z.string().trim().min(1).max(4e3),
  findings: z.array(reviewFindingSchema).max(100),
  risks: z.array(reviewRiskSchema).max(100),
  publicApiChanges: z.array(publicApiChangeSchema).max(100),
  workspaceRevision: z.string().trim().min(1)
}).strict().superRefine((decision, context) => {
  const findingIds = new Set(
    decision.findings.map((finding) => finding.id)
  );
  if (findingIds.size !== decision.findings.length) {
    context.addIssue({
      code: "custom",
      path: ["findings"],
      message: "Review contains duplicate finding identifiers"
    });
  }
  const riskIds = new Set(decision.risks.map((risk) => risk.id));
  if (riskIds.size !== decision.risks.length) {
    context.addIssue({
      code: "custom",
      path: ["risks"],
      message: "Review contains duplicate risk identifiers"
    });
  }
  const hasBlockingIssue = decision.findings.some((finding) => finding.blocking) || decision.risks.some((risk) => risk.blocking);
  if (decision.recommendation === ReviewRecommendation.approve && hasBlockingIssue) {
    context.addIssue({
      code: "custom",
      path: ["recommendation"],
      message: "Review cannot approve changes with blocking issues"
    });
  }
});
var reviewerContextSnapshotSchema = z.object({
  agent: z.literal("reviewer" /* reviewer */),
  createdAt: z.string().trim().min(1),
  estimatedTokens: z.number().int().nonnegative(),
  context: z.object({
    runId: z.string().trim().min(1),
    task: z.string().trim().min(1),
    workspaceRevision: z.string().trim().min(1),
    artifactIds: z.array(z.string().trim().min(1)),
    evidence: z.array(z.unknown()).max(0),
    constraints: z.array(z.string()),
    summary: z.string().optional()
  }).strict()
}).strict();
var reviewInputSchema = z.object({
  context: reviewerContextSnapshotSchema,
  finalDiff: z.string().trim().min(1).max(2e6),
  changedFiles: z.array(repositoryRelativePathSchema5).min(1).max(200),
  validationReport: mechanicalValidationReportSchema
}).strict().superRefine((input, context) => {
  const expectedRevision = input.context.context.workspaceRevision;
  if (input.context.context.runId !== input.validationReport.runId) {
    context.addIssue({
      code: "custom",
      path: ["validationReport", "runId"],
      message: "Review context and validation run identifiers do not match"
    });
  }
  if (expectedRevision !== input.validationReport.workspaceRevision) {
    context.addIssue({
      code: "custom",
      path: ["validationReport", "workspaceRevision"],
      message: "Review context and validation revisions do not match"
    });
  }
  const uniqueChangedFiles = new Set(input.changedFiles);
  if (uniqueChangedFiles.size !== input.changedFiles.length) {
    context.addIssue({
      code: "custom",
      path: ["changedFiles"],
      message: "Review input contains duplicate changed files"
    });
  }
  if (!haveSameStrings(
    input.changedFiles,
    input.validationReport.changedFiles
  )) {
    context.addIssue({
      code: "custom",
      path: ["changedFiles"],
      message: "Review changed files do not match validation report"
    });
  }
});
function haveSameStrings(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const leftValues = [...left].sort();
  const rightValues = [...right].sort();
  return leftValues.every((value, index) => value === rightValues[index]);
}
__name(haveSameStrings, "haveSameStrings");
function isRepositoryRelativePath5(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
__name(isRepositoryRelativePath5, "isRepositoryRelativePath");

// src/core/review/reviewer-errors.ts
var ReviewerError = class extends Error {
  static {
    __name(this, "ReviewerError");
  }
  code;
  retryable;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "ReviewerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
};

// src/application/reviewer/final-diff-analyzer.ts
var ReviewDiffSignalKind = {
  disabled_test: "disabled_test",
  removed_test: "removed_test",
  validation_suppression: "validation_suppression",
  public_api_candidate: "public_api_candidate",
  dependency_change: "dependency_change"
};
var diffHeaderPattern3 = /^diff --git a\/(.+) b\/(.+)$/;
var hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
var disabledTestPattern = /\b(?:it|test|describe)\.skip\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/;
var testDeclarationPattern = /\b(?:it|test|describe)\s*\(/;
var validationSuppressionPattern = /@ts-ignore|@ts-nocheck|eslint-disable|istanbul ignore|c8 ignore/i;
var publicApiPattern = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum|\{)/;
var FinalDiffAnalyzer = class {
  static {
    __name(this, "FinalDiffAnalyzer");
  }
  analyze(finalDiff) {
    if (finalDiff.includes("GIT binary patch") || finalDiff.includes("Binary files ")) {
      throw new ReviewerError(
        "Reviewer cannot inspect binary diff content",
        "invalid_diff" /* invalid_diff */
      );
    }
    const files = [];
    const signals = [];
    let currentFile = null;
    let position = null;
    const lines = finalDiff.split(/\r?\n/);
    for (const line of lines) {
      const fileMatch = diffHeaderPattern3.exec(line);
      if (fileMatch !== null) {
        const sourcePath = fileMatch[1];
        const targetPath = fileMatch[2];
        if (sourcePath === void 0 || targetPath === void 0) {
          throw new ReviewerError(
            "Final diff contains an invalid file header",
            "invalid_diff" /* invalid_diff */
          );
        }
        currentFile = {
          path: targetPath,
          addedLines: 0,
          deletedLines: 0,
          lines: []
        };
        files.push(currentFile);
        position = null;
        continue;
      }
      if (currentFile === null) {
        continue;
      }
      const hunkMatch = hunkHeaderPattern.exec(line);
      if (hunkMatch !== null) {
        const oldLine = Number(hunkMatch[1]);
        const newLine = Number(hunkMatch[2]);
        position = {
          oldLine,
          newLine,
          hunkHeader: line
        };
        continue;
      }
      if (position === null) {
        continue;
      }
      if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("\\")) {
        continue;
      }
      if (line.startsWith("+")) {
        const parsedLine = createParsedLine(
          DiffLineType.addition,
          position.newLine,
          line.slice(1),
          position.hunkHeader
        );
        currentFile.lines.push(parsedLine);
        currentFile.addedLines += 1;
        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        );
        position = {
          ...position,
          newLine: position.newLine + 1
        };
        continue;
      }
      if (line.startsWith("-")) {
        const parsedLine = createParsedLine(
          DiffLineType.deletion,
          position.oldLine,
          line.slice(1),
          position.hunkHeader
        );
        currentFile.lines.push(parsedLine);
        currentFile.deletedLines += 1;
        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        );
        position = {
          ...position,
          oldLine: position.oldLine + 1
        };
        continue;
      }
      if (line.startsWith(" ")) {
        const parsedLine = createParsedLine(
          DiffLineType.context,
          position.newLine,
          line.slice(1),
          position.hunkHeader
        );
        currentFile.lines.push(parsedLine);
        signals.push(
          ...detectSignals(currentFile.path, parsedLine, signals.length)
        );
        position = {
          ...position,
          oldLine: position.oldLine + 1,
          newLine: position.newLine + 1
        };
      }
    }
    if (files.length === 0) {
      throw new ReviewerError(
        "Final diff does not contain changed files",
        "invalid_diff" /* invalid_diff */
      );
    }
    const totalAddedLines = files.reduce(
      (total, file) => total + file.addedLines,
      0
    );
    const totalDeletedLines = files.reduce(
      (total, file) => total + file.deletedLines,
      0
    );
    const normalizedSignals = removeRedundantRemovedTestSignals(signals);
    return {
      files,
      totalAddedLines,
      totalDeletedLines,
      excessive: files.length > 10 || totalAddedLines + totalDeletedLines > 300,
      signals: normalizedSignals
    };
  }
};
function createParsedLine(type, lineNumber, content, hunkHeader) {
  return {
    type,
    lineNumber,
    content,
    hunkHeader
  };
}
__name(createParsedLine, "createParsedLine");
function detectSignals(filePath, line, currentSignalCount) {
  const signals = [];
  if (line.type === DiffLineType.addition && disabledTestPattern.test(line.content)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.disabled_test,
        "Diff adds a disabled test",
        true,
        filePath,
        line
      )
    );
  }
  if (line.type === DiffLineType.deletion && isTestFile(filePath) && testDeclarationPattern.test(line.content)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.removed_test,
        "Diff removes an existing test declaration",
        true,
        filePath,
        line
      )
    );
  }
  if (line.type === DiffLineType.addition && validationSuppressionPattern.test(line.content)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.validation_suppression,
        "Diff adds a validation suppression directive",
        true,
        filePath,
        line
      )
    );
  }
  if (publicApiPattern.test(line.content)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.public_api_candidate,
        "Diff may change a public export",
        false,
        filePath,
        line
      )
    );
  }
  if (line.type === DiffLineType.addition && isDependencyFile(filePath)) {
    signals.push(
      createSignal(
        currentSignalCount + signals.length,
        ReviewDiffSignalKind.dependency_change,
        "Diff changes dependency metadata",
        false,
        filePath,
        line
      )
    );
  }
  return signals;
}
__name(detectSignals, "detectSignals");
function createSignal(index, kind, message, mandatory, filePath, line) {
  return {
    id: `diff-signal-${index + 1}`,
    kind,
    message,
    mandatory,
    evidence: {
      filePath,
      hunkHeader: line.hunkHeader,
      lineType: line.type,
      lineNumber: line.lineNumber,
      lineContent: line.content
    }
  };
}
__name(createSignal, "createSignal");
function isTestFile(filePath) {
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.includes("/tests/") || normalizedPath.startsWith("tests/") || normalizedPath.includes("/__tests__/") || normalizedPath.includes(".test.") || normalizedPath.includes(".spec.");
}
__name(isTestFile, "isTestFile");
function isDependencyFile(filePath) {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  return fileName === "package.json" || fileName === "package-lock.json" || fileName === "npm-shrinkwrap.json" || fileName === "pnpm-lock.yaml" || fileName === "yarn.lock";
}
__name(isDependencyFile, "isDependencyFile");
function removeRedundantRemovedTestSignals(signals) {
  return signals.filter((signal) => {
    if (signal.kind !== ReviewDiffSignalKind.removed_test) {
      return true;
    }
    const replacedByDisabledTest = signals.some(
      (candidate) => candidate.kind === ReviewDiffSignalKind.disabled_test && candidate.evidence.filePath === signal.evidence.filePath && candidate.evidence.hunkHeader === signal.evidence.hunkHeader && normalizeTestDeclaration(candidate.evidence.lineContent) === normalizeTestDeclaration(signal.evidence.lineContent)
    );
    return !replacedByDisabledTest;
  });
}
__name(removeRedundantRemovedTestSignals, "removeRedundantRemovedTestSignals");
function normalizeTestDeclaration(value) {
  return value.replace(/\b(it|test|describe)\.skip\s*\(/, "$1(").replace(/\bxit\s*\(/, "it(").replace(/\bxtest\s*\(/, "test(").replace(/\bxdescribe\s*\(/, "describe(").trim();
}
__name(normalizeTestDeclaration, "normalizeTestDeclaration");

// src/application/reviewer/review-result-validator.ts
var ReviewResultValidator = class {
  static {
    __name(this, "ReviewResultValidator");
  }
  validate(decision, input, analysis) {
    const expectedRevision = input.context.context.workspaceRevision;
    if (decision.workspaceRevision !== expectedRevision) {
      throw new ReviewerError(
        "Review result belongs to a stale workspace",
        "stale_workspace" /* stale_workspace */,
        {
          retryable: true
        }
      );
    }
    const diffFiles = analysis.files.map((file) => file.path);
    if (!haveSameStrings2(diffFiles, input.changedFiles)) {
      throw new ReviewerError(
        "Final diff files do not match review changed files",
        "changed_files_mismatch" /* changed_files_mismatch */
      );
    }
    const allEvidence = collectReviewEvidence(decision);
    for (const evidence of allEvidence) {
      this.assertGroundedEvidence(evidence, analysis);
    }
    if (!input.validationReport.passed && decision.recommendation === ReviewRecommendation.approve) {
      throw new ReviewerError(
        "Reviewer approved changes with failed mechanical validation",
        "invalid_recommendation" /* invalid_recommendation */,
        {
          retryable: true
        }
      );
    }
    this.assertMandatorySignalsReviewed(decision, analysis);
    if (analysis.excessive && !decision.findings.some(
      (finding) => finding.category === ReviewFindingCategory.excessive_change
    )) {
      throw new ReviewerError(
        "Reviewer did not report an excessive final diff",
        "missed_excessive_change" /* missed_excessive_change */,
        {
          retryable: true
        }
      );
    }
    return decision;
  }
  assertGroundedEvidence(evidence, analysis) {
    const file = analysis.files.find(
      (candidate) => candidate.path === evidence.filePath
    );
    if (file === void 0) {
      throw new ReviewerError(
        `Review evidence references missing diff file: ` + evidence.filePath,
        "ungrounded_finding" /* ungrounded_finding */,
        {
          retryable: true
        }
      );
    }
    const matchingLine = file.lines.find(
      (line) => line.hunkHeader === evidence.hunkHeader && line.type === evidence.lineType && line.lineNumber === evidence.lineNumber && line.content === evidence.lineContent
    );
    if (matchingLine === void 0) {
      throw new ReviewerError(
        `Review evidence does not exist in final diff: ${evidence.filePath}:${evidence.lineNumber}`,
        "ungrounded_finding" /* ungrounded_finding */,
        {
          retryable: true
        }
      );
    }
  }
  assertMandatorySignalsReviewed(decision, analysis) {
    const reviewedEvidenceKeys = new Set(
      collectReviewEvidence(decision).map(createEvidenceKey)
    );
    for (const signal of analysis.signals) {
      if (!signal.mandatory) {
        continue;
      }
      if (!reviewedEvidenceKeys.has(createEvidenceKey(signal.evidence))) {
        throw new ReviewerError(
          `Reviewer ignored suspicious diff signal: ${signal.kind}`,
          "missed_suspicious_change" /* missed_suspicious_change */,
          {
            retryable: true
          }
        );
      }
    }
  }
};
function collectReviewEvidence(decision) {
  return [
    ...decision.findings.flatMap((finding) => finding.evidence),
    ...decision.risks.flatMap((risk) => risk.evidence),
    ...decision.publicApiChanges.flatMap((change) => change.evidence)
  ];
}
__name(collectReviewEvidence, "collectReviewEvidence");
function createEvidenceKey(evidence) {
  return [
    evidence.filePath,
    evidence.hunkHeader,
    evidence.lineType,
    evidence.lineNumber,
    evidence.lineContent
  ].join("\0");
}
__name(createEvidenceKey, "createEvidenceKey");
function haveSameStrings2(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const leftValues = [...left].sort();
  const rightValues = [...right].sort();
  return leftValues.every((value, index) => value === rightValues[index]);
}
__name(haveSameStrings2, "haveSameStrings");
var repositoryRelativePathSchema6 = z.string().trim().min(1).max(500);
var processResultArtifactSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("command.result"),
  relativePath: repositoryRelativePathSchema6
}).strict();
var processOperationResultSchema = z.object({
  executionId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1),
  operation: z.enum([
    "runTests" /* run_tests */,
    "runTypecheck" /* run_typecheck */,
    "runLint" /* run_lint */,
    "runBuild" /* run_build */
  ]),
  command: z.object({
    executable: z.string().trim().min(1),
    args: z.array(z.string())
  }).strict(),
  cwd: z.string().trim().min(1),
  startedAt: z.string().trim().min(1),
  completedAt: z.string().trim().min(1),
  durationMs: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  succeeded: z.boolean(),
  artifact: processResultArtifactSchema
}).strict();
var storedArtifactSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  relativePath: repositoryRelativePathSchema6
}).strict();
var reproductionArtifactSchema = storedArtifactSchema.extend({
  type: z.literal("reproduction.test" /* reproduction_test */),
  workspaceRevision: z.string().trim().min(1)
});
var reproductionResultSchema = z.object({
  summary: z.string().trim().min(1).max(2e3),
  patch: z.string().trim().min(1).max(2e5),
  testFiles: z.array(repositoryRelativePathSchema6).min(1).max(20),
  expectedFailureMarker: z.string().trim().min(1).max(400),
  sourceWorkspaceRevision: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1),
  commandResult: processOperationResultSchema,
  artifacts: z.object({
    reproduction: reproductionArtifactSchema,
    patch: storedArtifactSchema,
    command: processResultArtifactSchema
  }).strict()
}).strict();
var implementationResultSchema = z.object({
  summary: z.string().trim().min(1).max(2e3),
  patch: z.string().trim().min(1).max(5e5),
  changedFiles: z.array(repositoryRelativePathSchema6).min(1).max(100),
  risks: z.array(z.string().trim().min(1).max(1e3)).max(20),
  sourceWorkspaceRevision: z.string().trim().min(1),
  workspaceRevision: z.string().trim().min(1),
  commandResult: processOperationResultSchema,
  artifacts: z.object({
    implementation: storedArtifactSchema,
    patch: storedArtifactSchema,
    command: processResultArtifactSchema
  }).strict()
}).strict();
var AgentOutputSchemaValidator = class {
  static {
    __name(this, "AgentOutputSchemaValidator");
  }
  validatePreReview(investigation, reproduction, implementation) {
    return {
      investigation: this.validateInvestigation(investigation),
      reproduction: this.validateReproduction(reproduction),
      implementation: this.validateImplementation(implementation)
    };
  }
  validateInvestigation(value) {
    return parseOutput(investigationResultSchema, value, "Investigator");
  }
  validateReproduction(value) {
    const result = parseOutput(
      reproductionResultSchema,
      value,
      "Reproducer"
    );
    parseOutput(
      reproductionPlanSchema,
      {
        summary: result.summary,
        patch: result.patch,
        testFiles: result.testFiles,
        expectedFailureMarker: result.expectedFailureMarker,
        workspaceRevision: result.sourceWorkspaceRevision
      },
      "Reproducer plan"
    );
    return result;
  }
  validateImplementation(value) {
    const result = parseOutput(
      implementationResultSchema,
      value,
      "Implementer"
    );
    parseOutput(
      implementationPlanSchema,
      {
        summary: result.summary,
        patch: result.patch,
        changedFiles: result.changedFiles,
        risks: result.risks,
        workspaceRevision: result.sourceWorkspaceRevision
      },
      "Implementer plan"
    );
    return result;
  }
  validateReview(value) {
    return parseOutput(reviewDecisionSchema, value, "Reviewer");
  }
};
function parseOutput(schema, value, agentName) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      `${agentName} output failed schema validation: ` + z.prettifyError(result.error),
      "agent_output_schema" /* agent_output_schema */,
      {
        cause: result.error
      }
    );
  }
  return result.data;
}
__name(parseOutput, "parseOutput");

// src/application/validation/changed-file-policy-validator.ts
var ChangedFilePolicyValidator = class {
  static {
    __name(this, "ChangedFilePolicyValidator");
  }
  getViolations(changedFiles, policy) {
    const allowedFiles = new Set(policy.allowedFiles);
    const forbiddenFiles = new Set(policy.forbiddenFiles);
    const violations = /* @__PURE__ */ new Set();
    for (const filePath of changedFiles) {
      if (!allowedFiles.has(filePath)) {
        violations.add(filePath);
      }
      if (forbiddenFiles.has(filePath)) {
        violations.add(filePath);
      }
      if (policy.forbiddenPrefixes.some(
        (prefix) => matchesPrefix(filePath, prefix)
      )) {
        violations.add(filePath);
      }
    }
    return [...violations].sort();
  }
};
function matchesPrefix(filePath, prefix) {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return filePath === normalizedPrefix || filePath.startsWith(`${normalizedPrefix}/`);
}
__name(matchesPrefix, "matchesPrefix");

// src/application/validation/evidence-reference-validator.ts
var EvidenceReferenceValidator = class {
  static {
    __name(this, "EvidenceReferenceValidator");
  }
  async validate(investigation, repositoryTools) {
    const files = await repositoryTools.listFiles();
    const existingFiles = new Set(files.map((file) => file.path));
    for (const filePath of investigation.relatedFiles) {
      if (!existingFiles.has(filePath)) {
        throw new ValidationError(
          `Investigation references missing file: ${filePath}`,
          "invalid_reference" /* invalid_reference */
        );
      }
    }
    const contentCache = /* @__PURE__ */ new Map();
    for (const evidence of investigation.evidence) {
      if (!evidence.confirmed) {
        throw new ValidationError(
          `Evidence ${evidence.id} is not confirmed`,
          "invalid_reference" /* invalid_reference */
        );
      }
      if (evidence.workspaceRevision !== investigation.workspaceRevision) {
        throw new ValidationError(
          `Evidence ${evidence.id} belongs to a stale workspace`,
          "invalid_reference" /* invalid_reference */
        );
      }
      if (!existingFiles.has(evidence.filePath)) {
        throw new ValidationError(
          `Evidence ${evidence.id} references missing file: ` + evidence.filePath,
          "invalid_reference" /* invalid_reference */
        );
      }
      const content = await this.getFileContent(
        evidence.filePath,
        repositoryTools,
        contentCache
      );
      const lines = content.split(/\r?\n/);
      if (evidence.lineStart > lines.length || evidence.lineEnd > lines.length) {
        throw new ValidationError(
          `Evidence ${evidence.id} contains an invalid line range`,
          "invalid_reference" /* invalid_reference */
        );
      }
      const selectedContent = lines.slice(evidence.lineStart - 1, evidence.lineEnd).join("\n");
      const symbolPattern = createSymbolPattern(evidence.symbol);
      if (!symbolPattern.test(selectedContent)) {
        throw new ValidationError(
          `Evidence ${evidence.id} references missing symbol ${evidence.symbol}`,
          "invalid_reference" /* invalid_reference */
        );
      }
    }
  }
  async getFileContent(filePath, repositoryTools, cache) {
    const cached = cache.get(filePath);
    if (cached !== void 0) {
      return cached;
    }
    const result = await repositoryTools.readFile(filePath);
    cache.set(filePath, result.content);
    return result.content;
  }
};
function createSymbolPattern(symbol) {
  const escaped = symbol.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9_$])${escaped}([^a-zA-Z0-9_$]|$)`);
}
__name(createSymbolPattern, "createSymbolPattern");

// src/application/validation/patch-application-validator.ts
var diffHeaderPattern4 = /^diff --git a\/(.+) b\/(.+)$/gm;
var PatchApplicationValidator = class {
  static {
    __name(this, "PatchApplicationValidator");
  }
  async validate(input, repositoryTools) {
    this.assertRevisionChain(input);
    this.assertCommandResult(
      input.reproduction.commandResult,
      input.runId,
      input.reproduction.workspaceRevision
    );
    this.assertCommandResult(
      input.implementation.commandResult,
      input.runId,
      input.implementation.workspaceRevision
    );
    const currentRevision = await repositoryTools.getWorkspaceRevision();
    if (currentRevision !== input.implementation.workspaceRevision) {
      throw new ValidationError(
        "Current workspace does not match the implementation revision",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    const reproductionPatchFiles = extractDiffFiles(
      input.reproduction.patch
    );
    assertSameFiles3(
      reproductionPatchFiles,
      input.reproduction.testFiles,
      "Reproduction patch files do not match reproduction output"
    );
    const implementationPatchFiles = extractDiffFiles(
      input.implementation.patch
    );
    assertSameFiles3(
      implementationPatchFiles,
      input.implementation.changedFiles,
      "Implementation patch files do not match implementation output"
    );
    assertNoOverlap(
      input.reproduction.testFiles,
      input.implementation.changedFiles
    );
    const expectedChangedFiles = uniqueSorted([
      ...input.reproduction.testFiles,
      ...input.implementation.changedFiles
    ]);
    const changedFiles = uniqueSorted(
      await repositoryTools.getChangedFiles()
    );
    assertSameFiles3(
      changedFiles,
      expectedChangedFiles,
      "Workspace changed files do not match applied agent patches"
    );
    const finalDiff = await repositoryTools.getDiff();
    if (finalDiff.trim().length === 0) {
      throw new ValidationError(
        "Final workspace diff is empty",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    const finalDiffFiles = extractDiffFiles(finalDiff);
    assertSameFiles3(
      finalDiffFiles,
      changedFiles,
      "Final diff files do not match workspace changed files"
    );
    return {
      finalDiff,
      changedFiles
    };
  }
  assertRevisionChain(input) {
    if (input.reproduction.sourceWorkspaceRevision !== input.investigation.workspaceRevision) {
      throw new ValidationError(
        "Reproduction patch does not originate from the investigation revision",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    if (input.implementation.sourceWorkspaceRevision !== input.reproduction.workspaceRevision) {
      throw new ValidationError(
        "Implementation patch does not originate from the reproduction revision",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    if (input.workspace.workspaceRevision !== input.implementation.workspaceRevision) {
      throw new ValidationError(
        "Final workspace snapshot does not match the implementation revision",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
  }
  assertCommandResult(result, expectedRunId, expectedRevision) {
    if (result.runId !== expectedRunId) {
      throw new ValidationError(
        "Command result belongs to another run",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    if (result.workspaceRevision !== expectedRevision) {
      throw new ValidationError(
        "Command result belongs to another workspace revision",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    if (result.operation !== "runTests" /* run_tests */) {
      throw new ValidationError(
        "Agent command result is not a test operation",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
  }
};
function extractDiffFiles(patch) {
  const files = [];
  diffHeaderPattern4.lastIndex = 0;
  let match;
  while ((match = diffHeaderPattern4.exec(patch)) !== null) {
    const sourcePath = match[1];
    const targetPath = match[2];
    if (sourcePath === void 0 || targetPath === void 0 || sourcePath !== targetPath) {
      throw new ValidationError(
        "Diff contains an invalid file header or rename",
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
    files.push(targetPath);
  }
  if (files.length === 0) {
    throw new ValidationError(
      "Diff does not contain changed files",
      "invalid_patch_application" /* invalid_patch_application */
    );
  }
  return uniqueSorted(files);
}
__name(extractDiffFiles, "extractDiffFiles");
function assertNoOverlap(reproductionFiles, implementationFiles) {
  const reproductionSet = new Set(reproductionFiles);
  const overlappingFile = implementationFiles.find(
    (filePath) => reproductionSet.has(filePath)
  );
  if (overlappingFile !== void 0) {
    throw new ValidationError(
      `Implementation modifies reproduction test: ${overlappingFile}`,
      "invalid_patch_application" /* invalid_patch_application */
    );
  }
}
__name(assertNoOverlap, "assertNoOverlap");
function assertSameFiles3(actual, expected, message) {
  const normalizedActual = uniqueSorted(actual);
  const normalizedExpected = uniqueSorted(expected);
  if (normalizedActual.length !== normalizedExpected.length) {
    throw new ValidationError(
      message,
      "invalid_patch_application" /* invalid_patch_application */
    );
  }
  for (let index = 0; index < normalizedActual.length; index += 1) {
    if (normalizedActual[index] !== normalizedExpected[index]) {
      throw new ValidationError(
        message,
        "invalid_patch_application" /* invalid_patch_application */
      );
    }
  }
}
__name(assertSameFiles3, "assertSameFiles");
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
__name(uniqueSorted, "uniqueSorted");

// src/application/validation/deterministic-validation-service.ts
var validationStep = "validation";
var orderedCheckIds = [
  ValidationCheckId.agent_output_schema,
  ValidationCheckId.evidence_references,
  ValidationCheckId.patch_application,
  ValidationCheckId.reproduction_failure,
  ValidationCheckId.reproduction_success,
  ValidationCheckId.full_test_suite,
  ValidationCheckId.typecheck,
  ValidationCheckId.lint,
  ValidationCheckId.build,
  ValidationCheckId.changed_file_policy
];
var DeterministicValidationService = class {
  constructor(repositoryToolsFactory, processRunnerFactory, reportStore, traceRecorder, logger, agentOutputValidator = new AgentOutputSchemaValidator(), evidenceValidator = new EvidenceReferenceValidator(), patchValidator = new PatchApplicationValidator(), reproductionGate = new ReproductionGate(), implementationGate = new ImplementationGate(), changedFilePolicyValidator = new ChangedFilePolicyValidator(), now = () => /* @__PURE__ */ new Date()) {
    this.repositoryToolsFactory = repositoryToolsFactory;
    this.processRunnerFactory = processRunnerFactory;
    this.reportStore = reportStore;
    this.traceRecorder = traceRecorder;
    this.logger = logger;
    this.agentOutputValidator = agentOutputValidator;
    this.evidenceValidator = evidenceValidator;
    this.patchValidator = patchValidator;
    this.reproductionGate = reproductionGate;
    this.implementationGate = implementationGate;
    this.changedFilePolicyValidator = changedFilePolicyValidator;
    this.now = now;
  }
  repositoryToolsFactory;
  processRunnerFactory;
  reportStore;
  traceRecorder;
  logger;
  agentOutputValidator;
  evidenceValidator;
  patchValidator;
  reproductionGate;
  implementationGate;
  changedFilePolicyValidator;
  now;
  static {
    __name(this, "DeterministicValidationService");
  }
  async execute(input) {
    this.assertValidInput(input);
    const logger = this.logger.child({
      runId: input.runId,
      step: validationStep,
      workspaceRevision: input.workspace.workspaceRevision
    });
    const checks = [];
    let finalDiff = "";
    let changedFiles = [];
    let forbiddenFiles = [];
    const repositoryTools = this.repositoryToolsFactory.create(
      input.workspace
    );
    const schemaPassed = await this.runCheck(
      checks,
      ValidationCheckId.agent_output_schema,
      async () => {
        this.agentOutputValidator.validatePreReview(
          input.investigation,
          input.reproduction,
          input.implementation
        );
        return {
          message: "Investigator, reproducer, and implementer outputs match their schemas"
        };
      }
    );
    if (!schemaPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const evidencePassed = await this.runCheck(
      checks,
      ValidationCheckId.evidence_references,
      async () => {
        await this.evidenceValidator.validate(
          input.investigation,
          repositoryTools
        );
        return {
          message: "Investigation files, symbols, and evidence references exist"
        };
      }
    );
    if (!evidencePassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const patchPassed = await this.runCheck(
      checks,
      ValidationCheckId.patch_application,
      async () => {
        const result = await this.patchValidator.validate(
          {
            runId: input.runId,
            investigation: input.investigation,
            reproduction: input.reproduction,
            implementation: input.implementation,
            workspace: input.workspace
          },
          repositoryTools
        );
        finalDiff = result.finalDiff;
        changedFiles = result.changedFiles;
        return {
          message: "Patch revision chain and final workspace diff are valid"
        };
      }
    );
    if (!patchPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const reproductionFailurePassed = await this.runCheck(
      checks,
      ValidationCheckId.reproduction_failure,
      async () => {
        this.reproductionGate.assertExpectedFailure(
          input.reproduction.commandResult,
          input.reproduction.expectedFailureMarker
        );
        return {
          message: "Reproduction test failed before implementation for the expected reason",
          artifact: input.reproduction.commandResult.artifact
        };
      }
    );
    if (!reproductionFailurePassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const reproductionSuccessPassed = await this.runCheck(
      checks,
      ValidationCheckId.reproduction_success,
      async () => {
        this.implementationGate.assertReproductionFixed(
          input.implementation.commandResult,
          input.reproduction.expectedFailureMarker
        );
        return {
          message: "Reproduction test passed after implementation",
          artifact: input.implementation.commandResult.artifact
        };
      }
    );
    if (!reproductionSuccessPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const processRunner = this.processRunnerFactory.create(input.workspace);
    const testsPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.full_test_suite,
      () => processRunner.runTests(),
      "Full test suite passed"
    );
    if (!testsPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const typecheckPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.typecheck,
      () => processRunner.runTypecheck(),
      "Typecheck passed"
    );
    if (!typecheckPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const lintPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.lint,
      () => processRunner.runLint(),
      "Lint passed"
    );
    if (!lintPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const buildPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.build,
      () => processRunner.runBuild(),
      "Build passed"
    );
    if (!buildPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    const policyPassed = await this.runCheck(
      checks,
      ValidationCheckId.changed_file_policy,
      () => {
        forbiddenFiles = this.changedFilePolicyValidator.getViolations(
          changedFiles,
          input.filePolicy
        );
        if (forbiddenFiles.length > 0) {
          throw new ValidationError(
            `Changed file policy rejected: ` + forbiddenFiles.join(", "),
            "changed_file_policy" /* changed_file_policy */
          );
        }
        return Promise.resolve({
          message: "Changed files satisfy allowed and forbidden file policies"
        });
      }
    );
    if (!policyPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      );
    }
    return this.finishPassed(
      input,
      checks,
      finalDiff,
      changedFiles,
      logger
    );
  }
  assertValidInput(input) {
    if (input.runId !== input.workspace.runId) {
      throw new ValidationError(
        "Validation run and workspace identifiers do not match",
        "invalid_input" /* invalid_input */
      );
    }
    const policyResult = validationFilePolicySchema.safeParse(
      input.filePolicy
    );
    if (!policyResult.success) {
      throw new ValidationError(
        "Validation file policy is invalid",
        "invalid_input" /* invalid_input */,
        {
          cause: policyResult.error
        }
      );
    }
  }
  async runProcessCheck(checks, id, operation, successMessage) {
    return this.runCheck(checks, id, async () => {
      const result = await operation();
      assertSuccessfulProcessResult(result);
      return {
        message: successMessage,
        artifact: result.artifact
      };
    });
  }
  async runCheck(checks, id, operation) {
    try {
      const result = await operation();
      checks.push({
        id,
        status: MechanicalValidationCheckStatus.passed,
        required: true,
        message: result.message,
        ...result.artifact === void 0 ? {} : {
          artifact: result.artifact
        }
      });
      return true;
    } catch (error) {
      checks.push({
        id,
        status: MechanicalValidationCheckStatus.failed,
        required: true,
        message: getErrorMessage(error)
      });
      return false;
    }
  }
  finishPassed(input, checks, finalDiff, changedFiles, logger) {
    return this.finish(
      input,
      checks,
      finalDiff,
      changedFiles,
      [],
      true,
      logger
    );
  }
  finishFailed(input, checks, finalDiff, changedFiles, forbiddenFiles, logger) {
    return this.finish(
      input,
      checks,
      finalDiff,
      changedFiles,
      forbiddenFiles,
      false,
      logger
    ).then((result) => {
      throw new ValidationGateError(result.report, result.artifact);
    });
  }
  async finish(input, completedChecks, finalDiff, changedFiles, forbiddenFiles, passed, logger) {
    const checks = [...completedChecks];
    const completedIds = new Set(checks.map((check) => check.id));
    for (const id of orderedCheckIds) {
      if (completedIds.has(id)) {
        continue;
      }
      checks.push({
        id,
        status: MechanicalValidationCheckStatus.skipped,
        required: true,
        message: "Skipped because an earlier deterministic gate failed"
      });
    }
    const report = mechanicalValidationReportSchema.parse({
      schemaVersion: 1,
      runId: input.runId,
      workspaceRevision: input.workspace.workspaceRevision,
      generatedAt: this.now().toISOString(),
      passed,
      changedFiles: [...changedFiles],
      forbiddenFiles: [...forbiddenFiles],
      checks
    });
    let artifact;
    try {
      artifact = await this.reportStore.save(report);
    } catch (error) {
      throw new ValidationError(
        "Failed to save final validation report",
        "report_save_failed" /* report_save_failed */,
        {
          cause: error
        }
      );
    }
    await this.traceRecorder.record({
      runId: input.runId,
      step: validationStep,
      workspaceRevision: input.workspace.workspaceRevision,
      type: "validation.result" /* validation_result */,
      output: {
        report,
        artifact
      }
    });
    logger.info("Deterministic validation completed", {
      passed: report.passed,
      changedFileCount: report.changedFiles.length,
      forbiddenFileCount: report.forbiddenFiles.length
    });
    return {
      report,
      artifact,
      finalDiff,
      changedFiles
    };
  }
};
function assertSuccessfulProcessResult(result) {
  if (result.timedOut || !result.succeeded || result.exitCode !== 0) {
    throw new ValidationError(
      `${result.operation} failed with exit code ` + String(result.exitCode),
      "process_check_failed" /* process_check_failed */
    );
  }
}
__name(assertSuccessfulProcessResult, "assertSuccessfulProcessResult");
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown validation failure";
}
__name(getErrorMessage, "getErrorMessage");

// src/application/reviewer/reviewer-agent.ts
var reviewerStep = "reviewer";
var ModelReviewerAgent = class {
  constructor(modelProvider, promptRegistry, artifactStore, traceRecorder, logger, diffAnalyzer = new FinalDiffAnalyzer(), resultValidator = new ReviewResultValidator(), agentOutputValidator = new AgentOutputSchemaValidator()) {
    this.modelProvider = modelProvider;
    this.promptRegistry = promptRegistry;
    this.artifactStore = artifactStore;
    this.traceRecorder = traceRecorder;
    this.logger = logger;
    this.diffAnalyzer = diffAnalyzer;
    this.resultValidator = resultValidator;
    this.agentOutputValidator = agentOutputValidator;
  }
  modelProvider;
  promptRegistry;
  artifactStore;
  traceRecorder;
  logger;
  diffAnalyzer;
  resultValidator;
  agentOutputValidator;
  static {
    __name(this, "ModelReviewerAgent");
  }
  async execute(input) {
    this.assertValidInput(input);
    const workspaceRevision = input.context.context.workspaceRevision;
    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: reviewerStep,
      agent: "reviewer" /* reviewer */,
      workspaceRevision
    });
    let promptVersion;
    try {
      const prompt = await this.promptRegistry.load("reviewer" /* reviewer */);
      promptVersion = prompt.id;
      const diffAnalysis = this.diffAnalyzer.analyze(input.finalDiff);
      const modelResult = await this.modelProvider.generate({
        input: [
          {
            type: "message",
            role: "system",
            content: prompt.content
          },
          {
            type: "message",
            role: "user",
            content: JSON.stringify({
              context: {
                runId: input.context.context.runId,
                task: input.context.context.task,
                workspaceRevision,
                constraints: input.context.context.constraints
              },
              changedFiles: input.changedFiles,
              finalDiff: input.finalDiff,
              mechanicalValidation: input.validationReport,
              diffSummary: {
                files: diffAnalysis.files.map((file) => ({
                  path: file.path,
                  addedLines: file.addedLines,
                  deletedLines: file.deletedLines
                })),
                totalAddedLines: diffAnalysis.totalAddedLines,
                totalDeletedLines: diffAnalysis.totalDeletedLines,
                excessive: diffAnalysis.excessive,
                signals: diffAnalysis.signals
              }
            })
          }
        ],
        outputSchemaName: "review_decision",
        outputSchema: reviewDecisionSchema
      });
      await this.recordModelCall(input, prompt.id, modelResult);
      if (modelResult.toolCalls.length > 0) {
        throw new ReviewerError(
          "Reviewer returned an unexpected tool call",
          "unexpected_tool_call" /* unexpected_tool_call */
        );
      }
      if (modelResult.output === void 0) {
        throw new ReviewerError(
          "Reviewer returned no structured output",
          "missing_output" /* missing_output */,
          {
            retryable: true
          }
        );
      }
      const decision = this.agentOutputValidator.validateReview(
        modelResult.output
      );
      const validatedDecision = this.resultValidator.validate(
        decision,
        input,
        diffAnalysis
      );
      const artifact = await this.saveArtifact(
        input,
        prompt.id,
        validatedDecision
      );
      const result = {
        ...validatedDecision,
        promptVersion: prompt.id,
        artifact
      };
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reviewerStep,
        agent: "reviewer" /* reviewer */,
        workspaceRevision,
        type: "agent.result" /* agent_result */,
        promptVersion: prompt.id,
        output: {
          recommendation: result.recommendation,
          summary: result.summary,
          findings: result.findings,
          risks: result.risks,
          publicApiChanges: result.publicApiChanges,
          artifact: result.artifact
        }
      });
      logger.info("Review completed", {
        recommendation: result.recommendation,
        findingCount: result.findings.length,
        riskCount: result.risks.length,
        publicApiChangeCount: result.publicApiChanges.length
      });
      return result;
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger);
      logger.error("Review failed", {
        error
      });
      throw error;
    }
  }
  assertValidInput(input) {
    const result = reviewInputSchema.safeParse(input);
    if (!result.success) {
      throw new ReviewerError(
        "Review input failed schema validation: " + z.prettifyError(result.error),
        "invalid_input" /* invalid_input */,
        {
          cause: result.error
        }
      );
    }
  }
  async saveArtifact(input, promptVersion, decision) {
    try {
      return await this.artifactStore.save({
        runId: input.context.context.runId,
        promptVersion,
        decision,
        finalDiff: input.finalDiff,
        validationReport: input.validationReport
      });
    } catch (error) {
      throw new ReviewerError(
        "Failed to save review artifact",
        "artifact_save_failed" /* artifact_save_failed */,
        {
          cause: error
        }
      );
    }
  }
  recordModelCall(input, promptVersion, result) {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reviewerStep,
      agent: "reviewer" /* reviewer */,
      workspaceRevision: input.context.context.workspaceRevision,
      type: "agent.call" /* agent_call */,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      output: {
        returnedStructuredOutput: result.output !== void 0,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    });
  }
  async recordFailure(input, promptVersion, error, logger) {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reviewerStep,
        agent: "reviewer" /* reviewer */,
        workspaceRevision: input.context.context.workspaceRevision,
        type: "failure" /* failure */,
        error: toTraceError5(error),
        ...promptVersion === void 0 ? {} : {
          promptVersion
        }
      });
    } catch (traceError) {
      logger.warn("Failed to record reviewer failure", {
        traceError
      });
    }
  }
};
function toTraceError5(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown reviewer failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError5, "toTraceError");

// src/application/run/run-command-handler.ts
var RunCommandHandler = class {
  constructor(runService, repositoryValidator, workspaceManager, pipelineOrchestrator, output, logger, traceRecorder) {
    this.runService = runService;
    this.repositoryValidator = repositoryValidator;
    this.workspaceManager = workspaceManager;
    this.pipelineOrchestrator = pipelineOrchestrator;
    this.output = output;
    this.logger = logger;
    this.traceRecorder = traceRecorder;
  }
  runService;
  repositoryValidator;
  workspaceManager;
  pipelineOrchestrator;
  output;
  logger;
  traceRecorder;
  static {
    __name(this, "RunCommandHandler");
  }
  async execute(input) {
    let state = await this.runService.create(input);
    const logger = this.logger.child({
      runId: state.runId,
      step: "run-command"
    });
    this.output.writeLine(`Run created: ${state.runId}`);
    this.output.writeLine(`Run directory: ${state.runDirectory}`);
    try {
      state = await this.runService.startStep(
        state,
        "validate_target" /* validate_target */,
        "validating" /* validating */
      );
      this.printProgress(state, "Validating target repository");
      const validation = await this.repositoryValidator.validate(
        state.repositoryPath
      );
      await this.runService.saveValidation(state, validation);
      await this.traceRecorder.record({
        runId: state.runId,
        step: "validate_target" /* validate_target */,
        type: "validation.result" /* validation_result */,
        output: validation
      });
      this.printValidation(validation);
      if (!validation.passed) {
        throw new Error("Target repository validation failed");
      }
      state = await this.runService.completeStep(
        state,
        "validate_target" /* validate_target */,
        "ready" /* ready */,
        "Target repository validation passed"
      );
      state = await this.runService.startStep(
        state,
        "prepare_workspace" /* prepare_workspace */,
        "preparing_workspace" /* preparing_workspace */
      );
      this.printProgress(state, "Creating isolated Git workspace");
      const workspace = await this.workspaceManager.create({
        runId: state.runId,
        repositoryPath: state.repositoryPath
      });
      state = await this.runService.attachWorkspace(state, workspace);
      await this.traceRecorder.record({
        runId: state.runId,
        step: "prepare_workspace" /* prepare_workspace */,
        workspaceRevision: workspace.workspaceRevision,
        type: "tool.result" /* tool_result */,
        output: {
          workspacePath: workspace.workspacePath,
          baseCommit: workspace.baseCommit,
          workspaceRevision: workspace.workspaceRevision
        }
      });
      this.output.writeLine(`Workspace: ${workspace.workspacePath}`);
      this.output.writeLine(`Base commit: ${workspace.baseCommit}`);
      const result = await this.pipelineOrchestrator.execute({
        state,
        workspace
      });
      this.output.writeLine(
        result.decision === "approved" /* approved */ ? `Run ${state.runId} completed` : `Run ${state.runId} rejected and rolled back`
      );
      return 0;
    } catch (error) {
      if (state.currentStep !== null) {
        state = await this.runService.failStep(state, error);
      }
      await this.traceRecorder.record({
        runId: state.runId,
        step: "run-command",
        type: "failure" /* failure */,
        error: toTraceError6(error),
        ...state.workspaceRevision === null ? {} : {
          workspaceRevision: state.workspaceRevision
        }
      });
      logger.error("Run command failed", {
        error
      });
      this.output.writeError(
        error instanceof Error ? error.message : "Unknown run failure"
      );
      return 1;
    }
  }
  printProgress(state, message) {
    this.output.writeLine(
      `[${state.runId}] ${state.currentStep ?? "unknown"}: ${message}`
    );
  }
  printValidation(report) {
    this.output.writeLine("");
    this.output.writeLine("Validation results:");
    for (const check of report.checks) {
      const marker = check.passed ? "PASS" : "FAIL";
      this.output.writeLine(`  [${marker}] ${check.message}`);
    }
    this.output.writeLine(
      `Validation: ${report.passed ? "PASSED" : "FAILED"}`
    );
    this.output.writeLine("");
  }
};
function toTraceError6(error) {
  if (!(error instanceof Error)) {
    return {
      name: "UnknownError",
      message: "Unknown run command failure"
    };
  }
  const result = {
    name: error.name,
    message: error.message
  };
  if ("code" in error && typeof error.code === "string") {
    result.code = error.code;
  }
  if ("retryable" in error && typeof error.retryable === "boolean") {
    result.retryable = error.retryable;
  }
  return result;
}
__name(toTraceError6, "toTraceError");
var RunService = class {
  constructor(store, now = () => /* @__PURE__ */ new Date(), runIdFactory = createRunId) {
    this.store = store;
    this.now = now;
    this.runIdFactory = runIdFactory;
  }
  store;
  now;
  runIdFactory;
  static {
    __name(this, "RunService");
  }
  async create(input) {
    const now = this.now();
    const timestamp = now.toISOString();
    const runId = this.runIdFactory(now);
    const state = {
      schemaVersion: 1,
      runId,
      repositoryPath: input.repositoryPath,
      task: input.task,
      runDirectory: this.store.getRunDirectory(runId),
      status: "created" /* created */,
      currentStep: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      approval: null,
      failure: null,
      repositoryRoot: null,
      repositoryRelativePath: null,
      workspaceRoot: null,
      workspacePath: null,
      baseCommit: null,
      workspaceRevision: null,
      steps: [
        {
          name: "initialize_run" /* initialize_run */,
          status: "succeeded" /* succeeded */,
          startedAt: timestamp,
          completedAt: timestamp,
          message: "Run directory initialized"
        }
      ]
    };
    await this.store.create({
      state
    });
    return state;
  }
  async startStep(state, stepName, status) {
    if (state.currentStep !== null) {
      throw new Error(
        `Run ${state.runId} already has active step ${state.currentStep}`
      );
    }
    const timestamp = this.now().toISOString();
    const nextState = {
      ...state,
      status,
      currentStep: stepName,
      updatedAt: timestamp,
      steps: [
        ...state.steps,
        {
          name: stepName,
          status: "running" /* running */,
          startedAt: timestamp,
          completedAt: null,
          message: null
        }
      ]
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  async completeStep(state, stepName, status, message) {
    this.assertCurrentStep(state, stepName);
    const timestamp = this.now().toISOString();
    const stepIndex = this.findCurrentStepIndex(state, stepName);
    const steps = state.steps.map(
      (step, index) => index === stepIndex ? {
        ...step,
        status: "succeeded" /* succeeded */,
        completedAt: timestamp,
        message
      } : step
    );
    const nextState = {
      ...state,
      status,
      currentStep: null,
      updatedAt: timestamp,
      steps
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  async failStep(state, error) {
    if (state.currentStep === null) {
      throw new Error(`Run ${state.runId} does not have an active step`);
    }
    const timestamp = this.now().toISOString();
    const message = getErrorMessage2(error);
    const code = getErrorCode(error);
    const stepIndex = this.findCurrentStepIndex(state, state.currentStep);
    const steps = state.steps.map(
      (step, index) => index === stepIndex ? {
        ...step,
        status: "failed" /* failed */,
        completedAt: timestamp,
        message
      } : step
    );
    const nextState = {
      ...state,
      status: "failed" /* failed */,
      currentStep: null,
      updatedAt: timestamp,
      steps,
      failure: {
        message,
        code,
        failedAt: timestamp
      }
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  async recordApproval(state, decision) {
    this.assertCurrentStep(state, "human_approval" /* human_approval */);
    const timestamp = this.now().toISOString();
    const stepIndex = this.findCurrentStepIndex(
      state,
      "human_approval" /* human_approval */
    );
    const approved = decision === "approved" /* approved */;
    const steps = state.steps.map(
      (step, index) => index === stepIndex ? {
        ...step,
        status: approved ? "succeeded" /* succeeded */ : "rejected" /* rejected */,
        completedAt: timestamp,
        message: approved ? "Run approved by human" : "Run rejected by human"
      } : step
    );
    const nextState = {
      ...state,
      status: approved ? "approved" /* approved */ : "rejected" /* rejected */,
      currentStep: null,
      updatedAt: timestamp,
      steps,
      approval: {
        decision,
        decidedAt: timestamp
      }
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  saveValidation(state, report) {
    return this.store.saveValidation(state.runId, report);
  }
  async attachWorkspace(state, workspace) {
    this.assertCurrentStep(state, "prepare_workspace" /* prepare_workspace */);
    const timestamp = this.now().toISOString();
    const stepIndex = this.findCurrentStepIndex(
      state,
      "prepare_workspace" /* prepare_workspace */
    );
    const steps = state.steps.map(
      (step, index) => index === stepIndex ? {
        ...step,
        status: "succeeded" /* succeeded */,
        completedAt: timestamp,
        message: "Isolated Git workspace created"
      } : step
    );
    const nextState = {
      ...state,
      repositoryPath: workspace.repositoryPath,
      repositoryRoot: workspace.repositoryRoot,
      repositoryRelativePath: workspace.repositoryRelativePath,
      workspaceRoot: workspace.workspaceRoot,
      workspacePath: workspace.workspacePath,
      baseCommit: workspace.baseCommit,
      workspaceRevision: workspace.workspaceRevision,
      status: "ready" /* ready */,
      currentStep: null,
      updatedAt: timestamp,
      steps
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  async updateWorkspaceRevision(state, workspace) {
    const timestamp = this.now().toISOString();
    const nextState = {
      ...state,
      workspaceRevision: workspace.workspaceRevision,
      updatedAt: timestamp
    };
    await this.store.saveState(nextState);
    return nextState;
  }
  async completeRun(state, status, message) {
    if (state.currentStep !== "finalize" /* finalize */ && state.currentStep !== "rollback" /* rollback */) {
      throw new Error(
        `Cannot complete run from step ${state.currentStep ?? "none"}`
      );
    }
    return this.completeStep(state, state.currentStep, status, message);
  }
  assertCurrentStep(state, stepName) {
    if (state.currentStep !== stepName) {
      throw new Error(
        `Expected current step ${stepName}, received ${state.currentStep ?? "none"}`
      );
    }
  }
  findCurrentStepIndex(state, stepName) {
    const stepIndex = state.steps.findLastIndex(
      (step) => step.name === stepName && step.status === "running" /* running */
    );
    if (stepIndex === -1) {
      throw new Error(`Active step ${stepName} was not found in run state`);
    }
    return stepIndex;
  }
};
function createRunId(now) {
  const timestamp = now.toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
  const suffix = randomUUID().slice(0, 8);
  return `run-${timestamp}-${suffix}`;
}
__name(createRunId, "createRunId");
function getErrorMessage2(error) {
  return error instanceof Error ? error.message : "Unknown run failure";
}
__name(getErrorMessage2, "getErrorMessage");
function getErrorCode(error) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}
__name(getErrorCode, "getErrorCode");

// src/core/config/application-config.ts
var AppConfig = class {
  static {
    __name(this, "AppConfig");
  }
  environment;
  constructor(env2) {
    this.environment = env2;
  }
};
var booleanEnvironmentVariableSchema = z.enum(["true", "false"]).transform((value) => value === "true");
var environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(6e4),
  RUNS_ROOT: z.string().min(1).default(".runs"),
  MAX_AGENT_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(12e4),
  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(16e3),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_PRETTY: booleanEnvironmentVariableSchema.default(false),
  DOCKER_ENABLED: booleanEnvironmentVariableSchema.default(false)
});
var EnvironmentValidationError = class extends Error {
  static {
    __name(this, "EnvironmentValidationError");
  }
  constructor(error) {
    super(`Invalid environment variables:
${z.prettifyError(error)}`, {
      cause: error
    });
    this.name = "EnvironmentValidationError";
  }
};
function parseEnvironment(values) {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    throw new EnvironmentValidationError(result.error);
  }
  return result.data;
}
__name(parseEnvironment, "parseEnvironment");
var environmentFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
dotenv.config({
  path: environmentFile
});
var env = parseEnvironment(process.env);

// src/core/cli/cli.ts
var CliUsageError = class extends Error {
  static {
    __name(this, "CliUsageError");
  }
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
};

// src/infra/cli/agent-fix-cli.ts
var runCommandSchema = z.object({
  repositoryPath: z.string().trim().min(1, "Repository path is required"),
  task: z.string().trim().min(1, "Bug description is required").max(1e4, "Bug description exceeds 10000 characters")
});
var AgentFixCli = class {
  constructor(runCommandHandler, output, logger) {
    this.runCommandHandler = runCommandHandler;
    this.output = output;
    this.logger = logger;
  }
  runCommandHandler;
  output;
  logger;
  static {
    __name(this, "AgentFixCli");
  }
  async execute(argv) {
    try {
      const command = parseCliCommand(argv);
      if (command.type === "help") {
        this.output.writeLine(getHelpText());
        return 0;
      }
      return await this.runCommandHandler.execute({
        repositoryPath: command.repositoryPath,
        task: command.task
      });
    } catch (error) {
      const message = getErrorMessage3(error);
      if (error instanceof CliUsageError) {
        this.logger.warn("Invalid CLI arguments", {
          message
        });
        this.output.writeError(`Error: ${message}`);
        this.output.writeLine("");
        this.output.writeLine(getHelpText());
        return 1;
      }
      this.logger.error("CLI execution failed", {
        error
      });
      this.output.writeError(`Error: ${message}`);
      return 1;
    }
  }
};
function parseCliCommand(argv, cwd = process.cwd()) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        repo: {
          type: "string"
        },
        task: {
          type: "string"
        },
        help: {
          type: "boolean",
          short: "h"
        }
      }
    });
  } catch (error) {
    throw new CliUsageError(getErrorMessage3(error));
  }
  if (parsed.values.help === true) {
    return {
      type: "help"
    };
  }
  const [command, ...extraPositionals] = parsed.positionals;
  if (command === void 0) {
    return {
      type: "help"
    };
  }
  if (command !== "run") {
    throw new CliUsageError(`Unknown command: ${command}`);
  }
  if (extraPositionals.length > 0) {
    throw new CliUsageError(
      `Unexpected arguments: ${extraPositionals.join(" ")}`
    );
  }
  const result = runCommandSchema.safeParse({
    repositoryPath: parsed.values.repo,
    task: parsed.values.task
  });
  if (!result.success) {
    throw new CliUsageError(z.prettifyError(result.error));
  }
  return {
    type: "run",
    repositoryPath: path14.resolve(cwd, result.data.repositoryPath),
    task: result.data.task
  };
}
__name(parseCliCommand, "parseCliCommand");
function getHelpText() {
  return [
    "AgentFix",
    "",
    "Usage:",
    "  npm run dev -- run --repo <path> --task <description>",
    "",
    "Options:",
    "  --repo <path>         target Git repository",
    "  --task <description>  bug description",
    "  -h, --help            display help"
  ].join("\n");
}
__name(getHelpText, "getHelpText");
function getErrorMessage3(error) {
  return error instanceof Error ? error.message : "Unknown CLI error";
}
__name(getErrorMessage3, "getErrorMessage");

// src/infra/cli/console-output.ts
var ConsoleOutput = class {
  constructor(stdout = process.stdout, stderr = process.stderr) {
    this.stdout = stdout;
    this.stderr = stderr;
  }
  stdout;
  stderr;
  static {
    __name(this, "ConsoleOutput");
  }
  writeLine(message) {
    this.stdout.write(`${message}
`);
  }
  writeError(message) {
    this.stderr.write(`${message}
`);
  }
};
var ReadlineApprovalPrompt = class {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
  }
  input;
  output;
  static {
    __name(this, "ReadlineApprovalPrompt");
  }
  async requestApproval(request) {
    this.printSummary(request);
    const readline = createInterface({
      input: this.input,
      output: this.output
    });
    try {
      while (true) {
        const answer = await readline.question(
          "Approve final changes? [y/n]: "
        );
        const decision = parseApprovalDecision(answer);
        if (decision !== null) {
          return decision;
        }
        this.output.write("Enter y/yes or n/no.\n");
      }
    } finally {
      readline.close();
    }
  }
  printSummary(request) {
    this.output.write("\nHuman approval required\n");
    this.output.write(`Run: ${request.runId}
`);
    this.output.write(`Repository: ${request.repositoryPath}
`);
    this.output.write(`Task: ${request.task}
`);
    this.output.write(
      `Validation: ${request.validation.passed ? "PASSED" : "FAILED"}
`
    );
    this.output.write(`Reviewer: ${request.review.recommendation}
`);
    this.output.write(`Changed files: ${request.changedFiles.length}
`);
    this.output.write(
      `Retries: investigator=${request.retries.investigator}, reproducer=${request.retries.reproducer}, implementer=${request.retries.implementer}, reviewer=${request.retries.reviewer}
`
    );
    this.output.write(
      `Tokens: input=${request.tokenUsage.inputTokens}, output=${request.tokenUsage.outputTokens}, total=${request.tokenUsage.totalTokens}
`
    );
    this.output.write(
      `Estimated cost: ${request.tokenUsage.estimatedCostUsd === null ? "unavailable" : `$${request.tokenUsage.estimatedCostUsd.toFixed(6)}`}
`
    );
    if (request.review.findings.length > 0) {
      this.output.write("\nFindings:\n");
      for (const finding of request.review.findings) {
        this.output.write(
          `  [${finding.severity}] ${finding.title}${finding.blocking ? " (blocking)" : ""}
`
        );
      }
    }
    if (request.review.risks.length > 0) {
      this.output.write("\nRisks:\n");
      for (const risk of request.review.risks) {
        this.output.write(
          `  [${risk.severity}] ${risk.description}${risk.blocking ? " (blocking)" : ""}
`
        );
      }
    }
    this.output.write("\nFinal diff:\n");
    this.output.write(`${request.finalDiff}

`);
  }
};
function parseApprovalDecision(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return "approved" /* approved */;
  }
  if (normalized === "n" || normalized === "no") {
    return "rejected" /* rejected */;
  }
  return null;
}
__name(parseApprovalDecision, "parseApprovalDecision");

// src/core/workspace/workspace-errors.ts
var WorkspaceError = class extends Error {
  static {
    __name(this, "WorkspaceError");
  }
  code;
  path;
  constructor(message, code, options) {
    super(message, {
      cause: options?.cause
    });
    this.name = "WorkspaceError";
    this.code = code;
    if (options?.path !== void 0) {
      this.path = options.path;
    }
  }
};

// src/infra/git/git-command-runner.ts
var GitCommandRunner = class {
  static {
    __name(this, "GitCommandRunner");
  }
  timeoutMs;
  maxBufferBytes;
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.maxBufferBytes = options.maxBufferBytes ?? 20 * 1024 * 1024;
  }
  run(args, cwd) {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        [...args],
        {
          cwd,
          encoding: "utf8",
          timeout: this.timeoutMs,
          maxBuffer: this.maxBufferBytes,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0"
          }
        },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              new WorkspaceError(
                formatGitError(args, stderr),
                "git_command_failed" /* git_command_failed */,
                {
                  cause: error
                }
              )
            );
            return;
          }
          resolve({
            stdout,
            stderr
          });
        }
      );
    });
  }
};
function formatGitError(args, stderr) {
  const details = stderr.trim();
  return details.length > 0 ? `Git command failed: ${details}` : `Git command failed: git ${args.join(" ")}`;
}
__name(formatGitError, "formatGitError");

// src/infra/cli/target-repository-validator.ts
var GitTargetRepositoryValidator = class {
  constructor(git = new GitCommandRunner(), now = () => /* @__PURE__ */ new Date()) {
    this.git = git;
    this.now = now;
  }
  git;
  now;
  static {
    __name(this, "GitTargetRepositoryValidator");
  }
  async validate(repositoryPath) {
    const resolvedPath = path14.resolve(repositoryPath);
    const checks = [];
    const targetStat = await stat(resolvedPath).catch(() => null);
    const exists = targetStat !== null;
    const isDirectory = targetStat?.isDirectory() === true;
    checks.push({
      id: "repository.exists",
      passed: exists,
      message: exists ? "Repository path exists" : "Repository path does not exist"
    });
    checks.push({
      id: "repository.directory",
      passed: isDirectory,
      message: isDirectory ? "Repository path is a directory" : "Repository path is not a directory"
    });
    const readable = isDirectory ? await isReadable(resolvedPath) : false;
    checks.push({
      id: "repository.readable",
      passed: readable,
      message: readable ? "Repository path is readable" : "Repository path is not readable"
    });
    let gitRepository = false;
    let headExists = false;
    if (readable) {
      try {
        const result = await this.git.run(
          ["rev-parse", "--is-inside-work-tree"],
          resolvedPath
        );
        gitRepository = result.stdout.trim() === "true";
      } catch {
        gitRepository = false;
      }
      if (gitRepository) {
        try {
          await this.git.run(
            ["rev-parse", "--verify", "HEAD"],
            resolvedPath
          );
          headExists = true;
        } catch {
          headExists = false;
        }
      }
    }
    checks.push({
      id: "repository.git",
      passed: gitRepository,
      message: gitRepository ? "Target belongs to a Git work tree" : "Target does not belong to a Git work tree"
    });
    checks.push({
      id: "repository.head",
      passed: headExists,
      message: headExists ? "Git repository has a valid HEAD commit" : "Git repository does not have a valid HEAD commit"
    });
    return {
      timestamp: this.now().toISOString(),
      repositoryPath: resolvedPath,
      passed: checks.every((check) => check.passed),
      checks
    };
  }
};
async function isReadable(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
__name(isReadable, "isReadable");
var validIdentifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileStepCheckpointStore = class {
  static {
    __name(this, "FileStepCheckpointStore");
  }
  runsRoot;
  constructor(runsRoot) {
    this.runsRoot = path14.resolve(runsRoot);
  }
  async load(runId, executionId) {
    assertValidIdentifier(runId);
    assertValidIdentifier(executionId);
    const filePath = path14.join(
      this.runsRoot,
      runId,
      "checkpoints",
      `${executionId}.json`
    );
    const content = await readFile(filePath, "utf8").catch(
      (error) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    );
    if (content === null) {
      return null;
    }
    return JSON.parse(content);
  }
  async save(input) {
    assertValidIdentifier(input.runId);
    assertValidIdentifier(input.executionId);
    const checkpoint = {
      schemaVersion: 1,
      runId: input.runId,
      step: input.step,
      executionId: input.executionId,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      attempt: input.attempt,
      workspaceRevision: input.workspaceRevision,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      output: input.output
    };
    const directory = path14.join(this.runsRoot, input.runId, "checkpoints");
    await mkdir(directory, {
      recursive: true
    });
    const filePath = path14.join(directory, `${input.executionId}.json`);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(checkpoint, null, 2)}
`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
    return checkpoint;
  }
  async findCheckpoint(executionId) {
    const runsDirectory = await import('fs/promises').then(
      ({ readdir }) => readdir(this.runsRoot, {
        withFileTypes: true
      }).catch(() => [])
    );
    for (const entry of runsDirectory) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = path14.join(
        this.runsRoot,
        entry.name,
        "checkpoints",
        `${executionId}.json`
      );
      const exists = await import('fs/promises').then(
        ({ stat: stat4 }) => stat4(filePath).then((result) => result.isFile()).catch(() => false)
      );
      if (exists) {
        return filePath;
      }
    }
    return null;
  }
};
function assertValidIdentifier(value) {
  if (!validIdentifierPattern.test(value)) {
    throw new Error(`Invalid execution identifier: ${value}`);
  }
}
__name(assertValidIdentifier, "assertValidIdentifier");
var validIdentifierPattern2 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileImplementationArtifactStore = class {
  constructor(runsRoot, now = () => /* @__PURE__ */ new Date()) {
    this.now = now;
    this.runsRoot = path14.resolve(runsRoot);
  }
  now;
  static {
    __name(this, "FileImplementationArtifactStore");
  }
  runsRoot;
  async save(input) {
    assertValidIdentifier2(input.runId, "run");
    assertValidIdentifier2(input.commandResult.executionId, "execution");
    if (input.commandResult.runId !== input.runId) {
      throw new ImplementerError(
        "Implementation command result belongs to another run",
        "test_execution_failed" /* test_execution_failed */
      );
    }
    if (input.commandResult.workspaceRevision !== input.workspaceRevision) {
      throw new ImplementerError(
        "Implementation command result belongs to a stale workspace",
        "stale_workspace" /* stale_workspace */
      );
    }
    const suffix = input.commandResult.executionId;
    const patchFileName = `implementation-${suffix}.diff`;
    const resultFileName = `implementation-${suffix}.json`;
    const patchRelativePath = path14.posix.join("patches", patchFileName);
    const resultRelativePath = path14.posix.join("agents", resultFileName);
    const patchDirectory = path14.join(this.runsRoot, input.runId, "patches");
    const agentDirectory = path14.join(this.runsRoot, input.runId, "agents");
    await Promise.all([
      mkdir(patchDirectory, {
        recursive: true
      }),
      mkdir(agentDirectory, {
        recursive: true
      })
    ]);
    const patchArtifact = {
      id: `implementation-patch-${suffix}`,
      type: "implementation.patch",
      relativePath: patchRelativePath
    };
    const implementationArtifact = {
      id: `implementation-result-${suffix}`,
      type: "implementation.result",
      relativePath: resultRelativePath
    };
    await this.writeAtomic(
      path14.join(patchDirectory, patchFileName),
      ensureTrailingNewline(input.plan.patch)
    );
    await this.writeJsonAtomic(path14.join(agentDirectory, resultFileName), {
      schemaVersion: 1,
      createdAt: this.now().toISOString(),
      runId: input.runId,
      sourceWorkspaceRevision: input.sourceWorkspaceRevision,
      workspaceRevision: input.workspaceRevision,
      summary: input.plan.summary,
      changedFiles: input.plan.changedFiles,
      risks: input.plan.risks,
      reproduction: {
        testFiles: input.reproduction.testFiles,
        expectedFailureMarker: input.reproduction.expectedFailureMarker,
        failingExecutionId: input.reproduction.commandResult.executionId
      },
      patchArtifact,
      commandArtifact: input.commandResult.artifact,
      commandResult: {
        executionId: input.commandResult.executionId,
        operation: input.commandResult.operation,
        exitCode: input.commandResult.exitCode,
        signal: input.commandResult.signal,
        timedOut: input.commandResult.timedOut,
        succeeded: input.commandResult.succeeded,
        durationMs: input.commandResult.durationMs
      }
    });
    return {
      implementation: implementationArtifact,
      patch: patchArtifact,
      command: input.commandResult.artifact
    };
  }
  async writeJsonAtomic(filePath, value) {
    await this.writeAtomic(filePath, `${JSON.stringify(value, null, 2)}
`);
  }
  async writeAtomic(filePath, content) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  }
};
function assertValidIdentifier2(value, kind) {
  if (!validIdentifierPattern2.test(value)) {
    throw new ImplementerError(
      `Invalid ${kind} identifier: ${value}`,
      "invalid_input" /* invalid_input */
    );
  }
}
__name(assertValidIdentifier2, "assertValidIdentifier");
function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}
`;
}
__name(ensureTrailingNewline, "ensureTrailingNewline");

// src/core/observability/redaction.ts
var REDACTED_SECRET = "[REDACTED_SECRET]";
var REDACTED_PROMPT = "[REDACTED_PROMPT]";
var CIRCULAR_VALUE = "[Circular]";
var secretKeyPatterns = [
  /api[_-]?key/i,
  /authorization/i,
  /password/i,
  /(^|[_-])secret$/i,
  /^token$/i,
  /(^|[_-])(access|refresh|id|bearer)[_-]?token$/i
];
var promptKeyPatterns = [
  /^(system|user|developer)?_?prompt$/i,
  /^prompt(Text|Content)$/i,
  /^messages$/i,
  /^instructions?$/i
];
function redactSensitiveData(value) {
  return redactValue(value, /* @__PURE__ */ new WeakSet());
}
__name(redactSensitiveData, "redactSensitiveData");
function redactValue(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return void 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return redactError(value, ancestors);
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors));
    }
    return redactRecord(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}
__name(redactValue, "redactValue");
function redactRecord(value, ancestors) {
  const result = {};
  const promptMessage = isPromptMessage(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED_SECRET;
      continue;
    }
    if (isPromptKey(key) || promptMessage && key === "content") {
      result[key] = REDACTED_PROMPT;
      continue;
    }
    result[key] = redactValue(nestedValue, ancestors);
  }
  return result;
}
__name(redactRecord, "redactRecord");
function redactError(error, ancestors) {
  const result = {
    name: error.name,
    message: error.message
  };
  if (error.stack !== void 0) {
    result.stack = error.stack;
  }
  if (error.cause !== void 0) {
    result.cause = redactValue(error.cause, ancestors);
  }
  for (const [key, value] of Object.entries(error)) {
    if (!(key in result)) {
      result[key] = redactValue(value, ancestors);
    }
  }
  return result;
}
__name(redactError, "redactError");
function isSecretKey(key) {
  return secretKeyPatterns.some((pattern) => pattern.test(key));
}
__name(isSecretKey, "isSecretKey");
function isPromptKey(key) {
  return promptKeyPatterns.some((pattern) => pattern.test(key));
}
__name(isPromptKey, "isPromptKey");
function isPromptMessage(value) {
  return typeof value.role === "string" && ["system", "user", "developer", "assistant"].includes(value.role);
}
__name(isPromptMessage, "isPromptMessage");

// src/infra/logging/pino-logger.ts
function createPinoLogger(options) {
  const loggerOptions = {
    level: options.level,
    base: {
      service: options.serviceName ?? "AgentFix"
    }
  };
  if (options.destination !== void 0) {
    return new PinoLoggerAdapter(pino(loggerOptions, options.destination));
  }
  if (options.pretty) {
    const transport = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        singleLine: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname"
      }
    });
    return new PinoLoggerAdapter(pino(loggerOptions, transport));
  }
  return new PinoLoggerAdapter(pino(loggerOptions));
}
__name(createPinoLogger, "createPinoLogger");
var PinoLoggerAdapter = class _PinoLoggerAdapter {
  constructor(logger) {
    this.logger = logger;
  }
  logger;
  static {
    __name(this, "PinoLoggerAdapter");
  }
  child(context) {
    return new _PinoLoggerAdapter(
      this.logger.child(toRecord2(redactSensitiveData(context)))
    );
  }
  trace(message, data) {
    this.write("trace" /* trace */, message, data);
  }
  debug(message, data) {
    this.write("debug" /* debug */, message, data);
  }
  info(message, data) {
    this.write("info" /* info */, message, data);
  }
  warn(message, data) {
    this.write("warn" /* warn */, message, data);
  }
  error(message, data) {
    this.write("error" /* error */, message, data);
  }
  fatal(message, data) {
    this.write("fatal" /* fatal */, message, data);
  }
  flush() {
    this.logger.flush();
  }
  write(level, message, data) {
    if (data === void 0) {
      this.writeMessage(level, message);
      return;
    }
    this.writeData(level, message, toRecord2(redactSensitiveData(data)));
  }
  writeMessage(level, message) {
    switch (level) {
      case "trace" /* trace */:
        this.logger.trace(message);
        return;
      case "debug" /* debug */:
        this.logger.debug(message);
        return;
      case "info" /* info */:
        this.logger.info(message);
        return;
      case "warn" /* warn */:
        this.logger.warn(message);
        return;
      case "error" /* error */:
        this.logger.error(message);
        return;
      case "fatal" /* fatal */:
        this.logger.fatal(message);
    }
  }
  writeData(level, message, data) {
    switch (level) {
      case "trace" /* trace */:
        this.logger.trace(data, message);
        return;
      case "debug" /* debug */:
        this.logger.debug(data, message);
        return;
      case "info" /* info */:
        this.logger.info(data, message);
        return;
      case "warn" /* warn */:
        this.logger.warn(data, message);
        return;
      case "error" /* error */:
        this.logger.error(data, message);
        return;
      case "fatal" /* fatal */:
        this.logger.fatal(data, message);
    }
  }
};
function toRecord2(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  return {
    data: value
  };
}
__name(toRecord2, "toRecord");

// src/core/model/model-provider.error.ts
var ModelProviderError = class extends Error {
  static {
    __name(this, "ModelProviderError");
  }
  code;
  retryable;
  statusCode;
  durationMs;
  constructor(message, options) {
    super(message, {
      cause: options.cause
    });
    this.name = "ModelProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.statusCode !== void 0) {
      this.statusCode = options.statusCode;
    }
    if (options.durationMs !== void 0) {
      this.durationMs = options.durationMs;
    }
  }
};

// src/infra/openai/openai-model-provider.ts
var OpenAiModelProvider = class {
  static {
    __name(this, "OpenAiModelProvider");
  }
  apiKey;
  model;
  timeoutMs;
  baseUrl;
  fetchImplementation;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }
  async generate(request) {
    const startedAt = performance.now();
    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}/responses`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(this.createRequestBody(request)),
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
      const durationMs = performance.now() - startedAt;
      const payload = await response.json();
      if (!response.ok) {
        throw mapOpenAiHttpError(response.status, payload, durationMs);
      }
      return parseOpenAiResponse(request, payload, durationMs);
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      if (error instanceof ModelProviderError) {
        throw error;
      }
      if (isTimeoutError(error)) {
        throw new ModelProviderError("OpenAI request timed out", {
          code: "timeout" /* timeout */,
          retryable: true,
          durationMs,
          cause: error
        });
      }
      throw new ModelProviderError("OpenAI request failed", {
        code: "network" /* network */,
        retryable: true,
        durationMs,
        cause: error
      });
    }
  }
  createRequestBody(request) {
    const tools = request.tools ?? [];
    return {
      model: this.model,
      input: request.input.map(mapModelInput),
      text: {
        format: {
          type: "json_schema",
          name: request.outputSchemaName,
          schema: z.toJSONSchema(request.outputSchema),
          strict: true
        }
      },
      ...tools.length === 0 ? {} : {
        tools: tools.map(mapModelTool),
        tool_choice: "auto"
      },
      ...request.previousResponseId === void 0 ? {} : {
        previous_response_id: request.previousResponseId
      }
    };
  }
};
function mapModelInput(input) {
  if (input.type === "tool_result") {
    return {
      type: "function_call_output",
      call_id: input.callId,
      output: input.output
    };
  }
  return {
    role: input.role,
    content: input.content
  };
}
__name(mapModelInput, "mapModelInput");
function mapModelTool(tool) {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
    strict: true
  };
}
__name(mapModelTool, "mapModelTool");
function parseOpenAiResponse(request, payload, durationMs) {
  if (!isRecord(payload)) {
    throw invalidResponse(
      "OpenAI returned a non-object response",
      durationMs
    );
  }
  const outputItems = payload.output;
  if (!Array.isArray(outputItems)) {
    throw invalidResponse(
      "OpenAI response does not contain an output array",
      durationMs
    );
  }
  const toolCalls = parseToolCalls(
    outputItems,
    request.tools ?? [],
    durationMs
  );
  const outputText = readOutputText(outputItems);
  const usage = parseTokenUsage(payload.usage, durationMs);
  const responseId = typeof payload.id === "string" ? payload.id : void 0;
  let output;
  if (outputText !== void 0) {
    let parsedJson;
    try {
      parsedJson = JSON.parse(outputText);
    } catch (error) {
      throw new ModelProviderError(
        "OpenAI structured output is not valid JSON",
        {
          code: "invalid_response" /* invalid_response */,
          retryable: true,
          durationMs,
          cause: error
        }
      );
    }
    const validationResult = request.outputSchema.safeParse(parsedJson);
    if (!validationResult.success) {
      throw new ModelProviderError(
        `OpenAI structured output failed schema validation: ${z.prettifyError(validationResult.error)}`,
        {
          code: "invalid_response" /* invalid_response */,
          retryable: true,
          durationMs,
          cause: validationResult.error
        }
      );
    }
    output = validationResult.data;
  }
  if (output === void 0 && toolCalls.length === 0) {
    throw invalidResponse(
      "OpenAI returned neither structured output nor tool calls",
      durationMs
    );
  }
  return {
    ...output === void 0 ? {} : { output },
    toolCalls,
    usage,
    durationMs,
    ...responseId === void 0 ? {} : { responseId }
  };
}
__name(parseOpenAiResponse, "parseOpenAiResponse");
function parseToolCalls(outputItems, tools, durationMs) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolCalls = [];
  for (const item of outputItems) {
    if (!isRecord(item) || item.type !== "function_call") {
      continue;
    }
    if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string") {
      throw invalidResponse(
        "OpenAI returned a malformed function call",
        durationMs
      );
    }
    const tool = toolsByName.get(item.name);
    if (tool === void 0) {
      throw invalidResponse(
        `OpenAI requested unknown tool: ${item.name}`,
        durationMs
      );
    }
    let parsedArguments;
    try {
      parsedArguments = JSON.parse(item.arguments);
    } catch (error) {
      throw new ModelProviderError(
        `OpenAI returned invalid arguments for tool ${item.name}`,
        {
          code: "invalid_response" /* invalid_response */,
          retryable: true,
          durationMs,
          cause: error
        }
      );
    }
    const validationResult = tool.inputSchema.safeParse(parsedArguments);
    if (!validationResult.success) {
      throw new ModelProviderError(
        `Arguments for tool ${item.name} failed schema validation: ${z.prettifyError(validationResult.error)}`,
        {
          code: "invalid_response" /* invalid_response */,
          retryable: true,
          durationMs,
          cause: validationResult.error
        }
      );
    }
    toolCalls.push({
      id: item.call_id,
      name: item.name,
      arguments: validationResult.data
    });
  }
  return toolCalls;
}
__name(parseToolCalls, "parseToolCalls");
function readOutputText(outputItems) {
  const textParts = [];
  for (const item of outputItems) {
    if (!isRecord(item) || item.type !== "message") {
      continue;
    }
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (isRecord(contentItem) && contentItem.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      }
    }
  }
  if (textParts.length === 0) {
    return void 0;
  }
  return textParts.join("");
}
__name(readOutputText, "readOutputText");
function parseTokenUsage(value, durationMs) {
  if (!isRecord(value)) {
    throw invalidResponse(
      "OpenAI response does not contain token usage",
      durationMs
    );
  }
  const inputTokens = value.input_tokens;
  const outputTokens = value.output_tokens;
  const totalTokens = value.total_tokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || typeof totalTokens !== "number") {
    throw invalidResponse(
      "OpenAI returned malformed token usage",
      durationMs
    );
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}
__name(parseTokenUsage, "parseTokenUsage");
function mapOpenAiHttpError(statusCode, payload, durationMs) {
  const message = readOpenAiErrorMessage(payload);
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(message, {
      code: "authentication" /* authentication */,
      retryable: false,
      statusCode,
      durationMs
    });
  }
  if (statusCode === 408) {
    return new ModelProviderError(message, {
      code: "timeout" /* timeout */,
      retryable: true,
      statusCode,
      durationMs
    });
  }
  if (statusCode === 429) {
    return new ModelProviderError(message, {
      code: "rate_limit" /* rate_limit */,
      retryable: true,
      statusCode,
      durationMs
    });
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return new ModelProviderError(message, {
      code: "invalid_request" /* invalid_request */,
      retryable: false,
      statusCode,
      durationMs
    });
  }
  if (statusCode >= 500) {
    return new ModelProviderError(message, {
      code: "server" /* server */,
      retryable: true,
      statusCode,
      durationMs
    });
  }
  return new ModelProviderError(message, {
    code: "unknown" /* unknown */,
    retryable: false,
    statusCode,
    durationMs
  });
}
__name(mapOpenAiHttpError, "mapOpenAiHttpError");
function readOpenAiErrorMessage(payload) {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return "OpenAI API request failed";
}
__name(readOpenAiErrorMessage, "readOpenAiErrorMessage");
function invalidResponse(message, durationMs) {
  return new ModelProviderError(message, {
    code: "invalid_response" /* invalid_response */,
    retryable: true,
    durationMs
  });
}
__name(invalidResponse, "invalidResponse");
function isTimeoutError(error) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}
__name(isTimeoutError, "isTimeoutError");
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
__name(isRecord, "isRecord");
var validRunIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileFinalRunArtifactStore = class {
  static {
    __name(this, "FileFinalRunArtifactStore");
  }
  runsRoot;
  constructor(runsRoot) {
    this.runsRoot = path14.resolve(runsRoot);
  }
  async save(artifact) {
    assertValidRunId(artifact.runId);
    const finalDirectory = path14.join(
      this.runsRoot,
      artifact.runId,
      "final"
    );
    await mkdir(finalDirectory, {
      recursive: true
    });
    await Promise.all([
      this.writeAtomic(
        path14.join(finalDirectory, "result.json"),
        `${JSON.stringify(artifact, null, 2)}
`
      ),
      this.writeAtomic(
        path14.join(finalDirectory, "final.diff"),
        ensureFinalNewline(artifact.finalDiff)
      ),
      this.writeAtomic(
        path14.join(finalDirectory, "approval.json"),
        `${JSON.stringify(
          {
            runId: artifact.runId,
            decision: artifact.approvalDecision,
            workspaceRevision: artifact.workspaceRevision,
            createdAt: artifact.createdAt
          },
          null,
          2
        )}
`
      )
    ]);
  }
  async writeAtomic(filePath, content) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  }
};
function assertValidRunId(runId) {
  if (!validRunIdPattern.test(runId)) {
    throw new Error(`Invalid run identifier: ${runId}`);
  }
}
__name(assertValidRunId, "assertValidRunId");
function ensureFinalNewline(value) {
  return value.endsWith("\n") ? value : `${value}
`;
}
__name(ensureFinalNewline, "ensureFinalNewline");
var validIdentifierPattern3 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileProcessResultStore = class {
  static {
    __name(this, "FileProcessResultStore");
  }
  runsRoot;
  constructor(runsRoot) {
    this.runsRoot = path14.resolve(runsRoot);
  }
  async save(runId, result) {
    assertValidIdentifier3(runId, "run");
    assertValidIdentifier3(result.executionId, "execution");
    if (result.runId !== runId) {
      throw new ProcessRunnerError(
        `Command result belongs to run ${result.runId}, expected ${runId}`,
        "invalid_run" /* invalid_run */
      );
    }
    const commandsDirectory = path14.join(this.runsRoot, runId, "commands");
    await mkdir(commandsDirectory, {
      recursive: true
    });
    const fileName = `${result.executionId}.json`;
    const filePath = path14.join(commandsDirectory, fileName);
    await this.writeJsonAtomic(filePath, result);
    return {
      id: result.executionId,
      type: "command.result",
      relativePath: path14.posix.join("commands", fileName)
    };
  }
  async writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}
`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
  }
};
function assertValidIdentifier3(value, kind) {
  if (!validIdentifierPattern3.test(value)) {
    throw new ProcessRunnerError(
      `Invalid ${kind} identifier: ${value}`,
      "invalid_run" /* invalid_run */
    );
  }
}
__name(assertValidIdentifier3, "assertValidIdentifier");
var defaultTerminationGraceMs = 1e3;
var NpmProcessRunnerFactory = class {
  static {
    __name(this, "NpmProcessRunnerFactory");
  }
  commandTimeoutMs;
  resultStore;
  terminationGraceMs;
  now;
  executionIdFactory;
  constructor(options) {
    assertPositiveInteger(options.commandTimeoutMs, "Command timeout");
    const terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
    assertPositiveInteger(
      terminationGraceMs,
      "Process termination grace period"
    );
    this.commandTimeoutMs = options.commandTimeoutMs;
    this.resultStore = options.resultStore;
    this.terminationGraceMs = terminationGraceMs;
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.executionIdFactory = options.executionIdFactory ?? randomUUID;
  }
  create(workspace) {
    assertWorkspacePath(workspace);
    const executor = new AllowlistedNpmExecutor(
      workspace,
      this.resultStore,
      this.commandTimeoutMs,
      this.terminationGraceMs,
      this.now,
      this.executionIdFactory
    );
    return Object.freeze({
      runTests: /* @__PURE__ */ __name(() => executor.execute("runTests" /* run_tests */, "test"), "runTests"),
      runTypecheck: /* @__PURE__ */ __name(() => executor.execute("runTypecheck" /* run_typecheck */, "typecheck"), "runTypecheck"),
      runLint: /* @__PURE__ */ __name(() => executor.execute("runLint" /* run_lint */, "lint"), "runLint"),
      runBuild: /* @__PURE__ */ __name(() => executor.execute("runBuild" /* run_build */, "build"), "runBuild")
    });
  }
};
var AllowlistedNpmExecutor = class {
  constructor(workspace, resultStore, commandTimeoutMs, terminationGraceMs, now, executionIdFactory) {
    this.workspace = workspace;
    this.resultStore = resultStore;
    this.commandTimeoutMs = commandTimeoutMs;
    this.terminationGraceMs = terminationGraceMs;
    this.now = now;
    this.executionIdFactory = executionIdFactory;
  }
  workspace;
  resultStore;
  commandTimeoutMs;
  terminationGraceMs;
  now;
  executionIdFactory;
  static {
    __name(this, "AllowlistedNpmExecutor");
  }
  execute(operation, scriptName) {
    const executable = resolveNpmExecutable();
    const args = ["run", scriptName];
    const executionId = this.executionIdFactory();
    const startedAt = this.now();
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let forceTerminationTimer = null;
      let child;
      try {
        child = spawn(executable, args, {
          cwd: this.workspace.workspacePath,
          detached: process.platform !== "win32",
          env: createExecutionEnvironment(),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        reject(createSpawnError(operation, error));
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        terminateProcess(child, "SIGTERM");
        forceTerminationTimer = setTimeout(() => {
          terminateProcess(child, "SIGKILL");
        }, this.terminationGraceMs);
        forceTerminationTimer.unref();
      }, this.commandTimeoutMs);
      timeout.unref();
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (forceTerminationTimer !== null) {
          clearTimeout(forceTerminationTimer);
        }
        reject(createSpawnError(operation, error));
      });
      child.once("close", (exitCode, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (forceTerminationTimer !== null) {
          clearTimeout(forceTerminationTimer);
        }
        const completedAt = this.now();
        const result = {
          executionId,
          runId: this.workspace.runId,
          workspaceRevision: this.workspace.workspaceRevision,
          operation,
          command: {
            executable,
            args
          },
          cwd: this.workspace.workspacePath,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: Math.max(
            0,
            completedAt.getTime() - startedAt.getTime()
          ),
          stdout,
          stderr,
          exitCode,
          signal,
          timedOut,
          succeeded: !timedOut && exitCode === 0
        };
        void this.resultStore.save(this.workspace.runId, result).then((artifact) => {
          resolve({
            ...result,
            artifact
          });
        }).catch(reject);
      });
    });
  }
};
function createSpawnError(operation, cause) {
  return new ProcessRunnerError(
    `Failed to start process operation ${operation}`,
    "spawn_failed" /* spawn_failed */,
    {
      operation,
      cause
    }
  );
}
__name(createSpawnError, "createSpawnError");
function createExecutionEnvironment() {
  return {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "0",
    npm_config_color: "false"
  };
}
__name(createExecutionEnvironment, "createExecutionEnvironment");
function resolveNpmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
__name(resolveNpmExecutable, "resolveNpmExecutable");
function terminateProcess(child, signal) {
  if (child.pid === void 0) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
}
__name(terminateProcess, "terminateProcess");
function isMissingProcessError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
__name(isMissingProcessError, "isMissingProcessError");
function assertWorkspacePath(workspace) {
  const workspaceRoot = path14.resolve(workspace.workspaceRoot);
  const workspacePath = path14.resolve(workspace.workspacePath);
  const relativePath = path14.relative(workspaceRoot, workspacePath);
  const outsideWorkspace = relativePath === ".." || relativePath.startsWith(`..${path14.sep}`) || path14.isAbsolute(relativePath);
  if (outsideWorkspace) {
    throw new ProcessRunnerError(
      "Process workspace path is outside the isolated workspace",
      "invalid_workspace" /* invalid_workspace */
    );
  }
}
__name(assertWorkspacePath, "assertWorkspacePath");
function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProcessRunnerError(
      `${name} must be a positive integer`,
      "invalid_configuration" /* invalid_configuration */
    );
  }
}
__name(assertPositiveInteger, "assertPositiveInteger");

// src/core/prompt/prompt.ts
var defaultPromptVersions = Object.freeze(
  {
    ["investigator" /* investigator */]: "v1",
    ["reproducer" /* reproducer */]: "v1",
    ["implementer" /* implementer */]: "v1",
    ["reviewer" /* reviewer */]: "v1"
  }
);
function createPromptVersionIdentifier(agent, version) {
  return `${agent}-${version}`;
}
__name(createPromptVersionIdentifier, "createPromptVersionIdentifier");

// src/core/prompt/prompt-registry-errors.ts
var PromptRegistryError = class extends Error {
  static {
    __name(this, "PromptRegistryError");
  }
  code;
  agent;
  version;
  constructor(message, code, options = {}) {
    super(message, {
      cause: options.cause
    });
    this.name = "PromptRegistryError";
    this.code = code;
    if (options.agent !== void 0) {
      this.agent = options.agent;
    }
    if (options.version !== void 0) {
      this.version = options.version;
    }
  }
};

// src/infra/prompt/file-prompt-registry.ts
var promptVersionPattern = /^v[1-9][0-9]*$/;
var promptMetadataPattern = /^<!-- prompt-agent: ([a-z]+) -->\r?\n<!-- prompt-version: ([a-z0-9-]+) -->\r?\n/;
var FilePromptRegistry = class {
  static {
    __name(this, "FilePromptRegistry");
  }
  promptsRoot;
  activeVersions;
  cache = /* @__PURE__ */ new Map();
  constructor(options) {
    this.promptsRoot = path14.resolve(options.promptsRoot);
    this.activeVersions = options.activeVersions ?? defaultPromptVersions;
  }
  load(agent, version = this.activeVersions[agent]) {
    assertPromptVersion(version, agent);
    const cacheKey = `${agent}:${version}`;
    const cachedPrompt = this.cache.get(cacheKey);
    if (cachedPrompt !== void 0) {
      return cachedPrompt;
    }
    const loadingPrompt = this.readPrompt(agent, version).catch(
      (error) => {
        this.cache.delete(cacheKey);
        throw error;
      }
    );
    this.cache.set(cacheKey, loadingPrompt);
    return loadingPrompt;
  }
  loadAll() {
    return Promise.all(
      Object.values(AgentRole).map((agent) => this.load(agent))
    );
  }
  async getVersionSnapshot() {
    const [investigator, reproducer, implementer, reviewer] = await Promise.all([
      this.load("investigator" /* investigator */),
      this.load("reproducer" /* reproducer */),
      this.load("implementer" /* implementer */),
      this.load("reviewer" /* reviewer */)
    ]);
    return Object.freeze({
      ["investigator" /* investigator */]: investigator.id,
      ["reproducer" /* reproducer */]: reproducer.id,
      ["implementer" /* implementer */]: implementer.id,
      ["reviewer" /* reviewer */]: reviewer.id
    });
  }
  async readPrompt(agent, version) {
    const sourcePath = path14.posix.join(agent, `${version}.md`);
    const absolutePath = path14.join(
      this.promptsRoot,
      agent,
      `${version}.md`
    );
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        throw new PromptRegistryError(
          `Prompt ${agent}:${version} was not found`,
          "not_found" /* not_found */,
          {
            agent,
            version,
            cause: error
          }
        );
      }
      throw new PromptRegistryError(
        `Failed to read prompt ${agent}:${version}`,
        "read_failed" /* read_failed */,
        {
          agent,
          version,
          cause: error
        }
      );
    }
    return parsePrompt(source, sourcePath, agent, version);
  }
};
function parsePrompt(source, sourcePath, expectedAgent, expectedVersion) {
  const metadata = promptMetadataPattern.exec(source);
  if (metadata === null) {
    throw new PromptRegistryError(
      `Prompt ${sourcePath} does not contain valid metadata`,
      "invalid_metadata" /* invalid_metadata */,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    );
  }
  const metadataAgent = metadata[1];
  const metadataVersion = metadata[2];
  const expectedIdentifier = createPromptVersionIdentifier(
    expectedAgent,
    expectedVersion
  );
  if (metadataAgent !== expectedAgent || metadataVersion !== expectedIdentifier) {
    throw new PromptRegistryError(
      `Prompt metadata does not match ${sourcePath}`,
      "invalid_metadata" /* invalid_metadata */,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    );
  }
  const content = source.slice(metadata[0].length).trim();
  if (content.length === 0) {
    throw new PromptRegistryError(
      `Prompt ${sourcePath} is empty`,
      "invalid_metadata" /* invalid_metadata */,
      {
        agent: expectedAgent,
        version: expectedVersion
      }
    );
  }
  return Object.freeze({
    id: expectedIdentifier,
    agent: expectedAgent,
    version: expectedVersion,
    content,
    sourcePath
  });
}
__name(parsePrompt, "parsePrompt");
function assertPromptVersion(version, agent) {
  if (!promptVersionPattern.test(version)) {
    throw new PromptRegistryError(
      `Invalid prompt version: ${version}`,
      "invalid_version" /* invalid_version */,
      {
        agent,
        version
      }
    );
  }
}
__name(assertPromptVersion, "assertPromptVersion");
function isFileNotFoundError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
__name(isFileNotFoundError, "isFileNotFoundError");
var validIdentifierPattern4 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileReproductionArtifactStore = class {
  constructor(runsRoot, now = () => /* @__PURE__ */ new Date()) {
    this.now = now;
    this.runsRoot = path14.resolve(runsRoot);
  }
  now;
  static {
    __name(this, "FileReproductionArtifactStore");
  }
  runsRoot;
  async save(input) {
    assertValidIdentifier4(input.runId, "run");
    assertValidIdentifier4(input.commandResult.executionId, "execution");
    if (input.commandResult.runId !== input.runId) {
      throw new ReproducerError(
        "Command result belongs to another run",
        "test_execution_failed" /* test_execution_failed */
      );
    }
    if (input.commandResult.workspaceRevision !== input.workspaceRevision) {
      throw new ReproducerError(
        "Command result belongs to a stale workspace",
        "stale_workspace" /* stale_workspace */
      );
    }
    const artifactSuffix = input.commandResult.executionId;
    const patchFileName = `reproduction-${artifactSuffix}.diff`;
    const resultFileName = `reproduction-${artifactSuffix}.json`;
    const patchRelativePath = path14.posix.join("patches", patchFileName);
    const resultRelativePath = path14.posix.join("agents", resultFileName);
    const patchDirectory = path14.join(this.runsRoot, input.runId, "patches");
    const agentDirectory = path14.join(this.runsRoot, input.runId, "agents");
    await Promise.all([
      mkdir(patchDirectory, {
        recursive: true
      }),
      mkdir(agentDirectory, {
        recursive: true
      })
    ]);
    const patchArtifact = {
      id: `reproduction-patch-${artifactSuffix}`,
      type: "reproduction.patch",
      relativePath: patchRelativePath
    };
    const reproductionArtifact = {
      id: `reproduction-test-${artifactSuffix}`,
      type: "reproduction.test" /* reproduction_test */,
      relativePath: resultRelativePath,
      workspaceRevision: input.workspaceRevision
    };
    await this.writeAtomic(
      path14.join(patchDirectory, patchFileName),
      ensureTrailingNewline2(input.plan.patch)
    );
    await this.writeJsonAtomic(path14.join(agentDirectory, resultFileName), {
      schemaVersion: 1,
      createdAt: this.now().toISOString(),
      runId: input.runId,
      sourceWorkspaceRevision: input.sourceWorkspaceRevision,
      workspaceRevision: input.workspaceRevision,
      summary: input.plan.summary,
      testFiles: input.plan.testFiles,
      expectedFailureMarker: input.plan.expectedFailureMarker,
      patchArtifact,
      commandArtifact: input.commandResult.artifact,
      commandResult: {
        executionId: input.commandResult.executionId,
        operation: input.commandResult.operation,
        exitCode: input.commandResult.exitCode,
        signal: input.commandResult.signal,
        timedOut: input.commandResult.timedOut,
        succeeded: input.commandResult.succeeded,
        durationMs: input.commandResult.durationMs
      }
    });
    return {
      reproduction: reproductionArtifact,
      patch: patchArtifact,
      command: input.commandResult.artifact
    };
  }
  async writeJsonAtomic(filePath, value) {
    await this.writeAtomic(filePath, `${JSON.stringify(value, null, 2)}
`);
  }
  async writeAtomic(filePath, content) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  }
};
function assertValidIdentifier4(value, kind) {
  if (!validIdentifierPattern4.test(value)) {
    throw new ReproducerError(
      `Invalid ${kind} identifier: ${value}`,
      "invalid_input" /* invalid_input */
    );
  }
}
__name(assertValidIdentifier4, "assertValidIdentifier");
function ensureTrailingNewline2(value) {
  return value.endsWith("\n") ? value : `${value}
`;
}
__name(ensureTrailingNewline2, "ensureTrailingNewline");
var validIdentifierPattern5 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileReviewArtifactStore = class {
  constructor(runsRoot, now = () => /* @__PURE__ */ new Date()) {
    this.now = now;
    this.runsRoot = path14.resolve(runsRoot);
  }
  now;
  static {
    __name(this, "FileReviewArtifactStore");
  }
  runsRoot;
  async save(input) {
    assertValidIdentifier5(input.runId, "run");
    if (input.decision.workspaceRevision !== input.validationReport.workspaceRevision) {
      throw new ReviewerError(
        "Review and validation artifacts use different workspace revisions",
        "stale_workspace" /* stale_workspace */
      );
    }
    const reviewId = randomUUID();
    const fileName = `review-${reviewId}.json`;
    const relativePath = path14.posix.join("agents", fileName);
    const directory = path14.join(this.runsRoot, input.runId, "agents");
    await mkdir(directory, {
      recursive: true
    });
    const artifact = {
      id: `review-${reviewId}`,
      type: "review.result",
      relativePath
    };
    await this.writeJsonAtomic(path14.join(directory, fileName), {
      schemaVersion: 1,
      createdAt: this.now().toISOString(),
      runId: input.runId,
      workspaceRevision: input.decision.workspaceRevision,
      promptVersion: input.promptVersion,
      finalDiffSha256: createSha256(input.finalDiff),
      validation: {
        passed: input.validationReport.passed,
        generatedAt: input.validationReport.generatedAt,
        checks: input.validationReport.checks,
        changedFiles: input.validationReport.changedFiles,
        forbiddenFiles: input.validationReport.forbiddenFiles
      },
      recommendation: input.decision.recommendation,
      summary: input.decision.summary,
      findings: input.decision.findings,
      risks: input.decision.risks,
      publicApiChanges: input.decision.publicApiChanges
    });
    return artifact;
  }
  async writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}
`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
  }
};
function createSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
__name(createSha256, "createSha256");
function assertValidIdentifier5(value, kind) {
  if (!validIdentifierPattern5.test(value)) {
    throw new ReviewerError(
      `Invalid ${kind} identifier: ${value}`,
      "invalid_input" /* invalid_input */
    );
  }
}
__name(assertValidIdentifier5, "assertValidIdentifier");
var validRunIdPattern2 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var runDirectories = [
  "workspace",
  "commands",
  "agents",
  "patches",
  "checkpoints",
  "final"
];
var FileRunStore = class {
  static {
    __name(this, "FileRunStore");
  }
  runsRoot;
  constructor(runsRoot) {
    this.runsRoot = path14.resolve(runsRoot);
  }
  getRunDirectory(runId) {
    assertValidRunId2(runId);
    return path14.join(this.runsRoot, runId);
  }
  async create(input) {
    const runDirectory = this.getRunDirectory(input.state.runId);
    await mkdir(this.runsRoot, {
      recursive: true
    });
    await mkdir(runDirectory, {
      recursive: false
    });
    await Promise.all(
      runDirectories.map(
        (directory) => mkdir(path14.join(runDirectory, directory))
      )
    );
    await writeFile(path14.join(runDirectory, "events.jsonl"), "", {
      encoding: "utf8",
      flag: "wx"
    });
    await this.writeJsonAtomic(
      path14.join(runDirectory, "state.json"),
      input.state
    );
  }
  saveState(state) {
    return this.writeJsonAtomic(
      path14.join(this.getRunDirectory(state.runId), "state.json"),
      state
    );
  }
  saveValidation(runId, report) {
    return this.writeJsonAtomic(
      path14.join(this.getRunDirectory(runId), "validation.json"),
      report
    );
  }
  async writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}
`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
  }
};
function assertValidRunId2(runId) {
  if (!validRunIdPattern2.test(runId)) {
    throw new Error(`Invalid run identifier: ${runId}`);
  }
}
__name(assertValidRunId2, "assertValidRunId");
var validRunIdPattern3 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var JsonlTraceWriter = class {
  static {
    __name(this, "JsonlTraceWriter");
  }
  runsRoot;
  fileName;
  queue = Promise.resolve();
  constructor(options) {
    this.runsRoot = path14.resolve(options.runsRoot);
    this.fileName = options.fileName ?? "events.jsonl";
  }
  write(event) {
    const operation = this.queue.then(() => this.append(event));
    this.queue = operation.catch(() => void 0);
    return operation;
  }
  flush() {
    return this.queue;
  }
  async append(event) {
    assertValidRunId3(event.runId);
    const runDirectory = path14.join(this.runsRoot, event.runId);
    const traceFile = path14.join(runDirectory, this.fileName);
    await mkdir(runDirectory, {
      recursive: true
    });
    const redactedEvent = redactSensitiveData(event);
    const line = `${JSON.stringify(redactedEvent)}
`;
    await appendFile(traceFile, line, "utf8");
  }
};
function assertValidRunId3(runId) {
  if (!validRunIdPattern3.test(runId)) {
    throw new Error(`Invalid trace run identifier: ${runId}`);
  }
}
__name(assertValidRunId3, "assertValidRunId");
var validRunIdPattern4 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var FileValidationReportStore = class {
  static {
    __name(this, "FileValidationReportStore");
  }
  runsRoot;
  constructor(runsRoot) {
    this.runsRoot = path14.resolve(runsRoot);
  }
  async save(report) {
    if (!validRunIdPattern4.test(report.runId)) {
      throw new Error(`Invalid validation run identifier: ${report.runId}`);
    }
    const directory = path14.join(this.runsRoot, report.runId, "validation");
    await mkdir(directory, {
      recursive: true
    });
    const fileName = "final-validation.json";
    const relativePath = path14.posix.join("validation", fileName);
    const filePath = path14.join(directory, fileName);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(report, null, 2)}
`,
      "utf8"
    );
    await rename(temporaryPath, filePath);
    return {
      id: "final-validation-report",
      type: "review.validation-report" /* validation_report */,
      workspaceRevision: report.workspaceRevision,
      relativePath
    };
  }
};
var forbiddenDirectoryNames = /* @__PURE__ */ new Set([
  ".git",
  ".runs",
  ".runs-test",
  "node_modules",
  "coverage"
]);
var forbiddenFileExtensions = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx"]);
var WorkspacePathPolicy = class {
  static {
    __name(this, "WorkspacePathPolicy");
  }
  workspaceRoot;
  constructor(workspaceRoot) {
    this.workspaceRoot = path14.resolve(workspaceRoot);
  }
  resolvePath(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    this.assertAllowed(normalized);
    const absolutePath = path14.resolve(this.workspaceRoot, normalized);
    if (!isInsideDirectory(this.workspaceRoot, absolutePath)) {
      throw new WorkspaceError(
        `Path escapes workspace: ${relativePath}`,
        "invalid_path" /* invalid_path */,
        {
          path: relativePath
        }
      );
    }
    return {
      relativePath: normalized,
      absolutePath
    };
  }
  async resolveExistingFile(relativePath) {
    const resolved = this.resolvePath(relativePath);
    await this.assertNoSymlinkSegments(resolved.relativePath);
    const fileStat = await lstat(resolved.absolutePath).catch(() => null);
    if (fileStat === null) {
      throw new WorkspaceError(
        `File does not exist: ${relativePath}`,
        "file_not_found" /* file_not_found */,
        {
          path: relativePath
        }
      );
    }
    if (fileStat.isSymbolicLink()) {
      throw new WorkspaceError(
        `Symbolic links are not allowed: ${relativePath}`,
        "symlink_not_allowed" /* symlink_not_allowed */,
        {
          path: relativePath
        }
      );
    }
    if (!fileStat.isFile()) {
      throw new WorkspaceError(
        `Path is not a regular file: ${relativePath}`,
        "invalid_path" /* invalid_path */,
        {
          path: relativePath
        }
      );
    }
    const actualPath = await realpath(resolved.absolutePath);
    if (!isInsideDirectory(this.workspaceRoot, actualPath)) {
      throw new WorkspaceError(
        `Resolved path escapes workspace: ${relativePath}`,
        "invalid_path" /* invalid_path */,
        {
          path: relativePath
        }
      );
    }
    return resolved;
  }
  async assertSafePatchPath(relativePath) {
    const resolved = this.resolvePath(relativePath);
    await this.assertNoSymlinkSegments(path14.dirname(resolved.relativePath));
    return resolved.relativePath;
  }
  isAllowed(relativePath) {
    try {
      this.resolvePath(relativePath);
      return true;
    } catch {
      return false;
    }
  }
  assertAllowed(relativePath) {
    const segments = relativePath.split("/").map((segment) => segment.toLowerCase());
    if (segments.some((segment) => forbiddenDirectoryNames.has(segment))) {
      throw new WorkspaceError(
        `Forbidden workspace path: ${relativePath}`,
        "forbidden_path" /* forbidden_path */,
        {
          path: relativePath
        }
      );
    }
    const baseName = segments.at(-1) ?? "";
    if (baseName === ".env" || baseName.startsWith(".env.") && baseName !== ".env.example") {
      throw new WorkspaceError(
        `Environment files are forbidden: ${relativePath}`,
        "forbidden_path" /* forbidden_path */,
        {
          path: relativePath
        }
      );
    }
    const extension = path14.extname(baseName);
    if (forbiddenFileExtensions.has(extension)) {
      throw new WorkspaceError(
        `Secret-bearing file is forbidden: ${relativePath}`,
        "forbidden_path" /* forbidden_path */,
        {
          path: relativePath
        }
      );
    }
  }
  async assertNoSymlinkSegments(relativePath) {
    if (relativePath === "." || relativePath.length === 0) {
      return;
    }
    const segments = relativePath.split("/");
    let currentPath = this.workspaceRoot;
    for (const segment of segments) {
      currentPath = path14.join(currentPath, segment);
      const currentStat = await lstat(currentPath).catch(() => null);
      if (currentStat === null) {
        return;
      }
      if (currentStat.isSymbolicLink()) {
        throw new WorkspaceError(
          `Symbolic link path segment is not allowed: ${relativePath}`,
          "symlink_not_allowed" /* symlink_not_allowed */,
          {
            path: relativePath
          }
        );
      }
    }
  }
};
function normalizeRelativePath(value) {
  if (value.includes("\0") || path14.isAbsolute(value)) {
    throw new WorkspaceError(
      `Invalid workspace path: ${value}`,
      "invalid_path" /* invalid_path */,
      {
        path: value
      }
    );
  }
  const normalized = path14.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new WorkspaceError(
      `Invalid workspace path: ${value}`,
      "invalid_path" /* invalid_path */,
      {
        path: value
      }
    );
  }
  return normalized;
}
__name(normalizeRelativePath, "normalizeRelativePath");
function isInsideDirectory(root2, target) {
  const relative = path14.relative(root2, target);
  return relative.length > 0 && !relative.startsWith("..") && !path14.isAbsolute(relative);
}
__name(isInsideDirectory, "isInsideDirectory");
async function calculateWorkspaceRevision(workspace, git) {
  const pathspec = getPathspec(workspace);
  const diff = await git.run(
    ["diff", "--binary", "--no-ext-diff", "HEAD", "--", pathspec],
    workspace.workspaceRoot
  );
  const untracked = await git.run(
    ["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec],
    workspace.workspaceRoot
  );
  const hash = createHash("sha256");
  hash.update(workspace.baseCommit);
  hash.update("\0");
  hash.update(diff.stdout);
  hash.update("\0");
  const untrackedPaths = splitNull(untracked.stdout).sort();
  for (const repositoryPath of untrackedPaths) {
    const absolutePath = path14.join(workspace.workspaceRoot, repositoryPath);
    const fileStat = await lstat(absolutePath).catch(() => null);
    if (fileStat === null || !fileStat.isFile() || fileStat.isSymbolicLink()) {
      continue;
    }
    hash.update(repositoryPath);
    hash.update("\0");
    hash.update(await readFile(absolutePath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
__name(calculateWorkspaceRevision, "calculateWorkspaceRevision");
function getPathspec(workspace) {
  return workspace.repositoryRelativePath === "" ? "." : workspace.repositoryRelativePath;
}
__name(getPathspec, "getPathspec");
function splitNull(value) {
  return value.split("\0").filter((item) => item.length > 0);
}
__name(splitNull, "splitNull");

// src/infra/workspace/git-repository-tools.ts
var GitRepositoryToolsFactory = class {
  constructor(options = {}, git = new GitCommandRunner()) {
    this.options = options;
    this.git = git;
  }
  options;
  git;
  static {
    __name(this, "GitRepositoryToolsFactory");
  }
  create(workspace) {
    return new GitRepositoryTools(workspace, this.git, this.options);
  }
};
var GitRepositoryTools = class {
  constructor(workspace, git = new GitCommandRunner(), options = {}) {
    this.workspace = workspace;
    this.git = git;
    this.pathPolicy = new WorkspacePathPolicy(workspace.workspacePath);
    this.maximumFileSizeBytes = options.maximumFileSizeBytes ?? 1024 * 1024;
    this.maximumPatchSizeBytes = options.maximumPatchSizeBytes ?? 2 * 1024 * 1024;
    this.maximumSearchResults = options.maximumSearchResults ?? 200;
  }
  workspace;
  git;
  static {
    __name(this, "GitRepositoryTools");
  }
  pathPolicy;
  maximumFileSizeBytes;
  maximumPatchSizeBytes;
  maximumSearchResults;
  async listFiles() {
    const repositoryPaths = await this.getRepositoryFilePaths();
    const files = [];
    for (const repositoryPath of repositoryPaths) {
      const relativePath = this.toTargetRelativePath(repositoryPath);
      if (relativePath === null || !this.pathPolicy.isAllowed(relativePath)) {
        continue;
      }
      const resolved = await this.pathPolicy.resolveExistingFile(relativePath).catch(() => null);
      if (resolved === null) {
        continue;
      }
      const fileStat = await stat(resolved.absolutePath);
      files.push({
        path: relativePath,
        sizeBytes: fileStat.size
      });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }
  async readFile(relativePath) {
    const resolved = await this.pathPolicy.resolveExistingFile(relativePath);
    const fileStat = await stat(resolved.absolutePath);
    if (fileStat.size > this.maximumFileSizeBytes) {
      throw new WorkspaceError(
        `File exceeds size limit: ${relativePath}`,
        "file_too_large" /* file_too_large */,
        {
          path: relativePath
        }
      );
    }
    const content = await readFile(resolved.absolutePath);
    if (content.includes(0)) {
      throw new WorkspaceError(
        `Binary files are not allowed: ${relativePath}`,
        "binary_file" /* binary_file */,
        {
          path: relativePath
        }
      );
    }
    return {
      path: resolved.relativePath,
      sizeBytes: fileStat.size,
      content: content.toString("utf8")
    };
  }
  async searchCode(input) {
    if (input.query.length === 0) {
      throw new WorkspaceError(
        "Search query must not be empty",
        "invalid_path" /* invalid_path */
      );
    }
    const maximumResults = Math.min(
      input.maxResults ?? this.maximumSearchResults,
      this.maximumSearchResults
    );
    const query = input.caseSensitive ? input.query : input.query.toLowerCase();
    const matches = [];
    const files = await this.listFiles();
    for (const file of files) {
      if (matches.length >= maximumResults) {
        break;
      }
      let content;
      try {
        content = (await this.readFile(file.path)).content;
      } catch (error) {
        if (error instanceof WorkspaceError && (error.code === "binary_file" /* binary_file */ || error.code === "file_too_large" /* file_too_large */)) {
          continue;
        }
        throw error;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const haystack = input.caseSensitive ? line : line.toLowerCase();
        const column = haystack.indexOf(query);
        if (column === -1) {
          continue;
        }
        matches.push({
          path: file.path,
          line: index + 1,
          column: column + 1,
          preview: line.slice(0, 500)
        });
        if (matches.length >= maximumResults) {
          return matches;
        }
      }
    }
    return matches;
  }
  async applyPatch(patch) {
    const patchSize = Buffer.byteLength(patch);
    if (patchSize === 0 || patchSize > this.maximumPatchSizeBytes) {
      throw new WorkspaceError(
        "Patch is empty or exceeds the size limit",
        "invalid_patch" /* invalid_patch */
      );
    }
    if (patch.includes("GIT binary patch") || patch.includes("Binary files ") || patch.includes("new file mode 120000")) {
      throw new WorkspaceError(
        "Binary and symbolic-link patches are forbidden",
        "invalid_patch" /* invalid_patch */
      );
    }
    const patchPaths = extractPatchPaths(patch);
    if (patchPaths.length === 0) {
      throw new WorkspaceError(
        "Patch does not contain file paths",
        "invalid_patch" /* invalid_patch */
      );
    }
    for (const patchPath of patchPaths) {
      await this.pathPolicy.assertSafePatchPath(patchPath);
    }
    const temporaryDirectory = await mkdtemp(
      path14.join(tmpdir(), "agent-fix-patch-")
    );
    const patchFile = path14.join(temporaryDirectory, "change.patch");
    try {
      await writeFile(patchFile, patch, "utf8");
      const directoryOption = this.workspace.repositoryRelativePath.length === 0 ? [] : [`--directory=${this.workspace.repositoryRelativePath}`];
      await this.git.run(
        [
          "apply",
          "--check",
          "--whitespace=error-all",
          ...directoryOption,
          patchFile
        ],
        this.workspace.workspaceRoot
      );
      await this.git.run(
        ["apply", "--whitespace=error-all", ...directoryOption, patchFile],
        this.workspace.workspaceRoot
      );
    } catch (error) {
      throw new WorkspaceError(
        "Patch validation or application failed",
        "invalid_patch" /* invalid_patch */,
        {
          cause: error
        }
      );
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true
      });
    }
    return {
      changedFiles: await this.getChangedFiles(),
      workspaceRevision: await this.getWorkspaceRevision()
    };
  }
  async getDiff() {
    const pathspec = this.getPathspec();
    const result = await this.git.run(
      ["diff", "--binary", "--no-ext-diff", "HEAD", "--", pathspec],
      this.workspace.workspaceRoot
    );
    return result.stdout;
  }
  async getChangedFiles() {
    const pathspec = this.getPathspec();
    const tracked = await this.git.run(
      ["diff", "--name-only", "-z", "HEAD", "--", pathspec],
      this.workspace.workspaceRoot
    );
    const untracked = await this.git.run(
      ["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec],
      this.workspace.workspaceRoot
    );
    const changedFiles = [
      ...splitNull2(tracked.stdout),
      ...splitNull2(untracked.stdout)
    ].map((repositoryPath) => this.toTargetRelativePath(repositoryPath)).filter(
      (relativePath) => relativePath !== null && this.pathPolicy.isAllowed(relativePath)
    );
    return [...new Set(changedFiles)].sort();
  }
  getWorkspaceRevision() {
    return calculateWorkspaceRevision(this.workspace, this.git);
  }
  async getRepositoryFilePaths() {
    const result = await this.git.run(
      [
        "ls-files",
        "-co",
        "--exclude-standard",
        "-z",
        "--",
        this.getPathspec()
      ],
      this.workspace.workspaceRoot
    );
    return [...new Set(splitNull2(result.stdout))];
  }
  getPathspec() {
    return this.workspace.repositoryRelativePath.length === 0 ? "." : this.workspace.repositoryRelativePath;
  }
  toTargetRelativePath(repositoryPath) {
    const normalized = repositoryPath.replaceAll("\\", "/");
    const prefix = this.workspace.repositoryRelativePath;
    if (prefix.length === 0) {
      return normalized;
    }
    if (normalized === prefix) {
      return null;
    }
    const expectedPrefix = `${prefix}/`;
    if (!normalized.startsWith(expectedPrefix)) {
      return null;
    }
    return normalized.slice(expectedPrefix.length);
  }
};
function extractPatchPaths(patch) {
  const paths = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) {
      continue;
    }
    const rawPath = line.slice(4).split("	")[0]?.trim();
    if (rawPath === void 0 || rawPath === "/dev/null") {
      continue;
    }
    if (rawPath.startsWith('"')) {
      throw new WorkspaceError(
        "Quoted patch paths are not supported",
        "invalid_patch" /* invalid_patch */
      );
    }
    const relativePath = rawPath.startsWith("a/") || rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
    paths.push(relativePath);
  }
  return [...new Set(paths)];
}
__name(extractPatchPaths, "extractPatchPaths");
function splitNull2(value) {
  return value.split("\0").filter((item) => item.length > 0);
}
__name(splitNull2, "splitNull");
var validRunIdPattern5 = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var GitWorkspaceManager = class {
  static {
    __name(this, "GitWorkspaceManager");
  }
  runsRoot;
  git;
  constructor(options) {
    this.runsRoot = path14.resolve(options.runsRoot);
    this.git = options.git ?? new GitCommandRunner();
  }
  async create(input) {
    assertValidRunId4(input.runId);
    const repositoryPath = path14.resolve(input.repositoryPath);
    await assertAccessibleDirectory(repositoryPath);
    const repositoryRoot = await this.resolveRepositoryRoot(repositoryPath);
    const repositoryRelativePath = normalizeRepositoryRelativePath(
      repositoryRoot,
      repositoryPath
    );
    const baseCommit = (await this.git.run(["rev-parse", "--verify", "HEAD"], repositoryRoot)).stdout.trim();
    const runDirectory = path14.join(this.runsRoot, input.runId);
    const workspaceRoot = path14.join(runDirectory, "workspace");
    await mkdir(runDirectory, {
      recursive: true
    });
    await rm(workspaceRoot, {
      recursive: true,
      force: true
    });
    await this.git.run(["worktree", "prune"], repositoryRoot);
    try {
      await this.git.run(
        ["worktree", "add", "--detach", workspaceRoot, baseCommit],
        repositoryRoot
      );
    } catch (error) {
      await rm(workspaceRoot, {
        recursive: true,
        force: true
      });
      throw error;
    }
    const workspacePath = repositoryRelativePath.length === 0 ? workspaceRoot : path14.join(workspaceRoot, repositoryRelativePath);
    const targetStat = await stat(workspacePath).catch(() => null);
    if (targetStat === null || !targetStat.isDirectory()) {
      await this.cleanupWorktree(repositoryRoot, workspaceRoot);
      throw new WorkspaceError(
        "Target repository path does not exist in the base commit",
        "invalid_repository" /* invalid_repository */,
        {
          path: repositoryPath
        }
      );
    }
    const partialWorkspace = {
      runId: input.runId,
      repositoryPath,
      repositoryRoot,
      repositoryRelativePath,
      workspaceRoot,
      workspacePath,
      baseCommit
    };
    const workspaceRevision = await calculateWorkspaceRevision(
      partialWorkspace,
      this.git
    );
    return {
      ...partialWorkspace,
      workspaceRevision
    };
  }
  async rollback(workspace) {
    await this.git.run(
      ["reset", "--hard", workspace.baseCommit],
      workspace.workspaceRoot
    );
    await this.git.run(["clean", "-fd"], workspace.workspaceRoot);
    const workspaceRevision = await calculateWorkspaceRevision(
      workspace,
      this.git
    );
    return {
      ...workspace,
      workspaceRevision
    };
  }
  async cleanup(workspace) {
    await this.cleanupWorktree(
      workspace.repositoryRoot,
      workspace.workspaceRoot
    );
  }
  async resolveRepositoryRoot(repositoryPath) {
    try {
      const inside = (await this.git.run(
        ["rev-parse", "--is-inside-work-tree"],
        repositoryPath
      )).stdout.trim();
      if (inside !== "true") {
        throw new Error("Not inside a Git work tree");
      }
      return (await this.git.run(
        ["rev-parse", "--show-toplevel"],
        repositoryPath
      )).stdout.trim();
    } catch (error) {
      throw new WorkspaceError(
        `Target is not an accessible Git repository: ${repositoryPath}`,
        "invalid_repository" /* invalid_repository */,
        {
          path: repositoryPath,
          cause: error
        }
      );
    }
  }
  async cleanupWorktree(repositoryRoot, workspaceRoot) {
    try {
      await this.git.run(
        ["worktree", "remove", "--force", workspaceRoot],
        repositoryRoot
      );
    } catch {
      await rm(workspaceRoot, {
        recursive: true,
        force: true
      });
    }
    await this.git.run(["worktree", "prune"], repositoryRoot);
  }
};
async function assertAccessibleDirectory(targetPath) {
  const targetStat = await stat(targetPath).catch(() => null);
  if (targetStat === null || !targetStat.isDirectory()) {
    throw new WorkspaceError(
      `Repository path is not a directory: ${targetPath}`,
      "invalid_repository" /* invalid_repository */,
      {
        path: targetPath
      }
    );
  }
  try {
    await access(targetPath);
  } catch (error) {
    throw new WorkspaceError(
      `Repository path is not accessible: ${targetPath}`,
      "invalid_repository" /* invalid_repository */,
      {
        path: targetPath,
        cause: error
      }
    );
  }
}
__name(assertAccessibleDirectory, "assertAccessibleDirectory");
function normalizeRepositoryRelativePath(repositoryRoot, repositoryPath) {
  const relativePath = path14.relative(repositoryRoot, repositoryPath);
  if (relativePath.startsWith("..") || path14.isAbsolute(relativePath)) {
    throw new WorkspaceError(
      "Target path is outside its Git repository",
      "invalid_repository" /* invalid_repository */,
      {
        path: repositoryPath
      }
    );
  }
  return relativePath.replaceAll(path14.sep, "/");
}
__name(normalizeRepositoryRelativePath, "normalizeRepositoryRelativePath");
function assertValidRunId4(runId) {
  if (!validRunIdPattern5.test(runId)) {
    throw new WorkspaceError(
      `Invalid run identifier: ${runId}`,
      "invalid_path" /* invalid_path */
    );
  }
}
__name(assertValidRunId4, "assertValidRunId");

// src/composition-root.ts
var CompositionRoot = class {
  static {
    __name(this, "CompositionRoot");
  }
  app;
  cli;
  config;
  logger;
  modelProvider;
  processRunnerFactory;
  promptRegistry;
  investigatorAgent;
  traceRecorder;
  contextManager;
  workspaceManager;
  repositoryToolsFactory;
  reproducerAgent;
  implementerAgent;
  reviewerAgent;
  validationService;
  constructor() {
    this.config = new AppConfig(env);
    const runsRoot = this.config.environment.RUNS_ROOT;
    this.workspaceManager = new GitWorkspaceManager({
      runsRoot
    });
    this.repositoryToolsFactory = new GitRepositoryToolsFactory();
    const processResultStore = new FileProcessResultStore(runsRoot);
    this.processRunnerFactory = new NpmProcessRunnerFactory({
      commandTimeoutMs: this.config.environment.COMMAND_TIMEOUT_MS,
      resultStore: processResultStore
    });
    this.promptRegistry = new FilePromptRegistry({
      promptsRoot: path14.resolve("prompts")
    });
    this.contextManager = new AgentContextManager({
      tokenBudget: this.config.environment.CONTEXT_TOKEN_BUDGET
    });
    this.logger = createPinoLogger({
      level: this.config.environment.LOG_LEVEL,
      pretty: this.config.environment.LOG_PRETTY,
      serviceName: "AgentFix"
    });
    this.modelProvider = new OpenAiModelProvider({
      apiKey: this.config.environment.OPENAI_API_KEY,
      model: this.config.environment.OPENAI_MODEL,
      timeoutMs: this.config.environment.OPENAI_TIMEOUT_MS
    });
    const traceWriter = new JsonlTraceWriter({
      runsRoot
    });
    this.traceRecorder = new TraceRecorder(traceWriter);
    this.investigatorAgent = new ModelInvestigatorAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.traceRecorder,
      this.logger
    );
    const reproductionArtifactStore = new FileReproductionArtifactStore(
      runsRoot
    );
    this.reproducerAgent = new ModelReproducerAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      reproductionArtifactStore,
      this.traceRecorder,
      this.logger
    );
    const implementationArtifactStore = new FileImplementationArtifactStore(runsRoot);
    this.implementerAgent = new ModelImplementerAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      implementationArtifactStore,
      this.traceRecorder,
      this.logger
    );
    const reviewArtifactStore = new FileReviewArtifactStore(runsRoot);
    this.reviewerAgent = new ModelReviewerAgent(
      this.modelProvider,
      this.promptRegistry,
      reviewArtifactStore,
      this.traceRecorder,
      this.logger
    );
    const validationReportStore = new FileValidationReportStore(runsRoot);
    this.validationService = new DeterministicValidationService(
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      validationReportStore,
      this.traceRecorder,
      this.logger
    );
    const output = new ConsoleOutput();
    const runStore = new FileRunStore(runsRoot);
    const runService = new RunService(runStore);
    const repositoryValidator = new GitTargetRepositoryValidator();
    const approvalPrompt = new ReadlineApprovalPrompt();
    const retryExecutor = new RetryExecutor(
      this.config.environment.MAX_AGENT_ATTEMPTS
    );
    const checkpointStore = new FileStepCheckpointStore(runsRoot);
    const stepExecutor = new StepExecutor(checkpointStore);
    const implementationRecovery = new ImplementationRetryRecovery(
      this.workspaceManager,
      this.repositoryToolsFactory
    );
    const finalArtifactStore = new FileFinalRunArtifactStore(runsRoot);
    const pipelineOrchestrator = new PipelineOrchestrator({
      runService,
      contextManager: this.contextManager,
      investigatorAgent: this.investigatorAgent,
      reproducerAgent: this.reproducerAgent,
      implementerAgent: this.implementerAgent,
      validationService: this.validationService,
      reviewerAgent: this.reviewerAgent,
      workspaceManager: this.workspaceManager,
      repositoryToolsFactory: this.repositoryToolsFactory,
      approvalPrompt,
      finalArtifactStore,
      retryExecutor,
      stepExecutor,
      implementationRecovery,
      traceRecorder: this.traceRecorder,
      logger: this.logger
    });
    const runCommandHandler = new RunCommandHandler(
      runService,
      repositoryValidator,
      this.workspaceManager,
      pipelineOrchestrator,
      output,
      this.logger,
      this.traceRecorder
    );
    this.cli = new AgentFixCli(runCommandHandler, output, this.logger);
    this.app = createApp({
      cli: this.cli,
      config: this.config,
      logger: this.logger,
      modelProvider: this.modelProvider,
      processRunnerFactory: this.processRunnerFactory,
      promptRegistry: this.promptRegistry,
      investigatorAgent: this.investigatorAgent,
      traceRecorder: this.traceRecorder,
      contextManager: this.contextManager,
      repositoryToolsFactory: this.repositoryToolsFactory,
      workspaceManager: this.workspaceManager,
      reproducerAgent: this.reproducerAgent,
      implementerAgent: this.implementerAgent,
      reviewerAgent: this.reviewerAgent,
      validationService: this.validationService
    });
  }
};

// src/main.ts
var root = new CompositionRoot();
var bootstrapLogger = root.logger.child({
  step: "bootstrap"
});
var shutdownPromise;
async function shutdown(signal) {
  if (shutdownPromise !== void 0) {
    return shutdownPromise;
  }
  removeSignalHandlers();
  shutdownPromise = (async () => {
    const shutdownLogger = root.logger.child({
      step: "shutdown"
    });
    shutdownLogger.info(`Received ${signal}`);
    try {
      await root.app.stop();
      shutdownLogger.info("Application stopped");
    } catch (error) {
      shutdownLogger.error("Failed to stop application", {
        error
      });
      process.exitCode = 1;
    } finally {
      await flushObservability();
    }
  })();
  return shutdownPromise;
}
__name(shutdown, "shutdown");
function handleSigint() {
  void shutdown("SIGINT");
}
__name(handleSigint, "handleSigint");
function handleSigterm() {
  void shutdown("SIGTERM");
}
__name(handleSigterm, "handleSigterm");
function removeSignalHandlers() {
  process.off("SIGINT", handleSigint);
  process.off("SIGTERM", handleSigterm);
}
__name(removeSignalHandlers, "removeSignalHandlers");
async function flushObservability() {
  try {
    await root.traceRecorder.flush();
  } catch (error) {
    root.logger.error("Failed to flush trace events", {
      error
    });
    process.exitCode = 1;
  }
  root.logger.flush();
}
__name(flushObservability, "flushObservability");
async function bootstrap() {
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  try {
    await root.app.start();
    bootstrapLogger.info("Application started");
    process.exitCode = await root.app.execute(process.argv.slice(2));
  } catch (error) {
    bootstrapLogger.error("Application execution failed", {
      error
    });
    process.exitCode = 1;
  } finally {
    removeSignalHandlers();
    if (shutdownPromise !== void 0) {
      await shutdownPromise;
      return;
    }
    try {
      await root.app.stop();
      bootstrapLogger.info("Application stopped");
    } catch (error) {
      bootstrapLogger.error("Failed to stop application", {
        error
      });
      process.exitCode = 1;
    }
    await flushObservability();
  }
}
__name(bootstrap, "bootstrap");
await bootstrap();
//# sourceMappingURL=main.js.map
//# sourceMappingURL=main.js.map