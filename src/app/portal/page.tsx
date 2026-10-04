import { redirect } from "next/navigation";
import Portal from "@/views/Portal";
import { FEATURES } from "@/features";

// Hidden while this stable does not use it (src/features.ts).
export default function Page() {
  if (!FEATURES.ownerPortal) redirect("/");
  return <Portal />;
}
