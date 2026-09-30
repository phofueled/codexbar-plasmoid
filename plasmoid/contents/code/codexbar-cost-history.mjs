import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Preserve previously observed daily quantities independently of disposable
// scan caches. These are diagnostic records, never additions to live totals:
// fewer tokens can mean deleted logs OR a correction in a newer parser.
function historyFilename(options) {
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const stateRoot = options.stateRoot || process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const scope = crypto.createHash("sha256").update(path.resolve(codexHome)).digest("hex");
  return path.join(stateRoot, "codexbar-plasmoid", "cost-history", `codex-${scope}.json`);
}

export function trackCodexCostHistory(items, options = {}) {
  if (!items.some((item) => item?.provider === "codex" && !item.error && item.historyCoverageIsEstablished === true && Array.isArray(item.daily))) return items;
  const filename = historyFilename(options);
  const lock = `${filename}.lock`;
  let fd = null;
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fd = fs.openSync(lock, "wx", 0o600);
        fs.writeFileSync(fd, String(process.pid));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Recover a lock left by a terminated helper, without disturbing a
        // live writer. Contention waits are bounded to one second.
        try {
          const pid = Number(fs.readFileSync(lock, "utf8"));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (probe) { if (probe.code === "ESRCH") fs.unlinkSync(lock); }
          }
        } catch {}
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    return fd === null ? items : trackUnlocked(items, options, filename);
  } catch { return items; }
  finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(lock); } catch {}
    }
  }
}

function trackUnlocked(items, options, filename) {
  const now = options.now || new Date();
  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = dayKey(now);
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const since = dayKey(first);
  let saved = { version: 1, days: {} };
  try {
    if (fs.statSync(filename).size <= 4 * 1024 * 1024) {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (parsed.version === 1 && parsed.days && typeof parsed.days === "object" && !Array.isArray(parsed.days)) saved = parsed;
    }
  } catch { /* A missing or damaged history file must not hide live usage. */ }
  let changed = false;
  const result = items.map((item) => {
    if (item?.provider !== "codex" || item.error || item.historyCoverageIsEstablished !== true || !Array.isArray(item.daily)) return item;
    const current = new Map();
    for (const day of item.daily) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || "") || !Number.isSafeInteger(day.totalTokens) || day.totalTokens < 0) continue;
      current.set(day.date, day);
      const previous = saved.days[day.date];
      if (!Number.isSafeInteger(previous?.totalTokens) || day.totalTokens > previous.totalTokens) {
        // No account identity, session paths, or transcript content is saved.
        saved.days[day.date] = {
          totalTokens: day.totalTokens,
          totalCost: Number.isFinite(day.totalCost) ? day.totalCost : null,
          observedAt: item.updatedAt || now.toISOString(),
        };
        changed = true;
      }
    }
    let changedDays = 0;
    let previouslyObservedTokensAbsent = 0;
    for (const [date, day] of Object.entries(saved.days)) {
      if (date < since || date > today || !Number.isSafeInteger(day?.totalTokens)) continue;
      const difference = day.totalTokens - (current.get(date)?.totalTokens || 0);
      if (difference > 0) {
        changedDays += 1;
        previouslyObservedTokensAbsent += difference;
      }
    }
    return { ...item, historyChangedDays: changedDays, previouslyObservedTokensAbsent };
  });
  if (changed) {
    const temporary = `${filename}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 });
      fs.renameSync(temporary, filename);
    } catch { /* A read-only state directory must not break cost fetching. */ }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  return result;
}
