// Serve the backend handler on a port without building Next.js — for
// end-to-end tests of the edge agent and the device API.
//   node server/testing/serve.mjs [port]
import http from "node:http";
import { handle } from "../app.mjs";

const port = Number(process.argv[2]) || 8090;
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`[serve] backend on http://127.0.0.1:${port}`));
