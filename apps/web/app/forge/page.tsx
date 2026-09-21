import { ForgeForm } from "@/components/ForgeForm";

export default function ForgePage() {
  return (
    <div className="mx-auto min-h-screen max-w-[1200px] px-4 py-6 md:px-8">
      <header className="mb-8 flex items-center justify-between">
        <a href="/" className="btn">
          Back to workspace
        </a>
      </header>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">New agent</h1>
      <p className="mt-3 max-w-xl text-[var(--ink-soft)]">
        Look, mind, then tools. Spreadsheet and PDF leave files you can open on
        the desk. The figure on the right is the same worker you open on the floor.
      </p>
      <div className="mt-8">
        <ForgeForm />
      </div>
    </div>
  );
}
