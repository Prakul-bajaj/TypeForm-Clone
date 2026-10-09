"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import FormRuntime from "@/components/runtime/FormRuntime";
import { api, ApiError } from "@/lib/api";
import type { RuntimeForm } from "@/lib/types";

/** Public, login-free form player: https://host/to/<publicId> */
export default function PublicFormPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [form, setForm] = useState<RuntimeForm | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const requested = useRef(false); // StrictMode runs effects twice in dev — count the view once

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    api
      .getPublicForm(publicId)
      .then((f) => {
        setForm(f);
        document.title = f.title;
      })
      .catch((e) => setError({ status: e instanceof ApiError ? e.status : 0, message: e.message }));
  }, [publicId]);

  if (error) {
    return (
      <div className="tf-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "left" }}>
        <div style={{ maxWidth: 520 }}>
          <h1 className="tf-title" style={{ fontSize: "1.9em" }}>
            {error.status === 404 ? "This form isn't available" : "Something went wrong"}
          </h1>
          <p className="tf-desc" style={{ fontSize: "1.2em" }}>
            {error.status === 404
              ? "It may have been unpublished or the link might be wrong. Ask the person who shared it with you."
              : error.message}
          </p>
        </div>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="tf-loading">
        <div className="tf-spinner" role="status" aria-label="Loading form" />
      </div>
    );
  }
  return <FormRuntime form={form} />;
}
