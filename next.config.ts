import type { NextConfig } from "next";

// The browser runs on mock data (no API calls) in exactly one case: a Vercel
// deployment with no external backend configured. That is today's public demo,
// and it must keep working with zero environment variables.
//
// Why not run the backend on Vercel too: it keeps readings and sessions in one
// long-lived process (the Postgres store caches at boot; sessions live in
// memory), and it has to reach cameras on the barn LAN. Serverless functions
// give neither — logins would drop between instances and cameras are
// unreachable. The real deployment is `next start` on the site's own server.
const onVercel = Boolean(process.env.VERCEL);
const demoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE ??
  (onVercel && !process.env.NEXT_PUBLIC_API_URL ? "1" : "0");

const config: NextConfig = {
  env: { NEXT_PUBLIC_DEMO_MODE: demoMode },
  // Loaded lazily only when DATABASE_URL is set; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  reactStrictMode: true,
};

export default config;
