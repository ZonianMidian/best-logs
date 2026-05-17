import { request as httpRequest } from './request.js';
import { USER_AGENT, userIdRegex, elapsedFrom } from './helpers.js';
import { config } from './config.js';
import { instanceLoader } from './instanceLoader.js';
import { infoService } from './infoService.js';
import type { LogsResult, RequestInfo } from '../types/logs.js';
import { InstanceStatus } from '../types/instance.js';
import type { InstanceResult, LogsAvailabilityDate } from '../types/instance.js';

interface InstanceAccumulator {
	Link: string;
	Full: string | undefined;
	channelFull: string | undefined;
	list: LogsAvailabilityDate[];
}

export class LogsService {
	private recentFailures = new Map<string, number>();
	private readonly FAILURE_COOLDOWN = 30_000;
	private inFlight = new Map<string, Promise<LogsResult>>();
	private lastSweep = 0;

	isCircuitBroken(url: string): boolean {
		return this.hasRecentFailure(url);
	}

	private hasRecentFailure(url: string): boolean {
		const ts = this.recentFailures.get(url);
		if (ts === undefined) return false;
		if (Date.now() - ts > this.FAILURE_COOLDOWN) {
			this.recentFailures.delete(url);
			return false;
		}
		return true;
	}

	private sweepFailures(): void {
		const now = Date.now();
		if (now - this.lastSweep < 60_000) return;
		this.lastSweep = now;
		for (const [key, ts] of this.recentFailures) {
			if (now - ts > this.FAILURE_COOLDOWN) this.recentFailures.delete(key);
		}
	}

	async getInstance(
		channel: string,
		user?: string | null,
		force?: boolean,
		pretty?: boolean,
		error?: string,
	): Promise<LogsResult> {
		this.sweepFailures();

		const forceLoad = force ?? false;
		if (!forceLoad) {
			const key = `${channel}:${user ?? ''}:${String(pretty ?? false)}`;
			const existing = this.inFlight.get(key);
			if (existing) return existing;
			const promise = this.fetchInstance(channel, user, false, pretty, error);
			this.inFlight.set(key, promise);
			void promise.finally(() => this.inFlight.delete(key));
			return promise;
		}

		return this.fetchInstance(channel, user, true, pretty, error);
	}

