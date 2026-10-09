"use client";
import { useEffect, useMemo } from "react";
import FormRuntime from "@/components/runtime/FormRuntime";
import { toRuntime } from "@/lib/runtimeAdapter";
import { useBuilder } from "@/lib/store";

/** Full-screen run-through of the *draft* using the very same player respondents get. */
export default function PreviewOverlay({ onClose }: { onClose: () => void }) {
  const form = useBuilder((s) => s.form)!;
  // snapshot once per open so typing in the builder behind it can't reset the run
  const runtime = useMemo(() => toRuntime(form), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return <FormRuntime form={runtime} preview onClose={onClose} />;
}
