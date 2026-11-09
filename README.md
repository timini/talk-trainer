# Talk Trainer

Learn a talk word for word. You upload the slide deck, with the script in the speaker notes. The app splits the
script into sentences and voices each one. You then say the sentences back, and a judge checks each attempt.
Cards come back on a schedule planned to the day of the talk.

This is an early beta. So far it has the grading and scheduling logic (`lib/`), the judge's prompt and schemas,
and a password gate. The training screens and the upload are next.

It runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare), with D1 for data and R2 for
files.

## Layout

- `lib/text.ts`: sentence splitting, the fading cues, chains, and the glossary of names for the judge.
- `lib/grade.ts`: grading what was heard against a sentence (numbers, names, split and joined words).
- `lib/schedule.ts`: the review scheduler, today's session, streaks, progress and merging imported progress.
- `lib/delivery.ts`: pace, the level meter, fillers and delivery tips.
- `lib/judge.ts`: the Gemini judge's prompt and response schemas, its verdict over the local grade, and `same()`.
- `lib/auth.ts`: the signed sign-in cookie.
- `proxy.ts`: sends anyone without a valid cookie to `/login`.
- `tests/unit`: Vitest tests for `lib/`, at 100% coverage. `tests/e2e`: Playwright tests.

## Setup

You need Node 26.

```sh
npm install
npx playwright install chromium
cp .dev.vars.example .dev.vars   # then put a local password in it
```

`.dev.vars` is ignored by git. Never commit a real password or key.

## Local development

```sh
BETA_PASSWORD=some-local-password npm run dev
```

Then open http://localhost:3000 and sign in with that password. `next dev` reads `BETA_PASSWORD` from the
environment or from `.env.local`.

To run the built Worker locally (it reads `.dev.vars`):

```sh
npm run preview
```

## Tests

```sh
npm run lint
npm run typecheck
npm test          # Vitest with coverage; fails under 100% for lib/
npm run e2e       # Playwright, desktop and phone sizes; starts next dev with a test password
```

The unit tests run in the Europe/London time zone, because days are counted in local time.

To run the Playwright tests against a preview build instead:

```sh
E2E_BASE_URL=http://localhost:8787 E2E_PASSWORD=<the password in .dev.vars> npm run e2e
```

GitHub Actions runs all four on each push.

## Cloudflare

`wrangler.jsonc` declares:

- `DB`: the D1 database `talk-trainer`.
- `FILES`: the R2 bucket `talk-trainer-files`.

R2 has to be enabled for the account in the Cloudflare dashboard. Then create the bucket once:

```sh
npx wrangler r2 bucket create talk-trainer-files
```

### Secrets

The Worker needs two secrets:

- `GEMINI_KEY`: the Gemini API key for the judge and the voices.
- `BETA_PASSWORD`: the shared beta password. Changing it signs everyone out.

Set each one with `wrangler secret put`, which reads the value from stdin. Paste it at the prompt, or pipe it from
your clipboard, so it never appears in a file, a command line or your shell history:

```sh
npx wrangler secret put BETA_PASSWORD
pbpaste | npx wrangler secret put GEMINI_KEY
```

### Deploy

```sh
npm run deploy
```

This builds the app with OpenNext and deploys it with Wrangler.

## Licence

MIT. See `LICENSE`.
