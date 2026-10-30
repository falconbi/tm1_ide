# Workforce Lenses

These are the Workforce Lenses exactly as saved in TM1 (`TM1_Test_DEV`, folder `Workforce`): each page is `pages/<name>.html` with its metadata and config in `pages/<name>.json`.

The TM1 copy and this folder must match — if a page changes in TM1, export it back here and commit it.

Save one page with `node lenses/workforce/save.js WFP-Home` (no argument saves every page).

Editing a page directly in TM1 counts as drift; export it back to this folder so the repo has the history.
