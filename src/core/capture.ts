// Capture and launcher pure logic. The line format mirrors ClauDHD's idea.js
// exactly (`- [ ] YYYY-MM-DD HH:MM (while: <tag>) <text>`), because
// state.json's ideas parse keys the untriaged count and the ideas-age date
// off the `- [ ] YYYY-MM-DD` prefix; a differently shaped line silently
// breaks ClauDHD's ideas math. Out-of-session captures carry the fixed
// while-tag since no thread is active.

export const OUT_OF_SESSION_TAG = "out-of-session";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Local time, same as idea.js stampNow().
export function ideaStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildIdeaLine(text: string, at: Date): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return `- [ ] ${ideaStamp(at)} (while: ${OUT_OF_SESSION_TAG}) ${clean}`;
}

// --- launcher templates -------------------------------------------------------

export function substituteTemplate(template: string, path: string): string {
  return template.replaceAll("{path}", path);
}

// Split a command line into exe + args, honoring double quotes. The courier
// spawns exe directly (no shell), so a missing executable fails fast and the
// UI can report it.
export function tokenizeCommand(commandLine: string): { exe: string; args: string[] } | null {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let sawAny = false;
  for (const ch of commandLine.trim()) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      sawAny = true;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current !== "" || sawAny) {
        tokens.push(current);
        current = "";
        sawAny = false;
      }
      continue;
    }
    current += ch;
  }
  if (current !== "" || sawAny) tokens.push(current);
  const exe = tokens[0];
  if (exe == null || exe === "") return null;
  return { exe, args: tokens.slice(1) };
}
