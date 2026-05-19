import type { ElapsedInfo } from './common.js';

export interface RecentMessagesResult {
	status: number;
	status_message: string | null;
	error: string | null;
	error_code: string | null;
	instance: string | null;
	elapsed: ElapsedInfo;
	count: number;
	request: Record<string, string | number | boolean>;
	messages: string[];
}
