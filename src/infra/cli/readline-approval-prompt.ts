import type { Readable, Writable } from 'node:stream'
import type { HumanApprovalPrompt, HumanApprovalRequest } from '~/core/run'

import { createInterface } from 'node:readline/promises'
import { HumanApprovalDecision } from '~/core/run'

export class ReadlineApprovalPrompt implements HumanApprovalPrompt {
  constructor(
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout
  ) {}

  async requestApproval(
    request: HumanApprovalRequest
  ): Promise<HumanApprovalDecision> {
    this.printSummary(request)

    const readline = createInterface({
      input: this.input,
      output: this.output
    })

    try {
      while (true) {
        const answer = await readline.question(
          'Approve final changes? [y/n]: '
        )

        const decision = parseApprovalDecision(answer)

        if (decision !== null) {
          return decision
        }

        this.output.write('Enter y/yes or n/no.\n')
      }
    } finally {
      readline.close()
    }
  }

  private printSummary(request: HumanApprovalRequest): void {
    this.output.write('\nHuman approval required\n')

    this.output.write(`Run: ${request.runId}\n`)
    this.output.write(`Repository: ${request.repositoryPath}\n`)
    this.output.write(`Task: ${request.task}\n`)

    this.output.write(
      `Validation: ${request.validation.passed ? 'PASSED' : 'FAILED'}\n`
    )

    this.output.write(`Reviewer: ${request.review.recommendation}\n`)

    this.output.write(`Changed files: ${request.changedFiles.length}\n`)

    this.output.write(
      `Retries: investigator=${request.retries.investigator}, reproducer=${
        request.retries.reproducer
      }, implementer=${request.retries.implementer}, reviewer=${
        request.retries.reviewer
      }\n`
    )

    this.output.write(
      `Tokens: input=${request.tokenUsage.inputTokens}, output=${
        request.tokenUsage.outputTokens
      }, total=${request.tokenUsage.totalTokens}\n`
    )

    this.output.write(
      `Estimated cost: ${
        request.tokenUsage.estimatedCostUsd === null
          ? 'unavailable'
          : `$${request.tokenUsage.estimatedCostUsd.toFixed(6)}`
      }\n`
    )

    if (request.review.findings.length > 0) {
      this.output.write('\nFindings:\n')

      for (const finding of request.review.findings) {
        this.output.write(
          `  [${finding.severity}] ${finding.title}${
            finding.blocking ? ' (blocking)' : ''
          }\n`
        )
      }
    }

    if (request.review.risks.length > 0) {
      this.output.write('\nRisks:\n')

      for (const risk of request.review.risks) {
        this.output.write(
          `  [${risk.severity}] ${risk.description}${
            risk.blocking ? ' (blocking)' : ''
          }\n`
        )
      }
    }

    this.output.write('\nFinal diff:\n')
    this.output.write(`${request.finalDiff}\n\n`)
  }
}

export function parseApprovalDecision(
  value: string
): HumanApprovalDecision | null {
  const normalized = value.trim().toLowerCase()

  if (normalized === 'y' || normalized === 'yes') {
    return HumanApprovalDecision.approved
  }

  if (normalized === 'n' || normalized === 'no') {
    return HumanApprovalDecision.rejected
  }

  return null
}
