import { Suspense } from "react";
import Reports from "@/views/Reports";

// useSearchParams() (?horse=<id>) must sit under a Suspense boundary in Next.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Reports />
    </Suspense>
  );
}
