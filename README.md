# AgentFix

AgentFix is a multi-agent engineering system that converts a bug report into a mechanically verified code change.

The system investigates a Git repository, creates a failing reproduction test, generates an implementation patch, runs deterministic validation, performs an LLM review, and asks a human to approve or reject the final diff.

The pipeline does not treat an LLM response as proof. Model output is accepted only after schema validation, reference grounding, patch verification, test execution, changed-file checks, and workspace revision checks.

## Requirements

- Node.js 24 or newer
- npm
- Git
- Docker, when sandbox execution is enabled
- OpenAI API credentials for live agent runs

## Architecture

The project uses four layers:

```bash
core
  Domain types, schemas, ports, errors, and invariants.

application
  Agents, orchestration, validation, retries, evaluation,
  monitoring, and use cases.

infra
  OpenAI, Git, filesystem, CLI, logging, trace persistence,
  process execution, and Docker adapters.

composition-root
  Manual construction of concrete dependencies.
```

The dependency direction is:

```bash
infra
  |
application
  |
core
```

Application code depends on ports from `core`. Concrete adapters are selected in the manual `CompositionRoot`.

## Pipeline

```bash
Bug report
  |
Target repository validation
  |
Isolated Git workspace
  |
Investigator
  |
Evidence validation
  |
Reproducer
  |
Pre-fix failing-test gate
  |
Implementer
  |
Post-fix reproduction test
  |
Mechanical validation
  |
Reviewer
  |
Human approval
  |
Saved final artifact or rollback
```

The terminal result is code and a final diff. The pipeline does not stop at a ticket, specification, or suggested patch.

## Agent structure

AgentFix uses four specialized agents.

### Investigator

The Investigator searches the current workspace and returns:

- a grounded bug hypothesis
- repository-relative file references
- symbol references
- evidence tied to file content
- related implementation files
- the workspace revision used during investigation

The Investigator does not modify files.

### Reproducer

The Reproducer receives the task, confirmed investigation evidence, and the existing test structure.

It creates a test patch and runs the test before any implementation change.

The reproduction is accepted only when:

```bash
test exit code is non-zero
and
the expected failure marker is present
and
the failure is not caused by imports, compilation, setup, or timeout
```

A test that already passes is rejected.

### Implementer

The Implementer receives:

- confirmed evidence
- the failing reproduction result
- the reproduction marker
- the allowed implementation file scope
- the current workspace revision

It cannot modify the reproduction test. Its patch must pass the reproduction test after application.

### Reviewer

The Reviewer receives:

- the final diff
- changed files
- the mechanical validation report
- the current workspace revision

It does not receive unrestricted repository access or the full conversation history.

Every finding must reference evidence from the final diff. Mechanical validation remains authoritative. An LLM approval cannot override a failed required check.

## Why this structure was selected

The four-agent structure follows the engineering stages that produce different evidence.

Investigation establishes where the defect probably exists.

Reproduction proves that the reported behavior exists before the fix.

Implementation changes production code under a restricted file scope.

Review examines the final combined diff after deterministic checks have already run.

Separating these responsibilities prevents one model call from inventing a hypothesis, writing a test, implementing a patch, and approving its own work without independent gates.

The structure also limits context size. Each agent receives only the artifacts required for its task.

## Rejected alternatives

### One general-purpose agent

A single agent would have access to the complete repository, full run history, shell execution, patching, and approval.

This was rejected because:

- context grows quickly
- the same model generates and judges its own patch
- failures are difficult to classify
- retries repeat more work than necessary
- tool permissions are too broad
- stale assumptions are harder to identify

### Planner plus coding agent

A planner and a coding agent reduce the number of calls, but they do not prove that the defect existed before implementation.

This was rejected because a written plan is not mechanical evidence.

### LLM-only reviewer

An LLM reviewer can identify suspicious changes, but cannot replace tests, typecheck, lint, build, file policy, or revision validation.

Reviewer output is advisory and grounded against the diff.

### Unrestricted shell access

