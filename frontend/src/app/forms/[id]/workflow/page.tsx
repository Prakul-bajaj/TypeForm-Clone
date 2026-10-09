"use client";
import { ArrowRight, Calculator, CornerDownRight, Plus, Trash2, Variable } from "lucide-react";
import { useMemo } from "react";
import { ComingSoon, TypeBadge } from "@/components/ui";
import { OPERATOR_LABELS, operatorsFor } from "@/lib/questionTypes";
import { useBuilder } from "@/lib/store";
import type { LogicRule, Question } from "@/lib/types";

function defaultValue(q: Question): string {
  if (q.type === "yes_no") return "yes";
  if (q.type === "rating") return "1";
  if (q.type === "multiple_choice" || q.type === "dropdown") return q.choices[0]?.label ?? "";
  return "";
}

function ValueInput({ q, rule, onChange }: { q: Question; rule: LogicRule; onChange: (v: string) => void }) {
  if (rule.operator === "is_answered" || rule.operator === "always") return null;
  if (q.type === "yes_no")
    return <select className="select" value={rule.value || "yes"} onChange={(e) => onChange(e.target.value)} aria-label="Value"><option value="yes">Yes</option><option value="no">No</option></select>;
  if (q.type === "rating")
    return (
      <select className="select" value={rule.value || "1"} onChange={(e) => onChange(e.target.value)} aria-label="Value">
        {Array.from({ length: Number(q.properties.steps) || 5 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
      </select>
    );
  if (q.type === "multiple_choice" || q.type === "dropdown") {
    const missing = rule.value !== "" && !q.choices.some((c) => c.label === rule.value);
    return (
      <select className={"select" + (missing ? " invalid" : "")} value={rule.value} onChange={(e) => onChange(e.target.value)} aria-label="Value">
        {missing && <option value={rule.value}>{rule.value} (removed)</option>}
        {q.choices.map((c) => <option key={c.key} value={c.label}>{c.label || "(empty choice)"}</option>)}
      </select>
    );
  }
  return <input className="input" type={q.type === "number" ? "number" : "text"} value={rule.value} placeholder="Value" onChange={(e) => onChange(e.target.value)} aria-label="Value" />;
}

export default function WorkflowPage() {
  const form = useBuilder((s) => s.form)!;
  const setLogic = useBuilder((s) => s.setLogic);
  const questions = useMemo(() => [...form.questions].sort((a, b) => a.position - b.position), [form.questions]);

  const addRule = (q: Question, i: number) => {
    const later = questions[i + 1];
    setLogic([
      ...form.logic,
      {
        source_question_id: q.id,
        operator: "equals",
        value: defaultValue(q),
        destination_type: later ? "question" : "end",
        destination_question_id: later?.id ?? null,
      },
    ]);
  };
  const patchRule = (idx: number, patch: Partial<LogicRule>) => setLogic(form.logic.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div className="plain-page wide">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>Workflow</h1>
          <p className="muted" style={{ maxWidth: 620 }}>
            Branch the conversation based on answers. Rules run top to bottom; the first one that matches wins. If none match, respondents continue to the next question.
            Jumps can only go forward.
          </p>
        </div>
      </div>

      <div className="flow">
        {questions.map((q, i) => {
          const rules = form.logic.map((r, idx) => ({ r, idx })).filter((x) => x.r.source_question_id === q.id);
          return (
            <section className="flow-card" key={q.id}>
              <header>
                <span className="row-num">{i + 1}</span>
                <TypeBadge type={q.type} size={24} />
                <span className={"flow-title" + (q.title ? "" : " untitled")}>{q.title || "Your question here"}</span>
                <button className="btn btn-sm" onClick={() => addRule(q, i)}><Plus size={14} /> Add rule</button>
              </header>
              {rules.length === 0 ? (
                <p className="flow-none"><CornerDownRight size={14} /> No rules — continues to {i + 1 < questions.length ? `question ${i + 2}` : "the thank-you screen"}.</p>
              ) : (
                <div className="rules">
                  {rules.map(({ r, idx }, n) => (
                    <div className="rule" key={idx}>
                      <span className="rule-if">{r.operator === "always" ? "Always" : n === 0 ? "If answer" : "Else if"}</span>
                      <select className="select" value={r.operator} aria-label="Condition"
                        onChange={(e) => patchRule(idx, { operator: e.target.value as LogicRule["operator"], value: ["always", "is_answered"].includes(e.target.value) ? "" : r.value || defaultValue(q) })}>
                        {operatorsFor(q.type).map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                      </select>
                      <ValueInput q={q} rule={r} onChange={(value) => patchRule(idx, { value })} />
                      <ArrowRight size={16} className="rule-arrow" />
                      <select className="select" aria-label="Jump to"
                        value={r.destination_type === "end" ? "end" : String(r.destination_question_id ?? "")}
                        onChange={(e) => e.target.value === "end"
                          ? patchRule(idx, { destination_type: "end", destination_question_id: null })
                          : patchRule(idx, { destination_type: "question", destination_question_id: Number(e.target.value) })}>
                        {questions.slice(i + 1).map((t, j) => <option key={t.id} value={t.id}>Jump to {i + j + 2}. {(t.title || "Your question here").slice(0, 40)}</option>)}
                        <option value="end">Jump to thank-you screen</option>
                      </select>
                      <button className="icon-btn" aria-label="Delete rule" onClick={() => setLogic(form.logic.filter((_, k) => k !== idx))}><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <p className="flow-none"><CornerDownRight size={14} /> Otherwise continues to {i + 1 < questions.length ? `question ${i + 2}` : "the thank-you screen"}.</p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="soon-list" style={{ marginTop: 24 }}>
        <ComingSoon icon={<Calculator size={20} />} title="Calculations & scoring" description="Add up points and show different endings." />
        <ComingSoon icon={<Variable size={20} />} title="Variables & hidden fields" description="Recall answers and URL parameters in your questions." />
      </div>
    </div>
  );
}
