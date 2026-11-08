import { describe, expect, test } from "bun:test";
import { ObserverReader, STALE_MS, observerTree, parseSnapshot } from "../mods/omp-agents/observer.js";

const child = (id, parentId = "Main", status = "running") => ({ id, parentId, agent: "scout", task: `Inspect ${id}`, status, model: null, updatedAt: 1000 });
const snapshot = (changes = {}) => ({ version: 1, terminalId: "t7", pid: 42, sessionId: "session-a", rootAgentId: "Main", updatedAt: 1000, closed: false, children: [], todos: [], ...changes });
const terminal = (path = "/cache/a.json") => ({ address: "t7", state: "live", labels: { "omp.observer": path } });

function observing(children) {
  let value = snapshot({ children });
  const reader = new ObserverReader(async () => value === null ? null : JSON.stringify(value), () => [terminal()], () => 1000);
  return {
    reader,
    update: async (changes = {}) => { value = { ...(value ?? snapshot()), ...changes }; await reader.poll(); },
    missing: async () => { value = null; await reader.poll(); },
    rows: () => observerTree(reader.get("t7").visibleSnapshot),
    ids: () => observerTree(reader.get("t7").visibleSnapshot).map(row => row.child.id),
  };
}

describe("observer snapshot boundaries", () => {
  test("rejects another terminal's snapshot and invalid lineage", () => {
    expect(parseSnapshot(JSON.stringify(snapshot({ terminalId: "t8" })), "t7")).toBeNull();
    expect(parseSnapshot(JSON.stringify(snapshot({ children: [child("a", "b"), child("b", "a")] })), "t7")).toBeNull();
    expect(parseSnapshot(JSON.stringify(snapshot({ children: [child("a", "missing")] })), "t7")).toBeNull();
  });

  test("retains nested lineage and distinguishes terminal task outcomes", () => {
    const value = parseSnapshot(JSON.stringify(snapshot({ children: [child("a", "Main", "completed"), child("b", "a", "failed"), child("c", "Main", "aborted")] })), "t7");
    expect(observerTree(value).map(row => [row.child.id, row.child.status])).toEqual([["a", "completed"], ["b", "failed"], ["c", "aborted"]]);
  });

  test("preserves blocked notes and does not invent a failed TODO state", () => {
    const value = snapshot({ todos: [{ name: "Build", tasks: [{ content: "Approve", status: "blocked", blocker: "Needs credentials" }, { content: "Ship", status: "completed" }, { content: "Discard", status: "abandoned" }] }] });
    expect(parseSnapshot(JSON.stringify(value), "t7").todos).toEqual(value.todos);
    value.todos[0].tasks[0].status = "failed";
    expect(parseSnapshot(JSON.stringify(value), "t7")).toBeNull();
  });

  test("discards a late read after the publisher label changes", async () => {
    let terminals = [terminal()];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const reader = new ObserverReader(path => path === "/cache/a.json" ? pending : Promise.resolve(JSON.stringify(snapshot({ sessionId: "new-session", children: [child("new-child")] }))), () => terminals, () => 1000);
    const oldPoll = reader.poll();
    terminals = [terminal("/cache/new.json")];
    reader.sync();
    release(JSON.stringify(snapshot({ children: [child("old-child")] })));
    await oldPoll;
    expect(reader.get("t7").snapshot).toBeNull();
    await reader.poll();
    expect(reader.get("t7").snapshot.children.map(item => item.id)).toEqual(["new-child"]);
  });

  test("stops claiming liveness after a heartbeat expires and recovers on renewal", async () => {
    let now = 1000;
    let value = snapshot({ children: [child("a")] });
    const reader = new ObserverReader(async () => JSON.stringify(value), () => [terminal()], () => now);
    await reader.poll();
    expect(reader.get("t7").state).toBe("live");
    now += STALE_MS + 1;
    reader.sync();
    expect(reader.get("t7").state).toBe("stale");
    value = { ...value, updatedAt: now };
    await reader.poll();
    expect(reader.get("t7").state).toBe("live");
    value = { ...value, closed: true };
    await reader.poll();
    expect(reader.get("t7").state).toBe("closed");
    expect(reader.get("t7").snapshot.children[0].id).toBe("a");
  });
});

