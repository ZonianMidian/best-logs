import { parseJsonResponse, requestText } from './request.js';
import { USER_AGENT, elapsedFrom } from './helpers.js';
import { config } from './config.js';
import { logsService } from './logsService.js';
import { InFlight } from './cache.js';
import type { HttpResponse } from './request.js';
import type { RecentMessagesResult } from '../types/messages.js';
import type { LogsAvailabilityDate } from '../types/instance.js';

interface RecentMessagesBody {
	messages?: string[];
	error?: string;
	error_code?: string;
	status_message?: string;
}

const TMI_SENT_REGEX = /tmi-sent-ts=(\d+)(;|\s:)/;

export class RecentMessagesService {
	private readonly inFlight = new InFlight<string, RecentMessagesResult>(5000);

	async fetchMessages(
		instance: string,
		channel: string,
		searchParams: Record<string, string>,
		signal?: AbortSignal,
	): Promise<HttpResponse> {
		const url = new URL(`https://${instance}/api/v2/recent-messages/${channel}`);
		for (const [key, value] of Object.entries(searchParams)) {
			url.searchParams.set(key, value);
		}
		return requestText(url.toString(), {
			headers: { 'User-Agent': USER_AGENT },
			timeout: 5000,
			...(signal === undefined ? {} : { signal }),
		});
	}

	async fetchRustlogs(
		instance: string,
		channel: string,
		date: LogsAvailabilityDate,
		limit: number,
		firstTs: string | null,
	): Promise<string[]> {
		const { body } = await requestText(
			`${instance}/channel/${channel}/${date.year}/${date.month}/${date.day}?limit=${String(limit)}&raw&reverse`,
			{
				headers: { 'User-Agent': USER_AGENT },
				timeout: 5000,
			},
		);

		const firstTsNum = firstTs === null ? null : Number(firstTs);
		const result: string[] = [];

		for (const message of body.split(/\r?\n/).toReversed().slice(1)) {
			if (!message) continue;

			if (!message.startsWith('@')) {
				result.push(message);
				continue;
			}

			const match = TMI_SENT_REGEX.exec(message);
			let transformed = message;

			if (match) {
				const timestamp = Number(match[1]);
				if (firstTsNum !== null && timestamp >= firstTsNum) continue;
				transformed = message.replace(
					`tmi-sent-ts=${String(timestamp)};`,
					`tmi-sent-ts=${String(timestamp)};rm-received-ts=${String(timestamp)};`,
				);
			}

			result.push(`@historical=1;${transformed.slice(1)}`);
		}

		return result;
	}

	async getRecentMessages(channel: string, searchParams: Record<string, string>): Promise<RecentMessagesResult> {
		const key = `${channel}:${new URLSearchParams(Object.entries(searchParams).toSorted()).toString()}`;
		return this.inFlight.run(key, () => this.fetchRecentMessages(channel, searchParams));
	}

