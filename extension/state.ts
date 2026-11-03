export type ChildStatus = "running" | "completed" | "failed" | "aborted" | "idle";
export type TodoStatus = "pending" | "in_progress" | "completed" | "blocked" | "abandoned";

export interface TodoPhase {
	name: string;
	tasks: Array<{ content: string; status: TodoStatus; blocker?: string }>;
}

export interface ObservedChild {
	id: string;
	parentId: string;
	agent: string;
	task: string;
	status: ChildStatus;
	model: string | null;
	updatedAt: number;
}

export interface Snapshot {
	version: 1;
	terminalId: string;
	pid: number;
	sessionId: string;
	rootAgentId: string;
	updatedAt: number;
	closed: boolean;
	children: ObservedChild[];
	todos: TodoPhase[];
}

export interface ChildUpdate {
	id: string;
	parentId: string;
	agent?: string;
	task?: string;
	model?: string;
	status?: ChildStatus;
	/** Only a real lifecycle start may reopen a settled task. */
	started?: boolean;
	/** The child's own ExtensionContext gives authoritative lineage. */
	identity?: boolean;
	/** Final lifecycle payloads outrank progress and agent-loop observations. */
	lifecycle?: boolean;
}

/** Session-scoped, read-only observations; no outcome is inferred from a turn ending. */
export class ObserverState {
	readonly children = new Map<string, ObservedChild>();
	readonly identities = new Set<string>();
	todos: TodoPhase[] = [];
	closed = false;
	active = true;
	#todoKey = "[]";

	constructor(
		readonly terminalId: string,
		readonly pid: number,
		readonly sessionId: string,
		readonly rootAgentId: string,
	) {}

	update(update: ChildUpdate, now = Date.now()): boolean {
		if (!this.active || this.closed || update.id === this.rootAgentId) return false;
		const previous = this.children.get(update.id);
		const status = previous && (previous.status === "completed" || previous.status === "failed" || previous.status === "aborted")
			&& !update.started && !update.lifecycle
			? previous.status
			: update.status ?? previous?.status ?? "idle";
		const child: ObservedChild = {
			id: update.id,
			parentId: update.identity || !this.identities.has(update.id)
				? update.parentId
				: previous?.parentId ?? update.parentId,
			agent: update.agent ?? previous?.agent ?? "sub",
			task: update.task || previous?.task || "",
			status,
			model: update.model ?? previous?.model ?? null,
			updatedAt: now,
		};
		if (update.identity) this.identities.add(update.id);
		this.children.set(update.id, child);
		return true;
	}

	setTodos(phases: TodoPhase[]): boolean {
		if (!this.active || this.closed) return false;
		const key = JSON.stringify(phases);
		if (key === this.#todoKey) return false;
		this.#todoKey = key;
		this.todos = phases;
		return true;
	}

	snapshot(now = Date.now()): Snapshot {
		return {
			version: 1,
			terminalId: this.terminalId,
			pid: this.pid,
			sessionId: this.sessionId,
			rootAgentId: this.rootAgentId,
			updatedAt: now,
			closed: this.closed,
			children: [...this.children.values()],
			todos: this.todos,
		};
	}
}
