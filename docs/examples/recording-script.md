# AgentFix recording script

Target duration: 10 to 15 minutes.

This script uses the existing billing duplicate-payment fixture, evaluation suite, static example artifacts, and one live pipeline run when OpenAI credentials are available.

Do not claim that static example metrics came from a live run. Show them as format examples. For actual token usage, cost, and latency, open the artifacts produced by the live run.

## Before recording

Prepare the terminal:

```bash
npm ci
npm run docker:build
npm run verify
npm run eval
npm run monitor
```

Run the Docker smoke test separately:

```bash
npm run docker:smoke
```

Prepare a live AgentFix run:

```bash
npm run dev -- run \
  --repo ./fixtures/billing-duplicate-payment \
  --task "Duplicate webhook delivery creates two payments"
```

Keep these files open:

```text
src/application/orchestrator/pipeline-orchestrator.ts
src/core/run/run-state.ts
src/core/context/agent-context.ts
src/core/context/agent-context-manager.ts
src/application/validation/deterministic-validation-service.ts
src/application/reproducer/reproduction-gate.ts
src/application/reviewer/review-result-validator.ts
src/application/execution/retry-executor.ts
src/application/monitoring/monitoring-aggregator.ts
evaluations/baseline.json
evaluations/self-improvement.md
Dockerfile
src/infra/process/docker-process-runner.ts
docs/examples/
```

Also keep the newest `.runs/<runId>/` directory open.

## 0:00 to 1:20. Architecture and rejected alternatives

### Screen

Show:

```text
src/
  core/
  application/
  infra/
  composition-root.ts
```

Then open `pipeline-orchestrator.ts`.

### Speech

"AgentFix is a multi-agent engineering workflow that takes a bug report and ends with a verified code diff.

The architecture has four main layers. Core contains ports, schemas, types, and invariants. Application contains the agents, orchestration, validation, retries, evaluation, and monitoring. Infra contains Git, filesystem, OpenAI, CLI, tracing, host process execution, and Docker. The CompositionRoot wires concrete adapters manually.

The pipeline is Investigator, Reproducer, Implementer, mechanical validation, Reviewer, and human approval.

I selected this structure because each stage produces a different kind of evidence. The Investigator finds grounded code evidence. The Reproducer proves the bug exists before the fix. The Implementer changes production code under an allowed file scope. The Reviewer sees the final diff only after deterministic validation.

I rejected one general-purpose agent because it would search, patch, execute commands, and approve its own result in one context. That increases context bloat and removes independent failure boundaries.

I also rejected an LLM-only validation approach. The Reviewer cannot override tests, typecheck, lint, build, file policy, or revision checks."

## 1:20 to 2:40. Context boundaries and RunState

### Screen

Open:

```text
src/core/run/run-state.ts
src/core/context/agent-context.ts
src/core/context/agent-context-manager.ts
```

Show a real `.runs/<runId>/state.json`.

### Speech

"RunState is persisted after every step. It records the run status, current step, approval or failure, workspace path, base commit, and workspace revision.

Each agent receives a separate AgentContext. I do not append the entire run history to every prompt.

The Investigator receives the task, repository tools, and current revision.

The Reproducer receives confirmed investigation evidence and the test structure.

The Implementer receives the failing reproduction, confirmed evidence, and an allowed file scope.

The Reviewer receives the final diff, changed files, and validation report.

Large investigation output is summarized under a token budget, while artifact references remain available.

The stale-context rule is based on workspaceRevision. Every context and result is tied to one revision. After a patch, the revision changes. An output generated against an older revision is rejected."

## 2:40 to 4:20. Successful bug-fix execution

### Screen

Show the fixture:

```text
fixtures/billing-duplicate-payment/
```

Open:

```text
src/payment.service.ts
src/webhook.handler.ts
tests/payment-webhook.test.ts
```

Run:

```bash
npm run dev -- run \
  --repo ./fixtures/billing-duplicate-payment \
  --task "Duplicate webhook delivery creates two payments"
```

Show the resulting run directory.

### Speech

"The demo defect is duplicate webhook delivery. Two deliveries with the same provider event ID create two payments.

The run begins by validating the target Git repository and creating an isolated workspace.

The Investigator searches the workspace and returns existing files, symbols, evidence, and a hypothesis.

The Reproducer adds a test with a deterministic failure marker. Before implementation, the test must fail with that marker.

The Implementer receives the confirmed failing test and only the allowed production files. It does not receive permission to modify the reproduction test.

After implementation, the reproduction test must pass.

The system then runs the complete mechanical validation sequence."

## 4:20 to 6:00. Mechanical validation and anti-hallucination

### Screen

Open the real:

```text
.runs/<runId>/validation.json
```

Then open:

```text
src/core/validation/mechanical-validation.ts
src/application/validation/evidence-reference-validator.ts
src/application/validation/patch-application-validator.ts
```

### Speech

"This is the most important part of the system.

Every agent result has a strict Zod schema. Structured output is not accepted because it looks plausible.

File references are checked against the repository. Symbol and evidence references must exist. Paths must be repository-relative. References include the workspace revision.

Patch validation checks the unified diff headers, actual changed files, declared changed files, patch application, allowed scope, and overlap between reproduction and implementation patches.

The Reproducer must prove a pre-fix failure. A passing test is rejected. A timeout is rejected. An import or compilation failure is rejected. Only the expected behavior failure allows the run to continue.

After implementation, the system runs the reproduction test, full tests, typecheck, lint, build, and changed-file policy.

