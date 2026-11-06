# Project instructions

- Keep website copy concise, minimal, and functional. Avoid slogans and grandiose language.
- Prefer `//` as a restrained visual separator between labels and details. The aggregate stats label is `LEADERBOARD INFO //`; these are totals, not player rankings.
- Use [HumansOnly](https://captcha.10xcatdad.xyz) as the design reference: Space Grotesk, compact captcha panels, clear controls and status, concise copy, `//` separators, and icon-based theme choices.
- Frame the site as an accessible capture-the-flag challenge: get an LLM through the captcha automatically or paste its response to reach the protected page. Explain the goal in plain language without assuming security expertise.
- Include System, Light, and Dark theme choices. Default to the system/browser preference when available, otherwise dark.
- Public limit copy should say only that users get three tries. Do not describe the browser/network enforcement mechanism in the UI.
- Use `https://captcha.10xcatdad.xyz` as the public URL.
- The approved public account link is `https://x.com/10xCatDad`. Keep the owner's real name, other accounts, and personal links off the site and its public assets.
- Preserve the initial $5 total API cap and the default three tries per browser/network for the test round. The diagnostics shortcut may grant unlimited retries only to its own server session; it must never bypass the shared budget or verification checks. Limits must survive redeployment and telemetry cleanup.
- Every story prompt must include at least one cat-related concept. Allow past, present, and speculative future settings, including years such as 2100.
- Validate story concepts using the owner’s existing Codex subscription through the private, tool-free worker. Use Pangram only for whole-text STORY AUTHOR VALIDATION. Never expose Codex execution or account credentials to visitors.
- Results and X sharing must include Pangram text percentages and the Codex concept check. Do not describe scores as the probability that a visitor is human.
- Agent opt-out notices and automation checks are deterrents only. Preserve paste, dictation, and accessibility.
- Public GitHub commits use `10xCatDad <353330524+10xCatDad@users.noreply.github.com>`. Keep the private hosting repository's history and deployment identifiers out of that mirror.
- The site brand is HumansOnly. Dark mode uses black surfaces and neon green accents; light mode keeps its neutral palette. Use icons for theme choices.
- Keep detector branding out of prominent copy and share text. Retain the provider link in the footer and accurate provider disclosure in the privacy details.
- Turnstile must succeed on the server before a new writing prompt is issued. Keep hostname/action validation and production test-key rejection; never rely only on the widget UI.
- Results use overall Pass/Fail as the heading, followed by Cloudflare precheck, Codex story validation, and STORY AUTHOR VALIDATION, in that order. Preserve this order in sharing.
- Keep the local validator outbound-only and tool-free. Never feed submissions or model output into commands, executable code, file paths, or native agent/tool RPCs. Preserve strict parsing, request limits, and service hardening.
- Main heading: "Bad Robot, Go Away // Challenge I". Keep the HumansOnly brand.
- Stories must contain 200–250 words. Keep X composer text under 280 characters; put the first four rendered lines of the story, prompt, and detailed check results in the downloadable result image. Include the X logo beside the handle.
- Use self-hosted Space Grotesk for website typography. Keep primary action buttons uppercase and label their instructions as the captcha process.
- Keep attempts remaining prominent. Previous results are private to the current session; never return other visitors’ results or store story text on the server for history. Cache result images in the visitor’s browser. On sharing, host one bounded, metadata-stripped PNG per completed result in the art site’s separate results storage. Keep images out of Git and gallery listings. Disclose that shared images are unlisted and accessible to anyone with the link, not private.
- Keep service-error totals out of the main stats. The diagnostics easter egg belongs below the footer and may show only aggregate counts, allowlisted error reasons, and service readiness. Never expose raw logs, secrets, identifiers, or private submissions through it.
- Generate and preview result images automatically, including in previous results. Keep sharing in the browser, including on Windows; do not call navigator.share. Open X in a new window with an unlisted result URL after a session-authorized upload. Retain download as a fallback. Never claim a URL attaches native media, guarantees a preview, or publishes automatically.
- X post text tags @10xCatDad, names the level, and uses the requested win/loss wording with remaining tries on a loss. Include the unlisted result URL in post text, staying under 280 characters. Print captcha.10xCatDad.xyz at the top center of the image and the attempt timestamp at bottom left; keep the X logo and handle at bottom right. Put the three prompt concepts in one compact box and the story excerpt in another.
- Open fresh pass/fail results in an accessible overlay with the check summary, automatically generated image preview, prominent SHARE TO X button, and image download. Put optional writing feedback below sharing.
- Use GOAL // CAPTURE THE FLAG WITH AN LLM for the goal heading and BEGIN ATTEMPT for the start button, without an arrow. Label Previous Results checks as Step 1 // CLOUDFLARE PRECHECK, Step 2 // STORY CONTENT & SUBJECT VALIDATION, and Step 3 // STORY AUTHOR VALIDATION. Use RESULT IMAGE GENERATION FAILURE for image creation errors, distinct from a failed captcha.

- Authorize result-image uploads using a completed attempt belonging to the current server session. Use a dedicated server-to-server secret, opaque random share IDs, idempotent writes, bounded PNG validation, and server-side metadata removal. Shared pages must provide server-rendered Open Graph and X card metadata without requiring login.

- Use CLOUDFLARE PRECHECK, STORY CONTENT & SUBJECT VALIDATION, and STORY AUTHOR VALIDATION as the three check titles in both the page and generated image. Omit the Checked with Codex subtitle. Include COPY PROMPT with clean plain-text requirements and label the submission button SUBMIT SOLUTION.