Agents do not receive arbitrary shell execution. They can request only:

```bash
runTests
runTypecheck
runLint
runBuild
```

This reduces command injection risk and keeps process results structured.

### Shared mutable conversation context

The system does not pass an ever-growing message thread between agents.

Artifacts and evidence references are persisted separately. Each context snapshot is rebuilt for one agent and one workspace revision.

### Parallel mutation by multiple agents

The Reproducer and Implementer do not modify the workspace concurrently.

Parallel mutations would complicate revision tracking, rollback, patch ownership, and deterministic validation.

## RunState

Every run has a persisted `state.json`.

The state contains:

- `runId`
- target repository path
- bug description
- run directory
- current status
- current step
- completed and failed steps
- approval decision
- failure information
- repository root
- isolated workspace path
- base commit
- current workspace revision

State is written after each transition.

Main statuses include:

```bash
created
validating
preparing_workspace
ready
running
awaiting_approval
approved
rejected
completed
failed
rolled_back
```

Main steps include:

```bash
initialize_run
validate_target
prepare_workspace
investigator
reproducer
implementer
mechanical_validation
reviewer
human_approval
finalize
rollback
cleanup
```

## Context boundaries

Every agent receives an `AgentContext` snapshot containing:

```ts
interface AgentContext {
  runId: string
  agent: AgentRole
  task: string
  workspaceRevision: string
  artifacts: ArtifactReference[]
  evidence: EvidenceReference[]
  constraints: string[]
  summary?: string
}
```

The context manager enforces agent-specific artifact policies.

### Investigator context

Visible:

- task
- repository snapshot reference
- repository tools
- current workspace revision

Not visible:

- future patches
- reviewer output
- human approval

### Reproducer context

Visible:

- task
- confirmed investigation
- investigation evidence
- test structure
- current workspace revision

Not visible:

- implementation result
- final review
- unrelated run history

### Implementer context

Visible:

- confirmed evidence
- failing reproduction result
- reproduction marker
- allowed file scope
- current workspace revision
- validation feedback from a previous attempt

Not visible:

- unrestricted file scope
- human approval
- complete trace history

### Reviewer context

Visible:

- final diff
- changed files
- validation report
- current workspace revision

Not visible:

- unrestricted shell
- mutable patch tools
- full repository history
- ungrounded internal reasoning from previous agents

## Context budget and compression

Each context snapshot has a configured token budget.

When investigation data exceeds the budget, the system summarizes the investigation and preserves structured references to the original artifacts.

The system passes artifact identifiers instead of embedding the complete run history in every request.

This keeps model context bounded while preserving deterministic access to stored evidence.

## Stale-context handling

Every context snapshot and every agent result includes a `workspaceRevision`.

After a patch changes the workspace, a new revision is calculated and persisted.

An output is rejected when its revision does not match the revision expected by the current step.

Evidence is rebound only after a controlled rollback or restoration operation establishes a known workspace state.

This prevents an agent from applying conclusions generated against an older version of the code.

## Mechanical validation

Validation runs before the Reviewer.

The required checks are:

```bash
agent_output_schema
evidence_references
patch_application
reproduction_failure
reproduction_success
full_test_suite
typecheck
lint
build
changed_file_policy
```

The report passes only when all required checks pass and no forbidden file is present.

### Output schemas

Every LLM result is parsed through a strict Zod schema.

Unknown, missing, duplicated, malformed, or incorrectly typed fields are rejected.

Structured-output repair may retry the model, but the repaired result must pass the same schema.

### Evidence grounding

Every evidence reference is checked against:

- repository-relative path rules
- file existence
- symbol existence when applicable
- line content or referenced source
- workspace revision

A model cannot introduce an unverified file path or symbol.

### Patch validation

Patch validation checks:

- valid unified diff headers
- repository-relative file paths
- no rename disguised as a normal patch
- declared changed files match actual changed files
- implementation files match the allowed scope
- reproduction and implementation patches do not overlap
- reproduction tests are not modified by the Implementer
- patch application succeeds against the expected revision

