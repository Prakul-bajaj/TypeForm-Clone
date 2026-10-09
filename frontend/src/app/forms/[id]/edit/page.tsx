"use client";
import Canvas from "@/components/builder/Canvas";
import QuestionList from "@/components/builder/QuestionList";
import SettingsPanel from "@/components/builder/SettingsPanel";

export default function ContentPage() {
  return (
    <div className="bd-grid">
      <QuestionList />
      <Canvas />
      <SettingsPanel />
    </div>
  );
}
