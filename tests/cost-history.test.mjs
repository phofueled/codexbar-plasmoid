import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { trackCodexCostHistory } from "../plasmoid/contents/code/codexbar-cost-history.mjs";

test("retains earlier observations and flags loss without inflating current totals", () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexbar-history-test-"));
  const options = { stateRoot, codexHome: "/synthetic/codex-a", now: new Date(2026, 8, 30) };
  const item = (daily, complete = true) => ({ provider: "codex", historyCoverageIsEstablished: complete, last30DaysTokens: daily.reduce((n, d) => n + d.totalTokens, 0), daily });
  try {
    const original = item([{ date: "2026-09-01", totalTokens: 100, totalCost: 2 }, { date: "2026-09-29", totalTokens: 50, totalCost: 1 }]);
    assert.equal(trackCodexCostHistory([original], options)[0].historyChangedDays, 0);
    const current = item([{ date: "2026-09-29", totalTokens: 30, totalCost: 0.6 }]);
    const result = trackCodexCostHistory([current], options)[0];
    assert.equal(result.historyChangedDays, 2);
    assert.equal(result.previouslyObservedTokensAbsent, 120);
    assert.equal(result.last30DaysTokens, 30);
    assert.deepEqual(result.daily, current.daily);
    assert.equal(trackCodexCostHistory([current], options)[0].previouslyObservedTokensAbsent, 120);
    assert.equal(trackCodexCostHistory([item([], false)], options)[0].historyChangedDays, undefined);
    assert.equal(trackCodexCostHistory([current], { ...options, codexHome: "/synthetic/codex-b" })[0].historyChangedDays, 0);
    const later = trackCodexCostHistory([current], { ...options, now: new Date(2026, 9, 1) })[0];
    assert.equal(later.previouslyObservedTokensAbsent, 20); // September 1 rolled out of the window.
    const restored = trackCodexCostHistory([original], options)[0];
    assert.equal(restored.historyChangedDays, 0);
    // Repricing the same tokens doesn't falsely signal lost usage.
    const repriced = structuredClone(original);
    repriced.daily[0].totalCost = 1;
    assert.equal(trackCodexCostHistory([repriced], options)[0].historyChangedDays, 0);
  } finally { fs.rmSync(stateRoot, { recursive: true, force: true }); }
});
