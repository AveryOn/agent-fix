# TODO List

## 1. ~~Project Foundation~~

- [x] `[001]` rename package metadata and project references to `AgentFix`
- [x] `[002]` replace the custom DI module framework with a simple composition root
- [x] `[003]` remove unused DI container, module metadata, and lifecycle code
- [x] `[004]` wire application dependencies through `createApp`
- [x] `[005]` implement application start and graceful shutdown
- [x] `[006]` verify that the application starts with all required dependencies

## 2. ~~Config and Model Provider~~

- [x] `[007]` add typed application configuration
- [x] `[008]` add OpenAI, runs, retry, timeout, logging, and Docker configuration
- [x] `[009]` validate environment variables with Zod
- [x] `[010]` define `ModelProvider` contract
- [x] `[011]` implement OpenAI structured outputs and tool calls
- [x] `[012]` collect token usage and request duration
- [x] `[013]` map API errors and timeouts to application errors

Required environment variables:

```bash
NODE_ENV
OPENAI_API_KEY
OPENAI_MODEL
LOG_LEVEL
LOG_PRETTY
RUNS_ROOT
MAX_AGENT_ATTEMPTS
COMMAND_TIMEOUT_MS
CONTEXT_TOKEN_BUDGET
DOCKER_ENABLED
```

## 3. ~~Logger and Trace Module~~

- [x] `[014]` implement structured logging with Pino
- [x] `[015]` add `runId`, `step`, `agent`, `attempt`, and `workspaceRevision` fields
- [x] `[016]` implement secret and prompt-data redaction
- [x] `[017]` define the trace event format
- [x] `[018]` implement JSONL trace writer
- [x] `[019]` save agent calls, tool calls, validation results, retries, and failures
- [x] `[020]` save prompt versions, token usage, estimated cost, and execution duration

Trace event:

```ts
interface TraceEvent {
  timestamp: string
  runId: string
  step: string
  agent?: string
  attempt?: number
  workspaceRevision?: string
  type: string
  input?: unknown
  output?: unknown
  durationMs?: number
  tokenUsage?: TokenUsage
  estimatedCostUsd?: number
}
```

## 4. ~~CLI and Run Module~~

- [x] `[021]` implement the `run` CLI command
- [x] `[022]` accept repository path and bug description
- [x] `[023]` validate CLI arguments and target repository
- [x] `[024]` generate a unique run identifier and run directory
- [x] `[025]` define run statuses and save `state.json` after every step
- [x] `[026]` display pipeline progress and validation results
- [x] `[027]` implement the human approval prompt

Target command:

```bash
npm run dev -- run \
  --repo ./fixtures/billing-duplicate-payment \
  --task "Duplicate webhook delivery creates two payments"
```

Run directory:

```text
.runs/
  run-001/
    state.json
    events.jsonl
    workspace/
    commands/
    agents/
    patches/
    validation.json
    metrics.json
    final.diff
```

## 5. ~~Context Management Module~~

- [x] `[028]` define the `AgentContext` envelope
- [x] `[029]` define what each agent can and cannot see
- [x] `[030]` pass artifact references instead of the complete run history
- [x] `[031]` enforce a context and token budget for every agent
- [x] `[032]` summarize oversized investigation results
- [x] `[033]` attach the workspace revision to every context snapshot
- [x] `[034]` reject agent results produced from stale workspace context
- [x] `[035]` add context boundary and stale-context tests

Context envelope:

```ts
interface AgentContext {
  runId: string
  task: string
  workspaceRevision: string
  artifactIds: string[]
  evidence: EvidenceReference[]
  constraints: string[]
  summary?: string
}
```

Agent visibility:

```text
Investigator:
  task
  repository tools
  current workspace revision

Reproducer:
  task
  confirmed investigation evidence
  existing test structure

Implementer:
  confirmed evidence
  failing reproduction test
  allowed file scope

Reviewer:
  final diff
  validation report
  changed file list
```

