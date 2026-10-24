# How signing in to TM1 works — a plain-English guide

Every way a person or a program can sign in to IBM Planning Analytics (TM1), explained so that anyone can follow
it: what each method is, when you'll meet it, how it works step by step, how to set it up, and what goes wrong.

This guide is about **TM1 itself** — it applies whatever tool you use (PAW, Architect, TM1py, ARC, TM1 IDE, your
own scripts). Where a fact comes from IBM, a vendor or a well-used open-source library it is linked under
[Sources](#sources). Where something has not been confirmed on a real server it says so.

*Status legend used below:* **Documented** = stated by IBM · **Proven in practice** = shown by widely used open-source
code or confirmed on a real server · **Unconfirmed** = believed correct, not yet checked.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [Words you'll meet](#2-words-youll-meet)
3. [Which method does my server use?](#3-which-method-does-my-server-use)
4. [The methods, one by one](#4-the-methods-one-by-one)
5. [Directory, CAM and single sign-on — how they fit together](#5-directory-cam-and-single-sign-on--how-they-fit-together)
6. [The very first administrator on a new server](#6-the-very-first-administrator-on-a-new-server)
7. [Sessions and lock-outs](#7-sessions-and-lock-outs)
8. [Keeping the connection private (TLS)](#8-keeping-the-connection-private-tls)
9. [What the common tools support](#9-what-the-common-tools-support)
10. [Sources](#sources)

---

## 1. The big picture

Signing in always answers two questions:

1. **Who are you?** — *authentication*. Proven with a password, a key, a ticket from Windows, or a pass from another
   system that already knows you.
2. **What may you do?** — *authorisation*. In TM1 this is always decided **inside TM1**, by the security groups a
   user belongs to (`}ClientGroups`). However someone signs in, TM1's own security still decides what they see.

Once TM1 is satisfied about *who*, it hands back a **session ticket** — a cookie called `TM1SessionId`. A
well-behaved program sends that ticket with every later request instead of signing in again. Think of it like a
hotel key card: you show your passport once at the desk, then use the card for the rest of your stay.

```
  you / your tool                      TM1 server
  ───────────────                      ──────────
  1. "Here's proof of who I am"  ───▶  checks it (itself, or asks a directory / Cognos)
  2.                             ◀───  "OK — here's your session ticket (TM1SessionId)"
  3. "Get me this view" + ticket ───▶  recognises the ticket, applies your security
```

Everything in the rest of this guide is about **step 1** — the different ways of proving who you are.

---

## 2. Words you'll meet

| Word | Plain meaning |
|---|---|
| **Authentication** | Proving who you are. |
| **Authorisation** | Deciding what you're allowed to do. In TM1, always TM1's own security groups. |
| **Directory** | The company's list of people and passwords — usually **Active Directory (AD)**, spoken to using **LDAP**. |
| **LDAP** | The standard "language" for asking a directory "does this user exist, is this password right?". |
| **CAM** | *Cognos Access Manager* — the sign-in service of IBM Cognos Analytics. TM1 can be told to trust it. |
| **Namespace** | A directory as seen by Cognos (e.g. "AD" or "LDAP"). A CAM user is always "user X in namespace Y". |
| **Passport** | A pass Cognos gives you once you've signed in to it. TM1 accepts it instead of a password. |
| **SSO** (single sign-on) | Not typing a password, because you already signed in somewhere TM1 trusts (usually Windows). |
| **Kerberos / NTLM** | The ways Windows proves who you are to other machines, without sending your password. |
| **Session / `TM1SessionId`** | TM1's ticket meaning "already signed in". |
| **Token** | A short-lived pass obtained by proving who you are once. Used instead of a password; expires on its own. |
| **API key** | A long random secret made for one user, used by programs instead of their password. Can be revoked. |
| **OAuth / OIDC** | Modern standards for "sign in with your company account" and for handing tokens to apps. |
| **TLS / HTTPS** | Encryption of the connection itself, so nobody on the network can read what's sent. |
| **Admin server** | The small TM1 service (default port 5895) that lists the TM1 servers on a machine and their ports. |
| **`tm1s.cfg`** | Each TM1 server's configuration file — where its security method is set. |

---

## 3. Which method does my server use?

### TM1 v11 (Planning Analytics Local 2.0.x)

Look in the server's `tm1s.cfg`:

| Setting | Meaning | Section |
|---|---|---|
| `IntegratedSecurityMode=1` | TM1's own users and passwords | [4.1](#41-tm1-native-security) |
| `IntegratedSecurityMode=1` + `PasswordSource=LDAP` | TM1's own users, passwords checked against the directory | [4.2](#42-tm1-users-ldap-password-check) |
| `IntegratedSecurityMode=2` | Users may choose: TM1 password **or** Windows sign-in | [4.1](#41-tm1-native-security) / [4.5](#45-windows-integrated-login) |
| `IntegratedSecurityMode=3` | Windows sign-in only | [4.5](#45-windows-integrated-login) |
| `IntegratedSecurityMode=4` | Cognos (CAM) signs people in; TM1's groups decide rights | [4.3](#43-cam--username-and-password) / [4.4](#44-cam--single-sign-on) |
| `IntegratedSecurityMode=5` | Cognos (CAM) signs people in; groups can come from Cognos **and** TM1 | [4.3](#43-cam--username-and-password) / [4.4](#44-cam--single-sign-on) |
| `SupportOpenConnect=T` | The server also accepts **OpenID Connect** sign-in (a company identity provider) | [4.9](#49-v11-openid-connect) |

Modes 4 and 5 also need `ServerCAMURI` and `ClientCAMURI` — the addresses of the Cognos services. *(Documented)*

### TM1 v12 (Planning Analytics Engine / TM1 Database 12)

There is **no `tm1s.cfg` security mode, no CAM and no Architect**. Identity always comes from the platform:

| Where v12 runs | Method | Section |
|---|---|---|
| IBM's cloud (Planning Analytics as a Service) | Your IBM / company sign-in in the browser; **API key** for programs | [4.6](#46-v12-in-ibms-cloud--api-keys) |
| On-premises or Cloud Pak for Data | The platform's identity provider; **app ID + secret → token** for programs | [4.7](#47-v12-on-premises-and-cloud-pak-for-data--app-credentials-and-tokens) |

### Asking the server (no password needed)

A tool can ask a TM1 v11 server which method it uses **without signing in**: send any request with no credentials
and read the `WWW-Authenticate` line of the "401 Unauthorized" answer. Because no username is sent, this does
**not** count as a failed login.

| Answer contains | Meaning | Status |
|---|---|---|
| `Basic realm="TM1"` | TM1's own security (native, or the LDAP password check) | **Proven** — TM1 v11.8, mode 1 |
| A CAM scheme and the Cognos address to get a passport | CAM (mode 4/5) | **Documented** by IBM; exact wording **Unconfirmed** |
| `Negotiate` | Windows integrated login (mode 2/3) | **Unconfirmed** |

Real example (native server):
```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="TM1"
Set-Cookie: TM1SessionId=...; Path=/api/; HttpOnly
```
Note the server hands out a session cookie even on the refusal — it is not signed in until credentials are sent.

### Through PAW

Planning Analytics Workspace can sit in front of TM1 and sign people in itself — see
[4.8](#48-through-planning-analytics-workspace-paw).

---

## 4. The methods, one by one

### 4.1 TM1 native security

**In one sentence:** TM1 keeps its own list of users and passwords. *(Documented)*

**When you'll see it:** labs, smaller sites, and any brand-new server before it is switched to something else.

**How it works:**
```
  tool ── "Authorization: Basic <name:password>" ──▶ TM1   (checks its own }Clients list)
  tool ◀────────────── TM1SessionId ──────────────── TM1
```
The name and password are only *encoded* (base64), not encrypted — which is why TLS ([section 8](#8-keeping-the-connection-private-tls)) matters.

**Setting it up:** the default. Users are `}Clients` elements; passwords are set by an admin (TI
`AssignClientPassword`, or the REST API).

**Common problems:** wrong password three times → the account is locked ([section 7](#7-sessions-and-lock-outs)).

### 4.2 TM1 users, LDAP password check

**In one sentence:** users still live in TM1, but TM1 asks the company directory whether the password is right.
*(Documented)*

**When you'll see it:** sites that want company passwords without installing Cognos.

**How it works:**
```
  tool ── Basic <name:password> ──▶ TM1 ── "is this password right?" ──▶ directory (LDAP)
  tool ◀──────── TM1SessionId ───── TM1 ◀──────────── "yes" ─────────── directory
```
To a tool it looks **exactly like native security** — same header. Never single sign-on: a password is always typed.

**Setting it up (`tm1s.cfg`):** `PasswordSource=LDAP`, `LDAPHost`, `LDAPPort` (636 for secure LDAP),
`LDAPSearchBase` (where users live), `LDAPSearchField` (usually `sAMAccountName` = the Windows user ID),
`LDAPUseServerAccount`. Users must already exist in TM1 — add them by hand or import them with IBM's **ETLDAP**
utility, which only *adds* users (it never updates or deletes).

**Common problems:** user exists in AD but not in TM1 → can't sign in; wrong search base → every login fails.

### 4.3 CAM — username and password

**In one sentence:** TM1 trusts Cognos to check who you are; you type your company (directory) password.
*(Documented; the header format is proven in practice by TM1py)*

**When you'll see it:** very common at larger sites — Cognos Analytics connected to Active Directory, TM1 in mode 4 or 5.

**How it works:**
```
  tool ── "Authorization: CAMNamespace <name:password:namespace>" ──▶ TM1
                                         TM1 ── asks Cognos ──▶ Cognos ── checks ──▶ Active Directory
  tool ◀──────────────────── TM1SessionId ─────────────────── TM1
```
The **namespace** tells Cognos which directory to check (a site can have several).

**Exact format** (as used by TM1py): the word `CAMNamespace`, a space, then `user:password:namespace` encoded in
base64 — e.g. `jsmith:secret:AD` becomes `CAMNamespace anNtaXRoOnNlY3JldDpBRA==`.

**Setting it up:** `IntegratedSecurityMode=4` or `5`, plus `ServerCAMURI` (Cognos's internal dispatcher, e.g.
`http://cognos:9300/p2pd/servlet/dispatch`) and `ClientCAMURI` (Cognos's address for users, e.g.
`http://cognos/ibmcognos/bi/v1/disp`). The first administrator needs a special routine — see
[section 6](#6-the-very-first-administrator-on-a-new-server).

**Common problems:** wrong or missing namespace → 401; Cognos down → nobody can sign in to TM1; a user's TM1 groups
only refresh when they sign in again.

### 4.4 CAM — single sign-on

**In one sentence:** you've already signed in to Windows; Cognos recognises you and gives you a passport, which TM1
accepts — no password typed. *(Documented; flow proven in practice by TM1py's "gateway" option)*

**When you'll see it:** the same sites as 4.3, where Cognos is set up for Windows sign-in (Kerberos).

**How it works:**
```
  1. tool ── GET gateway?CAMNamespace=<namespace>, with Windows sign-in (Negotiate) ──▶ Cognos gateway
  2. tool ◀────── passport (cookie "cam_passport") ───── Cognos
  3. tool ── "Authorization: CAMPassport <passport>" ──▶ TM1 ── checks with Cognos
  4. tool ◀──────────────── TM1SessionId ────────────── TM1
```
When TM1 refuses a request it tells the tool where to get a passport: its "please sign in" answer includes the
Cognos address. *(Documented)*

**Common problems:** works in the browser but not from a script → the script isn't doing the Windows sign-in to the
gateway; passport expired → get a new one.

### 4.5 Windows integrated login

**In one sentence:** TM1 trusts your Windows sign-in directly, with no Cognos involved. *(Documented)*

**When you'll see it:** Windows-centred sites without Cognos; `IntegratedSecurityMode=2` (choice) or `3` (Windows only).

**How it works:** the tool and TM1 use Windows' own sign-in exchange (**Negotiate** — Kerberos, or the older NTLM).
Your PC gets a ticket from the domain controller and shows it to TM1; **no password crosses the network**.

**Setting it up:** users exist in TM1 as `DOMAIN\user`; the TM1 service may need a *service principal name* (SPN)
registered in Active Directory for Kerberos. A program can only do this when it runs **as the Windows user**, on a
domain-joined machine (TM1py, for example, uses the Windows-only SSPI library for it).

**Common problems:** works on one PC but not another → SPN or delegation; mode 3 locks out anything that can't do
Windows sign-in (scripts on Linux, many web tools).

### 4.6 v12 in IBM's cloud — API keys

**In one sentence:** people sign in through the browser with their IBM/company account; programs use an **API key**
that carries the same rights as the person who made it. *(Documented by IBM; usage proven in practice by TM1py)*

**How it works (programs):**
```
  tool ── Basic "apikey" : <the key> ──▶ https://<region>.planninganalytics.saas.ibm.com/api/<tenant>/v0/...
  tool ◀──────────── session ──────────
  TM1 database API: .../api/<tenant>/v0/tm1/<database>/api/v1
```
**Setting it up:** in Planning Analytics: your name → **Manage API key** → **Generate key**. Copy it straight away —
it can't be shown again. Sessions time out after 60 minutes idle.

**Common problems:** the key works but data is missing → the key has exactly its creator's rights; key lost → make a
new one and revoke the old.

### 4.7 v12 on-premises and Cloud Pak for Data — app credentials and tokens

**In one sentence:** the platform's identity provider signs people in; programs use an **application ID and
secret** (or a ready-made access token) to get a short-lived token. *(Proven in practice by TM1py; IBM details vary by
deployment — partly Unconfirmed)*

**How it works (programs):**
```
  1. tool ── app ID + secret ──▶ platform's sign-in service
  2. tool ◀──── access token ──
  3. tool ── "Authorization: Bearer <token>" ──▶ TM1 database (instance + database name in the address)
```
**First administrator:** comes from the platform — e.g. on Cloud Pak for Data, platform administrators become
Workspace administrators and TM1 admins on first sign-in; other users are added to TM1 with TI `AddClient`.
*(Documented)*

**Note:** IBM's "authorized applications" (OAuth) for Planning Analytics support only **interactive** sign-in (a person
signs in in a browser); the non-interactive "client credentials" flow is documented as **not supported** there.
IBM documents this for Planning Analytics Workspace on Cloud; an **on-premises PAW v12** admin console checked on
4 Oct 2026 had **no** "authorized applications" page, so on-premises app registration happens elsewhere — in a lab with
Authentik as the identity provider, applications (client ID + secret) are registered **in the identity provider**; PAW
itself is one such application. Whether PAW and the v12 engine accept tokens issued to *another* application is
*Unconfirmed*.

**For people with single sign-on:** a tool signs you in by sending your browser to PAW, which sends it on to the
company's identity provider (Entra ID, Okta, Authentik …). If you're already signed in there, it comes straight back —
no password typed — and the tool receives a token carrying your identity. The tool must be registered once (an ID, a
secret and its return address) by an administrator; nothing is needed per user.

### 4.8 Through Planning Analytics Workspace (PAW)

**In one sentence:** PAW signs you in once and passes your requests on to TM1 for you. *(Proven in practice — lab)*

**How it works:** you sign in to PAW (which checks your login against its configured *TM1 login server*, or Cognos,
or an identity provider); PAW keeps your session in cookies and forwards TM1 requests at
`<PAW>/api/v0/tm1/<server>/api/v1/...`. Programs using this route must send PAW's anti-forgery value (cookie
`ba-sso-csrf`) back in a header (`ba-sso-authenticity`).

**Common problems:** you can sign in to PAW but see no data on a server → you're not a user on *that* server; PAW's
login server down → nobody can sign in to PAW.

### 4.9 v11 OpenID Connect

**In one sentence:** a v11 server can be told to accept sign-in from a company identity provider (Entra ID, Okta …)
using the OpenID Connect standard. *(Documented that it exists; how a tool hands the result to TM1 — Unconfirmed)*

**Setting it up:** `SupportOpenConnect=T` in `tm1s.cfg` (default off). **Not available in v12**, where the platform
handles identity instead (4.6, 4.7).

**How tools use it (Cubewise Canvas, from its documentation):** the tool is registered in the identity provider
(client ID, client secret, the provider's "discovery" address); when a user needs data, the browser is sent to the
provider's sign-in page (single sign-on passes straight through), comes back with a one-time **code**, and the tool
uses that code to sign in to TM1.

---

## 5. Directory, CAM and single sign-on — how they fit together

They are three different things:

| Term | What it is | Role |
|---|---|---|
| **LDAP / Active Directory** | The **directory** — where users and passwords live | "Who exists, and is this password right?" |
| **CAM** | Cognos's **sign-in service** — TM1 trusts it in mode 4/5 | "Cognos vouches for this person" |
| **SSO** (single sign-on) | **Not typing a password** — a sign-in that already happened is reused | "You're already signed in" |

How they combine in TM1 v11:

| Setup | What the user does | SSO? |
|---|---|---|
| **CAM + AD/LDAP namespace** | Types their AD username + password; Cognos checks them against the directory | No |
| **CAM + SSO** | Nothing — Cognos trusts their Windows login (Kerberos), issues a passport, TM1 accepts it. The most common SSO at larger sites | Yes — through CAM |
| **Windows integrated (mode 3)** | Nothing — TM1 trusts their Windows login directly, no Cognos | Yes — without CAM |
| **TM1's own LDAP check** (`PasswordSource=LDAP`) | Types a password; TM1 checks it against the directory | Never |

**In short: single sign-on comes through CAM (or Windows integrated), never through LDAP alone.** LDAP/AD is usually
the directory *behind* CAM, whether or not single sign-on is switched on.

---

## 6. The very first administrator on a new server

| Setup | How the first admin is created |
|---|---|
| **Native (mode 1)** | A new server has user `admin` with a **blank password**. Sign in that way once and set a password immediately (TI `AssignClientPassword('admin','…')`, or REST `PATCH Users('admin')` with `{"Password":"…"}`). |
| **CAM (mode 4/5)** | TM1 only lists a CAM user after they have tried to sign in once. So: set **mode 4** with the CAM settings → restart → sign in once with your CAM account (you get no rights yet) → set **mode 1** → restart → sign in as `admin` → add your CAM user to the `ADMIN` group → set **mode 5** → restart → sign in with your CAM account, now as administrator. *(Practitioner-documented; an Architect-only shortcut uses mode 2 to browse the namespace instead.)* |
| **Windows (mode 2/3)** | In mode 1 as `admin`, add your `DOMAIN\user` as a client in `ADMIN`, then switch to mode 2 or 3. |
| **LDAP password check** | Users must exist in TM1 first — add them in mode 1, or import them with ETLDAP. |
| **v12** | Comes from the platform's administrators, not from TM1 — see [4.7](#47-v12-on-premises-and-cloud-pak-for-data--app-credentials-and-tokens). |

---

**A warning about blank and sample passwords.** A brand-new TM1 server with `admin` and a blank password — or an IBM
sample server (24Retail, Planning Sample) still on its published `admin` / `apple` login — is open to anyone who can
reach it on the network. Set a real password before the server is reachable by anyone else, and change or remove the
sample servers on any shared machine.

## 7. Sessions and lock-outs

### Lock-outs
TM1 v11 allows **3 failed sign-ins by default** (`MaximumLoginAttempts` in `tm1s.cfg`). After that the account is
refused until an administrator resets its password or the server restarts. *(Documented — not applicable to v12.)*

**Watch out for tools that keep retrying.** Any program that keeps trying a stored password that has since changed
— a scheduler, a dashboard that refreshes, an IDE polling in the background — will lock the account within seconds.
A well-behaved tool tries once, reports the failure, and waits for a person.

### Leaked sessions
Every successful sign-in creates a session. A program that sends the password with **every** request, instead of
reusing the `TM1SessionId` ticket, creates a new session each time; they pile up until TM1's session timeout. A real
example: a lab server was found with **538 open sessions** left by a tool doing exactly this. They show up in the
`Sessions` list, in TM1 Top and in `}StatsByClient`, and they waste memory. A well-behaved tool signs in once per
server, reuses the ticket, and closes the session (REST: `POST ActiveSession/tm1.Close`) when it's done.
*(Proven on a real v11.8 server)*

**Measured, before and after fixing a tool to reuse its ticket** (same server, v11.8): before — a new session on every
request, 538 left open; after — a user browsing cubes, views and dimensions for several minutes added **no** sessions
beyond the one created at sign-in. To check your own server, compare the `Sessions` list before and after using a tool —
and remember that every *separate* program you run (including a quick check script) signs in once itself.

---

## 8. Keeping the connection private (TLS)

Basic and CAM credentials are only *encoded*, so the connection itself must be encrypted (**HTTPS / TLS**) on any
network you don't fully control. Three ways a tool can treat the server's certificate:

| Setting | Meaning | Use |
|---|---|---|
| **Full check** | Certificate signed by a trusted authority **and** issued for that server's name | Production |
| **Chain only** | Signed by a trusted authority, server name not checked | IBM's stock TM1 certificate, which carries no server name |
| **No check** | Anything accepted | Throwaway labs only — anyone on the network could intercept |

---

## 9. What the common tools support

From each project's own documentation (see Sources) — ARC's column uses Cubewise's own wording, which lists native,
Windows, CAM, OpenID, IBM ID and PA SaaS v12 keys. Check each project for the current state.

| Method | TM1py (open source) | Cubewise ARC (vendor's description) | TM1 IDE |
|---|---|---|---|
| Native / LDAP check | Yes | Yes | Yes |
| CAM — username + password | Yes | Yes | Built to TM1py's format — not yet confirmed on a CAM server |
| CAM — single sign-on | Yes ("gateway") | Yes | Planned |
| Windows integrated | Yes | Yes (mode 3, from v4.1.1) | Planned |
| v12 cloud — API key | Yes | Yes | Planned |
| v12 on-prem / Cloud Pak — app credentials / tokens | Yes | Vendor lists "OpenID" and "IBM ID" | Via PAW in the lab; direct planned |
| v11 OpenID Connect (`SupportOpenConnect`) | Not found in its docs | Vendor lists "OpenID" (sister product Canvas documents the flow) | Planned |

TM1 IDE's detail: [AUTHENTICATION.md](AUTHENTICATION.md).

---

## Sources

- IBM — [MaximumLoginAttempts](https://ibm.com/support/knowledgecenter/SSD29G_2.0.0/com.ibm.swg.ba.cognos.tm1_inst.2.0.0.doc/c_maximumloginattempts_tm1.html)
- IBM — [Configuring LDAP validation](https://www.ibm.com/docs/SSD29G_2.0.0/com.ibm.swg.ba.cognos.tm1_inst.2.0.0.doc/t_tm1_inst_config_ldap_validation.html)
- IBM — [TM1 REST API (v11)](https://www.ibm.com/docs/en/SSD29G_2.0.0/com.ibm.swg.ba.cognos.tm1_rest_api.2.0.0.doc/tm1_rest_api.pdf)
- IBM — [Authorized applications (OAuth), Planning Analytics 2.1](https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=api-authorized-applications-oauth)
- IBM — [Cloud Pak for Data: user management and authentication](https://www.ibm.com/support/pages/cloud-pak-data-planning-analytics-2049-user-management-and-authentication)
- IBM Community — [Managing Planning Analytics as a Service with API requests](https://community.ibm.com/community/user/businessanalytics/blogs/jessica-nicholls/2025/02/03/managing-paaas-with-apis)
- TM1py — [project](https://github.com/cubewise-code/tm1py) · [RestService reference](https://tm1py.org/latest/reference/services/restservice/)
- IBM — [SupportOpenConnect](https://www.ibm.com/docs/en/planning-analytics/2.0.0?topic=padcp-supportopenconnect)
- Cubewise — [Setting up Open ID with Canvas](https://code.cubewise.com/blog/setting-up-open-id-with-canvas/)
- Cubewise — [Setting up SSO with CAM and Arc](https://code.cubewise.com/arc-docs/setting-up-sso-with-cam-and-arc) · [Arc and Integrated Security](https://forum.cubewise.com/t/arc-compatibility-with-integrated-security/3603) · [Arc and IBM Cloud](https://code.cubewise.com/blog/connecting-to-the-ibm-cloud-remotely-with-arc/)
- Exploring TM1 — [How to set TM1 to use Cognos security (CAM)](https://exploringtm1.com/change-tm1-use-cognos-security-cam/)
- cogknowhow — [Setup of PAX (first CAM admin)](https://cogknowhow.tm1.dk/archives/1394) · [SSO against Active Directory](https://cogknowhow.tm1.dk/archives/307)
- TM1 Forum — [CAMNamespace header / 401](https://www.tm1forum.com/viewtopic.php?t=13227) · [REST API and mode 5](https://tm1forum.com/viewtopic.php?t=16073) · [Configuring TM1 with AD](https://tm1forum.com/viewtopic.php?t=2310) · [ETLDAP](https://www.tm1forum.com/viewtopic.php?t=8106)

*Corrections welcome — this guide is meant to be a shared reference. Last reviewed 4 Oct 2026.*
