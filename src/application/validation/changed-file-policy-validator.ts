import type { ValidationFilePolicy } from '~/core/validation'

export class ChangedFilePolicyValidator {
  getViolations(
    changedFiles: readonly string[],
    policy: ValidationFilePolicy
  ): readonly string[] {
    const allowedFiles = new Set(policy.allowedFiles)

    const forbiddenFiles = new Set(policy.forbiddenFiles)

    const violations = new Set<string>()

    for (const filePath of changedFiles) {
      if (!allowedFiles.has(filePath)) {
        violations.add(filePath)
      }

      if (forbiddenFiles.has(filePath)) {
        violations.add(filePath)
      }

      if (
        policy.forbiddenPrefixes.some((prefix) =>
          matchesPrefix(filePath, prefix)
        )
      ) {
        violations.add(filePath)
      }
    }

    return [...violations].sort()
  }
}

function matchesPrefix(filePath: string, prefix: string): boolean {
  const normalizedPrefix = prefix.endsWith('/')
    ? prefix.slice(0, -1)
    : prefix

  return (
    filePath === normalizedPrefix ||
    filePath.startsWith(`${normalizedPrefix}/`)
  )
}
