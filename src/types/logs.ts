import type { LogsAvailabilityDate, InstancesInfo } from './instance.js';
import type { ElapsedInfo } from './common.js';
import type { TwitchUser } from './user.js';

export interface RequestInfo {
	channel: TwitchUser | null;
	user: TwitchUser | null;
	forced: boolean;
}

export interface LoggedData {
	list: LogsAvailabilityDate[];
	days: number;
	since: LogsAvailabilityDate | null;
}

export interface InstanceSet {
	count: number;
	instances: string[];
}

export interface InstanceGroup extends InstanceSet {
	fullLink: string[];
}

export interface LogsResult {
	error: string | null;
	status: number;
	instancesInfo: InstancesInfo;
	request: RequestInfo;
	available: { user: boolean; channel: boolean };
	loggedData: LoggedData;
	userLogs: InstanceGroup;
	channelLogs: InstanceGroup;
	optedOut: InstanceSet;
	lastUpdated: { unix: number; utc: string };
	elapsed: ElapsedInfo;
}
