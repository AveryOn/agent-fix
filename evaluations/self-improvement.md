# Evaluation Self-Improvement Record

## Missed failure

The initial pipeline treated an applied reproduction patch as sufficient
evidence that the defect had been reproduced.

A reproduction test could pass against the original buggy implementation.
The pipeline could then continue without proving that the test detected the
reported defect.

## Failure classification

Category: false-positive reproduction.

The generated test was syntactically valid and executable, but it did not
fail before the implementation patch.

## Validator change

`ReproductionGate.assertExpectedFailure()` became a mandatory pipeline gate.

The gate rejects a reproduction when:

- the test command succeeds
- the exit code is zero
- the expected failure marker is absent
- the failure comes from setup, imports, compilation, timeout, or another
  unrelated cause

A test that passes before the fix produces
`ReproducerErrorCode.test_already_passes`.

## Prompt change

The Reproducer prompt was updated from `reproducer-v1` to
`reproducer-v2`.

The new prompt explicitly requires a non-zero pre-fix test result containing
the exact expected failure marker.

## Second prompt change

The Reproducer prompt was updated from `reproducer-v2` to
`reproducer-v3`.

The new version requires the expected failure marker to be emitted by
the exact assertion or conditional check that proves the defect.

It also rejects unreachable marker placement after a failing assertion
and requires all used test framework helpers to be imported.

## Regression case

`reproduction-test-already-passes` supplies a successful pre-fix test result.

The evaluation passes only when the reproduction gate rejects it with:

```text
test_already_passes
```

## Acceptance rule

The prompt or validator change is accepted only when:

- all evaluation cases pass
- no baseline case changes classification
- retry counts do not increase
- no case disappears from the suite
- the baseline comparison reports no regression
