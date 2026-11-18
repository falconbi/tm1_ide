# 07 — Deploy round 3: questions and out-of-scope bugs

Found while implementing steps 1–3. None of these were fixed here unless noted.

## 1. `ownerOf` ignores a subset's or view's parent (fixed in round 3b)

`core/git-release.js` `ownerOf` matches an excluded object to another change set by
`type + name` only. Subsets and views are keyed as `type::parent::name` everywhere else
(`objectKey`), because `Default` on two dimensions is two different objects. A change set
that edited `Default` on `DimA` can therefore be reported as the owner of `Default` on
`DimB`, blocking a release with the wrong change-set name.

**Fixed:** `ownerOf` now uses `objectKey(type, name, parent)`, with `detail` as the parent for subset/view entries. The key holds the dimension, not the hierarchy — so `Default` on the main and an alternate hierarchy of the same dimension still share a key.

## 2. Identical process runs collapse in the change-set view (small)

`getSessionLog` keeps one row per `(object_type, object_name, action, detail)`. `PROCESS_RUN`
detail includes the parameters/status/duration, so two identical runs of the same process
look like one entry in the Change Sets panel. The database has both rows; only the view
deduplicates them. If every run must be visible, the log query needs an exception for
`object_type = 'process-run'` (or the detail needs a per-run value such as its timestamp).

## 3. Windows-style links are not normalised (small)

`linkClosure` resolves with `path.posix`, which matches TM1 Git's exported paths. A link
written with backslashes (`By Location.subsets\Cities.json`) would not match a release path
and would be reported missing. No lab export seen so far uses backslashes; add a
backslash-to-slash normalisation if one does.

## 4. Step 4 of the updated brief (done)

Commit `31f1600` added **Step 4 — the Git token and setup screen tell the truth**. It is implemented on this branch in `fd3eec1`, with the lint follow-up `327b89a`.
