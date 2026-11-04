import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { STALE_MS } from "../mods/omp-agents/observer.js";

// Render real view descriptions and invoke their real disclosure callbacks.
// GPUI drawing and Herdr's external model are the only host boundaries replaced.
function element(kind = "div", source = null) {
  const value = { kind, source, content: [], attrs: {}, events: {} };
  const proxy = new Proxy(value, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "child") { if (args[0] != null) target.content.push(args[0]); }
      else if (key === "children") target.content.push(...args[0]);
      else if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key.startsWith("on_")) target.events[key] = args.at(-1);
      else target.attrs[key] = args.length === 1 ? args[0] : args;
      return proxy;
    };
  } });
  return proxy;
}

let model;
const commands = [];
const storage = new Map();
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
} });
afterAll(() => {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else delete globalThis.localStorage;
});

mock.module("gpui-kit", () => ({ View: class {}, div: () => element(), svg: source => element("svg", source), image: source => element("image", source) }));
mock.module("gpui-base", () => ({ h_flex: () => element("row"), v_flex: () => element("column") }));
mock.module("herdr", () => ({
  agents: () => model.roots, terminals: () => model.terminals, readTextFile: async path => JSON.stringify(model.snapshots[path]),
  panes: () => [], focused: () => ({ agent: "t1" }), spaces: () => [{ id: "space", tabs: [{ id: "tab", name: "Session" }] }],
  run: (name, args) => commands.push({ name, args }), theme: () => ({ dim: "#777777", muted: "#aaaaaa", chrome: "#111111", working: "#00aa00", done: "#0000aa", blocked: "#aa0000" }),
  shared: key => key === "agents.sort" ? "grouped" : undefined, setShared() {}, setAgentOrder() {}, openOverlay() {}, closeOverlay() {},
  props: () => ({}), window: () => ({ platform: "linux" }), layout: () => ({ id: "sidebar", size: { px: 268 } }),
}));
const { default: Agents } = await import("../mods/omp-agents/main.js");

const program = { key: "omp", name: "OMP", icon: "icons/omp.svg", tint: false, agent: true };
const child = (id, status = "running") => ({ id, parentId: "Main", agent: "scout", task: `Work by ${id}`, status, model: null, updatedAt: Date.now() });
const phase = (name, content, status = "in_progress") => ({ name, tasks: [{ content, status }] });
const snapshot = (terminalId, children, todos) => ({ version: 1, terminalId, pid: 42, sessionId: "session", rootAgentId: "Main", updatedAt: Date.now(), closed: false, children, todos });
const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {} } };
const nodes = root => [root, ...root.content.flatMap(item => typeof item === "object" ? nodes(item) : [])];
const text = root => root.content.map(item => typeof item === "string" ? item : text(item)).join("");
const find = (root, id) => nodes(root).find(node => node.attrs.id === id);
const hasSpinner = root => nodes(root).some(node => node.attrs.spin === 900);
const click = (view, id) => {
  const target = find(view.render(cx), id);
  if (!target?.events.on_click) throw new Error(`Missing actionable control: ${id}`);
  target.events.on_click({}, cx);
  return view.render(cx);
};

beforeEach(() => {
  storage.clear();
  commands.length = 0;
  model = {
    roots: [{ address: "t1", pane: "p1", space: "space", space_name: "Space", tab: "tab", status: "working", focused: true, program, app: "omp" }],
    terminals: [
      { address: "t1", state: "live", program, labels: { "omp.observer": "/t1.json" } },
      { address: "t2", parent: "t1", state: "live", name: "NativeChild", status: "working", program: { key: "claude", name: "Claude" } },
    ],
    snapshots: { "/t1.json": snapshot("t1", [child("OmpChild")], [phase("Preview video", "Inspect player"), phase("Release", "Ship change", "pending")]) },
  };
});

async function mount() {
  const view = new Agents();
  view.init({}, cx);
  await view.observer.poll();
  return view;
}

test("the root disclosure hides and restores both sources of children and all task phases", async () => {
  const view = await mount();
  let tree = view.render(cx);
  expect(find(tree, "omp-sub-t1-OmpChild")).toBeDefined();
  expect(find(tree, "sub-t2")).toBeDefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeDefined();
  tree = click(view, "fold-t1");
  expect(find(tree, "ag-t1")).toBeDefined();
  expect(find(tree, "omp-sub-t1-OmpChild")).toBeUndefined();
  expect(find(tree, "sub-t2")).toBeUndefined();
  expect(find(tree, "section-phase-t1-0-Preview video")).toBeUndefined();
  tree = click(view, "fold-t1");
  expect(find(tree, "omp-sub-t1-OmpChild")).toBeDefined();
  expect(find(tree, "sub-t2")).toBeDefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeDefined();
});

