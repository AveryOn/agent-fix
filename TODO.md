# TODO List

## 1. DI Module

- [x] `[001]` ~~implement base DI container logic~~
- [ ] `[002]` define module metadata with `imports`, `providers`, and `exports`
- [ ] `[003]` implement module graph registration
- [ ] `[004]` implement application bootstrap from `AppModule`
- [ ] `[005]` remove the global container instance
- [ ] `[006]` implement duplicate provider detection
- [ ] `[007]` implement circular dependency detection
- [ ] `[008]` implement application lifecycle and shutdown
- [ ] `[009]` add DI unit tests
- [ ] `[010]` add DI bootstrap smoke test

## 2. Application Bootstrap

- [ ] `[011]` implement `AppModule`
- [ ] `[012]` implement `createApp`
- [ ] `[013]` connect application modules through DI
- [ ] `[014]` implement application start
- [ ] `[015]` implement graceful shutdown
- [ ] `[016]` verify that the application starts without unresolved providers

## 3. Config Module

- [ ] `[017]` remove unused API and database environment variables
- [ ] `[018]` add OpenAI configuration
- [ ] `[019]` add runs directory configuration
- [ ] `[020]` add agent retry and timeout configuration
- [ ] `[021]` add logging configuration
- [ ] `[022]` provide typed config through DI
- [ ] `[023]` update `.env.example`
- [ ] `[024]` add config validation tests

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
```

## 4. Logger Module

- [ ] `[025]` add Pino
- [ ] `[026]` define `LoggerPort`
- [ ] `[027]` implement structured application logger
- [ ] `[028]` add `runId`, `step`, `agent`, and `attempt` fields
- [ ] `[029]` implement secret redaction
- [ ] `[030]` support pretty development logs
- [ ] `[031]` add logger tests

## 5. Trace Module

- [ ] `[032]` define trace event format
- [ ] `[033]` implement JSONL trace writer
- [ ] `[034]` save agent start and completion events
- [ ] `[035]` save tool calls and tool results
- [ ] `[036]` save validation results
- [ ] `[037]` save retries and failures
- [ ] `[038]` save token usage and execution duration
- [ ] `[039]` add trace writer tests

## 6. CLI Module

- [ ] `[040]` define the `CliPort` contract
- [ ] `[041]` implement CLI start and close methods
- [ ] `[042]` implement the `run` command
- [ ] `[043]` accept repository path
- [ ] `[044]` accept bug description
- [ ] `[045]` validate CLI arguments
- [ ] `[046]` display pipeline progress
- [ ] `[047]` display validation results
- [ ] `[048]` implement human approval prompt
- [ ] `[049]` add CLI smoke tests

Target command:

```bash
npm run dev -- run \
  --repo ./fixtures/billing \
  --task "Duplicate webhook delivery creates two payments"
```

## 7. Run Module

- [ ] `[050]` define `RunState`
- [ ] `[051]` define run statuses
- [ ] `[052]` generate unique run identifiers
- [ ] `[053]` create a directory for every run
- [ ] `[054]` save current state to `state.json`
- [ ] `[055]` save run artifacts
- [ ] `[056]` update state after every pipeline step
- [ ] `[057]` implement completed and failed states
- [ ] `[058]` add run state transition tests

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
    final.diff
```

## 8. Workspace Module

- [ ] `[059]` define `WorkspacePort`
- [ ] `[060]` validate the target repository path
- [ ] `[061]` verify that the target is a Git repository
- [ ] `[062]` read the base commit
- [ ] `[063]` create one Git worktree for one run
- [ ] `[064]` create a temporary branch for the run
- [ ] `[065]` return the workspace path to other modules
- [ ] `[066]` implement workspace cleanup
- [ ] `[067]` implement workspace rollback
- [ ] `[068]` add workspace integration tests

Workspace location:

```text
.runs/run-001/workspace
```

All agents inside one run must use the same workspace.

## 9. Repository Module

- [ ] `[069]` define `RepositoryPort`
- [ ] `[070]` implement file listing
- [ ] `[071]` implement code search
- [ ] `[072]` implement file reading
- [ ] `[073]` implement file range reading
- [ ] `[074]` implement current commit reading
- [ ] `[075]` implement changed file listing
- [ ] `[076]` implement Git diff reading
- [ ] `[077]` implement patch application
- [ ] `[078]` prevent access outside the workspace
- [ ] `[079]` reject binary and oversized files
- [ ] `[080]` add repository adapter tests

## 10. Process Module

- [ ] `[081]` define `ProcessRunnerPort`
- [ ] `[082]` implement safe command execution
- [ ] `[083]` implement command timeout
- [ ] `[084]` capture stdout and stderr
- [ ] `[085]` capture exit code and duration
- [ ] `[086]` implement test command execution
- [ ] `[087]` implement typecheck command execution
- [ ] `[088]` implement lint command execution
- [ ] `[089]` implement build command execution
- [ ] `[090]` save command results as run artifacts
- [ ] `[091]` add process runner tests

