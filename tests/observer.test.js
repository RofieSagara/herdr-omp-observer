import { describe, expect, test } from "bun:test";
import { ObserverReader, STALE_MS, observerTree, parseSnapshot } from "../mods/omp-agents/observer.js";

const child = (id, parentId = "Main", status = "running") => ({ id, parentId, agent: "scout", task: `Inspect ${id}`, status, model: null, updatedAt: 1000 });
const snapshot = (changes = {}) => ({ version: 1, terminalId: "t7", pid: 42, sessionId: "session-a", rootAgentId: "Main", updatedAt: 1000, closed: false, children: [], todos: [], ...changes });
const terminal = (path = "/cache/a.json") => ({ address: "t7", state: "live", labels: { "omp.observer": path } });

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