### Reproduction gate

Before implementation:

```bash
passing test
  -> reject

timeout
  -> reject

setup, import, or compilation failure
  -> reject

non-zero result with expected failure marker
  -> accept
```

After implementation, the same reproduction test must pass.

### Process checks

The system executes:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

Process results include:

- operation
- executable and arguments
- workspace revision
- start and completion timestamps
- duration
- stdout
- stderr
- exit code
- signal
- timeout state
- success state
- stored artifact reference

### Changed-file policy

Validation rejects changes outside the allowed scope.

The orchestrator currently forbids:

```bash
package-lock.json
.git
node_modules
.runs
```

The final changed-file list must match the patch and declared agent output.

## Retry behavior

Errors are classified as retryable or non-retryable.

For a retryable error, the retry trace contains:

- rejected attempt number
- error name
- error code
- error message
- current workspace revision
- next attempt
- mechanical validation feedback

The next context includes this feedback and requests a complete corrected output.

Retries stop at `MAX_AGENT_ATTEMPTS`.

## Rollback behavior

The workspace is isolated from the source repository.

Before a Reproducer retry, the workspace is rolled back to its previous valid state.

Before an Implementer retry, the implementation patch is removed and the confirmed reproduction workspace is restored.

When a human rejects the final diff, the workspace is rolled back.

When the pipeline fails, rollback is attempted before the failure is returned.

The source repository is not mutated by the agent pipeline.

## Resume and idempotency

Every executable step has deterministic execution metadata:

- execution identifier
- input hash
- output hash
- workspace revision
- persisted checkpoint

A step can be reused only when the stored input hash and workspace revision match the current execution.

A patch is not applied again when its valid checkpoint already exists.

A changed workspace revision invalidates the previous checkpoint for that step.

This prevents duplicate patch application during resume.

The current CLI starts a new run. Resume support exists at the execution and checkpoint layer, but the CLI does not yet expose a public `resume` command.

## Human approval

Human approval is the final decision boundary.

Before approval, the CLI provides:

- final diff
- changed files
- validation status
- review recommendation
- implementation risks
- review risks
- retries
- token usage
- estimated cost

Approval saves the final artifact.

Rejection rolls back the isolated workspace.

AgentFix does not automatically merge or push the change.

## Trace format

Trace events are written as JSONL to:

```bash
.runs/<runId>/events.jsonl
```

Event types include:

```bash
agent.call
agent.result
tool.call
tool.result
validation.result
retry
failure
```

A trace event may contain:

- run and step identifiers
- agent
- attempt
- workspace revision
- input or output
- structured error
- prompt version
- duration
- token usage
- estimated cost

Secrets and prompt-sensitive data are redacted before logging.

## Run artifacts

A run directory contains persisted state and evidence:

```bash
.runs/
  <runId>/
    state.json
    events.jsonl
    validation.json
    workspace/
    commands/
    agents/
    patches/
    checkpoints/
    final/
```

The exact files inside artifact directories depend on which steps completed.

## Self-improvement workflow

AgentFix uses a regression suite rather than changing prompts based on one anecdotal run.

```bash
Trace failure
  |
Classify the failure
  |
Change a prompt or deterministic validator
  |
Create a prompt version
  |
Add or update an evaluation case
  |
Run the complete evaluation suite
  |
Compare with baseline
  |
Accept or reject the change
```

The current evaluation cases are:

```bash
duplicate-payment-fix
hallucinated-file-reference
reproduction-test-already-passes
typecheck-failure
forbidden-file-modification
retry-then-success
```

Regression comparison checks:

- missing cases
- changed pass status
- changed classification
- increased attempt count
- changed error code
- unexpected prompt version changes

## Missed-failure story

The initial pipeline accepted a reproduction patch after it was applied, without proving that the test failed against the buggy implementation.

A generated test could therefore pass before the fix and still allow the pipeline to continue.

The correction had two parts:

