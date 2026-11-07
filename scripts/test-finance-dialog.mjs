// Focused regressions for the Radix-backed FinanceDialog adapter and its two integrations.
// No network, no new dependencies: TypeScript (already a devDependency) transpiles the adapter
// into .sites-runtime, then React's server renderer checks the generated markup.
//
// Boundary: server rendering cannot establish real focus trapping, Tab/Shift+Tab order, Escape,
// outside-click, scroll locking, focus return or the live aria-labelledby/aria-describedby
// associations (Radix adds them after client mount). Those require the root's real-browser checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "radix-ui";

const root = new URL("../", import.meta.url);
const adapterSource = await readFile(new URL("components/finance-dialog.tsx", root), "utf8");
const pageSource = await readFile(new URL("app/page.tsx", root), "utf8");
const outDir = new URL(".sites-runtime/test-finance-dialog/", root);
await mkdir(outDir, { recursive: true });
const compiled = ts.transpileModule(adapterSource, {
  fileName: "finance-dialog.tsx",
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
}).outputText;
const outFile = new URL("finance-dialog.mjs", outDir);
await writeFile(outFile, compiled);
const adapter = await import(`${outFile.href}?v=${Date.now()}`);
const { FinanceDialogSurface, FinanceDialogTitle, FinanceDialogDescription, FinanceDialogClose, guardedOpenChange, preventWhileBusy, recoverBusyDialogFocus, isOverlayScrollbarPointer, canReturnFocusTo, resolveReturnFocus, resolveDialogReturnFocus } = adapter;

