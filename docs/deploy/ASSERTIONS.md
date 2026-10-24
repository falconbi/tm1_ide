# Assertions — ground rules

Assertions are the model's tests. Each one is a **query** and the **number it should return**. They are written
mostly by the **AI** (via the MCP) as it builds a model, and a human can **override or delete** anything.

## What to test

1. **Test the end of the logic** — a real calculation or consolidation output, never an intermediate step.
2. **One question sets the kind** — does the expected value depend on the data?
   - **Yes → `behaviour`** (a specific number; runs on **DEV** only).
   - **No → `control`** (a rule that must hold; runs on **DEV and PROD**).
3. **A standard control kit on every model** — consolidations tie, totals = sum of the parts, balances = 0 where
   required, no unexpected negatives/blanks, cross-cube ties, model integrity. These are universal; treat them as a
   baseline.
4. **A change set carries the tests for its change.** If you changed a calculation, the change set includes the test
   that pins its output (or the control that guards its rule). A change is not done until it has the tests that prove it.

## Values

5. **Behaviour expected = the real output on known-good DEV.**
6. **AI sets; a human overrides or deletes.** The one hard rule: the AI must **never change an expected value
   silently** — every change is recorded (who/when/why) and visible, so a human can catch a moved goalpost.
7. **Tolerance**: 0.01 default; wider for rates/rounding.

## Severity

8. **`block`** = must stop a Close/deploy (invariants and key calcs).
9. **`warn`** = data-sensitive or nice-to-know. **Actual-vs-forecast / data comparisons are always `warn`** — never block.
10. **The AI sets severity by rule; a human can override.**

## Style & provenance

11. **Description says what it checks, in plain words; `why` says the rule/intent it protects.**
12. **Every assertion records its author, the change set that introduced it, and its expected-change history.**

## Reading a result

- **A behaviour mismatch is "changed"** — the number moved (the data moved, or a rule did). Confirm the new number;
  if it is right, update the expected (the test was out of date).
- **A control mismatch is "failed"** — the model is broken. Fix the logic; do not change the expected.
