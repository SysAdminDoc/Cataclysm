import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedLesson } from "../GuidedLesson";
import { getGuidedLessons, type GuidedLesson as LessonDef } from "../../lib/guided-lessons";
import { I18nProvider } from "../../lib/i18n";

const LESSON: LessonDef = {
  id: "lesson-a",
  title: "Lesson A",
  presetId: "chicxulub",
  summary: "A lesson summary.",
  steps: [
    { title: "Step one", body: "First step body." },
    { title: "Step two", body: "Second step body." },
  ],
  worksheet: ["Question one?", "Question two?"],
};

describe("GuidedLesson", () => {
  beforeEach(() => localStorage.clear());

  it("marks completion only when the final step is done", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onComplete = vi.fn();

    render(<GuidedLesson lesson={LESSON} onClose={onClose} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onComplete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onComplete).toHaveBeenCalledWith("lesson-a");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuidedLesson lesson={LESSON} onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders translated lesson content and controls", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const lesson = getGuidedLessons("ja")[0];
    render(
      <I18nProvider>
        <GuidedLesson lesson={lesson} onClose={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "チクシュルーブ：大量絶滅を引き起こした津波" })).toBeInTheDocument();
    expect(screen.getByText("発生源：なぜ重要か")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次へ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "印刷" })).toBeInTheDocument();
  });
});
