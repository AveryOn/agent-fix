/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  EvaluationMonitoringSnapshot,
  MonitoringRunRecord,
  MonitoringRunState,
  MonitoringSource
} from '~/core/monitoring'
import type { TraceEvent } from '~/core/trace'

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export interface FileMonitoringSourceOptions {
  readonly runsRoot: string
  readonly evaluationsRoot: string
}

export class FileMonitoringSource implements MonitoringSource {
  private readonly runsRoot: string
  private readonly evaluationsRoot: string

  constructor(options: FileMonitoringSourceOptions) {
    this.runsRoot = path.resolve(options.runsRoot)

    this.evaluationsRoot = path.resolve(options.evaluationsRoot)
  }

  async loadRuns(): Promise<readonly MonitoringRunRecord[]> {
    const entries = await readdir(this.runsRoot, {
      withFileTypes: true
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    })

    const runs: MonitoringRunRecord[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const run = await this.loadRun(entry.name)

      if (run !== null) {
        runs.push(run)
      }
    }

    return runs.sort((left, right) =>
      left.state.createdAt.localeCompare(right.state.createdAt)
    )
  }

  async loadEvaluationSnapshot(): Promise<EvaluationMonitoringSnapshot> {
    const current = await this.readJsonFile(
      path.join(this.evaluationsRoot, 'current.json')
    )

    const comparison = await this.readJsonFile(
      path.join(this.evaluationsRoot, 'comparison.json')
    )

    return {
      totalCases: getArrayLength(current, 'cases'),
      regressionCount: getArrayLength(comparison, 'regressions')
    }
  }

  private async loadRun(
    runId: string
  ): Promise<MonitoringRunRecord | null> {
    const runDirectory = path.join(this.runsRoot, runId)

    const stateValue = await this.readJsonFile(
      path.join(runDirectory, 'state.json')
    )

    if (stateValue === null) {
      return null
    }

    const state = parseRunState(stateValue)

    if (state === null) {
      return null
    }

    const events = await this.readEvents(
      path.join(runDirectory, 'events.jsonl')
    )

    return {
      state,
      events
    }
  }

  private async readEvents(
    filePath: string
  ): Promise<readonly TraceEvent[]> {
    const content = await readFile(filePath, 'utf8').catch(
      (error: unknown) => {
        if (isMissingFileError(error)) {
          return ''
        }

        throw error
      }
    )

    if (content.trim().length === 0) {
      return []
    }

    const events: TraceEvent[] = []

    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) {
        continue
      }

      try {
        events.push(JSON.parse(line) as TraceEvent)
      } catch (error) {
        throw new Error(`Invalid trace JSON at ${filePath}:${index + 1}`, {
          cause: error
        })
      }
    }

    return events
  }

  private async readJsonFile(filePath: string): Promise<unknown | null> {
    const content = await readFile(filePath, 'utf8').catch(
      (error: unknown) => {
        if (isMissingFileError(error)) {
          return null
        }

        throw error
      }
    )

    if (content === null) {
      return null
    }

    return JSON.parse(content) as unknown
  }
}

function parseRunState(value: unknown): MonitoringRunState | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !hasStringProperty(value, 'runId') ||
    !hasStringProperty(value, 'status') ||
    !hasStringProperty(value, 'createdAt') ||
    !hasStringProperty(value, 'updatedAt')
  ) {
    return null
  }

  return {
    runId: value.runId,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function getArrayLength(value: unknown, property: string): number {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(property in value)
  ) {
    return 0
  }

  const nestedValue = value[property as keyof typeof value]

  return Array.isArray(nestedValue)
    ? (nestedValue as any as string).length
    : 0
}

function hasStringProperty<TProperty extends string>(
  value: object,
  property: TProperty
): value is object & Record<TProperty, string> {
  return (
    property in value &&
    typeof value[property as keyof typeof value] === 'string'
  )
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
