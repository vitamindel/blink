import { Suspense } from "react";
import { Viewer } from "@/components/viewer/viewer";

export const metadata = { title: "Explore — Blink" };

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-sky" />}>
      <Viewer />
    </Suspense>
  );
}
