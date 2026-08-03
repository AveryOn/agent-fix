import { describe, expect, it } from 'vitest'
import { HumanApprovalDecision } from '~/core/run'
import { parseApprovalDecision } from '~/infra/cli'

describe('parseApprovalDecision', () => {
  it.each(['y', 'yes', ' Y ', 'YES'])('parses %s as approved', (value) => {
    expect(parseApprovalDecision(value)).toBe(
      HumanApprovalDecision.approved
    )
  })

  it.each(['n', 'no', ' N ', 'NO'])('parses %s as rejected', (value) => {
    expect(parseApprovalDecision(value)).toBe(
      HumanApprovalDecision.rejected
    )
  })

  it('rejects an unknown answer', () => {
    expect(parseApprovalDecision('maybe')).toBeNull()
  })
})
