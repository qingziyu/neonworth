"use client";

import { TerminalRainBackdrop } from "./terminal-rain";
import { useWorkspaceMotion } from "./workspace-preferences";

/** A single layout sibling: report navigation and financial state never own it. */
export function WorkspaceBackground() {
 const {enabled}=useWorkspaceMotion();
 return <TerminalRainBackdrop enabled={enabled}/>;
}
