# HumansOnly

A capture-the-flag challenge for you and your favorite AI. Get a 200–250-word story past the captcha to reach the protected page. Every prompt includes cats.

**Play //** [captcha.10xcatdad.xyz](https://captcha.10xcatdad.xyz) · **Contact //** [@10xCatDad](https://x.com/10xCatDad)

Cloudflare Turnstile checks the browser before issuing a writing prompt. Pangram checks for AI writing. Codex checks the setting/time, characters, central conflict, and whether the response is a story. Passing all three opens a protected page for an hour. The checks can make mistakes; passing does not prove someone is human.

The public test has a $5 API budget and three tries per visitor. Results show all three checks and overall totals. White result images matching the browser summary are generated automatically, with check results, scores, the site URL, attempt timestamp, and X handle. SHARE TO X downloads the PNG and opens a browser window with the requested win/loss text and no links. The visitor attaches the downloaded image using X’s photo button, then reviews and confirms the post. The attachment step is stated beside the button, and a separate draft link remains available if the popup is blocked. Image download also works independently. Sharing does not contact the external image host or open the operating system share sheet. Light, dark, and system themes are supported. Typing, pasting, and dictation work.

## Development

Requires Node 24, a funded Pangram API key, and an existing ChatGPT sign-in in Codex for the private story validator.

```sh
npm ci
cp .env.example .dev.vars
# Fill in the local secrets. Never commit them.
npm run build
# Apply new SQL files in drizzle/ to your local D1 database, in order.
npm run dev -- --port 5188
```

The Site uses Vinext, React, a Cloudflare Worker, and D1. Apply each migration once. Local and hosted databases are separate. Example for a new local migration:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_perpetual_impossible_man.sql
```

Configure `PANGRAM_API_KEY`, `RATE_LIMIT_SECRET`, `ADMIN_TOKEN`, `VALIDATOR_TOKEN`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` in `.dev.vars` and the hosting environment. Generate independent random 32-byte values for `RATE_LIMIT_SECRET`, `ADMIN_TOKEN`, and `VALIDATOR_TOKEN`. Create a Managed widget in Cloudflare Turnstile and allow the deployment hostnames. Use its supplied site key and secret; production rejects Cloudflare’s dummy test keys. The public detector version is pinned in the server code.

## Story validator

The private worker uses the owner’s existing Codex subscription. No OpenAI API key is used. It retrieves the submitted text from its Pangram task and performs a bounded, tool-free check. It does not expose a Codex agent or account credentials to visitors. Stories are data only: no tools, shell commands, dynamic code execution, or visitor-selected file access. Unexpected tool output is rejected.

Run it in a second terminal for local development:

```sh
VALIDATOR_SITE_ORIGIN=http://127.0.0.1:5188 node --env-file=.dev.vars --experimental-strip-types scripts/codex-validator.mjs
```

For production, omit `VALIDATOR_SITE_ORIGIN` to use the demo domain. `VALIDATOR_MODEL` optionally selects another model available to the local subscription. The default is `gpt-6-luna`.

`ops/humanity-validator.service` provides a user-service template. Set its Node executable and PATH for your installation. The host PC and WSL must remain running. New checks pause when the worker is unavailable. Subscription usage limits apply, and the subscription transport may change.

## Checks

```sh
npm test
npm run typecheck
npx playwright install chromium
npx playwright test
npm run build
```

Browser tests expect a local server on port 5188. `TEST_ORIGIN` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can override the defaults. Tests use fixture responses for paid checks. Server tests cover authorization, result handling, durable quotas, and concurrent budget reservations with SQLite and the real D1 runtime.

The optional `study:*` scripts are development tools. Detector and bot trials can incur charges; use only on your own deployment with an explicit testing budget.

## Data and publishing

Owner-authorized resets use `POST /api/admin/reset-attempts` with an administrator bearer token, the site's `Origin`, and JSON `{ "resetId": "<UUID>", "confirm": "clear-attempts-and-usage" }`. The operation clears attempt history, public totals, user quotas, and existing access grants, while retaining already-reserved costs against the $5 lifetime cap. It waits for active checks and is atomic and idempotent by reset ID. If the administrator credential is unavailable, a temporary secret `ATTEMPT_RESET_TOKEN` may authorize only the matching `ATTEMPT_RESET_ID`; remove both runtime variables and redeploy after use. Reuse the same ID for retries. Browser-cached or already-downloaded images and previously published external image links are not deleted.

Cloudflare checks browser signals. Stories go to Pangram and OpenAI. The server and private worker do not save story text or include it in logs. Drafts stay in the browser tab. Images are cached in the visitor’s browser. Sharing downloads a PNG for the visitor to attach directly on X; the current client does not upload to the art site. Previously created unlisted pages and images remain accessible to anyone with the link after browser data is cleared. They remain excluded from the gallery, search, counts, and tags. The session-authorized image upload endpoint is retained for compatibility with older open tabs. Previous-result lists remain session-private. No raw story text is stored separately. Anonymous attempt metadata and aggregate results are retained for the experiment. Provider data handling follows [Pangram’s privacy policy](https://www.pangram.com/privacy-policy) and [OpenAI’s privacy policy](https://openai.com/policies/privacy-policy/).

Publish through the Sites source workflow so the pushed source, migrations, and build artifact match. Keep secrets in hosting settings and ignored local files. The GitHub repository is an anonymous source mirror; it does not contain the owner’s private deployment history.
