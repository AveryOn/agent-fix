const REDACTED_SECRET = '[REDACTED_SECRET]'
const REDACTED_PROMPT = '[REDACTED_PROMPT]'
const CIRCULAR_VALUE = '[Circular]'

const secretKeyPatterns = [
  /api[_-]?key/i,
  /authorization/i,
  /password/i,
  /(^|[_-])secret$/i,
  /^token$/i,
  /(^|[_-])(access|refresh|id|bearer)[_-]?token$/i
]

const promptKeyPatterns = [
  /^(system|user|developer)?_?prompt$/i,
  /^prompt(Text|Content)$/i,
  /^messages$/i,
  /^instructions?$/i
]

export function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>())
}

function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'undefined') {
    return undefined
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return redactError(value, ancestors)
  }

  if (typeof value !== 'object') {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value)
  }

  if (ancestors.has(value)) {
    return CIRCULAR_VALUE
  }

  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors))
    }

    return redactRecord(value as Record<string, unknown>, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function redactRecord(
  value: Record<string, unknown>,
  ancestors: WeakSet<object>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const promptMessage = isPromptMessage(value)

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED_SECRET
      continue
    }

    if (isPromptKey(key) || (promptMessage && key === 'content')) {
      result[key] = REDACTED_PROMPT
      continue
    }

    result[key] = redactValue(nestedValue, ancestors)
  }

  return result
}

function redactError(
  error: Error,
  ancestors: WeakSet<object>
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message
  }

  if (error.stack !== undefined) {
    result.stack = error.stack
  }

  if (error.cause !== undefined) {
    result.cause = redactValue(error.cause, ancestors)
  }

  for (const [key, value] of Object.entries(error)) {
    if (!(key in result)) {
      result[key] = redactValue(value, ancestors)
    }
  }

  return result
}

function isSecretKey(key: string): boolean {
  return secretKeyPatterns.some((pattern) => pattern.test(key))
}

function isPromptKey(key: string): boolean {
  return promptKeyPatterns.some((pattern) => pattern.test(key))
}

function isPromptMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value.role === 'string' &&
    ['system', 'user', 'developer', 'assistant'].includes(value.role)
  )
}