describe("completed and failed child visibility", () => {
  test("keeps the latest outcomes until a new child arrives, without heartbeat resurrection", async () => {
    const view = observing([child("old")]);
    await view.update();
    await view.update({ children: [child("old", "Main", "completed")] });
    expect(view.ids()).toEqual(["old"]);
    await view.update({ children: [child("old", "Main", "completed"), child("new")] });
    expect(view.ids()).toEqual(["new"]);
    await view.update({ updatedAt: 1100, children: [child("old", "Main", "completed"), child("new", "Main", "completed")] });
    expect(view.ids()).toEqual(["new"]);
    await view.update({ updatedAt: 1200 });
    expect(view.ids()).toEqual(["new"]);
    await view.update({ children: [child("old", "Main", "completed"), child("new", "Main", "completed"), child("next")] });
    expect(view.ids()).toEqual(["next"]);
    expect(view.reader.get("t7").snapshot.children.map(item => item.id)).toEqual(["old", "new", "next"]);
  });

  test("handles completion and arrival in the same poll, preserving newly observed completed children", async () => {
    const view = observing([child("old")]);
    await view.update();
    await view.update({ children: [child("old", "Main", "completed"), child("quick", "Main", "completed")] });
    expect(view.ids()).toEqual(["quick"]);
    await view.update();
    expect(view.ids()).toEqual(["quick"]);
  });

  test("keeps running, idle and aborted children when clearing completed and failed ones", async () => {
    const retained = [child("active"), child("idle", "Main", "idle"), child("cancelled", "Main", "aborted")];
    const outcomes = [child("finished", "Main", "completed"), child("failure", "Main", "failed")];
    const view = observing([...outcomes, ...retained]);
    await view.update();
    await view.update({ children: [...outcomes, ...retained, child("incoming")] });
    expect(view.ids()).toEqual(["active", "idle", "cancelled", "incoming"]);
  });

  test("promotes live descendants past hidden completed ancestors without editing the canonical tree or TODOs", async () => {
    const children = [child("parent", "Main", "completed"), child("nested", "parent", "completed"), child("active", "nested")];
    const todos = [{ name: "Build", tasks: [{ content: "Keep outcome", status: "completed" }] }];
    const view = observing(children);
    await view.update({ todos });
    await view.update({ children: [...children, child("incoming")] });
    expect(view.rows().map(row => [row.child.id, row.child.parentId, row.lines])).toEqual([
      ["active", "Main", ["├"]], ["incoming", "Main", ["└"]],
    ]);
    expect(view.reader.get("t7").snapshot.children).toEqual([...children, child("incoming")]);
    expect(view.reader.get("t7").snapshot.todos).toEqual(todos);
  });

  test("retains new failures until the next arrival and keeps old failures hidden across missing reads", async () => {
    const view = observing([child("old")]);
    await view.update();
    await view.update({ children: [child("old", "Main", "failed")] });
    expect(view.ids()).toEqual(["old"]);
    const outcomes = [child("old", "Main", "failed"), child("quick", "Main", "failed")];
    await view.update({ children: outcomes });
    expect(view.ids()).toEqual(["quick"]);
    await view.update({ updatedAt: 1100 });
    expect(view.ids()).toEqual(["quick"]);
    await view.missing();
    await view.update({ children: outcomes });
    expect(view.ids()).toEqual(["quick"]);
    await view.update({ children: [...outcomes, child("incoming")] });
    expect(view.ids()).toEqual(["incoming"]);
    expect(view.reader.get("t7").snapshot.children).toEqual([...outcomes, child("incoming")]);
  });

  test("promotes active descendants of hidden failures and restores a restarted child", async () => {
    const failed = child("failed-parent", "Main", "failed");
    const active = child("active", failed.id);
    const view = observing([failed, active]);
    await view.update();
    await view.update({ children: [failed, active, child("incoming")] });
    expect(view.rows().map(row => [row.child.id, row.child.parentId])).toEqual([
      ["active", "Main"], ["incoming", "Main"],
    ]);
    await view.update({ children: [{ ...failed, status: "running" }, active, child("incoming")] });
    expect(view.ids()).toEqual(["failed-parent", "active", "incoming"]);
    await view.update({ children: [failed, active, child("incoming")] });
    expect(view.ids()).toEqual(["failed-parent", "active", "incoming"]);
    await view.update({ children: [failed, active, child("incoming"), child("next")] });
    expect(view.ids()).toEqual(["active", "incoming", "next"]);
    await view.update({ sessionId: "session-b", children: [failed, active] });
    expect(view.ids()).toEqual(["failed-parent", "active"]);
  });

  test("resets history on a new session and lets a resumed child show its next result", async () => {
    const view = observing([child("old", "Main", "completed")]);
    await view.update();
    await view.update({ children: [child("old", "Main", "completed"), child("new")] });
    expect(view.ids()).toEqual(["new"]);
    await view.update({ children: [child("old"), child("new")] });
    expect(view.ids()).toEqual(["old", "new"]);
    await view.update({ children: [child("old", "Main", "completed"), child("new")] });
    expect(view.ids()).toEqual(["old", "new"]);
    await view.update({ sessionId: "session-b", children: [child("old", "Main", "completed")] });
    expect(view.ids()).toEqual(["old"]);
  });

  test("retains cleanup history over a missing snapshot", async () => {
    const view = observing([child("old", "Main", "completed")]);
    await view.update();
    await view.update({ children: [child("old", "Main", "completed"), child("new")] });
    await view.missing();
    expect(view.ids()).toEqual([]);
    await view.update({ children: [child("old", "Main", "completed"), child("new")] });
    expect(view.ids()).toEqual(["new"]);
  });

  test("a new child in one terminal cannot clear another terminal's completed outcomes", async () => {
    let first = snapshot({ children: [child("a", "Main", "completed")] });
    const second = snapshot({ terminalId: "t8", children: [child("b", "Main", "completed")] });
    const reader = new ObserverReader(async path => JSON.stringify(path === "/cache/a.json" ? first : second),
      () => [terminal(), { ...terminal("/cache/b.json"), address: "t8" }], () => 1000);
    await reader.poll();
    first = { ...first, children: [...first.children, child("new")] };
    await reader.poll();
    expect(observerTree(reader.get("t7").visibleSnapshot).map(row => row.child.id)).toEqual(["new"]);
    expect(observerTree(reader.get("t8").visibleSnapshot).map(row => row.child.id)).toEqual(["b"]);
  });
});
