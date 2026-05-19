export interface CircuitBreakerOptions {
	name: string;
	threshold?: number;
	baseBlockMs?: number;
	maxBlockMs?: number;
}

export class CircuitBreaker {
	private readonly failures = new Map<string, number>();
	private readonly blockedUntil = new Map<string, number>();
	private readonly threshold: number;
	private readonly baseBlockMs: number;
	private readonly maxBlockMs: number;
	private readonly name: string;

	constructor({ name, threshold = 3, baseBlockMs = 10_000, maxBlockMs = 300_000 }: CircuitBreakerOptions) {
		this.name = name;
		this.threshold = threshold;
		this.baseBlockMs = baseBlockMs;
		this.maxBlockMs = maxBlockMs;
	}

	isOpen(key: string): boolean {
		const until = this.blockedUntil.get(key);
		if (until === undefined) return false;
		if (Date.now() < until) return true;
		this.failures.set(key, this.threshold - 1);
		this.blockedUntil.delete(key);
		return false;
	}

	recordFailure(key: string): void {
		const count = (this.failures.get(key) ?? 0) + 1;
		this.failures.set(key, count);
		if (count >= this.threshold) {
			const exponent = count - this.threshold;
			const block = Math.min(this.baseBlockMs * 2 ** exponent, this.maxBlockMs);
			this.blockedUntil.set(key, Date.now() + block);
			const seconds = Math.round(block / 1000);
			console.error(
				`[${this.name}] Blocking '${key}' for ${String(seconds)}s after ${String(count)} consecutive failures`,
			);
		}
	}

	recordSuccess(key: string): void {
		this.failures.delete(key);
		this.blockedUntil.delete(key);
	}
}
