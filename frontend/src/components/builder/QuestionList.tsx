"use client";
import {
  closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, EllipsisVertical, Flag, GripVertical, HandMetal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { MenuButton, TypeBadge } from "@/components/ui";
import { useBuilder, useBuilderPick } from "@/lib/store";
import type { Question } from "@/lib/types";
import AddContentModal from "./AddContentModal";

function RowBody({ q, index, selected, ghost }: { q: Question; index: number; selected: boolean; ghost?: boolean }) {
  return (
    <>
      <span className="row-num">{index + 1}</span>
      <TypeBadge type={q.type} size={24} />
      <span className={"row-title" + (q.title ? "" : " untitled")}>{q.title || "Your question here"}</span>
      {q.required && !ghost && <span className="row-req" title="Required">*</span>}
    </>
  );
}

function SortableRow({ q, index }: { q: Question; index: number }) {
  const { selected, select, duplicateQuestion, deleteQuestion } = useBuilderPick((s) => ({
    selected: s.selected, select: s.select, duplicateQuestion: s.duplicateQuestion, deleteQuestion: s.deleteQuestion,
  }));
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const isSel = selected === q.id;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={"qrow" + (isSel ? " selected" : "") + (isDragging ? " dragging" : "")}
      onClick={() => select(q.id)}
    >
      <button ref={setActivatorNodeRef} className="grip" aria-label={`Reorder question ${index + 1}`} {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
        <GripVertical size={14} />
      </button>
      <button className="qrow-main" onClick={() => select(q.id)} aria-current={isSel}>
        <RowBody q={q} index={index} selected={isSel} />
      </button>
      <MenuButton
        label={`Question ${index + 1} options`}
        trigger={<EllipsisVertical size={16} />}
        items={[
          { label: "Duplicate", icon: <Copy size={15} />, onClick: () => duplicateQuestion(q.id) },
          { label: "Delete", icon: <Trash2 size={15} />, danger: true, divider: true, onClick: () => deleteQuestion(q.id) },
        ]}
      />
    </li>
  );
}

export default function QuestionList() {
  const form = useBuilder((s) => s.form)!;
  const { selected, select, reorder, addQuestion, setSettings } = useBuilderPick((s) => ({
    selected: s.selected, select: s.select, reorder: s.reorder, addQuestion: s.addQuestion, setSettings: s.setSettings,
  }));
  const [picker, setPicker] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  const questions = [...form.questions].sort((a, b) => a.position - b.position);
  const ids = questions.map((q) => q.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // ONE semantic move on drop — nothing is persisted while dragging
    reorder(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))));
  };

  const welcome = form.settings.welcome;
  const activeQ = questions.find((q) => q.id === activeId);
  const afterId = typeof selected === "number" ? selected : questions[questions.length - 1]?.id ?? null;

  return (
    <aside className="bd-left" aria-label="Form outline">
      <div className="bd-left-head">
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setPicker(true)}><Plus size={16} /> Add content</button>
      </div>

      <div className="bd-left-scroll">
        {welcome.enabled ? (
          <ul className="qlist single">
            <li className={"qrow" + (selected === "welcome" ? " selected" : "")} onClick={() => select("welcome")}>
              <span className="grip ph" />
              <button className="qrow-main"><span className="row-num"><HandMetal size={14} /></span><span className="row-title">Welcome screen</span></button>
              <MenuButton label="Welcome screen options" trigger={<EllipsisVertical size={16} />}
                items={[{ label: "Remove welcome screen", icon: <Trash2 size={15} />, danger: true, onClick: () => { setSettings({ ...form.settings, welcome: { ...welcome, enabled: false } }); select(questions[0]?.id ?? null); } }]} />
            </li>
          </ul>
        ) : (
          <button className="ghost-add" onClick={() => { setSettings({ ...form.settings, welcome: { ...welcome, enabled: true } }); select("welcome"); }}>
            <Plus size={14} /> Add welcome screen
          </button>
        )}

        <div className="list-label">Questions</div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e: DragStartEvent) => setActiveId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="qlist">
              {questions.map((q, i) => <SortableRow key={q.id} q={q} index={i} />)}
            </ul>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 180 }}>
            {activeQ ? (
              <div className="qrow overlay"><span className="grip"><GripVertical size={14} /></span><span className="qrow-main"><RowBody q={activeQ} index={ids.indexOf(activeQ.id)} selected ghost /></span></div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <button className="ghost-add" onClick={() => setPicker(true)}><Plus size={14} /> Add question</button>

        <div className="list-label">Ending</div>
        <ul className="qlist single">
          <li className={"qrow" + (selected === "ending" ? " selected" : "")} onClick={() => select("ending")}>
            <span className="grip ph" />
            <button className="qrow-main"><span className="row-num"><Flag size={14} /></span><span className="row-title">{form.settings.ending.title || "Thank-you screen"}</span></button>
          </li>
        </ul>
      </div>

      <AddContentModal open={picker} onClose={() => setPicker(false)} onPick={(t) => addQuestion(t, afterId)} />
    </aside>
  );
}
