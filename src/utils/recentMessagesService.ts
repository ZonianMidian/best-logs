import { request as httpRequest } from './request.js';
import { USER_AGENT, elapsedFrom } from './helpers.js';
import { config } from './config.js';
import { logsService } from './logsService.js';
import type { HttpResponse } from './request.js';
import type { RecentMessagesResult } from '../types/messages.js';
import type { LogsAvailabilityDate } from '../types/instance.js';

interface RecentMessagesBody {
	messages: string[];
	error?: string;
	error_code?: string;
	status_message?: string;
}

const TMI_SENT_REGEX = /tmi-sent-ts=(\d+)(;|\s:)/;

export class RecentMessagesService {
	async fetchMessages(instance: string, channel: string, searchParams: Record<string, string>): Promise<HttpResponse> {
		const url = new URL(`https://${instance}/api/v2/recent-messages/${channel}`);
		for (const [key, value] of Object.entries(searchParams)) {
			url.searchParams.set(key, value);
		}
		return httpRequest(url.toString(), {
			headers: { 'User-Agent': USER_AGENT },
			timeout: 5000,
		});
	}

	async fetchRustlogs(
		instance: string,
		channel: string,
		date: LogsAvailabilityDate,
		limit: number,
		firstTs: string | null,
	): Promise<string[]> {
		const { body } = await httpRequest(
			`${instance}/channel/${channel}/${date.year}/${date.month}/${date.day}?limit=${String(limit)}&raw&reverse`,
			{
				headers: { 'User-Agent': USER_AGENT },
				timeout: 3000,
			},
		);

		const firstTsNum = firstTs === null ? null : Number(firstTs);
		const result: string[] = [];

		// Adds @historical=1 tag so Chatterino differentiates historical from live messages.
		for (const message of body.split(/\r?\n/).toReversed().slice(1)) {
			if (!message.startsWith('@')) continue;

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
		const start = performance.now();

		const instances = config.recentmessagesInstances;
		const { rm_only } = searchParams;
		const limitNum = Math.min(Math.max(1, Number(searchParams.limit) || 1000), 10_000);

		if (instances.length === 0) {
			return {
				status: 503,
				status_message: undefined,
				error: 'No recent-messages instances configured',
				error_code: 'no_instances',
				instance: undefined,
				elapsed: elapsedFrom(start),
				count: 0,
				request: { channel, limit: limitNum },
				messages: [],
			};
		}

		let recentMessages: string[] = [];
		let messages: string[] = [];

		let statusMessage: string | undefined;
		let errorCode: string | null | undefined;
		let instance: string | undefined;
		let status = 500;
		let error: string | null | undefined;

		const capturedErrors: { body: RecentMessagesBody; statusCode: number; entry: string }[] = [];

		const rmWinner = await Promise.any(
			instances.map(async (entry) => {
				const { body: rawBody, statusCode } = await this.fetchMessages(entry, channel, searchParams);
				let body: RecentMessagesBody;
				try {
					body = JSON.parse(rawBody) as RecentMessagesBody;
				} catch {
					capturedErrors.push({ entry, body: { messages: [] }, statusCode });
					throw new Error('Invalid JSON response');
				}
				if (statusCode === 200 && body.messages.length > 0) {
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
			recentMessages = body.messages.filter((str) => !str.includes(':tmi.twitch.tv ROOMSTATE #'));
			messages = recentMessages;
			statusMessage = body.status_message;
			errorCode = body.error_code;
			error = body.error ?? null;
			instance = `https://${entry}`;
			status = statusCode;
		} else if (lastRmError) {
			statusMessage = lastRmError.body.status_message;
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
				const mainInstance = config.instances[0] ? `https://${config.instances[0]}` : '';
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
						const dayResults = await Promise.allSettled(
							daysToFetch.map((date) => this.fetchRustlogs(link, channel, date, limitNum, firstTs)),
						);

						let logsMessages = recentMessages;
						for (let i = dayResults.length - 1; i >= 0; i--) {
							const result = dayResults[i];
							if (result?.status === 'fulfilled' && result.value.length > 0) {
								logsMessages = [...result.value, ...logsMessages];
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

		const elapsed = elapsedFrom(start);

		console.log(
			`[RecentMessages] Channel: ${channel} | ${String(status)} - [${String(messages.length)}/${String(limitNum)}] | ${instance ?? 'none'} | ${String(elapsed.ms)}ms`,
		);

		const requestBase: Record<string, string | number> = { channel, limit: limitNum };
		const requestObj: Record<string, string | number | boolean> = {
			...requestBase,
			...Object.fromEntries(
				Object.entries(searchParams)
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
