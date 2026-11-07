"use client";

import { labelCategory } from "@/lib/finance";
import { refreshTextForDisplay } from "@/lib/refresh-status";

export interface CategoryFilterProps {
  categories: string[];
  value: string;
  hidden: boolean;
  onChange: (category: string) => void;
  label: string;
  allLabel: string;
  className?: string;
}

/** Raw categories remain in caller state. Native option values are local opaque
 * indices, so masking a monetary category label also protects DOM attributes. */
export default function CategoryFilter({ categories, value, hidden, onChange, label, allLabel, className }: CategoryFilterProps) {
  const index = categories.indexOf(value);
  const missing = value !== "all" && index < 0;
  const selected = value === "all" ? "all" : missing ? "missing" : `category-${index}`;
  const displayed = (category: string) => refreshTextForDisplay(labelCategory(category), hidden);
  return <select className={className} aria-label={refreshTextForDisplay(label, hidden)} value={selected} onChange={event => {
    const next = event.target.value;
    if (next === "all") { onChange("all"); return; }
    const match = /^category-(0|[1-9]\d*)$/.exec(next);
    if (!match) return;
    const nextIndex = Number(match[1]);
    if (Number.isSafeInteger(nextIndex) && nextIndex < categories.length) onChange(categories[nextIndex]);
  }}>
    <option value="all">{refreshTextForDisplay(allLabel, hidden)}</option>
    {missing && <option value="missing" disabled>{displayed(value)} · unavailable in this list</option>}
    {categories.map((category, optionIndex) => <option key={optionIndex} value={`category-${optionIndex}`}>{displayed(category)}</option>)}
  </select>;
}
