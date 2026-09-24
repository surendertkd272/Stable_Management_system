// Thin adapter: the whole backend is one Web-standard handler in server/app.mjs,
// shared by the /api, /auth and /ingest route trees.
import { handle } from "../../../../server/app.mjs";

// Node, not Edge: the backend uses node:crypto (scrypt), node:fs (JSON store)
// and raw TCP to cameras. force-dynamic: nothing here may be cached or
// prerendered at build time — every response reflects live readings.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS };
