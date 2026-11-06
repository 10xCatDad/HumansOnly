# Project instructions

- Keep website copy concise, minimal, and functional. Avoid slogans and grandiose language.
- Include System, Light, and Dark theme choices. Default to the system/browser preference when available, otherwise dark.
- Public limit copy should say only that users get three tries. Do not describe the browser/network enforcement mechanism in the UI.
- Use `https://captcha.10xcatdad.xyz` as the public URL.
- The approved public account link is `https://x.com/10xCatDad`. Keep the owner's real name, other accounts, and personal links off the site and its public assets.
- Preserve the initial $5 total API cap and three tries per browser/network for the test round. Limits must survive redeployment and telemetry cleanup.
- Every story prompt must include at least one cat-related concept.
- Validate story concepts using the owner’s existing Codex subscription through the private, tool-free worker. Use Pangram only for whole-text AI detection. Never expose Codex execution or account credentials to visitors.
- Results and X sharing must include Pangram text percentages and the Codex concept check. Do not describe scores as the probability that a visitor is human.
- Agent opt-out notices and automation checks are deterrents only. Preserve paste, dictation, and accessibility.
- Public GitHub commits use `10xCatDad <353330524+10xCatDad@users.noreply.github.com>`. Keep the private hosting repository's history and deployment identifiers out of that mirror.
- The site brand is HumansOnly. Dark mode uses black surfaces and neon green accents; light mode keeps its neutral palette. Use icons for theme choices.
- Keep detector branding out of prominent copy and share text. Retain the provider link in the footer and accurate provider disclosure in the privacy details.
- Turnstile must succeed on the server before a new writing prompt is issued. Keep hostname/action validation and production test-key rejection; never rely only on the widget UI.
- Results use overall Pass/Fail as the heading, followed by Cloudflare precheck, Codex story validation, and AI detection, in that order. Preserve this order in sharing.
- Keep the local validator outbound-only and tool-free. Never feed submissions or model output into commands, executable code, file paths, or native agent/tool RPCs. Preserve strict parsing, request limits, and service hardening.
- Main heading: "Bad Robot, Go Away (Challenge I)". Keep the HumansOnly brand.
- Stories must contain 200–250 words. Keep X composer text under 280 characters; put the full story, prompt, and detailed check results in the downloadable result image.
