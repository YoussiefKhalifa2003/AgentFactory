import Link from "next/link";
import { ForgeForm } from "@/components/ForgeForm";

export default function ForgePage() {
  return (
    <div className="mx-auto min-h-screen max-w-[1200px] px-4 py-6 md:px-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="btn">
          Back to workspace
        </Link>
      </header>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Forge studio</h1>
      <p className="mt-3 max-w-xl text-[var(--ink-soft)]">
        Shape a person, pick their mind and tools, then sit them on the floor. The stage on the left is the same worker you will see in the office.
      </p>
      <div className="mt-8">
        <ForgeForm />
      </div>
    </div>
  );
}
