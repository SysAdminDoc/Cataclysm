import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlossaryTip } from "../GlossaryTip";
import { I18nProvider } from "../../lib/i18n";

describe("GlossaryTip", () => {
  it("uses instance-unique tooltip relationships for repeated terms", () => {
    const { container } = render(
      <>
        <GlossaryTip term="mw">First magnitude</GlossaryTip>
        <GlossaryTip term="mw">Second magnitude</GlossaryTip>
      </>,
    );
    const tips = [...container.querySelectorAll<HTMLElement>(".glossary-tip")];
    fireEvent.mouseEnter(tips[0]);
    fireEvent.mouseEnter(tips[1]);

    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips).toHaveLength(2);
    expect(tooltips[0].id).not.toBe(tooltips[1].id);
    expect(tips[0]).toHaveAttribute("aria-describedby", tooltips[0].id);
    expect(tips[1]).toHaveAttribute("aria-describedby", tooltips[1].id);
  });

  it("renders glossary content in the persisted interface language", () => {
    localStorage.setItem("tsunamisim.locale", JSON.stringify("ja"));
    const { container } = render(
      <I18nProvider><GlossaryTip term="mw">Mw</GlossaryTip></I18nProvider>,
    );
    fireEvent.mouseEnter(container.querySelector(".glossary-tip") as HTMLElement);
    expect(screen.getByRole("tooltip")).toHaveTextContent("モーメントマグニチュード");
  });
});
