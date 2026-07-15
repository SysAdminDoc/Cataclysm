import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { TrustEvidence } from "../../lib/trust-evidence";
import { TrustDisclosure } from "../TrustDisclosure";

const evidence: TrustEvidence = {
  id: "result:preset:test:outcome",
  title: "Test outcome",
  sourceTitle: "Test source",
  model: "Test model",
  version: "test-1.0.0",
  confidence: "Reference inputs; modelled outcome",
  tone: "reference",
  assumptions: ["One documented assumption."],
  limitations: ["One documented limitation."],
  citations: [
    { label: "Approved HTTPS", url: "https://doi.org/10.1029/2021AV000627" },
    { label: "Legacy paper", url: "http://www.tsunamisociety.org/213choi.pdf" },
    { label: "Blocked publisher", url: "https://www.science.org/" },
    { label: "Local bibliography entry" },
  ],
};

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("TrustDisclosure", () => {
  it("exposes model, version, assumptions, limitations, exact citations, and evidence ID", async () => {
    const user = userEvent.setup();
    render(<TrustDisclosure evidence={evidence} />);

    const summary = screen.getByText("Why trust this?");
    expect(summary.closest("summary")).toHaveAccessibleName("Why trust this? Test outcome");
    await user.click(summary);

    expect(screen.getByText("Test model")).toBeInTheDocument();
    expect(screen.getByText("test-1.0.0")).toBeInTheDocument();
    expect(screen.getByText("One documented assumption.")).toBeInTheDocument();
    expect(screen.getByText("One documented limitation.")).toBeInTheDocument();
    expect(screen.getByText("result:preset:test:outcome")).toBeInTheDocument();
    expect(screen.getByText("Legacy HTTP")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Bibliography")).toBeInTheDocument();
  });

  it("keeps citations visible and labels external links while offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const user = userEvent.setup();
    render(<TrustDisclosure evidence={{ ...evidence, citations: [evidence.citations[0]] }} />);
    await user.click(screen.getByText("Why trust this?"));

    expect(screen.getByText("Approved HTTPS")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Approved HTTPS" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");
  });

  it("reports a blocked citation without hiding its title", async () => {
    const user = userEvent.setup();
    render(<TrustDisclosure evidence={{ ...evidence, citations: [evidence.citations[2]] }} />);
    await user.click(screen.getByText("Why trust this?"));
    await user.click(screen.getByRole("button", { name: "Blocked publisher" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/not in the allowlist/i);
  });
});
