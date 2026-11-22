# Deploy a change set — short walkthrough

About **5 minutes**. This is the simple path: one change set, one release, one target.
Edge cases and recovery live in the written guides, not in this video.

## Before recording

| Setting | Value |
|---|---|
| IDE | `http://localhost:8083` |
| Source server | `TM1_Test_DEV` |
| Target server | `TM1_Test_PROD` |
| Example | A closed change set that has **not** been deployed yet |
| Drift | Clean |
| Browser | Dark theme, 100–110% zoom, notifications off |
| Keep off camera | `.env`, `config/servers.json`, tokens |

The servers are already linked to GitHub. That setup is one-time and is covered in the docs.

**[Bracketed] lines are screen actions — do not read them.**

---

## 0:00 — What this shows

**[IDE open on `TM1_Test_DEV`. Point to the Change Sets control in the header.]**

> This is a short walkthrough of shipping one change from DEV to PROD.
>
> The servers are already connected to GitHub. I have one closed change set ready to deploy.
>
> We will review it, run the deployment wizard, and check the result.

## 0:20 — One place for change sets

**[Click Change sets.]**

> Change sets live here.
>
> This is the current set. These are older sets. **New** starts another one.
>
> Today we only need this one.

## 0:35 — Review the change set

**[Open the change set. Click the report icon. Show the grouped report, then the note field.]**

> Open the report before deploying. It groups the changes by cube, dimension and process. Each entry can show a before and after.
>
> The note says what this work is and why it is being released.
>
> This is the review. If something here is wrong, fix it before going further.

## 1:00 — Start the deploy

**[Hover the change set row. Click Deploy.]**

> There is one way to start: **Deploy** on the change set row.
>
> That opens the wizard for this set.

## 1:10 — Test

**[Step 1: Test. Click Run tests.]**

> Step one runs the model’s tests.
>
> Here they pass. If a blocking test fails, the wizard stops here.

**[Click Continue to Close.]**

## 1:30 — Close

**[Step 2: Close. Click Close change set.]**

> Closing records the test result and the exact changes that will ship.
>
> The set is now the release.

## 1:50 — Commit

**[Step 3: Commit. Click Commit.]**

> This saves DEV to Git. That is the model’s history.
>
> It is not the release. The next step builds the release for PROD.

## 2:10 — Build the release

**[Step 4: Build release. Choose `TM1_Test_PROD`. Click Build release.]**

> Choose PROD as the target and build the release.
>
> The release starts from what PROD already has. It adds only this change set.
>
> **Included** will ship. **Left on DEV** will not. For this walkthrough, everything we need is included.

## 2:40 — Review

**[Step 5: Review. Show the list of changes.]**

> Review shows exactly what PROD will receive.
>
> The drift check is clean. If it were not, the deploy would stop here.

## 3:00 — Approve

**[Step 6: Approve. Type a short note. Click Approve.]**

> Approval is for this exact build.
>
> It records who approved it and when.

## 3:20 — Deploy

**[Step 7: Deploy. Click Deploy to `TM1_Test_PROD`. Confirm.]**

> Deploy sends the approved build to PROD.
>
> The control checks run on the target, and the result is recorded.

## 3:40 — Verify

**[Step 8: Verify. Click Check for drift. Show “No drift”. Open Deploy History briefly.]**

> Verify checks PROD again.
>
> No drift means PROD matches the build it was given.
>
> Deploy History keeps the record: what shipped, who approved it, and when.

## 4:10 — The Deploy tab

**[Close the wizard. Open Deploy from Change Sets.]**

> The Deploy tab holds the other deploy tools: History, Lenses, Baselines, Drift, Model health and GitHub setup.
>
> They are separate from this walkthrough. The written guides cover each one.

## 4:35 — Close

**[Return to the IDE.]**

> That is the simple path:
>
> Review the change set. Run the tests. Close it. Commit DEV. Build for PROD. Review. Approve. Deploy. Verify.
>
> One change set, one release, one target.

---

## Related written guides

- How a TM1 deploy works — https://falconbi.github.io/articles/how-tm1-deploys-work/
- Deploying Lenses — https://falconbi.github.io/articles/deploying-lenses/
