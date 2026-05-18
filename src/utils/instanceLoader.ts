import { request as httpRequest } from './request.js';
import { USER_AGENT } from './helpers.js';
import { config } from './config.js';
import type { Channel, LogsAvailabilityDate } from '../types/instance.js';

interface ChannelsBody {
	channels: Channel[];
}

export class InstanceLoader {
	readonly LIST_TTL = 10 * 60 * 1000;
	readonly STATUS_TTL = 5 * 60 * 1000;

	readonly instanceCounts = new Map<string, number>();
	readonly instanceChannelSets = new Map<string, Set<string>>();
	uniqueChannels = new Map<string, Channel>();
	readonly statusCodes = new Map<string, { code: number; ts: number }>();
	readonly listData = new Map<string, { list: LogsAvailabilityDate[]; ts: number }>();
	lastUpdated = Date.now();
	readonly reloadInterval = 1 * 60 * 60 * 1000;

	private readonly errorInterval = 1 * 60 * 1000;
	private readonly sweepInterval = 5 * 60 * 1000;
	private errorLoop: ReturnType<typeof setInterval> | null = null;
	private loadLoop: ReturnType<typeof setInterval> | null = null;
	private sweepLoop: ReturnType<typeof setInterval> | null = null;
	private forceLoadPromise: Promise<void> | null = null;

	addChannel(channel: Channel): void {
		this.uniqueChannels.set(channel.userID, channel);
	}

	private sweepCaches(): void {
		const now = Date.now();
		for (const [key, value] of this.listData) {
			if (now - value.ts >= this.LIST_TTL) this.listData.delete(key);
		}
		for (const [key, value] of this.statusCodes) {
			if (now - value.ts >= this.STATUS_TTL) this.statusCodes.delete(key);
		}
	}

	async loadInstanceChannels(noLogs?: boolean, onlyError?: boolean): Promise<void> {
		let instances = config.instances;

		if (onlyError) {
			instances = instances.filter((url) => {
				const count = this.instanceCounts.get(url);
				return count === 0 || count === undefined;
			});
		}

		if (instances.length === 0) {
			if (!noLogs && !onlyError) {
				console.log(`[Logs] No instances found`);
			}
			return;
		}

		this.sweepCaches();

		// Full reload: build into a fresh map, then swap atomically (no clear() race window).
		// onlyError reload: instances had 0 channels before, so only new entries are added — write directly.
		const newUniqueChannels = onlyError ? null : new Map<string, Channel>();

		let instancesWorking = 0;
		await Promise.allSettled(
			instances.map(async (url) => {
				try {
					const response = await httpRequest(`https://${url}/channels`, {
						headers: { 'User-Agent': USER_AGENT },
						timeout: 10_000,
					});

					const logsData = JSON.parse(response.body) as ChannelsBody;
					if (logsData.channels.length === 0) throw new Error('No channels found');

					const currentInstanceChannels = logsData.channels;

					const channelSet = new Set<string>();
					for (const channel of currentInstanceChannels) {
						channelSet.add(channel.name);
						channelSet.add(channel.userID);
						if (newUniqueChannels) {
							newUniqueChannels.set(channel.userID, channel);
						} else {
							this.uniqueChannels.set(channel.userID, channel);
						}
					}

					this.instanceCounts.set(url, currentInstanceChannels.length);
					this.instanceChannelSets.set(url, channelSet);
					instancesWorking++;

					if (!noLogs) {
						console.log(`[${url}] Loaded ${String(currentInstanceChannels.length)} channels`);
					}
				} catch (error_) {
					const msg = error_ instanceof Error ? error_.message : String(error_);
					const error = error_ instanceof SyntaxError ? 'Invalid JSON' : msg;
					if (!noLogs) {
						console.error(`[${url}] Failed loading channels: ${error}`);
					}
					this.instanceCounts.set(url, 0);
					this.instanceChannelSets.set(url, new Set<string>());
				}
			}),
		);

		if (newUniqueChannels !== null) {
			this.uniqueChannels = newUniqueChannels;
		}

		if (!onlyError) {
			this.lastUpdated = Date.now();
		}

		if (!noLogs) {
			console.log(
				`[Logs] Loaded ${String(this.uniqueChannels.size)} unique channels from ${String(instancesWorking)}/${String(this.instanceCounts.size)} instances`,
			);
		}
	}

	startLoops(): void {
		clearInterval(this.loadLoop ?? undefined);
		this.loadLoop = setInterval(() => {
			void this.loadInstanceChannels();
		}, this.reloadInterval);

		clearInterval(this.sweepLoop ?? undefined);
		this.sweepLoop = setInterval(() => {
			this.sweepCaches();
		}, this.sweepInterval);

		void this.loopErrorInstanceChannels();
	}

	async loopLoadInstanceChannels(noLogs?: boolean): Promise<void> {
		if (noLogs) {
			// Force reload from a request: deduplicate concurrent callers
			if (this.forceLoadPromise) return this.forceLoadPromise;
			this.forceLoadPromise = this.loadInstanceChannels(noLogs).finally(() => {
				this.forceLoadPromise = null;
			});
			return this.forceLoadPromise;
		}

		clearInterval(this.loadLoop ?? undefined);
		await this.loadInstanceChannels(noLogs);
		this.loadLoop = setInterval(() => {
			void this.loadInstanceChannels(noLogs);
		}, this.reloadInterval);
	}

	async loopErrorInstanceChannels(): Promise<void> {
		clearInterval(this.errorLoop ?? undefined);

		await this.loadInstanceChannels(true, true);

		this.errorLoop = setInterval(() => {
			void this.loadInstanceChannels(true, true);
		}, this.errorInterval);
	}
}

export const instanceLoader = new InstanceLoader();