test("child and phase sections fold independently and preserve those choices through the root toggle", async () => {
  const view = await mount();
  let tree = click(view, "section-children-t1");
  expect(find(tree, "sub-t2")).toBeUndefined();
  expect(find(tree, "omp-sub-t1-OmpChild")).toBeUndefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeDefined();
  tree = click(view, "section-phase-t1-0-Preview video");
  expect(find(tree, "omp-task-t1-0-0")).toBeUndefined();
  expect(find(tree, "omp-task-t1-1-0")).toBeDefined();
  click(view, "fold-t1");
  tree = click(view, "fold-t1");
  expect(find(tree, "sub-t2")).toBeUndefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeUndefined();
  expect(find(tree, "omp-task-t1-1-0")).toBeDefined();
  tree = click(view, "section-children-t1");
  expect(find(tree, "sub-t2")).toBeDefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeUndefined();
});

test("native and OMP running-to-completed transitions replace the spinner with an outcome icon", async () => {
  const view = await mount();
  let tree = view.render(cx);
  expect(hasSpinner(find(tree, "sub-t2"))).toBe(true);
  expect(hasSpinner(find(tree, "omp-sub-t1-OmpChild"))).toBe(true);
  model.terminals[1].status = "done";
  model.snapshots["/t1.json"].children[0].status = "completed";
  await view.observer.poll();
  tree = view.render(cx);
  for (const id of ["sub-t2", "omp-sub-t1-OmpChild"]) {
    expect(hasSpinner(find(tree, id))).toBe(false);
    expect(text(find(tree, id))).toContain("✓");
    expect(text(find(tree, id))).not.toContain("completed");
  }
});

test("stale child and task data never spins while completed and failed outcomes remain distinguishable", async () => {
  model.snapshots["/t1.json"].updatedAt = Date.now() - STALE_MS - 1000;
  model.snapshots["/t1.json"].children.push(child("FailedChild", "failed"), child("CompletedChild", "completed"), child("AbortedChild", "aborted"));
  const view = await mount();
  const tree = view.render(cx);
  expect(hasSpinner(find(tree, "omp-sub-t1-OmpChild"))).toBe(false);
  expect(hasSpinner(find(tree, "omp-task-t1-0-0"))).toBe(false);
  expect(text(find(tree, "omp-sub-t1-OmpChild"))).toContain("◷");
  expect(text(find(tree, "omp-sub-t1-FailedChild"))).toContain("!");
  expect(text(find(tree, "omp-sub-t1-CompletedChild"))).toContain("✓");
  expect(text(find(tree, "omp-sub-t1-AbortedChild"))).toContain("–");
});

test("task-only and empty observed sessions still have the combined disclosure", async () => {
  model.terminals.pop();
  model.snapshots["/t1.json"].children = [];
  const view = await mount();
  expect(find(view.render(cx), "omp-task-t1-0-0")).toBeDefined();
  expect(find(click(view, "fold-t1"), "omp-task-t1-0-0")).toBeUndefined();
  click(view, "fold-t1");
  model.snapshots["/t1.json"].todos = [];
  await view.observer.poll();
  expect(text(view.render(cx))).toContain("No Task Yet");
  expect(text(click(view, "fold-t1"))).not.toContain("No Task Yet");
});

test("collapsing Child agents does not hide nested OMP owners' independent task phases", async () => {
  model.terminals[1].program = program;
  model.terminals[1].labels = { "omp.observer": "/t2.json" };
  model.snapshots["/t2.json"] = snapshot("t2", [child("NestedChild")], [phase("Preview video", "Inspect nested session")]);
  const view = await mount();
  expect(find(view.render(cx), "omp-task-t2-0-0")).toBeDefined();
  let tree = click(view, "section-children-t1");
  expect(find(tree, "omp-sub-t2-NestedChild")).toBeUndefined();
  expect(find(tree, "omp-task-t2-0-0")).toBeDefined();
  tree = click(view, "section-phase-t2-0-Preview video");
  expect(find(tree, "omp-task-t2-0-0")).toBeUndefined();
  expect(find(tree, "omp-task-t1-0-0")).toBeDefined();
  tree = click(view, "fold-t1");
  expect(find(tree, "omp-task-t1-0-0")).toBeUndefined();
});
