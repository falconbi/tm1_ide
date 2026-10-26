# SYS Settings

Platform settings cube, one per server, `SYS Application × SYS Setting × SYS Settings Measure`.

Read order is **application row → `All` row → code default**. Only platform/admin writes it. It is deployed as a platform object, not inside an application change set.

The `Text` measure holds string values. Version Copy reads its application row (`pApp`) and falls back to `All`.

Current seeded keys:

- Version Dimension
- Version Static Parent
- Version Input Cubes
- Version Exclude Cubes
- Version Type Attribute
- Version Status Attribute
- Current Forecast
- Working Budget
- Current Budget
- Default Entity / Year / Currency

The server template/bootstrap should create this cube. This repository contains the definition; the current DEV server has the cube and values.