Agents must not receive an unrestricted shell tool.

Allowed operations:

```text
runTests
runTypecheck
runLint
runBuild
```

## 11. OpenAI Model Module

- [ ] `[092]` install the OpenAI SDK
- [ ] `[093]` define `ModelProviderPort`
- [ ] `[094]` implement `OpenAiModelProvider`
- [ ] `[095]` support structured outputs
- [ ] `[096]` support agent tool calls
- [ ] `[097]` validate model responses with Zod
- [ ] `[098]` collect token usage
- [ ] `[099]` collect request duration
- [ ] `[100]` map OpenAI errors to application errors
- [ ] `[101]` implement API timeout
- [ ] `[102]` add mocked adapter tests
- [ ] `[103]` add one manual live API test

## 12. Prompt Module

- [ ] `[104]` create prompt directories
- [ ] `[105]` create investigator prompt
- [ ] `[106]` create reproducer prompt
- [ ] `[107]` create implementer prompt
- [ ] `[108]` create reviewer prompt
- [ ] `[109]` add prompt version identifiers
- [ ] `[110]` load prompts through a prompt registry
- [ ] `[111]` save prompt versions in traces

Prompt structure:

```text
prompts/
  investigator/
  reproducer/
  implementer/
  reviewer/
```

## 13. Investigator Agent

- [ ] `[112]` define investigation input schema
- [ ] `[113]` define investigation output schema
- [ ] `[114]` implement repository search tool loop
- [ ] `[115]` return related files and symbols
- [ ] `[116]` return evidence references
- [ ] `[117]` return a bug hypothesis
- [ ] `[118]` validate all referenced files
- [ ] `[119]` reject hallucinated file references
- [ ] `[120]` add investigator tests

## 14. Reproducer Agent

- [ ] `[121]` define reproduction input schema
- [ ] `[122]` define reproduction output schema
- [ ] `[123]` inspect the existing test structure
- [ ] `[124]` generate a reproduction test patch
- [ ] `[125]` apply the test patch
- [ ] `[126]` run the reproduction test
- [ ] `[127]` verify that the test fails before the fix
- [ ] `[128]` reject tests that already pass
- [ ] `[129]` save the reproduction patch and test output
- [ ] `[130]` add reproducer tests

## 15. Implementer Agent

- [ ] `[131]` define implementation input schema
- [ ] `[132]` define implementation output schema
- [ ] `[133]` provide confirmed investigation evidence
- [ ] `[134]` provide the failing test result
- [ ] `[135]` generate the implementation patch
- [ ] `[136]` apply the implementation patch
- [ ] `[137]` prevent modification of the reproduction test
- [ ] `[138]` reject forbidden file changes
- [ ] `[139]` save the implementation patch
- [ ] `[140]` add implementer tests

## 16. Reviewer Agent

- [ ] `[141]` define review input schema
- [ ] `[142]` define review output schema
- [ ] `[143]` provide the final diff
- [ ] `[144]` provide test and validation results
- [ ] `[145]` detect suspicious or unrelated changes
- [ ] `[146]` report implementation risks
- [ ] `[147]` report public API changes
- [ ] `[148]` save the review result
- [ ] `[149]` add reviewer tests

## 17. Validation Module

- [ ] `[150]` define validation result format
- [ ] `[151]` validate agent output schemas
- [ ] `[152]` validate file and symbol references
- [ ] `[153]` validate patch application
- [ ] `[154]` verify reproduction failure before the fix
- [ ] `[155]` verify reproduction success after the fix
- [ ] `[156]` run the full test suite
- [ ] `[157]` run typecheck
- [ ] `[158]` run lint
- [ ] `[159]` run build
- [ ] `[160]` validate changed file policies
- [ ] `[161]` reject changes outside the allowed scope
- [ ] `[162]` save the final validation report
- [ ] `[163]` add validation unit tests

## 18. Retry and Failure Handling

- [ ] `[164]` define application error types
- [ ] `[165]` define retryable errors
- [ ] `[166]` define non-retryable errors
- [ ] `[167]` implement schema repair retry
- [ ] `[168]` implement implementation retry
- [ ] `[169]` provide validation errors to the next attempt
- [ ] `[170]` enforce maximum attempt limits
- [ ] `[171]` stop the pipeline on fatal errors
- [ ] `[172]` rollback failed patches
- [ ] `[173]` save retry reasons in traces
- [ ] `[174]` add retry policy tests

## 19. Orchestrator Module