	private async fetchInstance(
		channel: string,
		user?: string | null,
		force?: boolean,
		pretty?: boolean,
		error?: string,
	): Promise<LogsResult> {
		const forceLoad = force ?? false;

		const instances = config.instances;
		const start = performance.now();

		let status = 200;
		let downSites = 0;
		let currentError: string | undefined = error;
		const requestInfo: RequestInfo = {
			channel: null,
			user: null,
			forced: forceLoad,
		};

		const optOuts: string[] = [];
		const userLinks: string[] = [];
		const channelLinks: string[] = [];
		const userInstances: string[] = [];
		const channelInstances: string[] = [];
		const userInstancesWithLength: InstanceAccumulator[] = [];
		const channelInstancesWithLength: InstanceAccumulator[] = [];

		if (forceLoad) {
			await instanceLoader.loopLoadInstanceChannels(true);
		}

		const [channelInfo, userInfo] = await Promise.all([
			infoService.getInfo(channel).catch(() => null),
			user ? infoService.getInfo(user).catch(() => null) : Promise.resolve(null),
		]);

		const channelLogin = channelInfo?.login;
		const id = channelInfo?.id;
		const banned = channelInfo?.banned;
		if (id) {
			requestInfo.channel = { login: channelLogin ?? '', id, banned: banned ?? false };
			if (banned) {
				channel = `id:${requestInfo.channel.id}`;
			}
		} else {
			currentError = `The channel does not exist: ${channel}`;
		}

		let userLogin: string | undefined;
		if (user) {
			userLogin = userInfo?.login;
			const userId = userInfo?.id;
			const userBanned = userInfo?.banned;
			if (userId) {
				requestInfo.user = { login: userLogin ?? '', id: userId, banned: userBanned ?? false };
				if (userBanned) {
					user = `id:${requestInfo.user.id}`;
				}
			} else {
				currentError = `The user does not exist: ${user}`;
			}
		}

		if (currentError) {
			status = 404;
		} else {
			const results = await Promise.allSettled(
				instances.map((i) =>
					this.getLogs(i, user ?? null, channel, forceLoad, pretty, banned, channelLogin, userLogin),
				),
			);
			const resolvedInstances = results
				.filter((r): r is PromiseFulfilledResult<InstanceResult> => r.status === 'fulfilled')
				.map((r) => r.value);

			for (const instance of resolvedInstances) {
				const { Status } = instance;

				switch (Status) {
					case InstanceStatus.Down: {
						downSites++;
						continue;
					}
					case InstanceStatus.UserAndChannel: {
						const { Link, Full, channelFull, list } = instance;
						channelInstancesWithLength.push({ Link, Full: channelFull, channelFull, list });
						userInstancesWithLength.push({ Link, Full, channelFull, list });
						continue;
					}
					case InstanceStatus.ChannelOnly: {
						const { Link, channelFull, list } = instance;
						channelInstancesWithLength.push({ Link, Full: channelFull, channelFull, list });
						continue;
					}
					case InstanceStatus.NoChannel: {
						continue;
					}
					case InstanceStatus.OptedOut: {
						const { Link } = instance;
						optOuts.push(Link);
						continue;
					}
				}
			}

			channelInstancesWithLength.sort((a, b) => b.list.length - a.list.length);
			userInstancesWithLength.sort((a, b) => b.list.length - a.list.length);

			for (const instance of channelInstancesWithLength) {
				channelInstances.push(instance.Link);
				if (instance.Full) channelLinks.push(instance.Full);
			}

			for (const instance of userInstancesWithLength) {
				userInstances.push(instance.Link);
				if (instance.Full) userLinks.push(instance.Full);
			}

			if (optOuts.length > 0 && channelInstances.length === 0) {
				currentError = 'User or channel has opted out';
				status = 403;
			} else if (channelInstances.length === 0) {
				currentError = 'No channel logs found';
				status = 404;
			} else if (userInstances.length === 0 && user) {
				currentError = 'No user logs found';
				status = 404;
			}
		}

		const elapsed = elapsedFrom(start);

		const channelList = channelInstancesWithLength[0]?.list ?? [];

		if (requestInfo.channel?.banned && channelInstances.length > 0) {
			instanceLoader.addChannel({ name: requestInfo.channel.login, userID: requestInfo.channel.id });
		}

		console.log(`[Logs] Channel: ${channel}${user ? ` - User: ${user}` : ''} | ${String(elapsed.ms)}ms`);

		return {
			error: currentError,
			status,
			instancesInfo: {
				count: instances.length,
				down: downSites,
			},
			request: requestInfo,
			available: {
				user: userInstances.length > 0,
				channel: channelInstances.length > 0,
			},
			loggedData: {
				list: channelList,
				days: channelList.length,
				since: channelList.at(-1) ?? null,
			},
			userLogs: {
				count: userInstances.length,
				instances: userInstances,
				fullLink: userLinks,
			},
			channelLogs: {
				count: channelInstances.length,
				instances: channelInstances,
				fullLink: channelLinks,
			},
			optedOut: {
				count: optOuts.length,
				instances: optOuts,
			},
			lastUpdated: {
				unix: Math.trunc(instanceLoader.lastUpdated / 1000),
				utc: new Date(instanceLoader.lastUpdated).toUTCString(),
			},
			elapsed,
		};
	}

