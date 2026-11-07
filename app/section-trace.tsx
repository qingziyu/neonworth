/**
 * Fixed decorative circuit ornament for .page-heading.
 * Render with key={section} so only the ornament replays its finite reveal.
 */
export function SectionTrace() {
  return (
    <svg
      className="section-trace"
      viewBox="0 0 136 40"
      width="136"
      height="40"
      preserveAspectRatio="xMaxYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path className="section-trace__line section-trace__line--a" d="M6 28 H40 L52 16 H96" />
      <path className="section-trace__line section-trace__line--b" d="M40 28 L48 34 H120" />
      <path className="section-trace__line section-trace__line--c" d="M60 8 H84" />
      <rect className="section-trace__node section-trace__chip" x="96" y="10" width="14" height="12" rx="1" />
      <circle className="section-trace__node section-trace__node--a" cx="6" cy="28" r="2.5" />
      <circle className="section-trace__node section-trace__node--b" cx="120" cy="34" r="2.5" />
      <circle className="section-trace__node section-trace__node--c" cx="84" cy="8" r="2" />
    </svg>
  );
}

export default SectionTrace;
