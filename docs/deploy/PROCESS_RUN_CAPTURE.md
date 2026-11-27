# What a TI run records in the change set

A process run on DEV can build model objects — dimensions and their elements,
cubes, processes, subsets, views, chores, attribute definitions and values. Those
objects have to be in the change set, or the release cannot carry them and the
work arrives at close as an unowned file difference.

This page says exactly what is recorded, what is not, and how the gaps are
handled.

Code: `core/process-capture.js`, wired into `POST /api/process/run` and into the
MCP agent's own run path (`tools/tm1mcp/tools/develop.js`).

---

## The rule

**A run on DEV requires an open change set.** The route refuses otherwise,
because the capture needs somewhere to write. A server whose Git label is not
`DEV` keeps the old rule; an unlinked server's role is unknown and the rule is not
applied to it.

The capture runs around the process, whatever its outcome, so a run that failed
half way is recorded as far as it got.

---

## What is captured

### 1. Dimensions the process names

The process text is scanned for the dimensions and cubes it writes to:
`DimensionElementInsert`, `DimensionElementComponentAdd`,
`DimensionElementComponentDelete`, `DimensionElementDelete`, `DimensionElementType`,
`AttrPut*`, `Subset*`, `View*`, `CellPut*` and `DB(...)` reads, among others. The
names are matched against the model, so only real objects are seeded.

For each named dimension, the whole hierarchy is snapshotted before the run
(elements, types, edges, weights, hierarchies) and again after. The difference is
written into the change set in a form Build Release can replay:

| Recorded | Meaning |
| --- | --- |
| `ELEMENT_ADDED` | new element, with its type and parent |
| `ELEMENT_DELETED` | element removed |
| `ELEMENT_UPDATED` | type change (clears stored values, so Review asks) |
| `ELEMENT_LINKED` / `ELEMENT_UNLINKED` | parent link added or removed |
| `ELEMENT_MOVED` | parent or weight changed |
| `HIERARCHY_CREATED` / `HIERARCHY_DELETED` | alternate hierarchy added or removed |
| `ATTRIBUTE_*` | attribute definition added, removed or converted |
| attribute values | written values, per element |

### 2. Dimensions the process does **not** name

A process can build a name at run time:

```
sDim = 'WFP ' | Attrs('}Cubes', 'Some Cube', 'pDim');
DimensionElementInsert(sDim, '', 'E10001', 'N');
```

No name in the text matches a model object, so the scanner seeds nothing. Left
alone, that run's changes would be invisible until close.

**The sweep.** Every other model dimension (elements and edges only, no
attributes) is snapshotted before the run and again after, and anything that moved
is recorded exactly as above. On the workforce model, 35 dimensions cost about
0.1 seconds each side.

The run record names the dimensions the sweep caught, under
`capturesUnnamedDimensions`, so a person can see that the run changed something
the process text did not mention.

### 3. Objects created or deleted under a run-time name

The names of every object — dimensions, cubes, processes, chores, subsets per
hierarchy, views per cube — are read before and after the run and compared. A
subset, view, process, cube, chore or dimension that appears or disappears is
recorded, whatever the name it was given. A subset or view also has its content
read after the run, so the record carries what it now contains.

### 4. Subsets and views on named dimensions and cubes

Their content is compared before and after, for the dimensions and cubes in scope.

---

## What is not captured, and why

**Cube data.** Values a process writes to cubes are not recorded and are not
deployed. The run record lists the cubes whose data it touched
(`cubeDataNotDeployed`), so it is stated rather than hidden. Data moves in TM1,
not in Git.

**A process rewritten by another process.** Creating a process is caught by the
name comparison; rewriting one that already exists is not, because the object list
does not change. A process changed that way appears at close as a file difference.

**Attributes on an unnamed dimension.** The sweep reads elements and edges only,
because attributes are the expensive read. If a run changes an attribute value on
a dimension the process text does not name, that value is not recorded. The name
sweep still catches a *new* attribute-bearing object, because it is a new name.

---

## What happens at Build Release with these records

A dimension with element records is rebuilt from **the target's own copy** plus
those records. The target's own additions survive; the recorded edits are applied
on top. Review names anything that would be removed and needs an explicit yes.

A dimension with no records but a changed file (for example, a change made
outside the IDE, or a rewrite the capture could not see) is different: the release
does not carry it, and at Build it appears under "changed on DEV, not in this
release". Ticking it ships DEV's whole file, which replaces the target's copy
rather than merging with it.

---

## Limits worth knowing

- The scan is name-based. A name assembled from several parts that the scanner
  cannot resolve is only covered by the sweep (dimensions) and the name
  comparison (objects), not by full attribute capture.
- A run that is still in progress when the server stops is not captured: the
  capture completes when the run returns.
- The sweep costs one light read per model dimension before and after each run.
  That is deliberate: correctness over the few hundred milliseconds.
