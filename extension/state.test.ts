import { describe, expect, test } from "bun:test";
import { ObserverState, type ChildStatus, type TodoPhase } from "./state";

describe("native OMP observation state", () => {
	test("ending an agent loop is idle, not a completed task", () => {
		const state = new ObserverState("t1", 12, "root-session", "Main");
		state.update({ id: "Worker", parentId: "Main", status: "running", started: true }, 1);
		state.update({ id: "Worker", parentId: "Main", status: "idle" }, 2);
		expect(state.snapshot(3).children[0].status).toBe("idle");
		expect(state.snapshot(3).closed).toBe(false);
	});

	for (const outcome of ["completed", "failed", "aborted"] as const) {
		test(`${outcome} survives late agent_end and progress until a real restart`, () => {
			const state = new ObserverState("t1", 12, "root-session", "Main");
			state.update({ id: "Worker", parentId: "Main", status: outcome, lifecycle: true }, 1);
			state.update({ id: "Worker", parentId: "Main", status: "idle" }, 2);
			state.update({ id: "Worker", parentId: "Main", status: "running", model: "provider/model" }, 3);
			expect(state.snapshot(4).children[0].status).toBe(outcome);
			expect(state.snapshot(4).children[0].model).toBe("provider/model");
			state.update({ id: "Worker", parentId: "Main", status: "running", started: true }, 5);
			expect(state.snapshot(6).children[0].status).toBe("running");
		});
	}

	test("final lifecycle status overrides an earlier progress outcome", () => {
		const state = new ObserverState("t1", 12, "root-session", "Main");
		state.update({ id: "Worker", parentId: "Main", status: "completed" }, 1);
		state.update({ id: "Worker", parentId: "Main", status: "aborted", lifecycle: true }, 2);
		expect(state.snapshot(3).children[0].status).toBe("aborted");
	});

	test("child identity preserves nested lineage across aggregated parent events", () => {
		const state = new ObserverState("t1", 12, "root-session", "Main");
		state.update({ id: "Parent", parentId: "Main", status: "running" }, 1);
		state.update({ id: "Nested", parentId: "Parent", identity: true, agent: "scout", model: "p/m" }, 2);
		state.update({ id: "Nested", parentId: "Main", task: "Inspect sources", status: "running" }, 3);
		expect(state.snapshot(4).children.find(child => child.id === "Nested")).toEqual({
			id: "Nested", parentId: "Parent", agent: "scout", model: "p/m",
			task: "Inspect sources", status: "running", updatedAt: 3,
		});
		expect(state.update({ id: "Main", parentId: "Main", status: "running" }, 5)).toBe(false);
		expect(state.snapshot(6).children).toHaveLength(2);
	});

	test("session switch isolates children and todos, and ignores late old-session updates", () => {
		const old = new ObserverState("t1", 12, "old-session", "Main");
		old.update({ id: "Worker", parentId: "Main", status: "completed", lifecycle: true }, 1);
		old.setTodos([{ name: "Old phase", tasks: [{ content: "Old task", status: "completed" }] }]);
		old.active = false;
		const next = new ObserverState("t1", 12, "new-session", "Main");
		expect(old.update({ id: "LateWorker", parentId: "Main", status: "running" }, 2)).toBe(false);
		expect(next.snapshot(3)).toEqual({
			version: 1, terminalId: "t1", pid: 12, sessionId: "new-session", rootAgentId: "Main",
			updatedAt: 3, closed: false, children: [], todos: [],
		});
	});

	test("TODO retains all five native states and blocker text without failed conversion", () => {
		const state = new ObserverState("t1", 12, "root-session", "Main");
		const todos: TodoPhase[] = [{ name: "Implementation", tasks: [
			{ content: "Queued", status: "pending" },
			{ content: "Working", status: "in_progress" },
			{ content: "Finished", status: "completed" },
			{ content: "Waiting", status: "blocked", blocker: "Need credentials" },
			{ content: "Dropped", status: "abandoned" },
		] }];
		expect(state.setTodos(todos)).toBe(true);
		expect(state.setTodos(todos)).toBe(false);
		expect(state.snapshot(1).todos).toEqual(todos);
		expect(state.setTodos([])).toBe(true);
		expect(state.snapshot(2).todos).toEqual([]);
	});

	test("a closed root retains observed outcomes without inventing unfinished outcomes", () => {
		const state = new ObserverState("t1", 12, "root-session", "Main");
		const statuses: ChildStatus[] = ["running", "idle", "completed", "failed", "aborted"];
		for (const [index, status] of statuses.entries()) {
			state.update({ id: `Worker${index}`, parentId: "Main", status }, index);
		}
		state.closed = true;
		expect(state.snapshot(10).children.map(child => child.status)).toEqual(statuses);
		expect(state.update({ id: "LateWorker", parentId: "Main", status: "running" }, 11)).toBe(false);
		expect(state.setTodos([{ name: "Late", tasks: [] }])).toBe(false);
	});
});
