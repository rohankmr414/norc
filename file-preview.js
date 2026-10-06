const { BrowserWindow, dialog } = require("electron");
const { constants } = require("node:fs");
const { open } = require("node:fs/promises");
const path = require("node:path");

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function previewDocument(name, content) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(name)} — Norc</title>
<style>
  :root { color-scheme: light dark; font: 14px system-ui, sans-serif; }
  body { margin: 0; }
  header { padding: 18px 24px; border-bottom: 1px solid GrayText; }
  h1 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
  p { margin: 6px 0 0; color: GrayText; }
  pre { margin: 0; padding: 24px; font: 13px/1.6 monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
</style></head><body><header><h1>${escapeHtml(name)}</h1>
<p>Read-only preview · Escape to close</p></header><pre>${escapeHtml(content)}</pre></body></html>`;
}

async function showPreview(parent, name, content) {
  if (!parent || parent.isDestroyed()) return;
  const window = new BrowserWindow({
    parent, title: `${name} — Norc`, width: 900, height: 650,
    minWidth: 400, minHeight: 300, show: false, autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false,
      partition: "norc-file-preview",
    },
  });
  const close = () => { if (!window.isDestroyed()) window.destroy(); };
  parent.once("closed", close);
  window.once("closed", () => parent.removeListener("closed", close));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "Escape" || (input.control && input.key.toLowerCase() === "w"))) {
      event.preventDefault();
      window.close();
    }
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewDocument(name, content))}`);
    if (!window.isDestroyed()) window.show();
  } catch (error) {
    close();
    if (!parent.isDestroyed()) throw error;
  }
}

async function reportError(parent, error) {
  console.warn("Unable to preview attachment:", error.message);
  if (!parent || parent.isDestroyed()) return;
  await dialog.showMessageBox(parent, {
    type: "error", title: "Attachment preview", message: "Could not preview attachment",
    detail: "Try opening the attachment again. For a file on disk, check that it is readable.",
  }).catch(dialogError => console.warn("Unable to show preview error:", dialogError.message));
}

async function previewFromString(parent, attachment) {
  if (!parent || parent.isDestroyed()) return;
  try {
    if (typeof attachment?.content !== "string") throw new Error("Attachment content must be text");
    const name = typeof attachment.name === "string" && attachment.name ? attachment.name : "Feedback attachment";
    await showPreview(parent, name, attachment.content);
  } catch (error) { await reportError(parent, error); }
}

async function previewFromPath(parent, attachment) {
  if (!parent || parent.isDestroyed()) return;
  try {
    if (typeof attachment?.path !== "string" || !path.isAbsolute(attachment.path)) throw new Error("An absolute file path is required");
    const file = await open(attachment.path, constants.O_RDONLY | constants.O_NONBLOCK);
    let content;
    try {
      if (!(await file.stat()).isFile()) throw new Error("Not a regular file");
      content = await file.readFile("utf8");
    } finally { await file.close(); }
    const name = typeof attachment.name === "string" && attachment.name ? attachment.name : path.basename(attachment.path);
    await showPreview(parent, name, content);
  } catch (error) { await reportError(parent, error); }
}

module.exports = { previewFromString, previewFromPath };
