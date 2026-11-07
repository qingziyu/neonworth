"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { FinanceDialog, FinanceDialogClose, FinanceDialogDescription, FinanceDialogTitle } from "@/components/finance-dialog";

export type WorkspaceDestination = { name: string; label: string; description: string; href: string; group: string };

/** Search navigation metadata only. Financial records and editable drafts never enter this index. */
export function filterWorkspaceDestinations(destinations: WorkspaceDestination[], query: string) {
  const words = query.trim().toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  return destinations.filter(destination => words.every(word => `${destination.name} ${destination.label} ${destination.description} ${destination.group}`.toLocaleLowerCase("en-US").includes(word)));
}

export default function WorkspaceNavigation({ open, onDismiss, destinations, current, onSelect, onIntent, container, getReturnFocus }: {
  open: boolean; onDismiss: () => void; destinations: WorkspaceDestination[]; current: string;
  onSelect: (name: string) => void; onIntent: (name: string) => void;
  container: Element | null; getReturnFocus: () => HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const matches = filterWorkspaceDestinations(destinations, query);
  return <FinanceDialog open={open} busy={false} onDismiss={onDismiss} container={container} getReturnFocus={getReturnFocus} getFallbackFocus={() => document.getElementById("main-content")} className="modal workspace-navigation">
    <FinanceDialogTitle asChild><h2>Go to a workspace</h2></FinanceDialogTitle>
    <FinanceDialogDescription asChild><p>Find a report, your FIRE plan, or the records behind a number.</p></FinanceDialogDescription>
    <label className="workspace-search"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Find a workspace" placeholder="Try FIRE, transactions, or budget" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <FinanceDialogClose asChild><button className="modal-close icon-button" aria-label="Close workspace navigation"><X size={19}/></button></FinanceDialogClose>
    <nav aria-label="Workspace destinations" className="workspace-destinations">
      {matches.map(destination => <a key={destination.name} href={destination.href} aria-current={current === destination.name ? "page" : undefined} onFocus={() => onIntent(destination.name)} onPointerEnter={event => { if (event.pointerType === "mouse") onIntent(destination.name); }} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onDismiss(); onSelect(destination.name);
      }}><span><small>{destination.group}</small><strong>{destination.label}</strong><span>{destination.description}</span></span><ArrowUpRight size={17} aria-hidden="true"/></a>)}
    </nav>
    {!matches.length && <p role="status" className="workspace-no-match">No matching workspace. Try a report name or clear the search.</p>}
  </FinanceDialog>;
}
