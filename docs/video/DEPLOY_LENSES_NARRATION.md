# Deploy Lenses — detailed narration

About **6–7 minutes**. This is the separate Lens deploy, not the Git change-set release.

## Before recording

| Setting | Value |
|---|---|
| IDE | `http://localhost:8083` |
| Source server | `TM1_Test_DEV` |
| Target server | `TM1_Test_PROD` |
| Flow | Deploy → **Lenses** |
| Lenses | `WFP-Positions` v14, `WFP-Hire-Approvals` v22 |
| Source state | Both **published** on DEV |
| Account | A TM1 admin |
| Keep off camera | `.env`, `config/servers.json`, tokens, unrelated tabs |

Make sure the change-set release has already put the Lenses’ cubes and processes on the target. A Lens that writes to a cube, or runs a process, is a blocker if that cube/process is missing on PROD.

**[Bracketed] lines are screen actions — do not read them.**

---

## 0:00 — Why Lenses have their own deploy

**[Deploy Center open. Point to the Lenses tab.]**

> Lenses are different from cubes, processes and rules.
>
> A Lens is a model document: its HTML, its config and its metadata are stored inside the TM1 model. It is not one of the Git-tracked model objects that the normal release carries.
>
> So Lenses have their own deploy, here: Deploy → Lenses. It is not a change set and it does not use Git. It compares the Lenses on one server with another, approves their exact content, ships them, and verifies them.

## 0:40 — What the Lens deploy does, in one sentence

> It answers one question: “Which published Lenses are different on the target, and can I safely copy exactly this approved content across?”

## 0:50 — Pick source and target

**[Deploy → Lenses. Source is already `TM1_Test_DEV`. Select `TM1_Test_PROD` as the target.]**

> The source is the server whose Lenses I want to ship — here, DEV.
>
> The target is where they will run — here, PROD. The app only offers servers other than the source.
>
> This is admin-only. The target’s Lens documents are model documents, so changing them is an administrative action.

## 1:10 — Compare

**[Click “Compare source and target”. Wait for the plan.]**

> Compare is read-only. Nothing is written to either server.
>
> It reads every Lens on the source, reads every Lens on the target, and compares their content. Not their version number, not who saved last — their actual content: the HTML, config, title, folder and metadata.
>
> The result groups them into new, changed, same and draft. There is also a target-only list.

## 1:40 — The four states

**[Point to the counts and the list.]**

> **New** means the target does not have this Lens at all.
>
> **Changed** means the target has a Lens with the same name, but its content is different.
>
> **Same** means the content already matches; there is nothing to do.
>
> **Draft** means the source Lens is still a draft. Drafts are shown so you can see them, but they cannot ship. Publish the Lens on the source first, then compare again.
>
> Only published new and changed Lenses go into the deploy.

## 2:20 — Blockers, not warnings

**[Point to the blockers area if present. Show a Lens’s declared writes/runs in the explanation.]**

> A Lens declares what it is allowed to change or run: its cubes and its processes.
>
> Before it can ship, the target must already have those cubes and processes. If one is missing, that Lens is a blocker, and the plan cannot be approved.
>
> This is deliberate. A Lens that saves into a cube which does not exist on PROD is not a cosmetic problem — it would fail for the person using it.
>
> The normal order is therefore: ship the model changes first, then the Lenses.

## 3:00 — Target-only Lenses

**[Scroll to “Target-only Lenses”. Point to the unticked boxes.]**

> Target-only means a Lens exists on PROD but not on DEV.
>
> Nothing is deleted by default. If one of these should be removed, tick it. If it is still needed, leave it alone.
>
> The deploy only deletes what you explicitly tick and approve.

## 3:30 — Review and approve

**[Click “Continue to approve”. Point to the plan hash.]**

> This is the approval step.
>
> The approval is bound to a plan hash: a fingerprint of the exact source Lenses and the exact delete list in this plan.
>
> If any source Lens changes after I approve, the hash changes and the deploy refuses. I have to compare and approve again.
>
> I can add a short note for the history, then approve.

## 4:10 — Deploy

**[Click “Approve deploy”. Then click “Deploy to TM1_Test_PROD”.]**

> Deploy takes the target’s deploy lock, so two Lens deploys cannot run against the same target at once.
>
> It saves each approved Lens as a published Lens on the target, with its HTML, config, title, folder, icon and metadata.
>
> Then it reads every Lens back and checks the content hash again. “Saved without error” is not the proof; matching the approved content is the proof.
>
> It also performs only the target-only deletes that were ticked.

## 5:00 — Verify

**[Show the per-Lens result list.]**

> The result is per Lens.
>
> A green tick means the Lens was saved and read back with the approved content. A failure names the Lens and the reason.
>
> If one Lens fails, the others are still reported individually. The deploy is not a silent partial success.

## 5:30 — History

**[Scroll to “Lens deploy history on TM1_Test_PROD”.]**

> The approval and the history live in the **target model**, under `Applications/Governance/LensDeploys`.
>
> That means everyone pointed at PROD sees the same record: who approved, who deployed, when, which server was the source, which Lenses shipped, and whether they verified.
>
> It is not a local log on my machine.

## 5:55 — What this deploy does not do

> Three things to be clear about:
>
> 1. It does **not** ship cubes, processes or rules. Those come through the normal Git release. The Lens deploy expects them to be there already.
> 2. It does **not** ship drafts. A draft must be published on the source first.
> 3. It does **not** replace the change-set deploy. It is a separate, deliberate Lens step, usually run after the model release.

## 6:20 — Close

**[Hold on the verified result and history.]**

> That is the Lens deploy: compare published Lenses, review the changes, approve the exact content, deploy, read back and verify, then keep the history in the target model.
>
> Model first, then Lenses.

---

## Recording order

1. Change-set release: DEV → PROD.
2. Lens deploy: DEV → PROD, for `WFP-Positions` and `WFP-Hire-Approvals`.

Say on camera: **“Lenses do not go through the Git release. This is Deploy → Lenses.”**
