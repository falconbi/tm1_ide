# }IDE.Backup

Archives a server's data folder **before a deploy replaces the model**. Hidden process (leading `}`),
created on the server by the IDE when needed — exactly like `}IDE.SaveDataAll`.

- **Save first:** `SaveDataAll` runs before anything is read from disk, so the archive holds every
  changed cube value, not just what happened to be written already.
- **Where it goes:** beside the data folder, never inside it.

  ```
  <server>\data       the model (this is what is zipped)
  <server>\backup     TM1Backup_2026-11-26_090415.zip
  ```

  A zip written into `data` would swallow itself, so `pTargetDir` defaults to `..\backup` and the
  folder is created if it is missing.
- **How:** a small PowerShell script is written to the data folder line by line (readable in the
  process, in the folder and in a review), then run with TM1's `ExecuteCommand`. It uses
  `Compress-Archive`; if that is unavailable it falls back to Windows' `tar.exe`. `pFormat=copy`
  produces a folder copy instead, for a server without either.
- **Proof, not hope:** the script writes `zz-ide-backup-last.txt` (`path|size`) only after the
  archive exists and is at least 1 KB. The process checks for that file and calls `ProcessError`
  when it is missing. A deploy that runs this as its backup process therefore **stops** instead of
  sending — the same rule as any other failed backup.
- **Retention:** keeps the last `pKeep` (default 5) `TM1Backup_*` entries in the folder, deletes
  older ones. Deleting is done by this process, not by a person.
- **Parameters:** `pTargetDir` (default `..\backup`), `pFormat` (`zip` | `copy`), `pKeep` (default 5).
- **Who runs it:** Deploy → **Protection** sets it as the target's backup process, so every deploy
  runs it first and refuses to send if it fails. The same screen can run it on demand.
- **Secrets and scope:** it never touches the model; it saves data and copies files. It runs as the
  signed-in account, so that account needs write access to the sibling `backup` folder.
- **No Bedrock.** One house process, ours, versioned here.

## Installing it

The definition in this folder is the source of truth; the server copy is runtime state (TM1 Git
exports no `}` objects, so it never travels in a release). The IDE creates it on the server when a
backup is first requested:

```js
const BACKUP = require('../ti-processes/backup/process.json')
if (!await this.getProcess(BACKUP.name).catch(() => null)) await this.createOrReplaceProcess(BACKUP)
await this.executeProcess(BACKUP.name, ['pKeep', 5])
```

## What a successful run leaves behind

- one `TM1Backup_<stamp>.zip` in `<server>\backup`
- `zz-ide-backup-last.txt` in `<server>\data` holding `<full path>|<bytes>`
- one `INFO` line in `tm1server.log`; on failure an `ERROR` line and a process error log
