import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tour } from "../Tour";

describe("Tour", () => {
  it("describes the current solver and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Tour open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/60-frame shallow-water simulation/i)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
