# llmprobe-server

Archive for `llmprobe --upload`. Express + Prisma + Postgres. The JSON report is
the record; everything the page shows is projected out of it at query time.

## Run

```sh
cp .env.example .env
docker compose up -d --build     # db + server on :3000
```

Set `UPLOAD_TOKEN` to require a bearer token on upload; leave it empty for an
open endpoint (localhost only).

## Upload

```sh
llmprobe localhost:8080 --upload                        # https://llmprobe.deploy.dalcu.com
llmprobe localhost:8080 --upload http://localhost:3000  # or $LLMPROBE_UPLOAD_URL
```

Auth comes from `$LLMPROBE_UPLOAD_TOKEN`. A run with no benchmark is refused —
timings are the point of the archive.

## API

| Method | Path                         |                                              |
| ------ | ---------------------------- | -------------------------------------------- |
| POST   | `/api/runs`                  | `{ key, data }`, upserts on `key`            |
| GET    | `/api/runs?model=&hardware=` | Filtered summaries, newest first             |
| GET    | `/api/runs/:key`             | The full JSON report                         |
| GET    | `/api/facets`                | Distinct models and hardware for the filters |

Filtering runs in Postgres over the JSONB column. `hardwareLabel()` in
`src/summary.ts` and `HARDWARE_SQL` in `src/queries.ts` build the same string
and must stay in lockstep.

## Develop

```sh
npm install
npm run dev          # tsx watch, needs DATABASE_URL
npm run typecheck
npm test             # unit only
npm run test:db      # + API tests, needs TEST_DATABASE_URL
```

`test:db` truncates between cases, so it uses its own database
(`llmprobe_test`, created by `initdb/`), never the one holding uploads.
