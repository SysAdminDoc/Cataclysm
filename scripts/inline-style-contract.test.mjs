import assert from "node:assert/strict";
import test from "node:test";
import { findInlineStyleViolations } from "./inline-style-contract.mjs";

test("rejects application-owned inline style APIs", () => {
  const source = `
    <div style={{ transform: "scale(1)" }} />;
    node.style.cursor = "help";
    node.setAttribute("style", "display:none");
    document.createElement("style");
  `;
  assert.deepEqual(
    findInlineStyleViolations(source).map(({ rule }) => rule),
    ["JSX style attribute", "DOM style mutation", "style attribute mutation", "runtime style element"],
  );
});

test("accepts declarative attributes, SVG transforms, and class-based styling", () => {
  const source = `
    <div className="progress" data-progress={progress} />;
    <g transform={\`rotate(\${heading} 18 18)\`} />;
    node.classList.toggle("cursor--pick", active);
  `;
  assert.deepEqual(findInlineStyleViolations(source), []);
});
