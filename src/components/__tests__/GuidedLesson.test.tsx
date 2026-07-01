import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuidedLesson } from "../GuidedLesson";
import type { GuidedLesson as LessonDef } from "../../lib/guided-lessons";

const LESSON: LessonDef = {
  id: "lesson-a",
  title: "Lesson A",
  presetId: "chicxulub",
  summary: "A lesson summary.",
  steps: [
    { title: "Step one", body: "First step body." },
    { title: "Step two", body: "Second step body." },
  ],
};

describe("GuidedLesson", () => {
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
});
