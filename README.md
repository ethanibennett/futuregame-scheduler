# futuregame scheduler

The poker tournament scheduler and tracker at [futurega.me](https://futurega.me): an Express + sql.js
server (`server.js`, `lib/`) and a Vite + React app (`vite-app/`) that builds into `public-vite/`, also
wrapped by Capacitor for iOS, Android and the Mac.

**Read [`CLAUDE.md`](CLAUDE.md) first.** It is the handoff: the architecture, the data flows, what runs
on the Windows box, the hazards, and the conventions. Recent state lives in
[`docs/session-handoff.md`](docs/session-handoff.md).

## Dev quick start

**Mac:**
```bash
npm install
cd vite-app && npm install && npm run build && cd ..
JWT_SECRET="dev-secret" PORT=3199 DB_PATH=./dev.db node server.js
```

**PC (PowerShell):**
```powershell
npm install
cd vite-app; npm install; npm run build; cd ..
$env:JWT_SECRET = "dev-secret"; $env:PORT = "3199"; $env:DB_PATH = "./dev.db"; node server.js
```

Never use port 3001 or `poker-tournaments.db` for development: both belong to the running pm2 app.