- [ ] `[175]` define the pipeline step sequence
- [ ] `[176]` create a run
- [ ] `[177]` create a workspace
- [ ] `[178]` execute the Investigator Agent
- [ ] `[179]` execute the Reproducer Agent
- [ ] `[180]` verify the failing test
- [ ] `[181]` execute the Implementer Agent
- [ ] `[182]` execute mechanical validation
- [ ] `[183]` execute the Reviewer Agent
- [ ] `[184]` request human approval
- [ ] `[185]` save the final diff
- [ ] `[186]` complete or fail the run
- [ ] `[187]` clean up the workspace when required
- [ ] `[188]` add orchestrator integration tests

## 20. Approval Module

- [ ] `[189]` define approval result
- [ ] `[190]` display changed files
- [ ] `[191]` display final diff
- [ ] `[192]` display test results
- [ ] `[193]` display reviewer risks
- [ ] `[194]` display token usage and retries
- [ ] `[195]` support approve
- [ ] `[196]` support reject
- [ ] `[197]` save the approval decision
- [ ] `[198]` add approval tests

## 21. Billing Demo Fixture

- [ ] `[199]` create a small billing fixture project
- [ ] `[200]` add payment webhook processing
- [ ] `[201]` add duplicate payment bug
- [ ] `[202]` add a minimal test environment
- [ ] `[203]` add typecheck, lint, test, and build scripts
- [ ] `[204]` initialize the fixture as a Git repository
- [ ] `[205]` verify that the bug exists before AgentFix runs
- [ ] `[206]` document the expected fix behavior

Fixture:

```text
fixtures/
  billing-duplicate-payment/
    src/
    tests/
    package.json
    tsconfig.json
```

## 22. Evaluation Cases

- [ ] `[207]` add successful bug fix case
- [ ] `[208]` add invalid agent schema case
- [ ] `[209]` add hallucinated file case
- [ ] `[210]` add reproduction test already passes case
- [ ] `[211]` add implementation typecheck failure case
- [ ] `[212]` add forbidden file modification case
- [ ] `[213]` add command timeout case
- [ ] `[214]` add retry success case
- [ ] `[215]` add human rejection case
- [ ] `[216]` generate an evaluation summary

## 23. Docker Environment

- [ ] `[217]` create a Node.js 24 Dockerfile
- [ ] `[218]` install Git and ripgrep
- [ ] `[219]` run the container as a non-root user
- [ ] `[220]` mount the run workspace
- [ ] `[221]` exclude OpenAI and GitHub secrets from the sandbox
- [ ] `[222]` support test, typecheck, lint, and build execution
- [ ] `[223]` add container resource limits
- [ ] `[224]` add Docker environment smoke test
- [ ] `[225]` update Docker scripts

## 24. Project Cleanup

- [ ] `[226]` rename package metadata to AgentFix
- [ ] `[227]` replace old billing repository links
- [ ] `[228]` replace the old package description
- [ ] `[229]` update `.gitignore` for `.runs`
- [ ] `[230]` remove unused files and configuration
- [ ] `[231]` fix Docker helper scripts
- [ ] `[232]` verify npm scripts
- [ ] `[233]` verify build output
- [ ] `[234]` run formatting and linting

## 25. Documentation

- [ ] `[235]` update README architecture section
- [ ] `[236]` document CLI usage
- [ ] `[237]` document environment variables
- [ ] `[238]` document the pipeline steps
- [ ] `[239]` document validation rules
- [ ] `[240]` document the billing fixture
- [ ] `[241]` document the failure demonstration
- [ ] `[242]` add an example trace
- [ ] `[243]` add an example final diff

## 26. Final Verification

- [ ] `[244]` install dependencies from a clean state
- [ ] `[245]` run typecheck
- [ ] `[246]` run lint
- [ ] `[247]` run build
- [ ] `[248]` run unit tests
- [ ] `[249]` run integration tests
- [ ] `[250]` run evaluation cases
- [ ] `[251]` run the complete live OpenAI workflow
- [ ] `[252]` verify the successful final diff
- [ ] `[253]` verify one retry scenario
- [ ] `[254]` verify one blocked invalid change
- [ ] `[255]` verify trace completeness
- [ ] `[256]` verify token and duration metrics
- [ ] `[257]` verify workspace cleanup
- [ ] `[258]` prepare the final demonstration run

## Commit convention

Use the task code in every commit:

```text
[001] implement base DI container
[003] implement DI bootstrap
[063] create Git worktree for run
[114] implement investigator tool loop
[154] verify reproduction failure
[181] execute implementation agent
```

Several directly related subtasks may be combined into one commit:

```text
[050-058] implement run state module
```

## Outside today's scope

The following parts are not required for the demonstration MVP:

- HTTP API;
- web interface;
- database;
- Redis;
- RabbitMQ;
- parallel agent execution;
- multiple LLM providers;
- automatic merge;
- production deployment;
- multi-user support;
- distributed workers.
