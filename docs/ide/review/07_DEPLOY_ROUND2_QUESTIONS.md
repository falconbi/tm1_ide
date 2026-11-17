# 07 — Deploy round 2: questions and out-of-scope findings

Findings noticed while completing the round. None changed in this round unless the brief names it.

1. **`readOptional` swallows every error, not just "missing".**
   `core/model-store.js` `readOptional` returns `null` for any `catch`, including a network
   failure or an unreadable document. It is used only for the deploy lock and lock events
   (`core/git-lock.js`), which are explicitly ephemeral coordination rather than model-owned
   records. Should an unreadable lock be "free" or should it stop a deploy? (Today it is free.)

2. **Lens lists collect per-document read errors and continue.**
   `core/lens-store.js` `listLenses` / `listLensRuns` catch a document read and push it to
   `out.errors`; the list still returns. The error is surfaced, not silently dropped, but a caller
   that ignores `errors` sees a partial list. Lenses are not one of the four manifest areas.

3. **`tools/migrate-assertions.js` does not write the manifest.**
   After it copies `config/assertions.json` into the model, assertions remain `local` until the
   manifest is set with `node tools/migrate-governance.js --manifest <server> --model --areas
   assertions`. This follows the brief ("only the tool writes the manifest"), but the assertions
   tool's output does not yet say so.

4. **`git-state.lastDeployed` still reads the local file.**
   Writes go to the model on a deployState-owned server and are mirrored locally, but reads use the
   local mirror. A fresh IDE that never wrote a deploy state relies on the model read elsewhere
   (`recordDeploy` reads it before writing). This is the existing write-through transition, not a
   silent catch.
