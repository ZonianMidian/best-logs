import { parseJsonResponse, requestText } from './request.js';
import { USER_AGENT, userIdRegex, elapsedFrom } from './helpers.js';
import { config } from './config.js';
import { instanceLoader } from './instanceLoader.js';
import { infoService } from './infoService.js';
import { InFlight } from './cache.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { LookupNotFoundError } from './errors.js';
import type { LogsResult, RequestInfo } from '../types/logs.js';
import { InstanceStatus } from '../types/instance.js';
import type { InstanceResult, LogsAvailabilityDate } from '../types/instance.js';
import type { LogInstanceConfig } from './config.js';

interface InstanceAccumulator {
	Link: string;
	Full: string | undefined;
	channelFull: string | undefined;
	list: LogsAvailabilityDate[];
}

const isNotFoundError = (error: unknown): boolean => error instanceof LookupNotFoundError;

export class LogsService {
	private readonly circuit = new CircuitBreaker({ name: 'Logs' });
	private readonly inFlight = new InFlight<string, LogsResult>(20_000);

	isCircuitBroken(url: string): boolean {
		return this.circuit.isOpen(url.replace(/^https?:\/\//, ''));
	}

	async getInstance(
		channel: string,
		user?: string | null,
		force?: boolean,
		pretty?: boolean,
		error?: string,
	): Promise<LogsResult> {
		const forceLoad = force ?? false;
		if (!forceLoad) {
			const key = `${channel}:${user ?? ''}:${String(pretty ?? false)}`;
			return this.inFlight.run(key, () => this.fetchInstance(channel, user, false, pretty, error));
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
		let currentError: string | null = error ?? null;
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
			await instanceLoader.forceReloadInstanceChannels();
		}

		const [channelResult, userResult] = await Promise.all([
			infoService
				.getInfo(channel)
				.then((v) => ({ ok: true as const, v }))
				.catch((error_: unknown) => ({ ok: false as const, e: error_ })),
			user
				? infoService
						.getInfo(user)
						.then((v) => ({ ok: true as const, v }))
						.catch((error_: unknown) => ({ ok: false as const, e: error_ }))
				: Promise.resolve(null),
		]);

		const channelInfo = channelResult.ok ? channelResult.v : null;
		const userInfo = userResult?.ok ? userResult.v : null;

		let channelLogin: string | undefined;
		let banned: boolean | undefined;

		if (channelResult.ok) {
			channelLogin = channelInfo?.login;
			const id = channelInfo?.id;
			banned = channelInfo?.banned;
			if (id) {
				requestInfo.channel = { login: channelLogin ?? '', id, banned: banned ?? false };
				if (banned) {
					channel = `id:${requestInfo.channel.id}`;
				}
			} else {
				currentError = `The channel does not exist: ${channel}`;
				status = 404;
			}
		} else {
			if (isNotFoundError(channelResult.e)) {
				currentError = `The channel does not exist: ${channel}`;
				status = 404;
			} else {
				currentError = `Could not look up channel: service unavailable`;
				status = 502;
			}
		}

		let userLogin: string | undefined;
		if (user && !currentError) {
			if (userResult?.ok) {
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
					status = 404;
				}
			} else {
				if (isNotFoundError(userResult?.e)) {
					currentError = `The user does not exist: ${user}`;
					status = 404;
				} else {
					currentError = `Could not look up user: service unavailable`;
					status = 502;
				}
			}
		}

		if (!currentError) {
			const results = await Promise.allSettled(
				instances.map((instance) =>
					this.getLogs(instance, user ?? null, channel, forceLoad, pretty, banned, channelLogin, userLogin),
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
		instance: LogInstanceConfig,
		user: string | null,
		channel: string,
		force: boolean,
		pretty?: boolean,
		banned?: boolean,
		channelLogin?: string,
		userLogin?: string,
	): Promise<InstanceResult> {
		const prettyFlag = pretty ?? false;
		const { host, apiHost } = instance;

		const instanceCount = instanceLoader.instanceCounts.get(host);
		const channelPath = userIdRegex.test(channel) ? 'channelid' : 'channel';
		const channelClean = channel.replace('id:', '');

		if (!instanceCount) return { Status: InstanceStatus.Down };
		if (this.circuit.isOpen(host)) return { Status: InstanceStatus.Down };
		if (!banned && !instanceLoader.instanceChannelSets.get(host)?.has(channelClean))
			return { Status: InstanceStatus.NoChannel };

		const listCacheKey = `${host}:${channel}`;
		const channelDisplay = banned ? channelClean : (channelLogin ?? channelClean);
		const channelFull = prettyFlag
			? `https://tv.supa.sh/logs?c=${channelDisplay}`
			: `https://${host}/?channel=${channel}`;

		const fetchList = (): Promise<LogsAvailabilityDate[] | null> =>
			requestText(`https://${apiHost}/list?${channelPath}=${channelClean}`, {
				headers: { 'User-Agent': USER_AGENT },
				timeout: 5000,
			})
				.then((res) => {
					if (res.statusCode >= 500) throw new Error(`HTTP ${String(res.statusCode)}`);
					const data = parseJsonResponse<{ availableLogs?: LogsAvailabilityDate[] }>(res).body;
					this.circuit.recordSuccess(host);
					return data.availableLogs ?? [];
				})
				.catch((error: unknown) => {
					this.circuit.recordFailure(host);
					const msg = error instanceof Error ? error.message : String(error);
					console.error(`[${host}] Failed loading ${channel} length: ${msg}`);
					return null;
				});

		if (!user) {
			const cachedList = force ? undefined : instanceLoader.listData.get(listCacheKey);
			const list = cachedList ?? (await fetchList());
			if (list === null) return { Status: InstanceStatus.Down };
			if (cachedList === undefined) instanceLoader.listData.set(listCacheKey, list);
			return { Status: InstanceStatus.ChannelOnly, Link: `https://${host}`, channelFull, list };
		}

		const userPath = userIdRegex.test(user) ? 'userid' : 'user';
		const userClean = user.replace('id:', '');
		const instanceCacheKey = `${host}:${channel}:${user}`;

		const fetchStatus = (): Promise<number | null> =>
			requestText(`https://${apiHost}/list?${channelPath}=${channelClean}&${userPath}=${userClean}`, {
				headers: { 'User-Agent': USER_AGENT },
				timeout: 5000,
			})
				.then((res) => {
					if (res.statusCode >= 500) throw new Error(`HTTP ${String(res.statusCode)}`);
					this.circuit.recordSuccess(host);
					return res.statusCode;
				})
				.catch((error: unknown) => {
					this.circuit.recordFailure(host);
					const msg = error instanceof Error ? error.message : String(error);
					console.error(`[${host}] Failed loading ${channel}/${user} status: ${msg}`);
					return null;
				});

		const cachedList = force ? undefined : instanceLoader.listData.get(listCacheKey);
		const cachedStatus = force ? undefined : instanceLoader.statusCodes.get(instanceCacheKey);

		const [list, statusCode] = await Promise.all([
			cachedList === undefined ? fetchList() : Promise.resolve(cachedList),
			cachedStatus === undefined ? fetchStatus() : Promise.resolve(cachedStatus),
		]);

		if (list === null) return { Status: InstanceStatus.Down };
		if (cachedList === undefined) instanceLoader.listData.set(listCacheKey, list);
		if (cachedStatus === undefined && statusCode !== null) instanceLoader.statusCodes.set(instanceCacheKey, statusCode);

		const userDisplay = userLogin ?? userClean;
		const fullLink = prettyFlag
			? `https://tv.supa.sh/logs?c=${channelDisplay}&u=${userDisplay}`
			: `https://${host}/?channel=${channel}&username=${user}`;

		if (statusCode === null) return { Status: InstanceStatus.Down };
		if (statusCode === 403) return { Status: InstanceStatus.OptedOut, Link: `https://${host}` };

		return {
			list,
			channelFull,
			Status: Math.trunc(statusCode / 100) === 2 ? InstanceStatus.UserAndChannel : InstanceStatus.ChannelOnly,
			Link: `https://${host}`,
			Full: fullLink,
		};
	}
}

export const logsService = new LogsService();