test("ledger Enter consumes the key before opening a dialog; unrelated keys remain native", () => {
  // Exercise the actual JSX handler, not a duplicate policy helper. Opening the
  // dialog moves focus to its Close button during the same keyboard activation.
  const pageAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(pageAst) === "tr") {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(pageAst) === "onKeyDown" && ts.isJsxExpression(attribute.initializer)) handlers.push(attribute.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(pageAst);
  assert.equal(handlers.length, 1, "the focused ledger row has one keyboard handler");
  const code = ts.transpileModule(`const handle = (${handlers[0].getText(pageAst)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const row = { id: "synthetic-keyboard-row" }, calls = [];
  const handle = new Function("editTransaction", "row", `${code}\nreturn handle;`)(value => { assert.equal(value, row); calls.push("open"); }, row);
  handle({ key: "Enter", preventDefault() { calls.push("prevent"); } });
  assert.deepEqual(calls, ["prevent", "open"], "prevent the native activation before focus moves into the dialog");
  for (const key of ["Tab", "Escape", " ", "ArrowDown"]) {
    calls.length = 0;
    handle({ key, preventDefault() { calls.push("prevent"); } });
    assert.deepEqual(calls, [], `${key} keeps its native behavior`);
  }
});

function render({ busy = false, hasDescription = true, title = "Coffee shop", description = "Food & dining · Checking" } = {}) {
  return renderToStaticMarkup(h(Dialog.Root, { open: true, onOpenChange() {} },
    h(FinanceDialogSurface, { busy, hasDescription, className: "modal transaction-review-modal" },
      h(FinanceDialogClose, { asChild: true }, h("button", { className: "modal-close icon-button", disabled: busy, "aria-label": "Close transaction editor" }, "×")),
      h("div", { className: "eyebrow" }, "TRANSACTION DETAILS"),
      h(FinanceDialogTitle, { asChild: true }, h("h2", null, title)),
      hasDescription ? h(FinanceDialogDescription, { asChild: true }, h("p", { className: "subtle" }, description)) : null,
      h("div", { className: "edit-amount" }, "••••"),
      h("div", { className: "modal-actions" }, h(FinanceDialogClose, { asChild: true }, h("button", { className: "button light", disabled: busy }, "Cancel"))),
    )));
}
const attr = (html, name) => html.match(new RegExp(`role="dialog"[^>]*?\\s${name}="([^"]*)"|\\s${name}="([^"]*)"[^>]*?role="dialog"`))?.slice(1).find(Boolean) ?? null;

test("dialog content nests inside the warm overlay and keeps existing modal classes", () => {
  const html = render();
  const overlayAt = html.indexOf('class="modal-overlay"');
  const contentAt = html.indexOf('class="modal transaction-review-modal"');
  assert.ok(overlayAt >= 0, "overlay uses .modal-overlay");
  assert.ok(contentAt > overlayAt, "content is nested inside the overlay (Radix scrollable-overlay shape)");
  assert.match(html, /role="dialog"/);
  // The close icon and Cancel stay direct children so `.transaction-review-modal>.modal-actions` and `.modal-close` styles apply.
  assert.match(html, /class="modal transaction-review-modal"[^>]*><button[^>]*class="modal-close icon-button"/);
});

// Installed @radix-ui/react-dialog (1.3.1) gives Title/Description generated ids during SSR, but registers
// their presence in useLayoutEffect, so aria-labelledby/aria-describedby only appear after client mount.
// These tests assert what SSR actually produces; the live associations are a root browser check.
const headingWithId = (html, tag) => html.match(new RegExp(`<${tag}[^>]*\\sid="([^"]+)"[^>]*>([^<]*)</${tag}>`));

test("Title and Description render the existing masked h2/p with generated (non-legacy) ids", () => {
  const html = render({ title: "Refund ••••", description: "Shopping · •••• credit" });
  const title = headingWithId(html, "h2"), description = headingWithId(html, "p");
  assert.ok(title, "the heading is an h2 with a generated id");
  assert.equal(title[2], "Refund ••••");
  assert.notEqual(title[1], "edit-title", "no hard-coded legacy id");
  assert.ok(description, "the subtitle is a p with a generated id");
  assert.equal(description[2], "Shopping · •••• credit");
  assert.notEqual(title[1], description[1]);
  assert.doesNotMatch(title[2] + description[2], /\$\d/, "no amount-shaped text in the heading/subtitle");
  assert.doesNotMatch(html, /class="edit-amount"[^>]*\sid=/, "the amount line is not given a Title/Description id");
});

test("without a subtitle no description element is rendered and SSR emits no aria-describedby", () => {
  const html = render({ hasDescription: false });
  assert.equal(headingWithId(html, "p"), null, "no description paragraph");
  assert.equal(attr(html, "aria-describedby"), null);
  assert.ok(headingWithId(html, "h2"), "the title is still rendered");
});

test("aria-busy reflects busy, and Close/Cancel render disabled while busy", () => {
  assert.equal(attr(render({ busy: false }), "aria-busy"), "false");
  const busyHtml = render({ busy: true });
  assert.equal(attr(busyHtml, "aria-busy"), "true");
  assert.match(busyHtml, /<button[^>]*disabled=""[^>]*aria-label="Close transaction editor"|<button[^>]*aria-label="Close transaction editor"[^>]*disabled=""/);
  assert.match(busyHtml, /<button[^>]*class="button light"[^>]*disabled=""[^>]*>Cancel<|<button[^>]*disabled=""[^>]*class="button light"[^>]*>Cancel</);
});

test("busy guard rejects every dismissal path but allows dismissal when idle", () => {
  let dismissed = 0;
  guardedOpenChange(true, () => dismissed++)(false);
  assert.equal(dismissed, 0, "Escape/outside/Close requests are ignored while busy");
  guardedOpenChange(false, () => dismissed++)(true);
  assert.equal(dismissed, 0, "open requests never call onDismiss");
  guardedOpenChange(false, () => dismissed++)(false);
  assert.equal(dismissed, 1);
  const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  const busyEvent = event(); preventWhileBusy(true)(busyEvent); assert.equal(busyEvent.prevented, true);
  const idleEvent = event(); preventWhileBusy(false)(idleEvent); assert.equal(idleEvent.prevented, false);
});

test("entering busy recovers disabled or escaped focus once without disturbing valid dialog focus", () => {
  const document = { activeElement: null }, focused = [], members = new Set();
  const content = {
    ownerDocument: document,
    contains(element) { return members.has(element); },
    matches() { return false; },
    focus(options) { focused.push(options); document.activeElement = content; },
  };
  const enabled = { matches: () => false }, disabled = { matches: selector => selector === ":disabled" };
  members.add(content); members.add(enabled); members.add(disabled);
  for (const active of [null, { name: "BODY" }, { name: "outside focus guard" }, disabled]) {
    document.activeElement = active; focused.length = 0;
    recoverBusyDialogFocus(false, true, content);
    assert.deepEqual(focused, [{ preventScroll: true }]);
    assert.equal(document.activeElement, content, "the dialog itself remains a stable focus target while controls are disabled");
  }
  for (const active of [enabled, content]) {
    document.activeElement = active; focused.length = 0;
    recoverBusyDialogFocus(false, true, content);
    assert.deepEqual(focused, [], "valid focus inside the dialog is retained");
  }
  document.activeElement = { name: "BODY" }; focused.length = 0;
  for (const [wasBusy, busy] of [[false, false], [true, false], [true, true]]) recoverBusyDialogFocus(wasBusy, busy, content);
  recoverBusyDialogFocus(false, true, null);
  assert.deepEqual(focused, [], "idle, completion, repeated busy renders and an absent dialog do not move focus");
});

test("overlay scrollbar presses are not outside clicks; ordinary overlay presses are", () => {
  const overlay = { clientWidth: 1000, clientHeight: 700 };
  assert.equal(isOverlayScrollbarPointer({ target: overlay, offsetX: 1005, offsetY: 10 }, overlay), true);
  assert.equal(isOverlayScrollbarPointer({ target: overlay, offsetX: 40, offsetY: 30 }, overlay), false);
  assert.equal(isOverlayScrollbarPointer({ target: {}, offsetX: 1005, offsetY: 10 }, overlay), false);
  assert.equal(isOverlayScrollbarPointer({ target: overlay, offsetX: 1005 }, null), false);
});

test("focus returns to a connected opener, else to the fallback, never to hidden/inert/body targets", () => {
  const body = { tag: "body" };
  const node = (extra = {}) => ({ isConnected: true, focus() {}, closest: () => null, getClientRects: () => ({ length: 1 }), ownerDocument: { body }, ...extra });
  const row = node(), main = node({ id: "main-content" });
  assert.equal(resolveReturnFocus(row, () => main), row);
  assert.equal(resolveReturnFocus(node({ isConnected: false }), () => main), main, "removed ledger row");
  assert.equal(resolveReturnFocus(node({ getClientRects: () => ({ length: 0 }) }), () => main), main, "hidden file input is not focused");
  assert.equal(resolveReturnFocus(node({ closest: selector => selector === "[inert]" ? {} : null }), () => main), main);
  assert.equal(resolveReturnFocus(node({ disabled: true }), () => main), main);
  assert.equal(resolveReturnFocus(null, () => main), main);
  const bodyLike = node(); bodyLike.ownerDocument = { body: bodyLike };
  assert.equal(canReturnFocusTo(bodyLike), false, "document.body after a non-focusing click");
  assert.equal(resolveReturnFocus(null, () => null), null);
});

test("an explicit return target (visible import button) wins over the recorded opener, with fallbacks", () => {
  const body = { tag: "body" };
  const node = (extra = {}) => ({ isConnected: true, focus() {}, closest: () => null, getClientRects: () => ({ length: 1 }), ownerDocument: { body }, ...extra });
  const importButton = node(), hiddenInput = node({ getClientRects: () => ({ length: 0 }) }), row = node(), main = node();
  assert.equal(resolveDialogReturnFocus(importButton, hiddenInput, () => main), importButton);
  assert.equal(resolveDialogReturnFocus(importButton, body, () => main), importButton, "body as activeElement after async file selection");
  assert.equal(resolveDialogReturnFocus(null, row, () => main), row, "ledger path: no explicit target, recorded row used");
  assert.equal(resolveDialogReturnFocus(node({ isConnected: false }), hiddenInput, () => main), main, "welcome-panel button removed after import");
});

test("page integration: both dialogs use the adapter and the custom dialog key/focus loop is gone", () => {
  assert.match(pageSource, /from "@\/components\/finance-dialog"/);
  assert.equal((pageSource.match(/<FinanceDialog\s/g) || []).length, 2, "exactly the editor and import confirmation");
  assert.doesNotMatch(pageSource, /querySelector<HTMLElement>\('\[role="dialog"\]'\)/, "custom dialog loop removed");
  assert.doesNotMatch(pageSource, /aria-labelledby="(edit|import)-title"/);
  assert.doesNotMatch(pageSource, /id="(edit|import)-title"/);
  // Mobile navigation keeps its own trap.
  assert.match(pageSource, /getElementById\("main-navigation"\)/);
  // Editor: masked title/subtitle variables feed Title/Description; amount stays outside them.
  assert.match(pageSource, /<FinanceDialogTitle asChild><h2>\{title\}<\/h2><\/FinanceDialogTitle>\{subtitle&&<FinanceDialogDescription asChild><p className="subtle">\{subtitle\}<\/p><\/FinanceDialogDescription>\}/);
  assert.match(pageSource, /const title=mask\(description\.title\),subtitle=mask\(description\.subtitle\);/, "TransactionIdentity masking unchanged");
  assert.match(pageSource, /hasDescription=\{!!editSubtitle\}/);
  // Busy protection and lifecycle.
  assert.match(pageSource, /<FinanceDialog open=\{!!edit\} busy=\{busy\} onDismiss=\{\(\)=>setEdit\(null\)\}/);
  assert.match(pageSource, /<FinanceDialog open=\{!!confirmImport\} busy=\{busy\} onDismiss=\{\(\)=>setConfirmImport\(null\)\}/);
  assert.match(pageSource, /<FinanceDialogClose asChild><button className="modal-close icon-button" disabled=\{busy\}/);
  assert.equal((pageSource.match(/<FinanceDialogClose asChild><button className="button light" disabled=\{busy\}>Cancel<\/button><\/FinanceDialogClose>/g) || []).length, 2, "both Cancel buttons disabled while busy");
  assert.match(pageSource, /onClick=\{onImport\} disabled=\{!ALLOW_IMPORT\|\|busy\}/);
  assert.match(pageSource, /<ImportConfirmation dataset=\{confirmImport\} busy=\{busy\} feedback=\{importFeedback\} onImport=\{importData\}\/>/);
  // Import failure feedback: cleared on a new file or retry; set only while the confirmation is still open.
  assert.match(pageSource, /const pickImport=async\(e:React\.ChangeEvent<HTMLInputElement>\)=>\{if\(!ALLOW_IMPORT\)\{e\.target\.value="";return;\}setImportFeedback\(""\);/);
  assert.match(pageSource, /setBusy\(true\);setImportFeedback\(""\);let applied=false;/);
  assert.match(pageSource, /applied=true;setConfirmImport\(null\);/);
  assert.match(pageSource, /if\(!applied\)setImportFeedback\(message\);tell\(message\)/);
  // Import return focus: the visible button that started file selection.
  assert.match(pageSource, /getReturnFocus=\{\(\)=>importOpener\.current\}/);
  assert.equal((pageSource.match(/chooseImportFile\(event\.currentTarget\)|onImport=\{chooseImportFile\}/g) || []).length, 2, "welcome and Accounts & data import buttons");
  // Note field: masked display, raw draft retained.
  assert.match(pageSource, /<TransactionNoteField note=\{editorState\.displayedNote\} hidden=\{hidden\} busy=\{busy\} onChange=\{note=>setDraft\(\{\.\.\.draft,note\}\)\}\/>/);
  assert.match(pageSource, /const changed=changedTransactionPatch\(draft,edit,savedTransactionNote\(edit\)\);/);
  // Portal stays inside the scoped app root.
  assert.match(pageSource, /<div ref=\{setDialogHost\} className=\{`app unified-dashboard/);
  const integrationAst = ts.createSourceFile("page.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scopedFinancialDialogs = 0;
  const inspectPortal = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(integrationAst) === "FinanceDialog" && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(integrationAst) === "container" && attribute.initializer?.getText(integrationAst) === "{dialogHost}")) scopedFinancialDialogs++;
    ts.forEachChild(node, inspectPortal);
  };
  inspectPortal(integrationAst);
  assert.equal(scopedFinancialDialogs, 2, "editor and import both portal into the scoped root; independent navigation dialogs are outside this count");
});
