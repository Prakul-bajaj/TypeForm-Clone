"use client";
/**
 * Builder state (zustand).
 *
 *  - Every edit is applied to local state first (instant UI = optimistic update).
 *  - Text-like edits are debounced; structural edits (add / delete / duplicate / reorder)
 *    flush pending edits first and are sent immediately.
 *  - ALL network writes go through one serial queue, so they can never race each other.
 *  - Drag state lives in the component; only the final order is committed (one PUT on drop).
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api, ApiError, newKey } from "./api";
import { toast } from "./toast";
import type { FormDetail, LogicRule, Question, QuestionType, Settings, Theme } from "./types";

export type Selection = number | "welcome" | "ending" | null;
const DEBOUNCE_MS = 600;

export interface BuilderState {
  form: FormDetail | null;
  loading: boolean;
  error: string | null;
  selected: Selection;
  pending: number; // unsaved debounced edits + in-flight writes
  saveError: boolean;

  load: (id: number) => Promise<void>;
  reset: () => void;
  select: (s: Selection) => void;

  setTitle: (title: string) => void;
  setTheme: (theme: Theme) => void;
  setSettings: (settings: Settings) => void;
  addQuestion: (type: QuestionType, afterId?: number | null) => Promise<void>;
  updateQuestion: (id: number, patch: Partial<Omit<Question, "id" | "ref" | "position">>) => void;
  deleteQuestion: (id: number) => Promise<void>;
  duplicateQuestion: (id: number) => Promise<void>;
  reorder: (ids: number[]) => Promise<void>;
  setLogic: (rules: LogicRule[]) => void;
  publish: () => Promise<boolean>;
  unpublish: () => Promise<void>;
  flush: () => Promise<void>;
}

// ───── serial write queue + debounce plumbing (module scope: not React state) ─────
let chain: Promise<unknown> = Promise.resolve();
const timers = new Map<string, { t: ReturnType<typeof setTimeout>; run: () => Promise<void> }>();
let inflight = 0;

export const useBuilder = create<BuilderState>((set, get) => {
  const bump = () => set({ pending: timers.size + inflight });

  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    inflight++;
    bump();
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined).finally(() => {
      inflight--;
      bump();
    });
    return p;
  };

  const fail = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : "Something went wrong while saving";
    set({ saveError: true });
    toast.error(msg);
  };

  const debounced = (key: string, run: () => Promise<void>) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing.t);
    const fire = () => {
      timers.delete(key);
      enqueue(run).then(() => set({ saveError: false })).catch(fail);
    };
    timers.set(key, { t: setTimeout(fire, DEBOUNCE_MS), run: async () => fire() });
    bump();
  };

  const flushTimers = () => {
    for (const [, { t, run }] of [...timers]) {
      clearTimeout(t);
      run();
    }
  };

  /** Apply a server FormDetail but keep local copies of questions with unsaved edits. */
  const applyServer = (detail: FormDetail, opts: { keepLogic?: boolean } = {}) => {
    const cur = get().form;
    if (!cur) return set({ form: detail });
    const dirty = new Set([...timers.keys()].filter((k) => k.startsWith("q:")).map((k) => Number(k.slice(2))));
    const localById = new Map(cur.questions.map((q) => [q.id, q]));
    const questions = detail.questions.map((q) => (dirty.has(q.id) && localById.has(q.id) ? localById.get(q.id)! : q));
    const keepForm = timers.has("form");
    set({
      form: {
        ...detail,
        title: keepForm ? cur.title : detail.title,
        theme: keepForm ? cur.theme : detail.theme,
        settings: keepForm ? cur.settings : detail.settings,
        questions,
        logic: opts.keepLogic || timers.has("logic") ? cur.logic : detail.logic,
      },
    });
  };

  const markDirtyLocally = () => {
    const f = get().form;
    if (f && f.status === "published" && !f.has_unpublished_changes) set({ form: { ...f, has_unpublished_changes: true } });
  };

  const structural = async (op: (id: number) => Promise<FormDetail>, after?: (d: FormDetail) => void) => {
    const f = get().form;
    if (!f) return;
    flushTimers();
    try {
      const detail = await enqueue(() => op(f.id));
      applyServer(detail);
      after?.(detail);
      set({ saveError: false });
    } catch (e) {
      fail(e);
      // resync with the server so the UI never drifts from the truth
      try {
        applyServer(await api.getForm(f.id));
      } catch {
        /* ignore */
      }
    }
  };

  return {
    form: null,
    loading: true,
    error: null,
    selected: null,
    pending: 0,
    saveError: false,

    async load(id) {
      set({ loading: true, error: null, form: null, selected: null });
      try {
        const form = await api.getForm(id);
        set({ form, loading: false, selected: form.questions[0]?.id ?? null });
      } catch (e) {
        set({ loading: false, error: e instanceof ApiError ? e.message : "Failed to load the form" });
      }
    },

    reset() {
      for (const { t } of timers.values()) clearTimeout(t);
      timers.clear();
      set({ form: null, loading: true, error: null, selected: null, pending: 0, saveError: false });
    },

    select: (selected) => set({ selected }),

    setTitle(title) {
      const f = get().form;
      if (!f) return;
      set({ form: { ...f, title } });
      markDirtyLocally();
      debounced("form", async () => {
        const cur = get().form;
        if (!cur || !cur.title.trim()) return;
        await api.updateForm(cur.id, { title: cur.title, theme: cur.theme, settings: cur.settings });
      });
    },

    setTheme(theme) {
      const f = get().form;
      if (!f) return;
      set({ form: { ...f, theme } });
      markDirtyLocally();
      debounced("form", async () => {
        const cur = get().form!;
        await api.updateForm(cur.id, { title: cur.title, theme: cur.theme, settings: cur.settings });
      });
    },

    setSettings(settings) {
      const f = get().form;
      if (!f) return;
      set({ form: { ...f, settings } });
      markDirtyLocally();
      debounced("form", async () => {
        const cur = get().form!;
        await api.updateForm(cur.id, { title: cur.title, theme: cur.theme, settings: cur.settings });
      });
    },

    async addQuestion(type, afterId) {
      await structural(
        (id) => api.addQuestion(id, type, afterId),
        (d) => {
          // select the question that just appeared
          const old = new Set(get().form?.questions.map((q) => q.id));
          const created = d.questions.find((q) => !old.has(q.id)) ?? d.questions[d.questions.length - 1];
          set({ selected: created?.id ?? null });
        },
      );
    },

    updateQuestion(id, patch) {
      const f = get().form;
      if (!f) return;
      const local = (patch.choices ?? undefined)?.map((c) => ({ ...c, key: c.key || newKey() }));
      set({
        form: {
          ...f,
          questions: f.questions.map((q) => (q.id === id ? { ...q, ...patch, ...(local ? { choices: local } : {}) } : q)),
        },
      });
      markDirtyLocally();
      const immediate = patch.type !== undefined;
      const run = async () => {
        const cur = get().form?.questions.find((q) => q.id === id);
        if (!cur) return; // deleted meanwhile
        const saved = await api.patchQuestion(get().form!.id, id, {
          type: cur.type,
          title: cur.title,
          description: cur.description,
          required: cur.required,
          properties: cur.properties,
          ...(cur.type === "multiple_choice" || cur.type === "dropdown"
            ? { choices: cur.choices.map((c) => ({ id: c.id, label: c.label })) }
            : {}),
        });
        // Merge ONLY what the server decided (choice ids, normalised properties); never clobber newer typing.
        const now = get().form;
        if (!now) return;
        set({
          form: {
            ...now,
            questions: now.questions.map((q) => {
              if (q.id !== id) return q;
              const choices =
                q.choices.length === saved.choices.length
                  ? q.choices.map((c, i) => ({ ...c, id: c.id ?? saved.choices[i].id }))
                  : q.choices;
              // a type change replaces choices/properties server-side
              return q.type !== cur.type ? q : { ...q, choices, properties: timers.has(`q:${id}`) ? q.properties : saved.properties };
            }),
          },
        });
      };
      if (immediate) {
        // type changes alter choices/properties on the server: take the server's version straight away
        const existing = timers.get(`q:${id}`);
        if (existing) clearTimeout(existing.t);
        timers.delete(`q:${id}`);
        enqueue(async () => {
          await run();
          const fresh = await api.getForm(get().form!.id);
          applyServer(fresh);
        })
          .then(() => set({ saveError: false }))
          .catch(fail);
      } else {
        debounced(`q:${id}`, run);
      }
    },

    async deleteQuestion(id) {
      const f = get().form;
      if (!f) return;
      const idx = f.questions.findIndex((q) => q.id === id);
      await structural(
        (fid) => api.deleteQuestion(fid, id),
        (d) => {
          const next = d.questions[Math.min(idx, d.questions.length - 1)];
          set({ selected: next?.id ?? null });
        },
      );
    },

    async duplicateQuestion(id) {
      const f = get().form;
      if (!f) return;
      const old = new Set(f.questions.map((q) => q.id));
      await structural(
        (fid) => api.duplicateQuestion(fid, id),
        (d) => set({ selected: d.questions.find((q) => !old.has(q.id))?.id ?? get().selected }),
      );
    },

    async reorder(ids) {
      const f = get().form;
      if (!f) return;
      // optimistic: show the new order immediately
      const byId = new Map(f.questions.map((q) => [q.id, q]));
      set({ form: { ...f, questions: ids.map((id, i) => ({ ...byId.get(id)!, position: i })) } });
      markDirtyLocally();
      await structural((fid) => api.reorderQuestions(fid, ids));
    },

    setLogic(rules) {
      const f = get().form;
      if (!f) return;
      set({ form: { ...f, logic: rules } });
      markDirtyLocally();
      debounced("logic", async () => {
        const cur = get().form!;
        try {
          const detail = await api.replaceLogic(cur.id, cur.logic);
          set({ form: { ...get().form!, logic: detail.logic } });
        } catch (e) {
          // rejected (e.g. backward jump): restore the server's rules
          const detail = await api.getForm(cur.id);
          set({ form: { ...get().form!, logic: detail.logic } });
          throw e;
        }
      });
    },

    async flush() {
      flushTimers();
      await chain.catch(() => undefined);
    },

    async publish() {
      const f = get().form;
      if (!f) return false;
      await get().flush();
      try {
        const detail = await enqueue(() => api.publishForm(f.id));
        applyServer(detail);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.errors.length) {
          const first = e.errors[0];
          toast.error(first.message);
          if (first.question_id) set({ selected: first.question_id });
        } else {
          toast.error(e instanceof Error ? e.message : "Couldn't publish the form");
        }
        return false;
      }
    },

    async unpublish() {
      const f = get().form;
      if (!f) return;
      await get().flush();
      try {
        applyServer(await enqueue(() => api.unpublishForm(f.id)));
      } catch (e) {
        fail(e);
      }
    },
  };
});

/** True when it is safe to leave the page (nothing unsaved). */
export const hasUnsaved = () => timers.size + inflight > 0;

/** Select several fields at once (zustand v5 needs useShallow for object selectors). */
export function useBuilderPick<T>(selector: (s: BuilderState) => T): T {
  return useBuilder(useShallow(selector));
}
