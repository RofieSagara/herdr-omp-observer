import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObserverState, type ChildStatus, type TodoPhase } from "./state";
import { SnapshotWriter } from "./transport";

// OMP reuses this module, but rebinds the factory/API for every child session.
// Sharing only observation state lets each child's own bus contribute descendants.
const owners = new Map<string, ObserverState>();
const sessionOwners = new Map<string, ObserverState>();
let currentRoot: ObserverState | undefined;
let writer: SnapshotWriter | undefined;
let published = false;

export default function herdrObserver(pi: ExtensionAPI): void {
	const terminalId = process.env.HC_TERMINAL_ID?.split("/").pop();
	if (!terminalId) return;
	const z = pi.zod;
	const taskStatus = z.enum(["pending", "running", "completed", "failed", "aborted"]);
	const lifecycleSchema = z.object({
		id: z.string().min(1), agent: z.string(),
		status: z.enum(["started", "completed", "failed", "aborted"]),
		description: z.string().optional(), sessionFile: z.string().optional(),
	});
	const progressSchema = z.object({
		agent: z.string(), task: z.string(), assignment: z.string().optional(),
		sessionFile: z.string().optional(),
		progress: z.object({
			id: z.string().min(1), status: taskStatus,
			task: z.string().optional(), assignment: z.string().optional(),
			description: z.string().optional(), resolvedModel: z.string().optional(),
		}),
	});
	const rawSchema = z.object({
		id: z.string().min(1), event: z.object({ type: z.string() }),
	});
	const phasesSchema = z.array(z.object({
		name: z.string(),
		tasks: z.array(z.object({
			content: z.string(),
			status: z.enum(["pending", "in_progress", "completed", "blocked", "abandoned"]),
			blocker: z.string().optional(),
		})),
	}));
	const detailsSchema = z.object({ phases: phasesSchema, op: z.string().optional() });
	const resultSchema = z.object({ details: detailsSchema, isError: z.boolean().optional() });
	const todoMessageSchema = z.object({
		role: z.literal("toolResult"), toolName: z.literal("todo"),
		details: detailsSchema, isError: z.boolean().optional(),
	});

	let root: ObserverState | undefined;
	let context: ExtensionContext | undefined;
	let canonicalEntryId: string | undefined;
	let branchLeaf: string | null | undefined;
	let timersStarted = false;
	let disposed = false;
	let lastWarning = "";
	let warningAt = 0;

	function warn(error: unknown): void {
		try {
			const message = error instanceof Error ? error.message : String(error);
			if (message === lastWarning && Date.now() - warningAt < 30_000) return;
			lastWarning = message;
			warningAt = Date.now();
			pi.logger.warn("Herdr observer unavailable", { error: message });
		} catch {
			// Even a host logger failure must not interfere with agent execution.
		}
	}

	function publish(): Promise<void> | undefined {
		if (root !== currentRoot || !root?.active || !writer) return;
		return writer.write(root.snapshot());
	}

	function restoreTodos(ctx: ExtensionContext, force = false): void {
		if (ctx.agent.kind !== "main" || !root?.active) return;
		const leaf = ctx.sessionManager.getLeafId();
		if (!force && branchLeaf === leaf) return;
		branchLeaf = leaf;
		const branch = ctx.sessionManager.getBranch();
		let phases: TodoPhase[] = [];
		let entryId: string | undefined;
		for (let index = branch.length - 1; index >= 0; index--) {
			const entry = branch[index];
			if (entry.type === "custom" && entry.customType === "user_todo_edit") {
				const parsed = detailsSchema.safeParse(entry.data);
				if (!parsed.success) continue;
				phases = parsed.data.phases;
				entryId = entry.id;
				break;
			}
			if (entry.type !== "message") continue;
			const parsed = todoMessageSchema.safeParse(entry.message);
			if (!parsed.success || parsed.data.isError || parsed.data.details.op === "view") continue;
			phases = parsed.data.details.phases;
			entryId = entry.id;
			break;
		}
		// A live tool result can precede its persisted entry. Unrelated branch
		// appends must not replace that result with the previous canonical entry.
		if (!force && entryId === canonicalEntryId) return;
		canonicalEntryId = entryId;
		if (root.setTodos(phases)) void publish();
	}

	function bind(ctx: ExtensionContext, restore = false): void {
		if (disposed) return;
		// Advisor tool middleware can borrow the main runner with a sub identity;
		// it must not replace the main factory's heartbeat/branch binding.
		if (context && ctx.agent.id !== context.agent.id) return;
		context = ctx;
		if (ctx.agent.kind === "main") {
			const sessionId = ctx.sessionManager.getSessionId();
			if (!root || root.sessionId !== sessionId || root.closed) {
				if (root) root.active = false;
				root = new ObserverState(terminalId, process.pid, sessionId, ctx.agent.id);
				currentRoot = root;
				owners.set(ctx.agent.id, root);
				canonicalEntryId = undefined;
				branchLeaf = undefined;
				restore = true;
				writer ??= new SnapshotWriter(
					join(homedir(), ".cache", "omp-herdr", `${terminalId.replace(/[^A-Za-z0-9_.-]/g, "_")}-${process.pid}.json`),
					warn,
				);
			}
			if (restore) restoreTodos(ctx, true);
			if (!timersStarted) {
				timersStarted = true;
				ctx.setInterval(() => {
					try {
						if (context) {
							bind(context);
							restoreTodos(context);
						}
					} catch (error) { warn(error); }
				}, 1500);
				ctx.setInterval(() => {
					try { void publish(); } catch (error) { warn(error); }
				}, 10_000);
			}
		} else if (!root) {
			const sessionFile = ctx.sessionManager.getSessionFile();
			root = (sessionFile ? sessionOwners.get(sessionFile) : undefined)
				?? (ctx.agent.parentId ? owners.get(ctx.agent.parentId) : undefined)
				?? currentRoot;
		}
		if (!root?.active) return;
		owners.set(ctx.agent.id, root);
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) sessionOwners.set(sessionFile, root);
		if (ctx.agent.kind === "sub") {
			root.update({
				id: ctx.agent.id, parentId: ctx.agent.parentId ?? root.rootAgentId,
				agent: ctx.agent.name, identity: true,
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			});
		}
	}

	function observe(action: () => void): void {
		try { action(); } catch (error) { warn(error); }
	}

	function acceptChild(id: string, sessionFile?: string): boolean {
		if (disposed || !context || !root?.active || root !== currentRoot || root.closed) return false;
		const previousOwner = sessionFile ? sessionOwners.get(sessionFile) : owners.get(id);
		if (previousOwner && previousOwner !== root) return false;
		if (sessionFile) sessionOwners.set(sessionFile, root);
		owners.set(id, root);
		return true;
	}

	const unsubscribers = [
		pi.events.on("task:subagent:lifecycle", payload => observe(() => {
			const parsed = lifecycleSchema.safeParse(payload);
			if (!parsed.success) { warn(new Error("Invalid subagent lifecycle payload")); return; }
			const event = parsed.data;
			if (!acceptChild(event.id, event.sessionFile) || !root || !context) return;
			root.update({
				id: event.id, parentId: context.agent.id, agent: event.agent,
				task: event.description,
				status: event.status === "started" ? "running" : event.status,
				started: event.status === "started",
				lifecycle: true,
			});
			void publish();
		})),
		pi.events.on("task:subagent:progress", payload => observe(() => {
			const parsed = progressSchema.safeParse(payload);
			if (!parsed.success) { warn(new Error("Invalid subagent progress payload")); return; }
			const event = parsed.data;
			if (!acceptChild(event.progress.id, event.sessionFile) || !root || !context) return;
			root.update({
				id: event.progress.id, parentId: context.agent.id, agent: event.agent,
				task: event.progress.description || event.progress.assignment || event.assignment || event.task,
				model: event.progress.resolvedModel,
				status: event.progress.status === "pending" ? "idle" : event.progress.status,
			});
			void publish();
		})),
		pi.events.on("task:subagent:event", payload => observe(() => {
			const parsed = rawSchema.safeParse(payload);
			if (!parsed.success) { warn(new Error("Invalid subagent event payload")); return; }
			const event = parsed.data;
			if (!acceptChild(event.id) || !root || !context) return;
			let status: ChildStatus;
			if (event.event.type === "agent_start") status = "running";
			else if (event.event.type === "agent_end") status = "idle";
			else return;
			root.update({ id: event.id, parentId: context.agent.id, status });
			void publish();
		})),
	];

	pi.on("session_start", async (_event, ctx) => {
		try {
			bind(ctx, true);
			await publish();
			if (ctx.agent.kind === "main" && writer && !published) {
				const result = await pi.exec("hc", ["label", terminalId, `omp.observer=${writer.path}`], { timeout: 3000 });
				if (result.code !== 0) throw new Error(`hc label failed: ${result.stderr || result.stdout}`);
				published = true;
			}
		} catch (error) { warn(error); }
	});
	const sessionChanged = (_event: unknown, ctx: ExtensionContext): void => {
		observe(() => { bind(ctx, true); void publish(); });
	};
	pi.on("session_switch", sessionChanged);
	pi.on("session_branch", sessionChanged);
	pi.on("session_tree", sessionChanged);
	pi.on("before_agent_start", (event, ctx) => observe(() => {
		bind(ctx);
		if (root && ctx.agent.kind === "sub") {
			root.update({
				id: ctx.agent.id, parentId: ctx.agent.parentId ?? root.rootAgentId,
				task: event.prompt || undefined, status: "running", identity: true,
			});
		}
		void publish();
	}));
	pi.on("agent_start", (_event, ctx) => observe(() => {
		bind(ctx);
		if (root && ctx.agent.kind === "sub") root.update({
			id: ctx.agent.id, parentId: ctx.agent.parentId ?? root.rootAgentId, status: "running", identity: true,
		});
		void publish();
	}));
	pi.on("agent_end", (_event, ctx) => observe(() => {
		bind(ctx);
		if (root && ctx.agent.kind === "sub") root.update({
			id: ctx.agent.id, parentId: ctx.agent.parentId ?? root.rootAgentId, status: "idle", identity: true,
		});
		restoreTodos(ctx);
		void publish();
	}));
	pi.on("tool_result", (event, ctx) => observe(() => {
		bind(ctx);
		if (ctx.agent.kind !== "main") return;
		if (event.toolName === "todo" && !event.isError) {
			const parsed = detailsSchema.safeParse(event.details);
			if (parsed.success && parsed.data.op !== "view" && root?.setTodos(parsed.data.phases)) void publish();
		}
		// Eval persists successful bridged TODOs as user_todo_edit entries.
		if (event.toolName !== "todo") restoreTodos(ctx);
	}));
	pi.on("tool_execution_end", (event, ctx) => observe(() => {
		bind(ctx);
		if (ctx.agent.kind !== "main") return;
		if (event.toolName === "todo" && !event.isError) {
			const parsed = resultSchema.safeParse(event.result);
			if (parsed.success && !parsed.data.isError && parsed.data.details.op !== "view"
				&& root?.setTodos(parsed.data.details.phases)) void publish();
		}
		if (event.toolName !== "todo") restoreTodos(ctx);
	}));
	pi.on("session_shutdown", async (_event, ctx) => {
		disposed = true;
		try {
			if (ctx.agent.kind === "main" && root === currentRoot && root?.active) {
				restoreTodos(ctx, true);
				root.closed = true;
				await publish();
				root.active = false;
			}
		} catch (error) { warn(error); }
		finally {
			for (const unsubscribe of unsubscribers) {
				try { unsubscribe(); } catch (error) { warn(error); }
			}
		}
	});
}
