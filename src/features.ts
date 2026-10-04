// Parts of EquiCare a stable may not use. RVC owns its horses and bills no
// one, so billing and the owner portal are hidden (4 Oct 2026). For a livery
// stable whose clients own the horses, set them back to true.
export const FEATURES = {
  billing: false,      // invoices, GST, UPI payments (/billing)
  ownerPortal: false,  // horse owners' read-only view of their own horses (/portal)
} as const;
