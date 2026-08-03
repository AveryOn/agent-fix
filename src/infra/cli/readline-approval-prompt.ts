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
    this.output.write('\nHuman approval required\n')
    this.output.write(`Run: ${request.runId}\n`)
    this.output.write(`Repository: ${request.repositoryPath}\n`)
    this.output.write(`Task: ${request.task}\n`)
    this.output.write(
      `Validation: ${request.validation.passed ? 'PASSED' : 'FAILED'}\n\n`
    )

    const readline = createInterface({
      input: this.input,
      output: this.output
    })

    try {
      while (true) {
        const answer = await readline.question('Approve this run? [y/n]: ')

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
