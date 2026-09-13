const CELLS = [
  { severity: "BREAKING", call: "hook", title: "Breaking" },
  { severity: "DEPRECATION", call: "cell", title: "Deprecation" },
  { severity: "BEHAVIORAL", call: "echo", title: "Behavioral" },
  { severity: "ADDITIVE", call: "clear", title: "Additive" },
] as const;

/** The reflectivity legend. Always visible; severity is a scale, not a tag. */
export function Scale() {
  return (
    <ol className="scale" aria-label="Severity scale, strongest return first">
      {CELLS.map((cell) => (
        <li key={cell.severity} data-severity={cell.severity} title={cell.title}>
          {cell.call}
        </li>
      ))}
    </ol>
  );
}
