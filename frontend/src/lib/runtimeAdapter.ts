import type { FormDetail, RuntimeForm } from "./types";

/** Turns the editable draft into the exact shape the public player consumes (live preview). */
export function toRuntime(form: FormDetail): RuntimeForm {
  const questions = [...form.questions].sort((a, b) => a.position - b.position);
  const refById = new Map(questions.map((q) => [q.id, q.ref]));
  return {
    public_id: form.public_id,
    title: form.title,
    theme: form.theme,
    settings: form.settings,
    preview: true,
    questions: questions.map((q) => ({
      ref: q.ref,
      type: q.type,
      title: q.title,
      description: q.description,
      required: q.required,
      properties: q.properties,
      choices: q.choices.map((c) => ({ label: c.label })),
      logic: form.logic
        .filter((r) => r.source_question_id === q.id)
        .map((r) => ({
          operator: r.operator,
          value: r.value,
          destination: r.destination_type === "end" ? "end" : refById.get(r.destination_question_id ?? -1) ?? "end",
        })),
    })),
  };
}
