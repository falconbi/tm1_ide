# Multi-User Login — status

**Last checked against the code: 15 Oct 2026.** This started as a TODO list. Most of it is now
built; what is left is listed under [Still open](#still-open).

How sign-in works for a user is in [AUTHENTICATION.md](AUTHENTICATION.md). This page tracks the
multi-user work itself.

---

## Why

The IDE used to sign in to TM1 as one shared account from `.env`. Everyone was the same user to
TM1, so change sets mixed everyone's work, nobody could see who changed what, and TM1's own
security didn't apply to each person.

## Done

| Item | Where | Notes |
| --- | --- | --- |
| IDE sign-in | `POST /api/auth/login`, `POST /api/auth/logout` (`server.js`) | Sign in through any TM1 server you have an account on. The browser gets a random session token, never the password. Rate-limited: 10 attempts per 15 minutes per IP. |
| Each server has its own login | `POST /api/auth/server-login`, `POST /api/auth/server-logout`, `GET /api/auth/servers` | Signing in to one server never signs you in to another. A rejected password is not retried. Signing out ends the TM1 session on the server. Tested on v11.8 on 4 Oct 2026. |
| Sign-in method detection | `GET /api/auth/method` | Asks the server how it wants to be signed in to (TM1 security, LDAP check, CAM) before asking for anything. |
| First login on a brand-new server | `POST /api/auth/setup-login` | Signs in once as `admin` with the blank password and makes you set a password straight away. |
| Local single-user mode | `POST /api/auth/local-session` | When the IDE is reachable only from this machine (`HOST=127.0.0.1`), it opens without a sign-in page. You still sign in to each TM1 server. |
| Token on every call | `x-ide-token` header from the client | Every TM1 call runs as the person signed in to that server. |
| One TM1 session per person per server | `core/adapter_registry.js` | Reused for every call, closed on sign-out. Before this fix, a lab server had 538 leaked sessions. |
| Per-person change sets | `core/change_log.js` `getActiveSession(server, user)` | Each person has their own open change set on a server. Each change records who made it. |
| No hard-coded user | `SessionControl.jsx` | The old `user: 'jdlove'` is gone. The signed-in user is used. |
| User Management on the selected server | Server Admin | Acts on the server selected in the IDE, not on a fixed login server. |
| Baseline and drift checks before deploy (old "Phase 3") | `/api/deploy/drift-check`, `/api/git/drift` | Drift on the target pauses a deploy. Details: [DEPLOY_LIFECYCLE.md](../deploy/DEPLOY_LIFECYCLE.md). |

## Partly done

- **Warning when two people touch the same object.** The Deploy panel warns when the change set
  you are packaging touches an object that's also in someone else's change set
  (`CrossSessionWarning`, from `getCrossSessionTouches`). The editors don't yet warn when you
  open or save something another person changed during your session. That was the old
  "Phase 2" plan, and it is not built.

## Still open

- **Direct CAM sign-in is untested.** The header matches TM1py's, but no CAM server has been
  available to confirm it.
- **v12 sign-in.** PAW-native covers v11 behind PAW. The `paw-oauth2` adapter in this repo uses a
  single machine credential (client ID and secret), so everyone is the same user to TM1. It is
  not per-person sign-in, and it isn't a supported v12 path (see
  [AUTHENTICATION.md](AUTHENTICATION.md), Known issues 5). Per-person OIDC sign-in is not built on v11 or v12. See
  [Connection types](AUTHENTICATION.md#connection-types).
- **Windows integrated login (Kerberos/NTLM)** is not supported.
- **Plain HTTP between browser and IDE.** That's fine on one machine. On a network, passwords
  typed in the browser cross it unencrypted. HTTPS for the IDE is planned.
- **Service credentials are plain text** in `config/servers.json`. They're gitignored, but not
  encrypted. Moving them to the OS keychain is on the list.
- **Sessions live in memory.** Restarting the IDE signs everyone out.
- **No roles inside the IDE.** The IDE makes no access decisions of its own. TM1 groups decide.
  That is deliberate, not a gap.
