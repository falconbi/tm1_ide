# }IDE.SaveDataAll

Hidden core fallback for servers whose REST API does not support `POST /api/v1/tm1.SaveDataAll`.

- **Prolog:** `SaveDataAll;` — writes all changed cube data to disk. The server pauses briefly.
- **Who:** TM1 admins only. The IDE route and MCP tool check the caller's `ADMIN` group.
- **Created on demand:** `TM1Client.saveDataAll()` tries the REST action first; if the server answers 400/404/405/501, it creates this process if missing and runs it.
- **Source of truth:** `process.json` is the versioned copy. The server process is the runtime copy.
- **No Bedrock.**
- Do not expose the raw hidden process to AI; use the `save_data_all` MCP tool.