1. `ReproductionGate.assertExpectedFailure()` became mandatory.
2. The Reproducer prompt was updated from `reproducer-v1` to `reproducer-v2`.

The new evaluation case `reproduction-test-already-passes` supplies a successful pre-fix test result.

The case passes only when the system rejects it with:

```bash
test_already_passes
```

## Monitoring

Monitoring aggregates completed run states and JSONL traces.

The primary degradation metric is:

```bash
firstAttemptValidationPassRate
```

This metric falls before total run success necessarily falls. A system may still finish successfully while requiring more retries, more tokens, and more latency.

Supporting metrics are:

```bash
runSuccessRate
runFailureRate
validationFailureRate
validationRejectionRate
retryRate
averageAttemptsPerSuccessfulRun
averageRetriesPerSuccessfulRun
tokensPerSuccessfulRun
tokenCostPerSuccessfulRun
averageRunLatencyMs
p50RunLatencyMs
p95RunLatencyMs
evaluationRegressionRate
```

## Cost estimation

Cost is calculated from model token usage recorded in trace events.

The provider returns:

```bash
inputTokens
outputTokens
totalTokens
```

When pricing information is available, the trace also records `estimatedCostUsd`.

Monitoring reports:

```bash
totalEstimatedCostUsd
tokenCostPerSuccessfulRun
```

Static example artifacts contain illustrative values. They are not measurements from a live OpenAI run.

Actual cost depends on:

- selected OpenAI model
- prompt size
- repository evidence size
- number of attempts
- output size
- current provider pricing

## CLI usage

Install dependencies:

```bash
npm ci
```

Create environment configuration:

```bash
cp .env.example .env
```

Set at least:

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

Display help:

```bash
npm run dev -- --help
```

Run the billing fixture:

```bash
npm run dev -- run \
  --repo ./fixtures/billing-duplicate-payment \
  --task "Duplicate webhook delivery creates two payments"
```

Run project verification:

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

Run evaluations:

```bash
npm run eval
npm run eval:current
npm run eval:comparison
```

Generate monitoring output:

```bash
npm run monitor
```

## Docker usage

Build the sandbox image:

```bash
npm run docker:build
```

Run the Docker smoke test:

```bash
npm run docker:smoke
```

Enable Docker process execution for AgentFix:

```dotenv
DOCKER_ENABLED=true
DOCKER_IMAGE=agent-fix-sandbox:local
DOCKER_MEMORY_MB=512
DOCKER_CPUS=1
DOCKER_PIDS_LIMIT=256
COMMAND_TIMEOUT_MS=120000
```

The Docker execution boundary is:

```bash
Agent
  |
Allowlisted Process Operation
  |
DockerProcessRunner
  |
Docker Container
  |
Isolated Run Workspace
```

The container uses:

- Node.js 24
- Git
- ripgrep
- non-root execution
- no network
- read-only root filesystem
- dropped Linux capabilities
- `no-new-privileges`
- memory limit
- CPU limit
- process count limit
- command timeout
- only the isolated workspace bind mount

OpenAI credentials are used by the host orchestration process and are not passed to validation containers.

The Docker adapter is used only for test, typecheck, lint, and build. Model calls remain outside the sandbox.

## Demonstration artifacts

Static examples are stored in:

```bash
docs/examples/
  successful-run.events.jsonl
  validation.json
  metrics.json
  final.diff
```

These files demonstrate the stored formats and the recording flow. They are not presented as a live production trace.

## Production limitations

The current project is a take-home-scale implementation.

Known limitations:

- one local orchestrator process
- filesystem-backed run storage
- no distributed locking
- no remote worker queue
- no automatic GitHub pull request creation
- no automatic merge
- no public resume CLI command
- no production secrets manager integration
- no model fallback provider
- Docker validation targets the bundled fixture dependency layout
- evaluation cases focus on core deterministic failure modes
- static example metrics are illustrative until a live run is recorded

A production version would add durable workflow execution, remote artifact storage, distributed locks, repository provider integration, policy management, alerting, and per-model pricing configuration.
