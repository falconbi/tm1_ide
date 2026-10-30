# Lens learning lab

Five browser-security ideas, each one you can break on purpose. No dependencies.

```bash
node docs/learn/lens-lab/server.js
# open http://localhost:3001  (DevTools → Console open the whole time)
```

Two origins are started:

- **A** — `http://localhost:3001` (the "app")
- **B** — `http://localhost:3002` (the "other site")

Same machine, same code, **different origins**. That is the first lesson.

Files: `server.js` is the whole lab (~200 lines). Change it, restart it, watch what happens.

---

## 1. Cookies and sessions — who the server thinks you are

**Do:** open `/cookie-demo`, click **alice**, then reload.

**Observe:**
- DevTools → Application → Cookies → `session=alice`, `HttpOnly` ticked.
- The page prints `document.cookie` — the session value is **not** there.
- `/whoami` returns `alice` — because the *server* received the cookie, even though the page can't read it.

**Also observe:** DevTools → Network → the `Set-Cookie` response header.

**What it proves:** identity is a server-side lookup keyed by an opaque id. The page doesn't know who you are; the server does. `HttpOnly` means JavaScript — including a Lens — cannot read it.

**Break it:** delete the cookie in DevTools, reload. You are nobody. Nothing was "remembered" in the page.

---

## 2. Origin and CORS — "it's our server" is not a boundary

**Do:** open `http://localhost:3002` and watch both fetches.

**Observe:**
- `/api/data` → **BLOCKED**. Console: *No 'Access-Control-Allow-Origin' header*.
- `/api/data-cors` → **READ**, because that route allows exactly `http://localhost:3002`.

**What it proves:** origin = scheme + host + **port**. The browser, not the server, decides whether one origin may read another's response. A request can still reach the server; the browser simply refuses to hand the response to the page.

**Break it:** change the allowed origin in `server.js` to `http://localhost:9999`, restart, reload. Both fail. This is why "just add `*`" is a decision, not a fix.

---

## 3. iframe sandbox — removing powers, not hiding things

**Do:** open `/frame-host?weak=1` (the frame with no sandbox), then `/frame-host` (sandboxed).

**Observe (weak):**
- `parent.document.title` → **works**.
- `localStorage` → **works**.
- `fetch /api/data` → **works**.

**Observe (strict):**
- `parent.document.title` → `BLOCKED — SecurityError`
- `localStorage` → `BLOCKED — SecurityError`
- `fetch /api/data` → `BLOCKED — TypeError` (CSP)
- `document.cookie` → empty, because the origin is opaque.

**What it proves:** `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an **opaque origin**. It has no cookie, no storage, no access to the parent. This is the property the Lens app depends on.

**Break it:** in `server.js`, add `allow-same-origin` to the iframe attribute, restart, reload. The strict frame now behaves like the weak one on everything except the CSP. This is the single attribute never to add to a Lens frame.

---

## 4. CSP — the browser refuses the request, not the server

**Do:** open `/frame-host` and look at both the page output and the console.

**Observe:**
- `fetch /api/data` fails with a **CSP violation** naming `connect-src`.
- No request appears in the Network tab — it was never sent.
- Try adding an `<img src="https://example.com/x.png">` to the frame: blocked by `img-src data:`.

**What it proves:** CSP is an allow-list of destinations, enforced by the browser before any bytes leave. `connect-src 'none'` is why a Lens cannot call the API directly, exfiltrate to a URL, or open a WebSocket.

**Break it:** change `connect-src 'none'` to `connect-src 'self'`, restart. The frame's `fetch` now reaches `/api/data` and prints the secret. Delete the line again. That one directive is the difference between "can only ask" and "can fetch".

---

## 5. postMessage — the only way across, and who sent it

**Do:** in `/frame-host`, see `bridge getData: 42`.

That 42 comes from the host page, not from the frame. The frame asked; the host answered.

**Observe in `server.js`:**
```js
if (ev.source !== f.contentWindow) return   // the source check
f.contentWindow.postMessage({ __labReply: d.id, value: 42 }, '*')
```

- The host checks **which window** sent the message, because an opaque frame's `event.origin` is `"null"` and useless.
- The reply goes to that exact window; the frame correlates it by `id`.

**Break it:** comment out the `ev.source` line, restart. Now anything that can post a matching message gets an answer. The check is the whole authentication of the bridge.

**Try to attack it:** open a second tab, paste in the console:
```js
window.postMessage({ __labBridge: 1, id: 1, method: 'getData' }, '*')
```
Nothing happens — the message came from the wrong window, and (once you restore the check) is ignored.

---

## 6. Put it together — the Lens contract

The strict frame in this lab is a miniature Lens:

| Lab | Lens app |
|---|---|
| iframe `sandbox="allow-scripts"` | `lens-server.js` shell iframe + CSP `sandbox allow-scripts` |
| `connect-src 'none'` | frame CSP (`/lens-frame/:name`) |
| host answers via `postMessage` | `shared/lens-bridge.js` |
| host supplies the data | `/api/lens/*` runs as the signed-in user |
| `ev.source` check | host checks its exact `contentWindow` |
| cookie never in the page | `HttpOnly` session; no token in the frame |

Now read the real files with this in mind:

- `lens-server.js` — sign-in, session store, `/lens/:name`, `/lens-frame/:name`, `/api/lens/*`
- `shared/lens-bridge.js` — the frame script and the host's `installLensHost`
- `core/lens_store.js` — `canOpenLens` (group access)

---

## Questions to answer before moving on

1. Why can't the frame read `document.cookie` even though it is served from the same host?
2. What stops the frame from calling `/api/lens/exec-mdx` — and is it one control or two?
3. Why does the host check `event.source` instead of `event.origin`?
4. What would break if the iframe added `allow-same-origin`?
5. Why is CORS not an access control for the data itself?
6. Where does the server get the user's identity, and what does it accept from the frame?
7. What is the difference between "the page hides a button" and "the server refuses a request"?

If you can answer 2, 3, 4 and 6 without looking, you understand the Lens design.
