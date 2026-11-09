# Workforce (WFP) — setup and demo-data processes

These nine TI processes built the Workforce model's demo data on TM1_Test_DEV. They were run
once, are not called by any process, chore or Lens, and were **removed from the server on
9 Nov 2026** to declutter the model. Each `.json` here is the full process as TM1 returned it
(code, parameters, datasource, variables), so any of them can be put back exactly.

The data they wrote is still in the cubes — removing the processes changed no data.

## What each one does

| Process | Writes | Parameters | What it seeds |
|---|---|---|---|
| WFP Seed Tax Bands | WFP Tax Bands | — | Employer payroll tax and employee income tax bands, by jurisdiction |
| WFP Seed FX Rates | WFP FX Rates | — | Rates to the reporting currency (GBP), for every leaf version |
| WFP Seed Pay Rates | WFP Pay Rates | — | Pay bands by grade, location and job family, for every leaf version (re-run after adding a version) |
| WFP Seed Assumptions | WFP Assumptions | — | Planning drivers per period, version and entity; each calculating version has its own set |
| WFP Generate Positions | WFP Position (+ attributes) | `pCount` (3000), `pSeed` (20261020) | A deterministic demo roster of `pCount` positions on top of the WFP Load Positions roster |
| WFP Seed Hiring Plan | WFP Hiring Plan | — | Hire and attrition months for the hand-typed positions, per version |
| WFP Generate Hiring Plan | WFP Hiring Plan | `pStage` (`feb` or `now`) | Hire and leave months for the generated roster: `feb` = the plan at the Feb 2026 close (run, then snapshot), `now` = today's plan |
| WFP Seed Assignments | WFP Assignment, WFP Position Map, people in WFP Employee | `pClear` (1) | Who sits in which position, and the position facts by month, from the opening period |
| WFP Seed Workforce Input | WFP Workforce Input | — | FTE, base salary and one-time amounts per month for each position that exists |

## Order to seed again

Based on what each process reads (check its Prolog header before running):

1. **Reference data:** Seed Tax Bands, Seed FX Rates, Seed Pay Rates (any order).
2. **Seed Assumptions.**
3. **Positions:** WFP Load Positions (still on the server), then **Generate Positions** — it reads Pay Rates.
4. **Hiring plan:** Seed Hiring Plan, then **Generate Hiring Plan** (`pStage=feb`, snapshot if you want the Feb plan, then `pStage=now`).
5. **Seed Assignments** — it reads the Hiring Plan, Assumptions and Position Map.
6. **Seed Workforce Input** — it reads Assignments and Position Map.
7. **Recalculate:** WFP Assignment Base (or let the WFP Recalculate Cost chore pick it up), then WFP Create Default Subsets.

## Putting a process back

Re-create it on the server from its file, inside a change set, then run it from the TI editor:

```bash
node -e "
require('dotenv').config({quiet:true});
const {makeClient}=require('./core/adapter_registry');
const p=require('./docs/models/workforce-setup/seed-tax-bands.json');
makeClient('TM1_Test_DEV',null).post('Processes',p).then(()=>console.log('created',p.Name));"
```

Or ask an AI agent to "re-create WFP Seed Tax Bands from docs/models/workforce-setup" — the MCP
`build_process` tool takes the same fields.
