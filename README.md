# AgentFix

AgentFix is a multi-agent engineering platform that turns bug reports into verified code changes.

The system uses a set of simple specialized agents for repository analysis, issue reproduction, patch creation, and verification. Each agent works with a limited context and returns structured output.

All changes are applied in an isolated Git workspace and checked using automated tests, type checks, linting, and repository rules. If something fails, the step can be retried without restarting the whole process.

A human must approve changes before a draft pull request is created.

## Workflow

1. Find relevant code in the repository.
2. Write a test that reproduces the bug.
3. Create and apply a patch.
4. Run validation (tests, lint, typecheck).
5. Collect logs, failures, and execution data.
6. Ask for human approval.
7. Create a draft pull request.

## Core properties

- Simple multi-agent coordination
- Structured outputs from agents
- Isolated Git workspace
- Automated validation
- Retry on failure
- Human approval step
- Basic execution logging
- Regression safety checks

## Technology

Node.js, TypeScript, Zod, Vitest, Pino, Git, GitHub CLI.
