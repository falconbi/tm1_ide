# HTML apps on TM1: the security layer you now own

*PAW handled the browser. When the screen is HTML you author — or an AI writes — you inherit that layer. Five decisions, one checklist.*

**Tested on** TM1 v11 · Lens runtime **Related** [How signing in to TM1 works](https://falconbi.github.io/articles/authentication-guide/) **Status** Published · October 2026

---

## Contents

1. [The shift](#a1)
2. [The threat model, in TM1 terms](#a2)
3. [The five layers](#a3)
4. [One request, end to end](#a4)
5. [What the server must never accept](#a5)
6. [Three failures worth recognising](#a6)
7. [The checklist](#a7)
8. [Questions for a client's security team](#a8)
9. [How this was tested](#a9)
10. [Still open](#a10)

---

## 01 The shift

For most of its life, building on TM1 meant rules, feeders, dimensions, processes and a cube view. The browser was somebody else's problem.

Planning Analytics Workspace owns that layer. It authenticates users, keeps sessions, blocks cross-site request forgery, renders data safely, sets content security policy, terminates TLS and patches its own framework. None of it is free — it is inside the licence. It is also invisible, so a TM1 developer never has to learn it.

An HTML app changes one thing: **the page is untrusted content.** PAW composes screens inside a runtime it controls. When the screen itself is arbitrary HTML, the platform cannot vouch for it, so whoever ships it inherits the layer.

```
PAW book                              HTML app
─────────────────────────────         ─────────────────────────────
PAW   login, session, CSRF,           you   login, session, CSRF,
      safe rendering, CSP,                   safe rendering, CSP,
      TLS, patching                          TLS, patching
you   rules, cubes, dimensions,       you   rules, cubes, dimensions,
      processes, views                       processes, views
                                            + the web layer
```

AI made the build cheap. It did not make the page trustworthy.

> **Principle.** A page can be authored freely only if the platform stops trusting it.

## 02 The threat model, in TM1 terms

Three failures explain most of the risk, and each has a TM1-shaped version.

**A service account is not "the app".** If the web layer talks to TM1 as one shared login, every user is that login. Region security, cost-centre security and version locks stop applying, because TM1 sees a single powerful user. The app can still *display* a filter; that is a UI, not a right.

```
shared login   every user → APP_SERVICE → TM1 sees one user
per-user login every user → own session → TM1 sees the person
```

**Hiding a button is not a permission.** The same as hiding a cube in Architect. If the server performs the action when asked, the button was never the control.

**A session cookie is a bearer token.** Whoever holds it is the user until it expires. It is not a password and it is not proof of anything on its own; it is a ticket, and the server trusts whoever presents it.

Add one more: the browser is someone else's computer. HTML, JavaScript, hidden fields and "current user" variables can all be changed before they come back.

> **Rule.** The server never accepts an identity, a server name or a permission from the page.

## 03 The five layers

| Question | Layer | Control | Typical failure |
|---|---|---|---|
| Can anyone on the path read or change this? | Transport | TLS from a trusted CA, HTTPS redirect, HSTS, `Secure` cookies | `Secure` decided by a config flag instead of the request |
| Who is this? | Identity | per-user TM1 login, random session id, `HttpOnly`, `SameSite` | one shared service account |
| What may they see or change? | Authorisation | TM1 security on every read and direct write; declared write cubes and processes | checks made in the UI |
| Is this page allowed to ask? | Isolation | sandboxed frame, opaque origin, `connect-src 'none'`, message bridge | `allow-same-origin` |
| Did this request come from my app? | Provenance | server-side `Origin` check, `__Host-` cookies, host-only scope | relying on `SameSite` alone |

### Transport

HTTPS is the floor. On an internal network it is still required: credentials and session cookies are the payload, and an internal LAN is not a trust boundary.

Two details matter more than the certificate:

- the `Secure` flag must follow the request the browser actually made, not "is this process configured for TLS" — behind a reverse proxy those are different questions;
- HTTP must redirect to HTTPS, and HSTS must be sent, or the first request, including the sign-in form, can still travel in clear text.

### Identity

Every user signs in as themselves, against TM1. The app keeps one TM1 session per user and gives the browser a random session id.

The TM1 side of that — native, LDAP, CAM, Windows integrated, v12 tokens, OpenID Connect and PAW — is covered in [How signing in to TM1 works](https://falconbi.github.io/articles/authentication-guide/). This article is about what the browser layer must do with the result.

- the password is checked once, with TM1, and never stored
- the cookie contains only an opaque id — not the username, groups or a token
- `HttpOnly` means page scripts cannot read it
- `SameSite=Strict` means other sites cannot make the browser send it

### Authorisation

TM1 decides on every read and every direct cell write, as the signed-in user. The app's job is to ask, not to judge:

- reads go through TM1, so cell security applies
- writes are checked against the cubes the **saved** screen declares, and TM1 still refuses calculated cells and cells the user may not change
- process runs are checked against the process list the saved screen declares, with parameter types validated
- opening a screen is checked against a TM1 group

One honest qualification: a running TI process is not limited by the caller's cell security. Any action process must check the caller itself and report why it refused. "TM1 security applies" is true for reads and direct writes; it does not automatically follow a process into its work.

### Isolation

The authored HTML runs in a sandboxed frame:

```
┌─────────────────────────────── browser ───────────────────────────────┐
│  host page (trusted)                    sandboxed frame (untrusted)   │
│  ─ session cookie                       ─ no cookie                   │
│  ─ calls the API                        ─ no storage                  │
│  ─ answers the bridge                   ─ no network (connect-src)    │
│                                          ─ no access to the host page │
└────────────────────────────────────────────────────────────────────────┘
```

- `sandbox` without `allow-same-origin`, so the document has an opaque origin
- a content security policy with `connect-src 'none'`, so it cannot call the API, reach the internet or open a socket
- a message bridge, where the host answers only its own frame and takes the server name from configuration, never from the message

This is what lets an AI-written screen be safe to run at all.

### Provenance

`SameSite` answers "is this another site?". It does not answer "is this my app?". Behind one domain, sibling subdomains are the same site, so a compromised app on one subdomain can POST to another with the user's cookies attached.

The missing control is a server-side `Origin` check on every state-changing route, plus `__Host-` cookie names and no `Domain` attribute, so cookies stay host-only.

## 04 One request, end to end

```
browser
  │  HTTPS + session cookie
  ▼
reverse proxy          TLS terminates here
  │                    redirect HTTP → HTTPS
  │                    send HSTS
  ▼
app server             cookie → session → user
  │                    group access to this screen
  │                    Origin check on writes
  │                    allowed cubes/processes from the saved screen
  ▼
TM1                    cell security, process rights, version locks
  │                    (the back hop is verified too)
  ▼
data
```

Identity is decided at the app server. Authorisation is decided at TM1. The proxy decides only that the connection is encrypted. The page decides nothing at all.

> **Lesson.** Every arrow in that diagram is a place where someone could trust the wrong thing.

## 05 What the server must never accept

- **an identity** — no "user" field, no "current user" variable
- **a server or environment** — the target comes from configuration
- **a permission** — no "canWrite" flag, no list of allowed cubes in the request
- **a claim about what is being written** — the saved screen, not the running page, declares its allowed cubes and processes

The page may send **questions**: an MDX query, a cell coordinate, a number to save. The server answers them as the signed-in user. For writes it re-reads the **saved** screen to decide what is allowed, so a running page cannot widen its own permissions by editing its HTML — and changing the saved screen is a recorded model change.

## 06 Three failures worth recognising

| Failure | What it looks like | Fix |
|---|---|---|
| `Secure` follows a config flag | HTTPS site, cookie without `Secure` | trust the proxy, derive from the request |
| `SameSite` without an `Origin` check | an XSS in a sibling app writes through the API | reject requests whose `Origin` is not your own |
| One wildcard, many apps | one certificate, one proxy, apps at different trust levels | `origin` check and strict CORS, or separate domains |

### The `Secure` flag that follows a boolean

The app asks "does this process serve TLS?" A proxy answers for it in production, so the process says no and the cookie is written without `Secure`. The site is HTTPS; the cookie is not protected.

```
browser ──TLS──▶ proxy ──HTTP──▶ app
                 │                └─ "https.enabled = false"
                 └─ the browser is on HTTPS; the app cannot tell
```

### `SameSite=Strict` and no `Origin` check

It blocks `evil.com`, so it feels finished. But a second app on a sibling subdomain is the same site:

```
ide.corp.example.com   ──same site──▶   lens.corp.example.com
  XSS here                                cookie attached
                                          CORS blocks READING only
                                          the write still happens
```

CORS does not stop the write; it only stops the attacker reading the reply. The fix is on the server: reject a request whose `Origin` is not this app's own.

### One wildcard, many apps

Convenient: one certificate, one proxy, one route per app. But cookies are host-only while `SameSite` sees one site, so the apps are isolated for storage and grouped for requests.

| | Cookie scope | `SameSite` | CORS |
|---|---|---|---|
| `lens.corp.example.com` | own jar | same site | own origin |
| `ide.corp.example.com` | own jar | same site | own origin |

That is fine for apps at the same trust level, and wrong for apps that must not trust each other.

## 07 The checklist

Before anything reaches a user:

1. **Certificate** from a CA the users' machines already trust
2. **Proxy** terminating TLS; apps bound to loopback
3. **Redirect** HTTP → HTTPS, and HSTS sent
4. **`Secure`** derived from the request, not a configuration switch
5. **`__Host-`** session cookie, with a distinct name per app
6. **`Origin`** checked on every write, process run and preference change
7. **Expiry** — idle and absolute; sign-out revokes the server-side session
8. **Back hop** to TM1 verified, never with TLS verification disabled

## 08 Questions for a client's security team

These turn a review into a conversation.

| Question | Why it matters |
|---|---|
| Which CA signs the existing platform, and do all user devices trust it? | decides whether internal certificates work without warnings |
| Can you issue certificates for these internal hostnames? | avoids self-signed certificates and user warnings |
| Is there an existing reverse proxy, and who owns it? | sets where TLS terminates and who can see cookies |
| Are all users on managed devices? | unmanaged phones and laptops won't trust an internal CA |
| What is the session timeout policy — idle, absolute, or both? | the app must match the policy, not invent one |
| Is the app internal-only, or reachable from outside? | decides internal CA vs public CA |
| Who may author screens, and who reviews them before release? | authored HTML is a trusted input; review is a control |
| What access and activity logging is required, and for how long? | drives what the app records and how long it keeps it |

## 09 How this was tested

The controls described here are the ones implemented in the Lens runtime in this repository, and they are covered by its test suites:

- sign-in, session flags, idle timeout and per-user identity
- a sandboxed frame with its own CSP and no network
- group access enforced on the list, the open, the frame and every bridge call
- declared write cubes and processes, numbers only, calculated cells refused, stale saves refused
- the server always taking the target server from configuration

What is not yet proven: an independent penetration test, and a production deployment behind a real internal CA and proxy. Those are the next two gates, not claims in this article.

> **Lesson.** A check that cannot fail is worse than no check. Test the refusal, not just the success.

## 10 Still open

- **An `Origin` check on writes.** Today `SameSite=Strict` is the CSRF control; it does not cover sibling apps on one domain.
- **An absolute session age.** The runtime has an idle timeout; it needs a maximum too.
- **`__Host-` cookie names.** A rename, and a sign-out for everyone — best done before a pilot.
- **PAW single sign-on.** The runtime signs in with TM1 credentials today; trusting a PAW session is a separate integration.
- **Load and session-leak testing** with several users and a real TM1 server.

---

TLS protects the channel. Identity and authorisation protect the data. Isolation protects the app from its own content. Provenance protects one app from another. None of them compensates for the others being missing.

**AI can write the screen. Only the architecture makes it safe.**

*CC BY 4.0 — attribution required.*
