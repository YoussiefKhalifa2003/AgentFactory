"use client";

import { AlertCircle, CheckCircle2, Clock, Loader2, Minus } from "lucide-react";
import { statusKind, statusLabel } from "@/lib/status";

const icons = {
  working: Loader2,
  done: CheckCircle2,
  blocked: AlertCircle,
  queued: Clock,
  ready: Minus,
};

export function StatusPill({
  status,
  activity,
  caption,
}: {
  status?: string;
  activity?: string;
  caption?: string;
}) {
  const kind = statusKind(status, activity);
  const Icon = icons[kind];
  const label = caption?.trim() || statusLabel(activity, status);
  return (
    <span className={`status-pill is-${kind}`}>
      <Icon size={12} className={kind === "working" ? "spin" : ""} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
