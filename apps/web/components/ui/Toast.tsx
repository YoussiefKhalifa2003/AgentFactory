"use client";

import { Toaster } from "sonner";

export function ToastHost() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: "paper-toast",
      }}
      theme="light"
    />
  );
}

export { toast } from "sonner";
