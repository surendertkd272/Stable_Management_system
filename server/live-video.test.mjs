import { test } from "node:test";
import assert from "node:assert/strict";
import { jpegSplitter, liveResponse, liveFeeds } from "./live-video.mjs";

const jpeg = (n) => Buffer.from([0xff, 0xd8, n, n, n, 0xff, 0xd9]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read length-prefixed frames from a live Response until `want` arrive. */
async function frames(res, want) {
  const reader = res.body.getReader();
  let buf = Buffer.alloc(0);
  const out = [];
  while (out.length < want) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = Buffer.concat([buf, Buffer.from(value)]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
      const n = buf.readUInt32BE(0);
      out.push(buf.subarray(4, 4 + n));
      buf = buf.subarray(4 + n);
    }
  }
  return { out, reader };
}

test("JPEG frames are split out of a byte stream, across chunk boundaries", () => {
  const got = [];
  const feed = jpegSplitter((f) => got.push(f[2]));
  const all = Buffer.concat([jpeg(1), jpeg(2), jpeg(3)]);
  for (let i = 0; i < all.length; i += 3) feed(all.subarray(i, i + 3));
  assert.deepEqual(got, [1, 2, 3]);
});

test("viewers share one video stream, a new viewer gets the newest frame, and it stops after the last one leaves", async () => {
  let runs = 0, stopped = 0, push;
  const run = async (dev, pw, which, onFrame) => { runs++; push = onFrame; return { stop: () => { stopped++; } }; };
  const dev = { id: "cam-live-1", host: "x" };
  const a = liveResponse(dev, "pw", "thermal", null, {}, { run, lingerMs: 50 });
  await sleep(5);
  push(jpeg(1));
  const b = liveResponse(dev, "pw", "thermal", null, {}, { run, lingerMs: 50 });
  assert.equal(runs, 1, "one camera stream for both viewers");
  push(jpeg(2));
  const ra = await frames(a, 2), rb = await frames(b, 2);
  assert.deepEqual(ra.out.map((f) => f[2]), [1, 2]);
  assert.deepEqual(rb.out.map((f) => f[2]), [1, 2], "the second viewer starts with the newest frame");
  assert.equal(liveFeeds().find((f) => f.key === "cam-live-1:thermal").viewers, 2);
  await ra.reader.cancel();
  await sleep(80);
  assert.equal(stopped, 0, "still one viewer: the stream keeps going");
  await rb.reader.cancel();
  await sleep(80);
  assert.equal(stopped, 1, "no viewers left: the camera stream is stopped");
  assert.equal(liveFeeds().some((f) => f.key === "cam-live-1:thermal"), false);
});

test("a viewer that has left by closing the connection is dropped too", async () => {
  let stopped = 0;
  const run = async () => ({ stop: () => { stopped++; } });
  const ac = new AbortController();
  liveResponse({ id: "cam-live-2", host: "x" }, "pw", "colour", ac.signal, {}, { run, lingerMs: 30 });
  await sleep(5);
  ac.abort();
  await sleep(60);
  assert.equal(stopped, 1);
});

test("when the camera stream ends, viewers are closed so the page can reconnect", async () => {
  let end;
  const run = async (dev, pw, which, onFrame, onEnd) => { end = onEnd; return { stop() {} }; };
  const res = liveResponse({ id: "cam-live-3", host: "x" }, "pw", "thermal", null, {}, { run });
  await sleep(5);
  end("the video stream ended");
  const { value, done } = await res.body.getReader().read();
  assert.equal(done, true);
  assert.equal(value, undefined);
});