## 6. ~~Workspace and Repository Tools~~

- [x] `[036]` validate that the target is an accessible Git repository
- [x] `[037]` create an isolated workspace for every run
- [x] `[038]` save the base commit and current workspace revision
- [x] `[039]` implement file listing, code search, and file reading
- [x] `[040]` implement patch application and Git diff reading
- [x] `[041]` prevent path traversal and access outside the workspace
- [x] `[042]` reject forbidden, binary, and oversized files
- [x] `[043]` implement workspace rollback and cleanup

Repository tools:

```text
listFiles
searchCode
readFile
applyPatch
getDiff
getChangedFiles
getWorkspaceRevision
```

All agents inside one run must use the same isolated workspace.

## 7. Process Runner Module

- [ ] `[044]` implement allowlisted command execution
- [ ] `[045]` implement command timeout and process termination
- [ ] `[046]` capture stdout, stderr, exit code, and duration
- [ ] `[047]` implement test, typecheck, lint, and build operations
- [ ] `[048]` save command results as run artifacts
- [ ] `[049]` prevent agents from receiving unrestricted shell access

Allowed operations:

```text
runTests
runTypecheck
runLint
runBuild
```

## 8. Prompt Module

- [ ] `[050]` create prompt directories for every agent
- [ ] `[051]` create investigator, reproducer, implementer, and reviewer prompts
- [ ] `[052]` define tool access and output constraints inside every prompt
- [ ] `[053]` add prompt version identifiers
- [ ] `[054]` load prompts through a prompt registry
- [ ] `[055]` save prompt versions in traces and evaluation results

Prompt structure:

```text
prompts/
  investigator/
    v1.md
  reproducer/
    v1.md
  implementer/
    v1.md
  reviewer/
    v1.md
```

## 9. Investigator Agent

- [ ] `[056]` define investigation input and output schemas
- [ ] `[057]` implement the repository search tool loop
- [ ] `[058]` return related files, symbols, and evidence references
- [ ] `[059]` return a grounded bug hypothesis
- [ ] `[060]` verify that every referenced file and symbol exists
- [ ] `[061]` reject hallucinated references and stale investigation results

Investigation result:

```ts
interface InvestigationResult {
  hypothesis: string
  evidence: EvidenceReference[]
  relatedFiles: string[]
  workspaceRevision: string
}
```

## 10. Reproducer Agent

- [ ] `[062]` define reproduction input and output schemas
- [ ] `[063]` inspect the existing test structure
- [ ] `[064]` generate and apply a reproduction test patch
- [ ] `[065]` run the reproduction test before implementation
- [ ] `[066]` require the reproduction test to fail for the expected reason
- [ ] `[067]` reject tests that already pass or do not reproduce the reported bug
- [ ] `[068]` save the reproduction patch and command output

Reproduction gate:

```text
Test passes before fix
  → reject reproduction

Test fails for unrelated reason
  → reject reproduction

Test fails for expected behavior
  → continue
```

## 11. Implementer Agent

- [ ] `[069]` define implementation input and output schemas
- [ ] `[070]` provide only confirmed evidence and the failing test result
- [ ] `[071]` generate and apply the implementation patch
- [ ] `[072]` restrict changes to the allowed file scope
- [ ] `[073]` prevent modification of the reproduction test
- [ ] `[074]` rerun the reproduction test after implementation
- [ ] `[075]` save the implementation patch and test result

## 12. Reviewer Agent

- [ ] `[076]` define review input and output schemas
- [ ] `[077]` provide the final diff and mechanical validation report
- [ ] `[078]` detect suspicious, unrelated, or excessive changes
- [ ] `[079]` report implementation risks and public API changes
- [ ] `[080]` ground every review finding in the final diff
- [ ] `[081]` save the review recommendation and evidence

## 13. Validation Module

