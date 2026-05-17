import { request as httpRequest } from './request.js';
import { USER_AGENT, userIdRegex } from './helpers.js';
import type { UserInfo } from '../types/user.js';

interface IvrUserData {
	displayName: string;
	login: string;
	logo: string;
	id: string;
	banned: boolean;
}

export class InfoService {
	private infoCache = new Map<string, { data: IvrUserData; ts: number }>();
	private negativeCache = new Map<string, number>();
	private inFlight = new Map<string, Promise<UserInfo>>();
	private readonly TTL = 60 * 60 * 1000;
	private readonly NEGATIVE_TTL = 60_000;
	private lastSweep = 0;

	async getInfo(user: string): Promise<UserInfo> {
		this.sweepCache();

		const negTS = this.negativeCache.get(user);
		if (negTS !== undefined && Date.now() - negTS < this.NEGATIVE_TTL) {
			throw new Error(`User not found: ${user}`);
		}

		const cached = this.infoCache.get(user);
		if (cached && Date.now() - cached.ts < this.TTL) {
			return this.transform(cached.data);
		}

		const inflight = this.inFlight.get(user);
		if (inflight) return inflight;

		const promise = this.fetch(user);
		this.inFlight.set(user, promise);
		void promise.finally(() => this.inFlight.delete(user));
		return promise;
	}

	private sweepCache(): void {
		const now = Date.now();
		if (now - this.lastSweep < 60_000) return;
		this.lastSweep = now;
		for (const [key, value] of this.infoCache) {
			if (now - value.ts >= this.TTL) this.infoCache.delete(key);
		}
		for (const [key, ts] of this.negativeCache) {
			if (now - ts >= this.NEGATIVE_TTL) this.negativeCache.delete(key);
		}
	}

	private async fetch(user: string): Promise<UserInfo> {
		const isId = userIdRegex.test(user);
		const params = new URLSearchParams({ [isId ? 'id' : 'login']: user.replace('id:', '') });
		const response = await httpRequest(`https://api.ivr.fi/v2/twitch/user?${params.toString()}`, {
			headers: { 'User-Agent': USER_AGENT },
			timeout: 5000,
		});
		if (response.statusCode < 200 || response.statusCode > 299) {
			throw new Error(`IVR API error: ${String(response.statusCode)}`);
		}
		const body = JSON.parse(response.body) as IvrUserData[];
		const fetched = body[0];
		if (!fetched?.id) {
			this.negativeCache.set(user, Date.now());
			throw new Error(`User not found: ${user}`);
		}
		this.infoCache.set(user, { data: fetched, ts: Date.now() });
		return this.transform(fetched);
	}

	private transform(data: IvrUserData): UserInfo {
		const { displayName, login, logo: avatar, id, banned } = data;
		const name = displayName.toLowerCase() === login ? displayName : login;
		return { name, login, avatar, id, banned };
	}
}

export const infoService = new InfoService();