The validation report passes only when every required check passes and there are no forbidden files."

## 6:00 to 7:00. Hallucinated output rejection

### Screen

Run:

```bash
npm run eval
```

Show the case:

```text
hallucinated-file-reference
```

Open `src/application/evaluation/evaluation-cases.ts`.

### Speech

"This evaluation case returns a file reference that does not exist: `src/non-existent-payment-store.ts`.

The result may be syntactically valid JSON, but it is not grounded in the repository.

The Investigator validator rejects it with `hallucinated_file`.

This distinction matters. Schema validation proves shape. Grounding proves that referenced repository facts exist."

## 7:00 to 8:00. Retry after implementation or structured-output failure

### Screen

Show:

```text
retry-then-success
```

Then open a retry event from `events.jsonl` or the static example structure.

### Speech

"Retryable failures contain structured feedback.

The retry trace records the failed attempt, error code, message, workspace revision, next attempt, and validation feedback.

Before another Reproducer attempt, the workspace is rolled back.

Before another Implementer attempt, the system restores the confirmed reproduction workspace. The failed implementation patch is not left in place.

The next context says that the previous output was rejected mechanically and includes the validation error.

The attempt limit is controlled by `MAX_AGENT_ATTEMPTS`.

A non-retryable failure stops the run and triggers rollback."

## 8:00 to 8:50. Human approval

### Screen

Show the CLI approval output and final diff.

### Speech

"The human is placed after mechanical validation and review.

At this point the human sees the diff, changed files, validation status, risks, retries, token usage, and estimated cost.

Approval saves the final artifact.

Rejection rolls back the isolated workspace.

AgentFix does not automatically merge or push. That is an intentional safety boundary for this implementation."

## 8:50 to 10:10. Missed failure and self-improvement

### Screen

Open:

```text
evaluations/self-improvement.md
evaluations/baseline.json
```

Show prompt versions and the `reproduction-test-already-passes` case.

### Speech

"The initially missed failure was a false-positive reproduction.

The first version treated an applied test patch as enough evidence. A generated test could already pass against the buggy implementation, so the pipeline had not actually proved the defect.

I added a mandatory pre-fix failing-test gate and changed the Reproducer prompt from version 1 to version 2.

Then I added the `reproduction-test-already-passes` evaluation case.

A prompt or validator change is accepted only when all baseline cases preserve their expected classification, error code, and attempt count, and no case disappears.

The current baseline contains six cases covering successful execution, hallucinated references, passing reproduction, typecheck failure, forbidden files, and retry then success."

## 10:10 to 11:20. Monitoring, latency, tokens, and cost

### Screen

Run:

```bash
npm run monitor
```

Open a real metrics output if available. Otherwise show `docs/examples/metrics.json` and state that it is illustrative.

### Speech

"The primary degradation metric is firstAttemptValidationPassRate.

This is more useful than final success rate alone. The system may still finish successfully while silently requiring more retries, tokens, and latency.

Supporting metrics include run success rate, validation failure rate, retry rate, attempts per successful run, tokens and cost per successful run, average latency, p50, p95, and evaluation regression rate.

Token usage and estimated cost come from model trace events.

The static metrics file in `docs/examples` demonstrates the schema. It is not presented as a live measurement. For a real run I use the values from its trace and generated monitoring report."

## 11:20 to 12:20. Docker boundary

### Screen

Open:

```text
Dockerfile
src/infra/process/docker-process-runner.ts
scripts/docker-sandbox-entrypoint.sh
```

Show:

```bash
npm run docker:smoke
```

### Speech

"Validation commands can run through a Docker adapter.

The agent still receives only four operations: test, typecheck, lint, and build.

The runner starts a Node.js 24 container with no network, a read-only root filesystem, dropped capabilities, no-new-privileges, CPU, memory, process, and time limits.

Only the isolated run workspace is mounted.

OpenAI credentials remain in the host orchestration process and are not passed into the validation container.

The smoke test runs all four allowlisted operations inside this boundary."

## 12:20 to 13:30. Production limitations and next steps

### Screen

Return to the architecture overview.

### Speech

"This is a functional take-home-scale system, not a distributed production platform.

State and artifacts are stored on the local filesystem. There is one orchestrator process, no distributed locking, no remote worker queue, no automatic pull request creation, and no automatic merge.

Resume exists at the checkpoint and execution layer, but the CLI does not expose a public resume command yet.

A production version would use durable workflow execution, remote artifact storage, repository-provider integration, distributed locks, alerting, and centrally managed policy and pricing configuration.

The part I would preserve is the core boundary: model output proposes actions, while deterministic code proves repository facts, patch scope, execution results, and workspace consistency."

## Optional failure run

Use the evaluation suite for a deterministic failure demonstration:

```bash
npm run eval
```

Show one of:

```text
hallucinated-file-reference
reproduction-test-already-passes
typecheck-failure
forbidden-file-modification
```

Do not modify the live fixture only to manufacture a failure unless the run can be cleanly restored before recording.

## Recording checklist

Before finishing, confirm that the recording shows:

- architecture
- rejected alternatives
- context boundaries
- RunState
- workspace revision
- successful code change
- pre-fix failing-test gate
- mechanical validation report
- hallucination rejection
- retry behavior
- rollback behavior
- human approval
- prompt version
- evaluation baseline
- monitoring summary
- token usage
- estimated cost or an explicit unavailable value
- Docker boundary
- production limitations
