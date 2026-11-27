# Testing a TM1 model — in plain English

This is generic: it applies to any model, not just Workforce.

## The one rule

**A test should check that the logic works, not that today's numbers match yesterday's.**

If the expected answer changes when someone loads data, moves an employee, or reseeds the
model, then it is not testing logic — it is testing the data. That is the difference between
a test that stays useful for years and one that goes red every Monday.

There are only three useful kinds of test.

---

## 1. Structure — "does the model hang together?"

True for **any** data. These are checks like **"A minus B = 0"** or **"count = 0"**.

What to test in any model:

- **Totals tie.** Every consolidation equals the sum of its children.
- **No orphans.** Every element that should have a parent has one; every subset element
  exists; every view points at a subset that still exists.
- **Rules and feeders.** Every calculated cube has feeders where it needs them; no rules
  without `SKIPCHECK`; no `SKIPCHECK` without `FEEDERS`.
- **Objects exist.** The cubes, dimensions, processes, chores and views the model needs are
  there, with the expected names.
- **Wiring.** A process writes to a cube that exists; a chore runs processes that exist.
- **Integrity.** No assignment outside its position's life; no duplicate aliases; no
  over-filled position; no person over 100%.
- **Security.** No cube left open by accident; the expected groups exist.

Why they are repeatable: the answer is a **relationship**, not a number. Load 10 rows or
10,000 and `total − sum(children)` is still 0.

When they run: every close, and again on the target after a deploy.

Do they gate? **Yes.** A broken structure means the model is wrong.

---

## 2. Calculation — "does this piece of logic give the right answer?"

Here the answer *is* a number — so the test must **supply the data it needs**.

What to test:

- A tax band calculation, a proration, an FTE split, a currency conversion, a bonus rule.
- Ideally as a **formula**: `net pay − (gross − tax − pension) = 0`. No literal, still a
  calculation.
- When you need a literal (`98,560.20`), put a tiny known input in a **reserved test
  version/scenario**, run the calculation there, and assert inside it. One employee, one
  month, one rate — not the live model.

Why they are repeatable: the test **owns its input**. It writes the same fixture every run,
so it does not care what the real data is doing.

When they run: at close, on the server that holds the fixture.

Do they gate? **Yes** — but only where the fixture exists. Never run them on PROD's live
data; the comparison would be meaningless.

---

## 3. Quality — "is the data sensible?"

These depend on the data by definition. That is fine — they just must **never block**.

What to test:

- Ranges: salary above zero, below a cap; headcount not 10× last month.
- Completeness: no employee without a position; no position without a location.
- Freshness: the load ran this month; the prior snapshot exists.
- Variances: actual vs budget inside a threshold.

Why they are not gates: a mass redundancy makes "headcount fell 30%" true while the model is
perfect. Stopping a release for that is wrong.

**Where they run: on PROD** — after a load, or on a schedule — and on TEST only because TEST is
a clone of PROD. **They are not a DEV test.** DEV holds working data; a quality check there
measures junk and trains people to ignore red.

Do they gate? **No.**

---

## How to decide which one you are writing

Ask three questions in order:

1. **Can I state it without a number that depends on today's data?**
   → **Structure.**
2. **Do I need an exact number?**
   → **Calculation** — and then you must supply the data (fixture).
3. **Does it only make sense against whatever is loaded?**
   → **Quality** — run it on PROD (or TEST, a clone of PROD), and it must not gate.

If none of these fit, the test is probably an intermediate step or a snapshot; delete it.

---

## How to do it better

1. **Prefer a relationship to a literal.** "Difference = 0" survives a reseed; a number does not.
2. **Own the input.** If you pin a number, the test creates the data — a reserved version, a
   small fixture, reset on every run.
3. **Quality belongs to the target.** Run it on PROD (or TEST, a clone of PROD), never on DEV —
   DEV's data is working data, so a quality result there is noise.
3. **One idea per test.** A test that fails for five possible reasons tells you nothing.
4. **Name the failure in plain words.** The description should say what broke, e.g. "net pay
   does not equal gross − tax − pension", not "expected 57,668".
5. **Separate the gate from the monitor.** Structure and calculation can stop a release.
   Quality informs the data owner.
6. **Record the dataset identity and any expected-value change** (who, when, why). Then red
   always means one of two things: the logic changed, or the data changed — and the record
   tells you which.
7. **Run structure on the target after a deploy.** It is the only kind that means anything on
   real data.
8. **Delete snapshot tests** you cannot reproduce from inputs. They are not tests; they are
   memories.
9. **Audit by movement.** If an expected value moves when data moves, the test is in the wrong
   category.

## Common mistakes this prevents

- **The literal on shared data.** Goes red when a roster changes; someone "fixes" it by
  updating the number, and the test becomes a tautology.
- **The aggregate as a calculation.** "Group total = 222M" fails for 500 reasons, none of which
  point at the logic.
- **The quality threshold in the gate.** Real-world data makes it red; the release is blocked
  for a business event.
- **The fixture that shares a version with real data.** Test writes corrupt a report.