	private async getLogs(
		url: string,
		user: string | null,
		channel: string,
		force: boolean,
		pretty?: boolean,
		banned?: boolean,
		channelLogin?: string,
		userLogin?: string,
	): Promise<InstanceResult> {
		const prettyFlag = pretty ?? false;

		const instanceCount = instanceLoader.instanceCounts.get(url);
		const channelPath = userIdRegex.test(channel) ? 'channelid' : 'channel';
		const channelClean = channel.replace('id:', '');

		if (!instanceCount) return { Status: InstanceStatus.Down };
		if (this.hasRecentFailure(url)) return { Status: InstanceStatus.Down };
		if (!banned && !instanceLoader.instanceChannelSets.get(url)?.has(channelClean))
			return { Status: InstanceStatus.NoChannel };

		const listCacheKey = `${url}:${channel}`;
		const channelDisplay = channelLogin ?? channelClean;
		const channelFull = prettyFlag
			? `https://tv.supa.sh/logs?c=${channelDisplay}`
			: `https://${url}/?${channelPath}=${channelClean}`;

		const fetchList = (): Promise<LogsAvailabilityDate[]> =>
			httpRequest(`https://${url}/list?${channelPath}=${channelClean}`, {
				headers: { 'User-Agent': USER_AGENT },
				timeout: 3000,
			})
				.then((res) => {
					const data = JSON.parse(res.body) as { availableLogs?: LogsAvailabilityDate[] };
					return data.availableLogs ?? [];
				})
				.catch((error: unknown) => {
					this.recentFailures.set(url, Date.now());
					const msg = error instanceof Error ? error.message : String(error);
					console.error(`[${url}] Failed loading ${channel} length: ${msg}`);
					return [] as LogsAvailabilityDate[];
				});

		if (!user) {
			const cached = instanceLoader.listData.get(listCacheKey);
			const listFresh = cached && !force && Date.now() - cached.ts < instanceLoader.LIST_TTL;
			const list = listFresh ? cached.list : await fetchList();
			if (!listFresh) instanceLoader.listData.set(listCacheKey, { list, ts: Date.now() });
			return { Status: InstanceStatus.ChannelOnly, Link: `https://${url}`, channelFull, list };
		}

		const userPath = userIdRegex.test(user) ? 'userid' : 'user';
		const userClean = user.replace('id:', '');
		const instanceCacheKey = `${url}:${channel}:${user}`;

		const fetchStatus = (): Promise<number> =>
			httpRequest(`https://${url}/list?${channelPath}=${channelClean}&${userPath}=${userClean}`, {
				headers: { 'User-Agent': USER_AGENT },
				timeout: 3000,
			})
				.then((res) => res.statusCode)
				.catch(() => 500);

		const cachedList = instanceLoader.listData.get(listCacheKey);
		const cachedStatus = instanceLoader.statusCodes.get(instanceCacheKey);
		const listFresh = cachedList && !force && Date.now() - cachedList.ts < instanceLoader.LIST_TTL;
		const statusFresh = cachedStatus && !force && Date.now() - cachedStatus.ts < instanceLoader.STATUS_TTL;

		const [list, statusCode] = await Promise.all([
			listFresh ? cachedList.list : fetchList(),
			statusFresh ? cachedStatus.code : fetchStatus(),
		]);

		if (!listFresh) instanceLoader.listData.set(listCacheKey, { list, ts: Date.now() });
		if (!statusFresh) instanceLoader.statusCodes.set(instanceCacheKey, { code: statusCode, ts: Date.now() });

		const userDisplay = userLogin ?? userClean;
		const fullLink = prettyFlag
			? `https://tv.supa.sh/logs?c=${channelDisplay}&u=${userDisplay}`
			: `https://${url}/?${channelPath}=${channelClean}&${userPath}=${userClean}`;

		if (statusCode === 403) return { Status: InstanceStatus.OptedOut, Link: `https://${url}` };

		return {
			list,
			channelFull,
			Status: Math.trunc(statusCode / 100) === 2 ? InstanceStatus.UserAndChannel : InstanceStatus.ChannelOnly,
			Link: `https://${url}`,
			Full: fullLink,
		};
	}
}

export const logsService = new LogsService();
