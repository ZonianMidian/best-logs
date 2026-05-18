import { request as httpRequest } from './request.js';
import { USER_AGENT } from './helpers.js';
import { config } from './config.js';
import { infoService } from './infoService.js';
import type { NameHistoryEntry } from '../types/user.js';

export class NameHistoryService {
	async getNameHistory(user: string): Promise<NameHistoryEntry[]> {
		if (!user.startsWith('login:') && Number.isNaN(Number(user))) {
			throw Object.assign(
				new Error(
					"The value must be an ID or use 'login:' to refer to usernames. Example: 754201843 or login:zonianmidian",
				),
				{ status: 400 },
			);
		}

		if (user.startsWith('login:')) {
			user = user.replace('login:', '');
			const userInfo = await infoService.getInfo(user);
			user = userInfo.id;
		}

		const nameHistoryMap = new Map<string, NameHistoryEntry>();

		await Promise.allSettled(
			config.instances.map(async (url) => {
				try {
					const historyData = await httpRequest(`https://${url}/namehistory/${user}`, {
						headers: { 'User-Agent': USER_AGENT },
						timeout: 10_000,
					});

					const historyBody = JSON.parse(historyData.body) as NameHistoryEntry[];
					if (historyData.statusCode !== 200 || !Array.isArray(historyBody)) return;

					console.log(`[${url}] Found ${String(historyBody.length)} registered usernames for ID ${user}`);

					for (const entry of historyBody) {
						const existing = nameHistoryMap.get(entry.user_login);
						if (existing) {
							if (entry.last_timestamp > existing.last_timestamp) existing.last_timestamp = entry.last_timestamp;
							if (entry.first_timestamp < existing.first_timestamp) existing.first_timestamp = entry.first_timestamp;
						} else {
							nameHistoryMap.set(entry.user_login, { ...entry });
						}
					}
				} catch {
					// silently skip failed instances
				}
			}),
		);

		const nameHistory = [...nameHistoryMap.values()];
		nameHistory.sort((a, b) =>
			a.last_timestamp < b.last_timestamp ? -1 : a.last_timestamp > b.last_timestamp ? 1 : 0,
		);

		console.log(`[NameHistory] Found ${String(nameHistory.length)} unique usernames for ID ${user}`);

		return nameHistory;
	}
}

export const nameHistoryService = new NameHistoryService();
