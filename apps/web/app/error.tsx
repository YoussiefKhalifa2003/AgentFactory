"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-[28px] bg-white p-8 text-center shadow-sm">
        <p className="display text-2xl">The workspace hiccuped</p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">Refresh the page, or try again.</p>
        <button type="button" className="btn btn-solid mt-5" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
