"use client";

import { Check } from "lucide-react";

export function Chip({
  on,
  onClick,
  children,
  pigment,
}: {
  on?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  pigment?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`chip ${on ? "is-on" : ""}`}
      style={on && pigment ? { background: `color-mix(in srgb, ${pigment} 18%, white)`, borderColor: pigment } : undefined}
    >
      {on && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {children}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? "is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
      <span className="toggle-label">{label}</span>
    </button>
  );
}
