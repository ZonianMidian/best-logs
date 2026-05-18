export const enum InstanceStatus {
	Down = 0,
	UserAndChannel = 1,
	ChannelOnly = 2,
	NoChannel = 3,
	OptedOut = 4,
}

export interface Channel {
	name: string;
	userID: string;
}

export interface LogsAvailabilityDate {
	year: string;
	month: string;
	day: string;
}

export interface InstanceResultOk {
	Status: InstanceStatus.UserAndChannel | InstanceStatus.ChannelOnly;
	Link: string;
	Full?: string;
	channelFull: string;
	list: LogsAvailabilityDate[];
}

export interface InstanceResultOptOut {
	Status: InstanceStatus.OptedOut;
	Link: string;
}

export interface InstanceResultDown {
	Status: InstanceStatus.Down;
}

export interface InstanceResultNoChannel {
	Status: InstanceStatus.NoChannel;
}

export type InstanceResult = InstanceResultOk | InstanceResultOptOut | InstanceResultDown | InstanceResultNoChannel;

export interface InstancesInfo {
	count: number;
	down: number;
}
