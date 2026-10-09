import type {
  FormDetail,
  FormSummary,
  LogicRule,
  Question,
  ResponsePage,
  ResponseRow,
  RuntimeForm,
  Summary,
  Theme,
  Settings,
  QuestionType,
  AuthUser,
  CustomTheme,
  FileAnswer,
} from "./types";
import { AUTH_EXPIRED_EVENT, clearToken, getToken } from "./auth";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export interface FieldError {
  ref?: string;
  question_id?: number;
  message: string;
}

export class ApiError extends Error {
  status: number;
  errors: FieldError[];
  constructor(status: number, message: string, errors: FieldError[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/** `Authorization: Bearer …` when we hold a login token (ignored by the public endpoints). */
function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeader(), ...(init.headers || {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    // A 401 on a normal request means the token expired / was revoked → drop it and tell the AuthProvider.
    // (Wrong password on /login is also a 401, but there is no token to drop and the form shows the message.)
    if (res.status === 401 && getToken()) {
      clearToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    const d = body?.detail;
    if (typeof d === "string") throw new ApiError(res.status, d);
    if (d && typeof d === "object" && !Array.isArray(d)) throw new ApiError(res.status, d.message || "Request failed", d.errors || []);
    if (Array.isArray(d)) throw new ApiError(res.status, d[0]?.msg || "Invalid input");
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Server → client: attach stable React keys to choices. */
let keySeq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;
function hydrate(q: any): Question {
  return { ...q, choices: (q.choices || []).map((c: any) => ({ id: c.id, key: `c${c.id}`, label: c.label })) };
}
function hydrateForm(f: any): FormDetail {
  return { ...f, questions: f.questions.map(hydrate) };
}

export const api = {
  // auth
  signup: (name: string, email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/api/auth/signup", json("POST", { name, email, password })),
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>("/api/auth/login", json("POST", { email, password })),
  me: () => request<AuthUser>("/api/auth/me"),

  // forms
  listForms: () => request<FormSummary[]>("/api/forms"),
  createForm: (title: string) => request<any>("/api/forms", json("POST", { title })).then(hydrateForm),
  getForm: (id: number) => request<any>(`/api/forms/${id}`).then(hydrateForm),
  updateForm: (id: number, patch: { title?: string; theme?: Theme; settings?: Settings }) =>
    request<any>(`/api/forms/${id}`, json("PATCH", patch)).then(hydrateForm),
  deleteForm: (id: number) => request<void>(`/api/forms/${id}`, json("DELETE")),
  duplicateForm: (id: number) => request<any>(`/api/forms/${id}/duplicate`, json("POST")).then(hydrateForm),
  publishForm: (id: number) => request<any>(`/api/forms/${id}/publish`, json("POST")).then(hydrateForm),
  unpublishForm: (id: number) => request<any>(`/api/forms/${id}/unpublish`, json("POST")).then(hydrateForm),

  // questions
  addQuestion: (id: number, type: QuestionType, afterId?: number | null) =>
    request<any>(`/api/forms/${id}/questions`, json("POST", { type, after_id: afterId ?? null })).then(hydrateForm),
  patchQuestion: (id: number, qid: number, patch: Record<string, unknown>) =>
    request<any>(`/api/forms/${id}/questions/${qid}`, json("PATCH", patch)).then(hydrate),
  deleteQuestion: (id: number, qid: number) =>
    request<any>(`/api/forms/${id}/questions/${qid}`, json("DELETE")).then(hydrateForm),
  duplicateQuestion: (id: number, qid: number) =>
    request<any>(`/api/forms/${id}/questions/${qid}/duplicate`, json("POST")).then(hydrateForm),
  reorderQuestions: (id: number, ids: number[]) =>
    request<any>(`/api/forms/${id}/questions/order`, json("PUT", { question_ids: ids })).then(hydrateForm),
  replaceLogic: (id: number, rules: LogicRule[]) =>
    request<any>(`/api/forms/${id}/logic`, json("PUT", { rules })).then(hydrateForm),

  // partial responses: answers so far, saved while the respondent is still filling the form in
  saveProgress: (
    publicId: string,
    body: { idempotency_key: string; answers: { ref: string; value: unknown }[]; started_at?: string },
  ) => request<void>(`/api/public/forms/${publicId}/progress`, { ...json("POST", body), keepalive: true }),

  // files
  /** Upload one answer file (XHR rather than fetch so we get real upload progress). */
  uploadAnswerFile: (publicId: string, ref: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
    new Promise<FileAnswer>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/api/public/forms/${publicId}/upload?ref=${encodeURIComponent(ref)}&filename=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError(0, "Can't reach the server. Is the backend running?"));
      xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      xhr.onload = () => {
        let body: any = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && body?.file_id) resolve({ file_id: body.file_id, name: body.name, size: body.size });
        else reject(new ApiError(xhr.status, typeof body?.detail === "string" ? body.detail : "The upload failed. Please try again."));
      };
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    }),
  discardFile: (publicId: string, fileId: string) =>
    request<void>(`/api/public/forms/${publicId}/upload/${fileId}`, { method: "DELETE" }).catch(() => undefined),
  /** Creator: fetch a response's file (needs the login header, so not a plain link). */
  downloadFile: async (formId: number, fileId: string): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/forms/${formId}/files/${fileId}`, { headers: authHeader(), cache: "no-store" });
    } catch {
      throw new ApiError(0, "Can't reach the server. Is the backend running?");
    }
    if (!res.ok) throw new ApiError(res.status, "Couldn't download the file");
    return res.blob();
  },
  uploadBackground: async (formId: number, file: File): Promise<{ url: string; name: string }> => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/forms/${formId}/background?filename=${encodeURIComponent(file.name)}`, {
        method: "POST", body: file, headers: authHeader(), cache: "no-store",
      });
    } catch {
      throw new ApiError(0, "Can't reach the server. Is the backend running?");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, typeof body?.detail === "string" ? body.detail : "Couldn't upload the image");
    return body;
  },

  // saved themes
  listThemes: () => request<CustomTheme[]>("/api/themes"),
  saveTheme: (name: string, theme: Theme) => request<CustomTheme>("/api/themes", json("POST", { name, theme })),
  deleteTheme: (id: number) => request<void>(`/api/themes/${id}`, json("DELETE")),

  // public runtime
  getPublicForm: (publicId: string) => request<RuntimeForm>(`/api/public/forms/${publicId}`),
  getPreview: (id: number) => request<RuntimeForm>(`/api/forms/${id}/preview`),
  submit: (
    publicId: string,
    body: { answers: { ref: string; value: unknown }[]; started_at?: string; idempotency_key?: string },
  ) => request<{ response_id: string; submitted_at: string }>(`/api/public/forms/${publicId}/responses`, json("POST", body)),

  // results
  listResponses: (id: number, page = 1, pageSize = 25, status: "all" | "completed" | "partial" = "all") =>
    request<ResponsePage>(`/api/forms/${id}/responses?page=${page}&page_size=${pageSize}&status=${status}`),
  getResponse: (id: number, rid: number) => request<ResponseRow>(`/api/forms/${id}/responses/${rid}`),
  deleteResponse: (id: number, rid: number) => request<void>(`/api/forms/${id}/responses/${rid}`, json("DELETE")),
  summary: (id: number) => request<Summary>(`/api/forms/${id}/summary`),
  /** The CSV needs the Authorization header, so it is fetched (not a plain <a href>) and saved as a Blob. */
  downloadCsv: async (id: number): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/forms/${id}/responses.csv`, { headers: authHeader(), cache: "no-store" });
    } catch {
      throw new ApiError(0, "Can't reach the server. Is the backend running?");
    }
    if (!res.ok) throw new ApiError(res.status, "Couldn't export the responses");
    return res.blob();
  },
};
