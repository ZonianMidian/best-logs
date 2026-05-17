export interface TwitchUser {
	login: string;
	id: string;
	banned: boolean;
}

export interface UserInfo extends TwitchUser {
	name: string;
	avatar: string;
}

export interface NameHistoryEntry {
	user_login: string;
	last_timestamp: string;
	first_timestamp: string;
}