- [ ] `[082]` validate every agent output against its Zod schema
- [ ] `[083]` validate file, symbol, and evidence references
- [ ] `[084]` validate patch application
- [ ] `[085]` verify reproduction failure before the fix
- [ ] `[086]` verify reproduction success after the fix
- [ ] `[087]` run the full test suite
- [ ] `[088]` run typecheck, lint, and build
- [ ] `[089]` validate changed file and forbidden file policies
- [ ] `[090]` save the final validation report
- [ ] `[091]` enforce deterministic validation gates before LLM review

Validation order:

```text
Agent Output Schema
  ↓
Evidence References
  ↓
Patch Application
  ↓
Reproduction Gate
  ↓
Full Test Suite
  ↓
Typecheck
  ↓
Lint
  ↓
Build
  ↓
Changed File Policy
  ↓
Reviewer Agent
```

## 14. Retry, Resume, and Failure Handling

- [ ] `[092]` define retryable, non-retryable, and fatal errors
- [ ] `[093]` implement structured output repair retry
- [ ] `[094]` implement implementation retry with validation feedback
- [ ] `[095]` enforce maximum attempt limits
- [ ] `[096]` rollback failed patches before another attempt
- [ ] `[097]` assign a deterministic execution identifier to every step
- [ ] `[098]` save step input and output hashes
- [ ] `[099]` resume from the last valid checkpoint and prevent duplicate patch application

Retry flow:

```text
Validation Failure
  ↓
Rollback Failed Patch
  ↓
Attach Validation Feedback
  ↓
Retry Agent
  ↓
Maximum Attempts Reached
  ↓
Fail Run or Escalate to Human
```

## 15. Orchestrator and Human Approval

- [ ] `[100]` define the complete pipeline step sequence
- [ ] `[101]` create the run and isolated workspace
- [ ] `[102]` execute the Investigator Agent
- [ ] `[103]` execute the Reproducer Agent and enforce the failing-test gate
- [ ] `[104]` execute the Implementer Agent
- [ ] `[105]` execute mechanical validation
- [ ] `[106]` execute the Reviewer Agent
- [ ] `[107]` display diff, tests, risks, retries, token usage, and cost
- [ ] `[108]` support human approve and reject decisions
- [ ] `[109]` save the final diff and approval decision
- [ ] `[110]` complete, fail, rollback, or clean up the run

Pipeline:

```text
User Task
  ↓
Investigator
  ↓
Evidence Validation
  ↓
Reproducer
  ↓
Failing-Test Gate
  ↓
Implementer
  ↓
Mechanical Validation
  ↓
Reviewer
  ↓
Human Approval
  ↓
Final Diff
```

## 16. Billing Demo Fixture

- [ ] `[111]` create a minimal billing fixture project
- [ ] `[112]` implement payment webhook processing
- [ ] `[113]` add the duplicate webhook payment bug
- [ ] `[114]` add a minimal test environment
- [ ] `[115]` add test, typecheck, lint, and build scripts
- [ ] `[116]` verify that the duplicate payment bug exists before AgentFix runs
- [ ] `[117]` document the expected idempotent fix behavior

Fixture:

```text
fixtures/
  billing-duplicate-payment/
    src/
      payment-service.ts
      webhook-handler.ts
    tests/
      payment-webhook.test.ts
    package.json
    tsconfig.json
```

Expected behavior:

```text
Two webhook deliveries with the same provider event ID
must create exactly one payment.
```

## 17. Evaluation and Self-Improvement

- [ ] `[118]` define the evaluation case and result formats
- [ ] `[119]` add a successful duplicate-payment fix case
- [ ] `[120]` add a hallucinated file reference case
- [ ] `[121]` add a reproduction test that already passes case
- [ ] `[122]` add typecheck failure and forbidden file modification cases
- [ ] `[123]` add a retry-then-success case
- [ ] `[124]` save an evaluation baseline with prompt versions
- [ ] `[125]` compare current results with the baseline and detect regressions
- [ ] `[126]` document one initially missed failure, update the prompt or validator, and rerun evaluations

Self-improvement loop:

