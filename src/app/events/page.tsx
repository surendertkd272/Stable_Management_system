import { Suspense } from "react";
import Events from "@/views/Events";

// useSearchParams() (?horse=) must sit under a Suspense boundary in Next.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Events />
    </Suspense>
  );
}
