# Dev Server Health Check

Static dev-server validation per phase (i). Captures the `npm run dev` startup output and an HTTP probe against the served URL. **No interactive browser verification was performed in this phase** — that is the next phase, user-driven.

## 1. Command + environment

| Field | Value |
|---|---|
| Command | `npm run dev` (script: `vite`) |
| Working directory | `/Users/minamakar/Developer/optcgsandbox` |
| Vite version | `8.0.14` |
| Node entrypoint | `node /Users/minamakar/Developer/optcgsandbox/node_modules/.bin/vite` |
| Backgrounded PID | `3411` (npm wrapper); vite subprocess PID `1442` |

## 2. Startup log (verbatim)

```
> optcgsandbox@0.0.0 dev
> vite

Port 5173 is in use, trying another one...
Port 5174 is in use, trying another one...

  VITE v8.0.14  ready in 175 ms

  ➜  Local:   http://localhost:5175/
  ➜  Network: use --host to expose
```

### Notes on the log

- **Boot time:** 175 ms. Clean.
- **Port shuffling (5173 → 5174 → 5175):** Vite encountered other listeners on 5173 and 5174 (likely prior dev sessions left running on this machine — not under this session's control) and auto-incremented per Vite's standard port-collision behavior. **This is not an error.** The final served URL is `http://localhost:5175/`.
- **No missing-module errors.**
- **No TS errors.**
- **No vite/esbuild plugin errors.**
- **No warnings.**

## 3. HTTP probe against the served URL

```
URL:    http://localhost:5175/
HTTP:   200
Size:   1445 bytes
Time:   0.012593 s
```

### Served HTML — first 30 lines

```html
<!doctype html>
<html lang="en">
  <head>
    <script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;</script>

    <script type="module" src="/@vite/client"></script>

    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Sandbox" />
    <meta name="theme-color" content="#F2E8D2" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#082A2D" media="(prefers-color-scheme: dark)" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@400;600;700;800&display=swap" />
    <title>OPTCGSandbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### What this confirms

- **Vite is serving the production HTML shell.**
- **Module entry resolves:** `/src/main.tsx` is referenced from the HTML; vite would have errored at startup if the file or its import graph couldn't be resolved.
- **React Refresh runtime injected:** `/@react-refresh` and `/@vite/client` are present, indicating the HMR pipeline initialized.
- **Title, manifest, theme-color, and PWA metadata are intact** — same shell as the production build.

## 4. Warnings

**None.** The startup log shows no warnings beyond the informational port-shuffling messages.

## 5. Process status

```
  PID COMMAND
 1442 node /Users/minamakar/Developer/optcgsandbox/node_modules/.bin/vite
```

Vite process is alive and serving. **Server has been left running for the upcoming user-driven interactive verification step.**

## 6. What this report does NOT establish

Per the (i)-only scope:
- This report does NOT confirm that the React app actually mounts at `#root` in a real browser.
- This report does NOT confirm that engine-v2 modules load without runtime errors when the bundle executes.
- This report does NOT confirm that a full match is playable.
- This report does NOT confirm there are no `console.error` outputs during interactive play.

Those checks require the user-driven interactive verification step that follows this phase.

## 7. Verdict

### dev server operational: **YES**

- Boot: clean, 175ms
- Served HTML: 200 OK, 1445 bytes
- Module entry referenced: `/src/main.tsx`
- HMR pipeline initialized
- No errors, no warnings (beyond port-shuffling info)

## 8. Awaiting

Open `http://localhost:5175/` in a browser and confirm interactive behavior. Report verdict back; I will incorporate into `production-ready-0.md` per the phase plan.
