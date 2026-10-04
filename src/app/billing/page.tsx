import { redirect } from "next/navigation";
import Billing from "@/views/Billing";
import { FEATURES } from "@/features";

// Hidden while this stable does not use it (src/features.ts).
export default function Page() {
  if (!FEATURES.billing) redirect("/");
  return <Billing />;
}