	private async fetchRecentMessages(
		channel: string,
		searchParams: Record<string, string>,
	): Promise<RecentMessagesResult> {
		const start = performance.now();

		const instances = config.recentmessagesInstances;
		const { rm_only, ...upstreamParams } = searchParams;
		const limitNum = Math.min(Math.max(1, Number(searchParams.limit) || 1000), 10_000);
		upstreamParams.limit = String(limitNum);

		if (instances.length === 0) {
			return {
				status: 503,
				status_message: null,
				error: 'No recent-messages instances configured',
				error_code: 'no_instances',
				instance: null,
				elapsed: elapsedFrom(start),
				count: 0,
				request: { channel, limit: limitNum },
				messages: [],
			};
		}

		let recentMessages: string[] = [];
		let messages: string[] = [];

		let statusMessage: string | null = null;
		let errorCode: string | null = null;
		let instance: string | null = null;
		let status = 500;
		let error: string | null = null;

		const capturedErrors: { body: RecentMessagesBody; statusCode: number; entry: string }[] = [];

		const rmController = new AbortController();
		const rmWinner = await Promise.any(
			instances.map(async (entry) => {
				const response = await this.fetchMessages(entry, channel, upstreamParams, rmController.signal);
				const { statusCode } = response;
				let body: RecentMessagesBody;
				try {
					body = parseJsonResponse<RecentMessagesBody>(response).body;
				} catch {
					capturedErrors.push({ entry, body: { messages: [] }, statusCode });
					throw new Error('Invalid JSON response');
				}
				if (statusCode === 200 && Array.isArray(body.messages) && body.messages.length > 0) {
					rmController.abort();
					console.log(
						`[${entry}] Channel: ${channel} | ${String(statusCode)} - ${String(body.messages.length)} messages`,
					);
					return { entry, body, statusCode };
				}
				capturedErrors.push({ entry, body, statusCode });
				console.error(`[${entry}] Channel: ${channel} | ${String(statusCode)} - ${body.error ?? 'No messages'}`);
				throw new Error(body.error ?? 'No messages');
			}),
		).catch(() => null);

		const lastRmError = capturedErrors.at(-1) ?? null;

		if (rmWinner) {
			const { entry, body, statusCode } = rmWinner;
			recentMessages = (body.messages ?? [])
				.filter((str) => !str.includes(':tmi.twitch.tv ROOMSTATE #'))
				.slice(-limitNum);
			messages = recentMessages;
			statusMessage = body.status_message ?? null;
			errorCode = body.error_code ?? null;
			error = body.error ?? null;
			instance = `https://${entry}`;
			status = statusCode;
		} else if (lastRmError) {
			statusMessage = lastRmError.body.status_message ?? null;
			instance = `https://${lastRmError.entry}`;
			status = lastRmError.statusCode;
			errorCode = lastRmError.body.error_code ?? 'internal_server_error';
			error = lastRmError.body.error ?? 'Internal Server Error';
		}

		const firstMsg = messages[0];
		const firstTs = (firstMsg === undefined ? null : TMI_SENT_REGEX.exec(firstMsg))?.[1] ?? null;

		if (rm_only !== 'true' && recentMessages.length < limitNum) {
			const logs = await logsService.getInstance(channel);

			if (logs.available.channel) {
				let logInstances = logs.channelLogs.instances.filter((link) => !logsService.isCircuitBroken(link));
				const mainInstance = config.instances[0] ? `https://${config.instances[0].host}` : '';
				const mainIdx = logInstances.indexOf(mainInstance);
				if (mainIdx > 0) {
					const mainEntry = logInstances[mainIdx];
					if (mainEntry) {
						logInstances = [mainEntry, ...logInstances.slice(0, mainIdx), ...logInstances.slice(mainIdx + 1)];
					}
				}

				for (const link of logInstances) {
					try {
						const daysToFetch = logs.loggedData.list.slice(0, 7);
						let logsMessages = recentMessages;

						for (const date of daysToFetch) {
							const remaining = limitNum - logsMessages.length;
							if (remaining <= 0) break;

							try {
								const dayMessages = await this.fetchRustlogs(link, channel, date, remaining, firstTs);
								if (dayMessages.length > 0) {
									logsMessages = [...dayMessages.slice(-remaining), ...logsMessages].slice(-limitNum);
								}
							} catch (dayError) {
								if (logsMessages.length === recentMessages.length) {
									throw dayError;
								}
							}
						}

						console.log(
							`[${link.replace('https://', '')}] Channel: ${channel} | 200 - ${String(logsMessages.length)} messages`,
						);

						if (logsMessages.length > messages.length) {
							messages = logsMessages;
							instance = link;
							errorCode = null;
							error = null;
							status = 200;
							break;
						}
					} catch (error_) {
						const msg = error_ instanceof Error ? error_.message : String(error_);
						console.error(`[${link.replace('https://', '')}] Channel: ${channel} | Failed loading messages: ${msg}`);
					}
				}
			}
		}

		messages = messages.slice(-limitNum);
		const elapsed = elapsedFrom(start);

		console.log(
			`[RecentMessages] Channel: ${channel} | ${String(status)} - [${String(messages.length)}/${String(limitNum)}] | ${instance ?? 'none'} | ${String(elapsed.ms)}ms`,
		);

		const requestBase: Record<string, string | number> = { channel, limit: limitNum };
		const requestObj: Record<string, string | number | boolean> = {
			...requestBase,
			...Object.fromEntries(
				Object.entries(upstreamParams)
					.filter(([key]) => !(key in requestBase))
					.map(([key, value]) => [key, value === 'true' ? true : value === 'false' ? false : value]),
			),
		};

		return {
			status,
			status_message: statusMessage,
			error,
			error_code: errorCode,
			instance,
			elapsed,
			count: messages.length,
			request: requestObj,
			messages,
		};
	}
}

export const recentMessagesService = new RecentMessagesService();
