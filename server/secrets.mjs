// Encryption at rest for device credentials.
//
// Camera passwords cannot be hashed like user passwords — the server has to
// send them to the camera to log in. So they are encrypted (AES-256-GCM) and
// never returned to the browser in any form.
//
// Key: CAMERA_SECRET_KEY if set (any string; stretched with scrypt), otherwise
// a random key generated once into <data dir>/secret.key (mode 0600). That
// keeps a leaked state.json or database dump from exposing camera passwords on
// its own; someone with the whole data directory has both halves, as with any
// local keyfile. For stronger separation set CAMERA_SECRET_KEY from a secret
// manager.
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store.mjs";

const G = (globalThis.__equicareSecrets ??= {});

function key() {
  if (G.key) return G.key;
  const env = process.env.CAMERA_SECRET_KEY;
  if (env) {
    G.key = scryptSync(env, "equicare-camera-credentials", 32);
  } else {
    const dir = dataDir();
    const file = join(dir, "secret.key");
    if (existsSync(/*turbopackIgnore: true*/ file)) {
      G.key = Buffer.from(readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim(), "base64");
    } else {
      if (!existsSync(/*turbopackIgnore: true*/ dir)) mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
      G.key = randomBytes(32);
      writeFileSync(/*turbopackIgnore: true*/ file, G.key.toString("base64"), { mode: 0o600 });
    }
  }
  return G.key;
}

/** Encrypt a secret. Output: "v1:<iv>:<tag>:<ciphertext>", base64 parts. */
export function seal(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === "") return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt, or null if absent/tampered/wrong key (never throws). */
export function open(sealed) {
  if (!sealed) return null;
  try {
    const [v, iv, tag, ct] = String(sealed).split(":");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** For tests: forget the cached key so a new data dir / env takes effect. */
export const _resetKeyForTests = () => { delete G.key; };
