type UiIconName =
  | "alert"
  | "check"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "copy"
  | "info"
  | "pause"
  | "play"
  | "refresh"
  | "reset"
  | "trash";

type Props = {
  name: UiIconName;
  size?: number;
  className?: string;
};

export function UiIcon({ name, size = 16, className }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (name === "alert") {
    return (
      <svg {...common}>
        <path d="M12 3 22 20H2L12 3Z" />
        <path d="M12 9v5" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }
  if (name === "chevronDown") {
    return (
      <svg {...common}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    );
  }
  if (name === "chevronRight") {
    return (
      <svg {...common}>
        <path d="m9 6 6 6-6 6" />
      </svg>
    );
  }
  if (name === "close") {
    return (
      <svg {...common}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg {...common}>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (name === "info") {
    return (
      <svg {...common}>
        <path d="M12 17v-6" />
        <path d="M12 7h.01" />
        <rect x="3" y="3" width="18" height="18" rx="4" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg {...common}>
        <path d="M8 5v14" />
        <path d="M16 5v14" />
      </svg>
    );
  }
  if (name === "play") {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M8 5v14l11-7L8 5Z" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 0 0-14.8-4" />
        <path d="M4 7V3h4" />
        <path d="M4 13a8 8 0 0 0 14.8 4" />
        <path d="M20 17v4h-4" />
      </svg>
    );
  }
  if (name === "reset") {
    return (
      <svg {...common}>
        <path d="M4 7h10a6 6 0 1 1-4.2 10.2" />
        <path d="M4 7l4-4" />
        <path d="M4 7l4 4" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M6 7l1 14h10l1-14" />
        <path d="M9 7V4h6v3" />
      </svg>
    );
  }

  return null;
}
