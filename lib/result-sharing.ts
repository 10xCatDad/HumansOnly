import { DEMO_ID } from "./budget.ts";
import { RESULT_IMAGE_VERSION } from "./result-image-version.ts";

export const RESULT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const RESULT_ART_ORIGIN = "https://art.10xcatdad.xyz";
export type SharingEnv = { RESULT_IMAGE_TOKEN?: string };
type ShareRow = { share_id: string; uploaded_at: number | null; image_version: number };
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const links = (row: ShareRow) => ({ shareUrl: `${RESULT_ART_ORIGIN}/r/${row.share_id}`, imageUrl: `${RESULT_ART_ORIGIN}/r/${row.share_id}/image.png`, imageVersion: row.image_version });

export async function shareResultImage(request: Request, db: D1Database, env: SharingEnv, sessionId: string | undefined, now: number, fetcher: typeof fetch = fetch) {
  if (!sessionId) return json({ message: "Open your result in the browser where you completed it." }, 401);
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed." }, 405);
  const url = new URL(request.url), id = url.searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ message: "Result not found." }, 404);
  if (request.method === "POST" && request.headers.get("origin") !== url.origin) return json({ message: "Share from this website." }, 403);
  // Durable reservations retain ownership after short-lived challenge details
  // are cleaned up. Never authorize with a result ID or a browser claim alone.
  const result = await db.prepare(`SELECT d.outcome, r.created_at FROM demo_reservations r JOIN demo_results d ON d.challenge_id = r.challenge_id AND d.demo_id = r.budget_id WHERE r.challenge_id = ? AND r.session_id = ? AND r.budget_id = ? AND d.outcome IN ('passed', 'rejected', 'error')`).bind(id, sessionId, DEMO_ID).first<{ outcome: string; created_at: number }>();
  if (!result) return json({ message: "Completed result not found." }, 404);
  const requestedVersion = url.searchParams.get("v");
  if (requestedVersion !== null && requestedVersion !== String(RESULT_IMAGE_VERSION)) return json({ message: "Refresh this page to generate the updated result image." }, 409);
  // Tabs opened before image versioning sent no v parameter. Keep their uploads
  // working, but label them as legacy so refreshed tabs still generate the new design.
  const imageVersion = requestedVersion === null ? 2 : RESULT_IMAGE_VERSION;
  let row = await db.prepare("SELECT share_id, uploaded_at, image_version FROM result_shares WHERE challenge_id = ? AND image_version >= ?").bind(id, imageVersion).first<ShareRow>();
  if (row?.uploaded_at) return json(links(row));
  if (request.method === "GET") return json({ shareUrl: null, imageUrl: null });
  if (row && row.image_version > imageVersion) return json({ message: "Image is still being saved. Please retry shortly." }, 409);
  if (!env.RESULT_IMAGE_TOKEN) return json({ message: "Image hosting is unavailable. Download the image instead." }, 503);
  if (request.headers.get("content-type")?.split(";")[0] !== "image/png") return json({ message: "Use a PNG result image." }, 415);
  if (Number(request.headers.get("content-length")) > RESULT_IMAGE_MAX_BYTES) return json({ message: "Result image is too large." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ message: "A result image is required." }, 400);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RESULT_IMAGE_MAX_BYTES) { await reader.cancel(); return json({ message: "Result image is too large." }, 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  if (size < 33 || ![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return json({ message: "Use a PNG result image." }, 400);
  const freshId = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
  // Rotate only the mapping for an older design. Previously shared URLs remain
  // available in image storage; retries of this design keep the same opaque key.
  await db.prepare(`INSERT INTO result_shares (challenge_id, share_id, created_at, image_version) VALUES (?, ?, ?, ?)
    ON CONFLICT(challenge_id) DO UPDATE SET share_id = excluded.share_id, created_at = excluded.created_at,
      image_version = excluded.image_version, uploaded_at = NULL, uploading_until = 0
    WHERE result_shares.image_version < excluded.image_version AND result_shares.uploading_until < ?`).bind(id, freshId, now, imageVersion, now).run();
  row = await db.prepare("SELECT share_id, uploaded_at, image_version FROM result_shares WHERE challenge_id = ? AND image_version >= ?").bind(id, imageVersion).first<ShareRow>();
  if (!row) return json({ message: "Image is still being saved. Please retry shortly." }, 409);
  if (row.uploaded_at) return json(links(row));
  if (row.image_version !== imageVersion) return json({ message: "Image is still being saved. Please retry shortly." }, 409);
  // One short upload lease prevents retry storms. An uncertain upload can be
  // retried safely because the storage endpoint also creates only once.
  const leased = await db.prepare("UPDATE result_shares SET uploading_until = ? WHERE challenge_id = ? AND share_id = ? AND image_version = ? AND uploaded_at IS NULL AND uploading_until < ? RETURNING share_id").bind(now + 20_000, id, row.share_id, imageVersion, now).first();
  if (!leased) return json({ message: "Image is still being saved. Please retry shortly." }, 409);
  try {
    const response = await fetcher(`${RESULT_ART_ORIGIN}/api/captcha-results/${row.share_id}`, {
      method: "PUT", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "image/png", "User-Agent": "HumansOnly-Result-Sharing/1.0", "Authorization": `Bearer ${env.RESULT_IMAGE_TOKEN}`, "X-Result-State": result.outcome, "X-Result-Time": String(result.created_at) }, body: bytes,
    });
    if (!response.ok) return json({ message: response.status === 400 || response.status === 413 ? "The result image could not be saved. Try downloading it." : "Image hosting is unavailable. Download the image instead." }, response.status === 400 ? 400 : 503);
    await db.prepare("UPDATE result_shares SET uploaded_at = ? WHERE challenge_id = ? AND share_id = ?").bind(now, id, row.share_id).run();
    return json(links(row));
  } catch { return json({ message: "Image hosting is unavailable. Download the image instead." }, 503); }
  finally { await db.prepare("UPDATE result_shares SET uploading_until = 0 WHERE challenge_id = ? AND share_id = ?").bind(id, row.share_id).run(); }
}
