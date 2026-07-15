import { useEffect, useId, useRef, useState } from "react";
import { UiIcon } from "./UiIcon";

type SliderConfig = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  valueText: string;
};

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number | "any";
  onCommit: (value: number) => void;
  unit?: string;
  help?: string;
  layout: "scenario" | "hazard";
  slider?: SliderConfig;
};

function validationMessage(label: string, draft: string, min: number, max: number): string | null {
  const parsed = Number(draft);
  if (draft.trim() === "" || !Number.isFinite(parsed)) return `${label} must be a number.`;
  if (parsed < min || parsed > max) return `${label} must be between ${min} and ${max}.`;
  return null;
}

/** A number entry and optional coarse slider with one semantic field boundary.
 * The exact draft stays local so invalid text can be explained without changing
 * the last valid scientific input held by the parent. */
export function NumericField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  unit,
  help,
  layout,
  slider,
}: Props) {
  const baseId = useId();
  const numberId = `${baseId}-number`;
  const labelId = `${baseId}-label`;
  const exactId = `${baseId}-exact`;
  const sliderId = `${baseId}-slider`;
  const sliderLabelId = `${baseId}-slider-label`;
  const boundsId = `${baseId}-bounds`;
  const unitId = `${baseId}-unit`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const [draft, setDraft] = useState(() => String(value));
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numberFocused = useRef(false);

  useEffect(() => {
    if (!numberFocused.current) setDraft(String(value));
  }, [value]);

  const descriptions = [boundsId, unit ? unitId : null, helpOpen && help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  function commit() {
    const nextError = validationMessage(label, draft, min, max);
    if (nextError) {
      setError(nextError);
      return;
    }
    const parsed = Number(draft);
    setError(null);
    onCommit(parsed);
    setDraft(String(parsed));
  }

  const exactInput = (
    <span className={layout === "hazard" ? "hazard__num" : "scenario-field__exact"}>
      <span id={exactId} className="sr-only">exact value</span>
      <input
        id={numberId}
        type="number"
        className={layout === "hazard" ? "hazard__number" : undefined}
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-labelledby={`${labelId} ${exactId}`}
        aria-describedby={descriptions}
        aria-invalid={error ? "true" : "false"}
        aria-errormessage={error ? errorId : undefined}
        onFocus={() => { numberFocused.current = true; }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          numberFocused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {unit && <span id={unitId} className={layout === "hazard" ? "hazard__num-unit" : "scenario-field__unit"}>{unit}</span>}
    </span>
  );

  const sliderInput = slider ? (
    <>
      <span id={sliderLabelId} className="sr-only">coarse slider</span>
      <input
        id={sliderId}
        type="range"
        className={layout === "hazard" ? "hazard__slider" : "scenario-field__slider"}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        value={slider.value}
        aria-labelledby={`${labelId} ${sliderLabelId}`}
        aria-describedby={descriptions}
        aria-valuetext={slider.valueText}
        onChange={(event) => {
          setError(null);
          slider.onChange(Number(event.target.value));
        }}
      />
    </>
  ) : null;

  const header = (
    <div className={layout === "hazard" ? "hazard__row-label" : "scenario-field__header"}>
      <label id={labelId} htmlFor={numberId}>{label}</label>
      <span
        id={boundsId}
        className={layout === "hazard" ? "sr-only" : "scenario-form__bound"}
      >
        {layout === "scenario" ? ` (${min} … ${max})` : `Allowed range: ${min} to ${max}.`}
      </span>
      {help && (
        <button
          type="button"
          className="scenario-field__help-btn"
          aria-label={`About ${label}`}
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((open) => !open)}
        >
          <UiIcon name="info" size={13} />
        </button>
      )}
    </div>
  );

  return (
    <div
      className={layout === "hazard" ? "hazard__row" : "scenario-field"}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={error ? `${boundsId} ${errorId}` : boundsId}
      data-invalid={error ? "true" : "false"}
    >
      {header}
      {help && (
        <div id={helpId} className="scenario-field__help-text" role="note" hidden={!helpOpen}>
          {help}
        </div>
      )}
      {layout === "hazard" ? (
        <>
          {sliderInput}
          {exactInput}
        </>
      ) : (
        <div className="scenario-field__inputs">
          {exactInput}
          {sliderInput}
        </div>
      )}
      {error && <div id={errorId} className={layout === "hazard" ? "hazard__number-error" : "scenario-field__error"} role="alert">{error}</div>}
    </div>
  );
}
