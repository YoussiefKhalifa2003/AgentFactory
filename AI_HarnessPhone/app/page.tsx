"use client";

import { FactoryProvider } from "@/lib/factory";
import { Shell } from "@/components/Shell";

export default function Home() {
  return (
    <FactoryProvider>
      <Shell />
    </FactoryProvider>
  );
}
