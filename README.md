# Talk Trainer

Learn a talk by heart. You upload the slide deck, with the script in the speaker notes. The app splits the
script into sentences and voices each one. You then say the sentences back, and a judge checks each attempt.
Cards come back on a schedule planned to the day of the talk.

This is an early beta. So far it has the grading and scheduling logic, the judge's prompt and schemas, a password
gate, the upload with its background build, and the training screens. The run-through is next.

It runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare), with D1 for data, R2 for
files, a Workflow for the background build and a container for rendering slides.

## How an upload is built

1. `POST /api/talks` stores the .pptx in R2, creates the talk in D1 and starts the `BUILD` Workflow.
2. Parse: the slides in presentation order, their titles and speaker notes. The notes are split into sentences;
   each sentence's names and numbers are its must-say items, and the talk's names make the judge's glossary.
   Slides with no notes are listed on the talks page.
3. Render: the `RENDER` container (LibreOffice and poppler, `container/`) turns the deck into one PNG a slide.
4. Voice: one Gemini clip a sentence (`gemini-3.8-flash-tts`, voice Achird), stored as WAV under a hash of the text,
   voice, model and style, so a sentence voiced before is never voiced again. Sentences are voiced 8 at a time,
   each its own step, retried with backoff, so a rate limit only delays that sentence.
5. The talks page polls `GET /api/talks/:id` and shows the progress, such as "Voicing 120 of 301".

## Training

Each talk is practised at `/talks/<id>/learn` (the old `/train` address opens it). There are three modes, picked on
its home screen: Get familiar (read each slide aloud, the whole talk in order, little hidden), Get the gist (the
meaning right, up to half hidden) and Word for word (every word hidden). `docs/learning.md` is the design of the
engine behind them: the tree of each slide, the score and spacing of each part, hiding, and what comes next.
Progress is kept in localStorage and in D1 (`/api/talks/<id>/progress`), merged so the newer state of each part
wins; the old trainer's sentence scores are carried over once.

You tap to speak and tap to stop; recording also stops once the browser's speech recognition has heard the last
words, and never on a pause. The attempt (Opus, 16 kbps) goes to `POST /api/grade`, where Gemini judges whether the
meaning came through, and the verdict shows on the same card after "Checking...".

- An attempt fails for a point left out, a changed meaning, a wrong number, name or key term (the talk's names and
  the must-say items), points in a different order, or a stumble (a false start, a repeat or a self-correction).
- Small words added or dropped, contractions, a greeting or filler, synonyms and light rewording within a point are
  fine. A pass that was not word for word says so quietly.
- Each problem's phrase is marked as one run of words, so a word said right elsewhere is never marked
  (`judged()` in `lib/judge.ts`).
- Without the judge, you mark yourself.

Hear it plays the clips of the slide or part, one after another.

Keys on a laptop: Space to speak, stop or go on, Enter to go on, R to hear it, 1 got it and 3 missed when marking
yourself.

Stored files are served from `GET /api/files/<key>`, with byte ranges, behind the sign-in. Uploads are read whole
before they are stored, up to 100 MB, as the build has to unzip the deck in memory anyway.

## Layout

- `lib/text.ts`: sentence splitting, the fading cues, chains, and the glossary of names for the judge.
- `lib/grade.ts`: grading what was heard against a sentence (numbers, names, split and joined words).
- `lib/schedule.ts`: the review scheduler, today's session, streaks, progress and merging imported progress.
- `lib/delivery.ts`: pace, the level meter, fillers and delivery tips.
- `lib/judge.ts`: the Gemini judge's prompt and response schemas, its verdict over the local grade, and `same()`.
- `lib/auth.ts`: the signed sign-in cookie.
- `lib/pptx.ts`: reading slides, titles and notes from a .pptx.
- `lib/build.ts`: the build steps. `lib/tts.ts`: Gemini text to speech. `lib/api.ts`: the talks API.
- `lib/standins.ts`: stand-ins for the renderer and the voice, for tests and local development.
- `workers/`: the Workflow and the container class. `worker.ts`: the Worker entry, around the OpenNext app.
- `container/`: the render server and its Dockerfile.
- `migrations/`: the D1 schema.
- `proxy.ts`: sends anyone without a valid cookie to `/login`.
- `tests/unit` and `tests/integration`: Vitest, with local D1 and R2 from Wrangler; 100% coverage of `lib/`.
  `tests/e2e`: Playwright. `tests/fixtures/three-slides.pptx` is made by `npm run fixture` from invented text.

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
npx wrangler d1 migrations apply DB --local
BETA_PASSWORD=some-local-password BUILD_INLINE=1 STANDINS=1 npm run dev
```

Then open http://localhost:3000 and sign in with that password. `next dev` reads its variables from the environment
or from `.env.local`. It uses local D1 and R2 (in `.wrangler/`), but it cannot run the Workflow or the container, so:

- `BUILD_INLINE=1` runs the build in the request instead of the Workflow.
- `STANDINS=1` uses blank slide images and silent clips. Without it, the build calls Gemini (set `GEMINI_KEY`) and
  leaves the slides without images.

To run the built Worker locally, with the real Workflow (it reads `.dev.vars`; put `STANDINS=1` there to skip the
container and Gemini):

```sh
npx opennextjs-cloudflare build
npx wrangler dev --enable-containers=false
```

Without `--enable-containers=false`, Wrangler builds the render container with Docker.

To try the render server on its own, with LibreOffice and poppler installed: `PORT=8080 node container/server.mjs`,
then `curl --data-binary @tests/fixtures/three-slides.pptx localhost:8080/render -o slides.zip`.

## Tests

```sh
npm run lint
npm run typecheck
npm test          # Vitest with coverage; fails under 100% for lib/
npm run e2e       # Playwright, desktop and phone sizes; starts next dev with a test password, stand-ins
                  # for the renderer, voice and judge, and a fake microphone
```

The unit tests run in the Europe/London time zone, because days are counted in local time.

To run the Playwright tests against the built Worker instead (with `STANDINS=1` in `.dev.vars`):

```sh
E2E_BASE_URL=http://localhost:8787 E2E_PASSWORD=<the password in .dev.vars> npm run e2e
```

After changing `wrangler.jsonc`, run `npm run cf-typegen` to update `cloudflare-env.d.ts`.

GitHub Actions runs all four on each push.

## Cloudflare

`wrangler.jsonc` declares:

- `DB`: the D1 database `talk-trainer`.
- `FILES`: the R2 bucket `talk-trainer-files`.
- `BUILD`: the Workflow `talk-trainer-build`.
- `RENDER`: the render container (needs the Workers Paid plan).

R2 has to be enabled for the account in the Cloudflare dashboard. Then create the bucket once:

```sh
npx wrangler r2 bucket create talk-trainer-files
npx wrangler d1 migrations apply DB --remote
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

This builds the app with OpenNext and deploys it with Wrangler, which builds and pushes the container image with
Docker. Apply new D1 migrations with `npx wrangler d1 migrations apply DB --remote` before deploying code that needs
them.

## Licence

MIT. See `LICENSE`.
