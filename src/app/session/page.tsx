import { Suspense } from "react";
import Session from "@/views/Session";

// useSearchParams() (?horse=&from=&to=) must sit under a Suspense boundary in Next.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Session />
    </Suspense>
  );
}
