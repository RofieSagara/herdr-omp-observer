import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot } from "./state";

/** One writer per OMP process: latest pending state wins, renames never overlap. */
export class SnapshotWriter {
	#pending: string | undefined;
	#writing: Promise<void> | undefined;

	constructor(readonly path: string, readonly warn: (error: unknown) => void) {}

	write(snapshot: Snapshot): Promise<void> {
		this.#pending = JSON.stringify(snapshot);
		if (!this.#writing) this.#writing = this.#drain();
		return this.#writing;
	}

	async #drain(): Promise<void> {
		while (this.#pending !== undefined) {
			const content = this.#pending;
			this.#pending = undefined;
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			try {
				await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
				const file = await open(temporary, "wx", 0o600);
				try {
					await file.writeFile(content, "utf8");
				} finally {
					await file.close();
				}
				await rename(temporary, this.path);
			} catch (error) {
				this.warn(error);
			} finally {
				try {
					await unlink(temporary);
				} catch {
					// Successful renames (and failures before open) leave no temp file.
				}
			}
		}
		this.#writing = undefined;
	}
}
