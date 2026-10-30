# Core IDE TIs

Hidden, platform-level TI processes. Install once per server through the server template or a platform release; never inside an application change set.

| Object | Purpose |
|---|---|
| `}IDE.Version.Copy` | Copy a version as static values or a calculating seed. |
| `}IDE.SaveDataAll` | Fallback for servers without the REST `SaveDataAll` action (`save-data-all/`). |
| `SYS Settings` | Platform settings cube (`sys-settings/`). |

Rules:

- `}IDE.*` is infrastructure; hidden from normal lists and not business-facing.
- Core is generic; model-specific values come from `SYS Settings` or parameters.
- Application processes may call core; core must not call application logic.
- Do not use `}bedrock.*` from core, MCP or application logic.
- MCP exposes dedicated tools (`copy_version`) rather than raw hidden process names.
- The source in this folder is the versioned copy; the model's process is the runtime copy.
