import type { ElapsedInfo } from './common.js';

export interface RecentMessagesResult {
	status: number;
	status_message: string | undefined;
	error: string | null | undefined;
	error_code: string | null | undefined;
	instance: string | undefined;
	elapsed: ElapsedInfo;
	count: number;
	request: Record<string, string | number | boolean>;
	messages: string[];
}
