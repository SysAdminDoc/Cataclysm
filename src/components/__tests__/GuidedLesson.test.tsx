import { render, screen, waitFor } from "@testing-library/react";
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
  story: {
    cues: [
      { target: "setup", panel: "setup", timeS: 0, playback: "pause" },
      { target: "solver", panel: "setup", runSolver: true },
    ],
  },
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

  it("drives real story cues in Follow mode and pauses them in Explore mode", async () => {
    const user = userEvent.setup();
    const onCue = vi.fn();
    render(<GuidedLesson lesson={LESSON} onClose={() => {}} onCue={onCue} />);

    await waitFor(() => expect(onCue).toHaveBeenCalledWith(LESSON.story.cues[0], "lesson-a", 0));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(onCue).toHaveBeenCalledWith(LESSON.story.cues[1], "lesson-a", 1));

    await user.click(screen.getByRole("button", { name: "Explore freely" }));
    await waitFor(() => expect(onCue).toHaveBeenLastCalledWith(null, "lesson-a", 1));
    expect(screen.getByText("Story controls paused — the simulator is yours")).toBeInTheDocument();
  });

  it("restores in-progress step and navigation mode", async () => {
    const user = userEvent.setup();
    const first = render(<GuidedLesson lesson={LESSON} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Explore freely" }));
    first.unmount();

    render(<GuidedLesson lesson={LESSON} onClose={() => {}} />);
    expect(screen.getByText("Step two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore freely" })).toHaveAttribute("aria-pressed", "true");
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
