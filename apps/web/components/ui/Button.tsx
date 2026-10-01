"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

const variants = {
  primary: "btn-solid",
  secondary: "",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;

const sizes = {
  sm: "btn-compact",
  md: "",
  lg: "btn-lg",
} as const;

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: keyof typeof variants;
    size?: keyof typeof sizes;
    loading?: boolean;
  }
>(function Button({ className = "", variant = "secondary", size = "md", loading, disabled, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`btn ${variants[variant]} ${sizes[size]} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? "Working…" : children}
    </button>
  );
});
