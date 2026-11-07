"use client";

import type { ReactNode } from "react";
import { WorkspaceScene } from "./workspace-scene";
import { NeonEntryLight } from "./neon-entry";
import "./report-masthead.css";
import "./workspace-scene.css";
import "./neon-entry.css";

export type ReportMastheadMotif = "overview" | "analysis" | "planning" | "records" | "terminal";

export type ReportMastheadProps = {
  index: string;
  motionEnabled?: boolean;
  family: string;
  title: string;
  description: string;
  scope?: string;
  actions?: ReactNode;
  motionControl?: ReactNode;
  motif?: ReportMastheadMotif;
};

export function ReportMasthead({
  index,
  motionEnabled = false,
  family,
  title,
  description,
  scope,
  actions,
  motionControl,
  motif = "overview",
}: ReportMastheadProps) {
  return (
    <header className="report-masthead" data-motif={motif}>
      <WorkspaceScene variant={motif} sceneKey={index} enabled={motionEnabled}/>
      <NeonEntryLight entryKey={index} enabled={motionEnabled}/>

      <div className="report-masthead__content">
        <p className="report-masthead__kicker">
          <span className="report-masthead__index">{index}</span>
          <span className="report-masthead__rule" aria-hidden="true" />
          <span className="report-masthead__family">{family}</span>
        </p>

        <div className="report-masthead__body">
          <div className="report-masthead__copy">
            <h1 className="report-masthead__title">{title}</h1>
            <p className="report-masthead__description">{description}</p>
            {scope ? (
              <p className="report-masthead__scope">
                <span className="report-masthead__scope-label">Scope</span>
                <span className="report-masthead__scope-value">{scope}</span>
              </p>
            ) : null}
          </div>

          {actions ? <div className="report-masthead__actions">{actions}</div> : null}
        </div>
        {motionControl}
      </div>
    </header>
  );
}
