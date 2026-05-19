import { requestJson } from './request.js';
import { USER_AGENT } from './helpers.js';
import { config } from './config.js';
import { TTLCache } from './cache.js';
import type { Channel, LogsAvailabilityDate } from '../types/instance.js';

interface ChannelsBody {
	channels: Channel[];
}

interface InstanceReloadOptions {
	silent?: boolean;
	failedOnly?: boolean;
}

interface InstanceUpdate {
	host: string;
	channels: Channel[];
	channelSet: Set<string>;
	count: number;
}

interface InstanceError {
	host: string;
	hadExisting: boolean;
}

export class InstanceLoader {
	readonly instanceCounts = new Map<string, number>();
	readonly instanceChannels = new Map<string, Channel[]>();
	readonly instanceChannelSets = new Map<string, Set<string>>();
	uniqueChannels = new Map<string, Channel>();
	uniqueChannelsArray: Channel[] = [];
	lastUpdated = Date.now();
	readonly reloadInterval = 1 * 60 * 60 * 1000;

	readonly listData = new TTLCache<string, LogsAvailabilityDate[]>({
		ttl: 10 * 60 * 1000,
		sweepInterval: 5 * 60 * 1000,
		maxSize: 100_000,
	});
	readonly statusCodes = new TTLCache<string, number>({
		ttl: 5 * 60 * 1000,
		sweepInterval: 5 * 60 * 1000,
		maxSize: 200_000,
	});

	private readonly errorInterval = 1 * 60 * 1000;
	private failedReloadLoop: ReturnType<typeof setInterval> | null = null;
	private reloadLoop: ReturnType<typeof setInterval> | null = null;
	private forceReloadPromise: Promise<void> | null = null;

	addChannel(channel: Channel): void {
		if (!this.uniqueChannels.has(channel.userID)) {
			this.uniqueChannels.set(channel.userID, channel);
			this.uniqueChannelsArray.push(channel);
		}
	}

	async reloadInstanceChannels(options: InstanceReloadOptions = {}): Promise<void> {
		const { silent = false, failedOnly = false } = options;
		let instances = config.instances;

		if (failedOnly) {
			instances = instances.filter(({ host }) => {
				const count = this.instanceCounts.get(host);
				return count === 0 || count === undefined;
			});
		}

		if (instances.length === 0) {
			if (!silent && !failedOnly) {
				console.log(`[Logs] No instances found`);
			}
			return;
		}

		const loadedChannels = new Map<string, Channel>();
		const successUpdates: InstanceUpdate[] = [];
		const errorUpdates: InstanceError[] = [];

		await Promise.allSettled(
			instances.map(async ({ host, apiHost }) => {
				try {
					const response = await requestJson<ChannelsBody>(`https://${apiHost}/channels`, {
						headers: { 'User-Agent': USER_AGENT },
						timeout: 10_000,
					});

					const logsData = response.body;
					if (logsData.channels.length === 0) throw new Error('No channels found');

					const currentInstanceChannels = logsData.channels;

					const channelSet = new Set<string>();
					for (const channel of currentInstanceChannels) {
						channelSet.add(channel.name);
						channelSet.add(channel.userID);
						loadedChannels.set(channel.userID, channel);
					}

					successUpdates.push({
						host,
						channels: currentInstanceChannels,
						channelSet,
						count: currentInstanceChannels.length,
					});

					if (!silent) {
						console.log(`[${host}] Loaded ${String(currentInstanceChannels.length)} channels`);
					}
				} catch (error_) {
					const msg = error_ instanceof Error ? error_.message : String(error_);
					const error = error_ instanceof SyntaxError ? 'Invalid JSON' : msg;
					if (!silent) {
						console.error(`[${host}] Failed loading channels: ${error}`);
					}
					errorUpdates.push({ host, hadExisting: this.instanceChannels.has(host) });
				}
			}),
		);

		const instancesWorking = successUpdates.length;

		for (const { host, channels, channelSet, count } of successUpdates) {
			this.instanceCounts.set(host, count);
			this.instanceChannels.set(host, channels);
			this.instanceChannelSets.set(host, channelSet);
		}

		for (const { host, hadExisting } of errorUpdates) {
			this.instanceCounts.set(host, 0);
			if (!hadExisting) {
				this.instanceChannels.set(host, []);
				this.instanceChannelSets.set(host, new Set<string>());
			}
		}

		if (failedOnly) {
			for (const [id, channel] of loadedChannels) {
				if (!this.uniqueChannels.has(id)) {
					this.uniqueChannels.set(id, channel);
					this.uniqueChannelsArray.push(channel);
				}
			}
		} else if (instancesWorking > 0) {
			this.uniqueChannels = loadedChannels;
			this.uniqueChannelsArray = [...loadedChannels.values()];
		}

		if (!failedOnly && instancesWorking > 0) {
			this.listData.clear();
			this.statusCodes.clear();
			this.lastUpdated = Date.now();
		}

		if (!silent) {
			console.log(
				`[Logs] Loaded ${String(this.uniqueChannels.size)} unique channels from ${String(instancesWorking)}/${String(this.instanceCounts.size)} instances`,
			);
		}
	}

	startLoops(): void {
		clearInterval(this.reloadLoop ?? undefined);
		this.reloadLoop = setInterval(() => {
			void this.reloadInstanceChannels();
		}, this.reloadInterval);

		void this.startFailedInstanceReloadLoop();
	}

	async forceReloadInstanceChannels(): Promise<void> {
		if (this.forceReloadPromise) return this.forceReloadPromise;
		this.forceReloadPromise = this.reloadInstanceChannels({ silent: true }).finally(() => {
			this.forceReloadPromise = null;
		});
		return this.forceReloadPromise;
	}

	private async startFailedInstanceReloadLoop(): Promise<void> {
		clearInterval(this.failedReloadLoop ?? undefined);

		await this.reloadInstanceChannels({ silent: true, failedOnly: true });

		this.failedReloadLoop = setInterval(() => {
			void this.reloadInstanceChannels({ silent: true, failedOnly: true });
		}, this.errorInterval);
	}

	stopLoops(): void {
		clearInterval(this.reloadLoop ?? undefined);
		clearInterval(this.failedReloadLoop ?? undefined);
		this.reloadLoop = null;
		this.failedReloadLoop = null;
		this.listData.destroy();
		this.statusCodes.destroy();
	}
}

export const instanceLoader = new InstanceLoader();
