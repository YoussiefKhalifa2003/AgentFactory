"use client";

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "article" | "section";
}) {
  return <Tag className={`paper-card ${className}`.trim()}>{children}</Tag>;
}
