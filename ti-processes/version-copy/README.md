# }IDE.Version.Copy

Generic, hidden core TI for copying one version inside a TM1 model.

- **static:** copies every cube that carries the version dimension; the target is added under the static parent and values are stored.
- **calculating:** copies only the configured input cubes; the target is calculating and TM1 rules rebuild the outputs.
- **new / replace:** the target must not exist for `new`; it must exist for `replace`.
- **exclusions:** control cubes and configured exclusions are skipped.
- **no Bedrock:** the process uses a view datasource and `CubeSetLogChanges`, not `}bedrock.*`.

Parameters:

```text
pSource, pTarget
pMode        new | replace
pType        calculating | static
pVersionDim
pStaticParent
pInputCubes  | separated, used for calculating
pExcludeCubes  | separated
pStatus
pTypeAttr
pStatusAttr
pCube        internal; leave blank
```

The process is installed once per server as `}IDE.Version.Copy`. The source lives here and is the versioned copy; the model's process is the runtime copy. It supports up to eight cube dimensions.

Do not expose this hidden process directly to AI. Use a dedicated MCP tool or an IDE Core TI action with the same guardrails.

Behaviour worth knowing:

- **Cells a rule still owns are skipped.** In a cube whose rules have no static-version guard (`[] = N: IF(ELPAR(...) @= 'Non-Calculating', STET, CONTINUE);`), rule-calculated cells cannot be written in any version, so the copy skips them and the rules calculate them in the target from its copied inputs. This is what Bedrock's copy did too.
- **A static copy refuses to run** unless the target sits under `pStaticParent`, so a "static" copy can never quietly land in a calculating version.
- **Any cube that fails fails the whole copy** (the parent checks each per-cube child). Earlier versions ignored child failures, which is why a direct call could look successful while rule cells failed.
- **Call it, then carry on:** it ends normally (no `ProcessQuit`), so a calling process isn't flagged with errors.
