import { useMemo, useRef } from "react";
import type { RuleSeverity } from "@promptlint/shared";
import type { DiffMark } from "../lib/diff";
import { cx } from "./ui";
import { severityRank, severityStyles } from "./honesty";

const LINE_H = "leading-[20px]";

/** Textarea with a line-number gutter. Lines carrying diagnostics get a severity dot. */
export function CodeEditor({
  value,
  onChange,
  markers,
  className,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  markers?: Map<number, RuleSeverity>;
  className?: string;
  placeholder?: string;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  return (
    <div className={cx("relative flex overflow-hidden rounded-lg border border-ink-700 bg-ink-950 font-mono text-[12.5px]", className)}>
      <div
        ref={gutterRef}
        aria-hidden
        className={cx("select-none overflow-hidden border-r border-ink-800 bg-ink-900 py-3 text-right text-ink-500", LINE_H)}
      >
        {Array.from({ length: lineCount }, (_, i) => {
          const sev = markers?.get(i + 1);
          return (
            <div key={i} className="relative flex h-5 items-center justify-end pl-4 pr-3">
              {sev && <span className={cx("absolute left-1.5 size-1.5 rounded-full", severityStyles[sev].dot)} />}
              <span className={cx("tabular", sev && severityStyles[sev].text)}>{i + 1}</span>
            </div>
          );
        })}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder}
        className={cx(
          "min-h-0 flex-1 resize-none whitespace-pre bg-transparent px-3 py-3 text-ink-100 outline-none placeholder:text-ink-500",
          LINE_H
        )}
        style={{ tabSize: 2 }}
      />
    </div>
  );
}

/** Read-only code with line numbers and optional diff tinting. */
export function CodeView({
  code,
  marks,
  side,
  className,
  wrap
}: {
  code: string;
  marks?: DiffMark[];
  side?: "removed" | "added";
  className?: string;
  /** Soft-wrap long lines (prompts) instead of scrolling horizontally */
  wrap?: boolean;
}) {
  const lines = code.split("\n");
  return (
    <div className={cx("overflow-auto rounded-lg border border-ink-700 bg-ink-950 font-mono text-[12.5px]", className)}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const changed = marks?.[i] === "changed" && line.trim() !== "";
            return (
              <tr
                key={i}
                className={cx(
                  changed && side === "removed" && "bg-red-500/10",
                  changed && side === "added" && "bg-emerald-500/10"
                )}
              >
                <td
                  className={cx(
                    "tabular w-px select-none whitespace-nowrap border-r border-ink-800 pl-3 pr-2 text-right align-top text-ink-500",
                    LINE_H
                  )}
                >
                  {i + 1}
                </td>
                <td className={cx("w-4 select-none pl-1.5 align-top", LINE_H, side === "removed" ? "text-red-400" : "text-emerald-400")}>
                  {changed ? (side === "removed" ? "−" : "+") : ""}
                </td>
                <td className={cx(wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", "pr-4 align-top text-ink-200", LINE_H)}>{line || " "}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function worstSeverityByLine(diags: Array<{ line: number; severity: RuleSeverity }>): Map<number, RuleSeverity> {
  const map = new Map<number, RuleSeverity>();
  for (const d of diags) {
    const cur = map.get(d.line);
    if (!cur || severityRank[d.severity] < severityRank[cur]) map.set(d.line, d.severity);
  }
  return map;
}
