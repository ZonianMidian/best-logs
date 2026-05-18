export interface TTLCacheOptions {
	ttl: number;
	sweepInterval?: number;
	maxSize?: number;
}

export class TTLCache<K, V> {
	private readonly cache = new Map<K, { value: V; expiresAt: number }>();
	private readonly ttl: number;
	private readonly maxSize: number | undefined;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor({ ttl, sweepInterval, maxSize }: TTLCacheOptions) {
		this.ttl = ttl;
		this.maxSize = maxSize;
		if (sweepInterval !== undefined) {
			this.timer = setInterval(() => {
				this.sweep();
			}, sweepInterval);
			this.timer.unref();
		}
	}

	set(key: K, value: V): void {
		this.cache.delete(key);
		this.cache.set(key, { value, expiresAt: Date.now() + this.ttl });
		if (this.maxSize !== undefined && this.cache.size > this.maxSize) {
			this.evict();
		}
	}

	get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (entry === undefined) return undefined;
		if (Date.now() >= entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}

	has(key: K): boolean {
		return this.get(key) !== undefined;
	}

	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}

	sweep(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (now >= entry.expiresAt) this.cache.delete(key);
		}
	}

	values(): IterableIterator<V> {
		const now = Date.now();
		const cache = this.cache;
		return (function* () {
			for (const entry of cache.values()) {
				if (now < entry.expiresAt) yield entry.value;
			}
		})();
	}

	entries(): IterableIterator<[K, V]> {
		const now = Date.now();
		const cache = this.cache;
		return (function* () {
			for (const [key, entry] of cache) {
				if (now < entry.expiresAt) yield [key, entry.value] as [K, V];
			}
		})();
	}

	private evict(): void {
		const firstKey = this.cache.keys().next().value;
		if (firstKey !== undefined) {
			this.cache.delete(firstKey);
		}
	}

	destroy(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}

export class InFlight<K, V> {
	private readonly map = new Map<K, Promise<V>>();

	constructor(private readonly maxSize = 10_000) {}

	run(key: K, fn: () => Promise<V>): Promise<V> {
		const existing = this.map.get(key);
		if (existing !== undefined) return existing;
		if (this.map.size >= this.maxSize) return fn();
		const promise = fn();
		this.map.set(key, promise);
		void promise.finally(() => this.map.delete(key));
		return promise;
	}
}