```text
Trace Failure
  ↓
Classify Failure Reason
  ↓
Update Prompt or Validation Rule
  ↓
Create New Prompt Version
  ↓
Run Evaluation Suite
  ↓
Compare with Baseline
  ↓
Accept or Reject Change
```

Required missed-failure story:

```text
Initial behavior:
The pipeline accepted a reproduction test that passed before the fix.

Change:
Added a mandatory pre-fix failing-test gate.

Regression:
Added an evaluation case that fails if the reproducer creates
a test that already passes.
```

## 18. Monitoring Module

- [ ] `[127]` aggregate metrics from completed traces
- [ ] `[128]` calculate run success and failure rates
- [ ] `[129]` calculate first-attempt validation pass rate
- [ ] `[130]` calculate retry rate and average attempts per successful run
- [ ] `[131]` calculate token usage and estimated cost per successful run
- [ ] `[132]` calculate average, p50, and p95 execution latency
- [ ] `[133]` calculate evaluation regression and validation rejection rates
- [ ] `[134]` generate a CLI monitoring summary

Primary degradation metric:

```text
firstAttemptValidationPassRate
```

Supporting metrics:

```text
runSuccessRate
validationFailureRate
averageRetriesPerSuccessfulRun
tokenCostPerSuccessfulRun
p50RunLatencyMs
p95RunLatencyMs
evaluationRegressionRate
```

## 19. Docker Environment

- [ ] `[135]` create a Node.js 24 Dockerfile
- [ ] `[136]` install Git and ripgrep
- [ ] `[137]` install project and fixture dependencies
- [ ] `[138]` run the container as a non-root user
- [ ] `[139]` mount only the isolated run workspace
- [ ] `[140]` exclude OpenAI, Git, and environment secrets from the sandbox
- [ ] `[141]` execute test, typecheck, lint, and build inside the container
- [ ] `[142]` add command timeout and container resource limits
- [ ] `[143]` add a Docker environment smoke test

Docker execution boundary:

```text
Agent
  ↓
Allowlisted Process Operation
  ↓
Docker Container
  ↓
Isolated Run Workspace
```

## 20. Documentation and Recording Preparation

- [ ] `[144]` document the architecture and pipeline
- [ ] `[145]` document why this agent structure was selected
- [ ] `[146]` document rejected alternatives and tradeoffs
- [ ] `[147]` document context boundaries and stale-context handling
- [ ] `[148]` document mechanical validation and anti-hallucination rules
- [ ] `[149]` document retry, rollback, resume, and idempotency behavior
- [ ] `[150]` document the self-improvement and evaluation workflow
- [ ] `[151]` document monitoring metrics and estimated costs
- [ ] `[152]` document CLI and Docker usage
- [ ] `[153]` add example trace, validation report, metrics report, and final diff
- [ ] `[154]` prepare the successful run, failure run, missed-failure story, and 10–15 minute recording script

Recording structure:

```text
1. Architecture and rejected alternatives
2. Agent context boundaries and RunState
3. Successful bug-fix execution
4. Mechanical validation gates
5. Hallucinated or invalid output rejection
6. Retry after implementation failure
7. Human approval
8. Evaluation regression and prompt version
9. Monitoring, latency, token usage, and cost
10. Production limitations and next steps
```

## 21. Final Verification

- [ ] `[155]` install dependencies from a clean state
- [ ] `[156]` run project typecheck, lint, and build
- [ ] `[157]` run critical validator and context-management tests
- [ ] `[158]` run the complete pipeline integration test
- [ ] `[159]` run all evaluation cases and compare them with the baseline
- [ ] `[160]` run one complete live OpenAI workflow
- [ ] `[161]` verify one implementation retry followed by success
- [ ] `[162]` verify one hallucinated or forbidden change is blocked
- [ ] `[163]` verify traces, context revisions, token usage, cost, latency, and monitoring metrics
- [ ] `[164]` verify Docker execution and prepare the final demonstration run
