import type { ElapsedInfo } from '../types/common.js';

export const USER_AGENT = 'Best Logs by ZonianMidian';
export const userIdRegex = /^id:(\d+)$/i;
export const userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d+)$/i;
export const formatUsername = (username: string): string => {
	try {
		return decodeURIComponent(username.replaceAll(/[@#,]/g, '').toLowerCase());
	} catch {
		return username.replaceAll(/[@#,]/g, '').toLowerCase();
	}
};

export function elapsedFrom(start: number): ElapsedInfo {
	const end = performance.now();
	return {
		ms: Math.round((end - start) * 100) / 100,
		s: Math.round((end - start) / 10) / 100,
	};
}

export function formatError(error: unknown): string {
	const msg = error instanceof Error ? error.message : '';
	return `Internal error${msg ? ` - ${msg}` : ''}`;
}

export function checkInstances(instances: Map<string, number>): { count: number; down: number } {
	let down = 0;
	for (const count of instances.values()) {
		if (count === 0) down++;
	}
	return { count: instances.size, down };
}
