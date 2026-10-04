import { Suspense } from "react";
import Rules from "@/views/Rules";

// useSearchParams() (?horse=) must sit under a Suspense boundary in Next.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Rules />
    </Suspense>
  );
}
