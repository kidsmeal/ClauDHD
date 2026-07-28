// The capture popover: its own tiny always-on-top window, shown by the global
// hotkey, gone on enter/esc. Reads its target list from capture-targets.json
// (written by the main window after every scan) so it needs no scan of its
// own. Appends exactly one idea.js-shaped line through the courier, the
// app's single project-file write.

import { buildIdeaLine } from "../core/capture.js";
import { ideaAppend, tauriStore } from "../adapters/tauri.js";

export const CAPTURE_TARGETS_FILE = "capture-targets.json";

interface Target {
  name: string;
  path: string;
}

let targets: Target[] = [];
let selected = 0;
let errorText: string | null = null;

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function loadTargets(): Promise<void> {
  const text = await tauriStore.read(CAPTURE_TARGETS_FILE);
  if (text == null) {
    targets = [];
    return;
  }
  try {
    const parsed = JSON.parse(text) as Target[];
    targets = Array.isArray(parsed) ? parsed.filter((t) => typeof t.name === "string" && typeof t.path === "string") : [];
  } catch {
    targets = [];
  }
}

function render(root: HTMLElement): void {
  const target = targets[selected];
  const preview = buildIdeaLine("...", new Date()).replace(" ...", "");
  root.innerHTML = `
    <div class="capture">
      <div class="capture-row">
        <span class="k">to:</span>
        <span class="capture-target">${target != null ? esc(target.name) : "(no claudhd projects found)"}</span>
        <span class="capture-hint">↑↓ to switch</span>
      </div>
      <input id="capture-input" class="capture-input" type="text"
        placeholder="${targets.length === 0 ? "no capture targets: open the main window once" : "one line, lands in IDEAS.md"}"
        ${targets.length === 0 ? "disabled" : ""} />
      <div class="capture-row dim">
        ${errorText != null ? `<span class="scan-error">${esc(errorText)}</span>` : `writes: ${esc(preview)} ...`}
      </div>
      <div class="capture-row dim">enter save · esc cancel</div>
    </div>`;
  focusInput();
}

// The window can gain OS focus before the DOM is ready to take element
// focus; a synchronous .focus() inside the focus event silently noops in the
// webview. Retry on a short timer until the input actually holds focus.
function focusInput(): void {
  for (const delay of [0, 60, 150]) {
    setTimeout(() => {
      const input = document.getElementById("capture-input") as HTMLInputElement | null;
      if (input != null && document.activeElement !== input) input.focus();
    }, delay);
  }
}

async function hide(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function bootCaptureWindow(root: HTMLElement): Promise<void> {
  await loadTargets();
  render(root);

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();

  // Every show reloads targets (the fleet may have changed) and resets state.
  await win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      void (async () => {
        await loadTargets();
        selected = 0;
        errorText = null;
        render(root);
      })();
    }
  });

  // document-level, not root-level: keystrokes target body when the input
  // has not claimed focus yet, and body is root's parent, so a root listener
  // never hears them. document hears everything in the window.
  document.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Escape") {
      void hide();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (targets.length > 0) {
        selected = (selected + (e.key === "ArrowDown" ? 1 : targets.length - 1)) % targets.length;
        const input = document.getElementById("capture-input") as HTMLInputElement | null;
        const text = input?.value ?? "";
        render(root);
        const again = document.getElementById("capture-input") as HTMLInputElement | null;
        if (again != null) again.value = text;
      }
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      const input = document.getElementById("capture-input") as HTMLInputElement | null;
      const text = input?.value.trim() ?? "";
      const target = targets[selected];
      if (text === "" || target == null) {
        void hide();
        return;
      }
      void (async () => {
        const ok = await ideaAppend(target.path, buildIdeaLine(text, new Date()));
        if (ok) {
          await hide();
        } else {
          // the one failure a capture tool must never hide
          errorText = `could not write ${target.name}/IDEAS.md (lock held or write failed), idea NOT captured`;
          render(root);
          const again = document.getElementById("capture-input") as HTMLInputElement | null;
          if (again != null) again.value = text;
        }
      })();
    }
  });
}
