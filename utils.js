import fs from 'fs/promises';
import got from 'got';

const loadConfig = async () => {
	try {
		// Try to read the custom config file
		const data = await fs.readFile('./config.json', 'utf-8');
		const config = JSON.parse(data);

		const defaultData = await fs.readFile('./example_config.json', 'utf-8');
		const defaultConfig = JSON.parse(defaultData);

		// Merge objects, giving priority to config.json over example_config.json
		return { ...defaultConfig, ...config };
	} catch (error) {
		if (error.code === 'ENOENT') {
			// If the file does not exist, load the example file
			const defaultData = await fs.readFile('./example_config.json', 'utf-8');
			return JSON.parse(defaultData);
		} else {
			throw error;
		}
	}
};

const loadedConfig = await loadConfig();
console.log(`- [Config] Loaded config`);

export class Utils {
	channelLinkRegex = /channel(?:id)?([\/=])([a-z0-9]\w{0,24})/i;
	userLinkRegex = /user(?:id)?([\/=])([a-z0-9]\w{0,24})/i;
	userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i;
	tmiSentRegex = /tmi-sent-ts=(\d+)(;|\s:)/;
	userIdRegex = /^id:(\d{1,})$/i;

	instanceChannels = new Map();
	uniqueChannels = new Map();
	statusCodes = new Map();
	listData = new Map();
	infoData = new Map();

	reloadInterval = 1 * 60 * 60 * 1000; // 1 hour
	errorInterval = 1 * 60 * 1000; // 1 minute
	lastUpdated = Date.now();
	config = loadedConfig;
	errorLoop = null;
	loadLoop = null;

	formatUsername(username) {
		return decodeURIComponent(username.replace(/[@#,]/g, '').toLowerCase());
	}

	getNow() {
		return Math.round(Date.now() / 1000);
	}

	async request(url, options) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), options.timeout);

		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error(`Request timed out after ${options.timeout}ms`)), options.timeout);
		});

		try {
			const response = await Promise.race([
				got(url, {
					...options,
					retry: 0,
					signal: controller.signal,
				}),
				timeoutPromise,
			]);

			return response;
		} catch (err) {
			if (err.name === 'RequestError') {
				throw new Error(`Request timed out after ${options.timeout}ms`);
			}

			if (err.name === 'HTTPError') {
				throw new Error(`Error ${err.message.replace(' (undefined)', '')}`);
			}

			throw err;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	async loadInstanceChannels(noLogs, onlyError) {
		let instances = Object.keys(this.config.justlogsInstances);

		if (onlyError) {
			instances = instances.filter((url) => Array.isArray(this.instanceChannels.get(url)) && this.instanceChannels.get(url).length === 0);
		}

		if (!instances.length && !onlyError) {
			if (!noLogs) {
				console.log(`- [Logs] No instances found`);
			}
			return;
		}

		let instancesWorking = 0;
		await Promise.allSettled(
			instances.map(async (url) => {
				try {
					const channelURL = this.config.justlogsInstances[url]?.alternate ?? url;
					const logsData = await this.request(`https://${channelURL}/channels`, {
						headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
						https: { rejectUnauthorized: false },
						responseType: 'json',
						timeout: 10000,
						http2: true,
					});

					if (!logsData.body?.channels?.length) throw new Error(`No channels found`);

					const currentInstanceChannels = logsData.body.channels;

					for (const channel of logsData.body.channels) {
						this.addChannel(channel);
					}

					this.instanceChannels.set(url, currentInstanceChannels);
					instancesWorking++;

					if (!noLogs) {
						console.log(`[${url}] Loaded ${currentInstanceChannels.length} channels`);
					}
				} catch (err) {
					let error = err.message;
					if (err.name === 'ParseError') {
						error = 'Invalid JSON';
					}
					if (!noLogs) {
						console.error(`[${url}] Failed loading channels: ${error}`);
					}
					this.instanceChannels.set(url, []);
				}
			}),
		);

		if (!onlyError) {
			this.lastUpdated = Date.now();
			this.statusCodes.clear();
			this.listData.clear();
		}

		if (!noLogs) {
			console.log(
				`- [Logs] Loaded ${this.uniqueChannels.size} unique channels from ${instancesWorking}/${this.instanceChannels.size} instances`,
			);
		}
	}

	addChannel(channel) {
		this.uniqueChannels.set(channel.userID, channel);
	}

	async loopLoadInstanceChannels(noLogs) {
		clearInterval(this.loadLoop);

		await this.loadInstanceChannels(noLogs);

		this.loadLoop = setInterval(() => this.loadInstanceChannels(noLogs), this.reloadInterval);
	}

	async loopErrorInstanceChannels() {
		clearInterval(this.errorLoop);

		await this.loadInstanceChannels(true, true);

		this.errorLoop = setInterval(() => this.loadInstanceChannels(true, true), this.errorInterval);
	}

	async getInstance(channel, user, force, pretty, error) {
		force = force?.toLowerCase() === 'true';

		const instances = Object.keys(this.config.justlogsInstances);
		const start = performance.now();

		let status = 200;
		let downSites = 0;
		let request = {
			channel: null,
			user: null,
			forced: force,
		};

		let optOuts = [];
		let userLinks = [];
		let channelLinks = [];
		let userInstances = [];
		let channelInstances = [];
		let userInstancesWithLength = [];
		let channelInstancesWithLength = [];

		if (force) {
			await this.loopLoadInstanceChannels(true);
		}

		const { login, id, banned } = await this.getInfo(channel).catch(() => ({}));
		if (id) {
			request.channel = { login, id, banned };
			if (banned) {
				channel = `id:${request.channel.id}`;
			}
		} else {
			error = `The channel does not exist: ${channel}`;
		}

		if (user) {
			const { login, id, banned } = await this.getInfo(user).catch(() => ({}));
			if (id) {
				request.user = { login, id, banned };
				if (banned) {
					user = `id:${request.user.id}`;
				}
			} else {
				error = `The user does not exist: ${user}`;
			}
		}

		if (!error) {
			const results = await Promise.allSettled(instances.map((i) => this.getLogs(i, user, channel, force, pretty, banned)));
			const resolvedInstances = results.filter(({ status }) => status === 'fulfilled').map(({ value }) => value);

			for (const instance of resolvedInstances) {
				const { Status, Link, Full, channelFull, list } = instance;

				switch (Status) {
					case 0:
						// The instance is probably down
						downSites++;
						continue;
					case 1:
						// The instance is up and the user logs are available
						channelInstancesWithLength.push({ Link, Full: channelFull, list });
						userInstancesWithLength.push({ Link, Full, list });
						continue;
					case 2:
						// The instance is up but the user logs are not available
						channelInstancesWithLength.push({ Link, Full: channelFull, list });
						continue;
					case 3:
						// The instance is up but the channel logs are not available
						continue;
					case 4:
						// The instance is up but the user or channel logs are opted out
						optOuts.push(Link);
						continue;
				}
			}

			// Sort the instances by length
			channelInstancesWithLength.sort((a, b) => b.list.length - a.list.length);
			userInstancesWithLength.sort((a, b) => b.list.length - a.list.length);

			for (const instance of channelInstancesWithLength) {
				channelInstances.push(instance.Link);
				channelLinks.push(instance.Full);
			}

			for (const instance of userInstancesWithLength) {
				userInstances.push(instance.Link);
				userLinks.push(instance.Full);
			}

			// Error messages and status codes
			if (optOuts.length && !channelInstances.length) {
				error = 'User or channel has opted out';
				status = 403;
			} else if (!channelInstances.length) {
				error = 'No channel logs found';
				status = 404;
			} else if (!userInstances.length && user) {
				error = 'No user logs found';
				status = 404;
			}
		} else {
			status = 404;
		}

		const end = performance.now();
		const elapsed = {
			ms: Math.round((end - start) * 100) / 100,
			s: Math.round((end - start) / 10) / 100,
		};

		const channelList = channelInstancesWithLength[0]?.list ?? [];

		if (request?.channel?.banned && channelInstances.length) {
			this.addChannel({ name: request.channel.login, userID: request.channel.id });
		}

		console.log(`- [Logs] Channel: ${channel}${user ? ` - User: ${user}` : ''} | ${elapsed.ms}ms`);

		return {
			error,
			status,
			instancesInfo: {
				count: instances.length,
				down: downSites,
			},
			request,
			available: {
				user: userInstances.length > 0,
				channel: channelInstances.length > 0,
			},
			loggedData: {
				list: channelList,
				days: channelList.length,
				since: channelList[channelList.length - 1] ?? null,
			},
			userLogs: {
				count: userInstances.length,
				instances: userInstances,
				fullLink: userLinks,
			},
			channelLogs: {
				count: channelInstances.length,
				instances: channelInstances,
				fullLink: channelLinks,
			},
			optedOut: {
				count: optOuts.length,
				instances: optOuts,
			},
			lastUpdated: {
				unix: ~~(this.lastUpdated / 1000),
				utc: new Date(this.lastUpdated * 1000).toUTCString(),
			},
			elapsed,
		};
	}

	async getLogs(url, user, channel, force, pretty, banned) {
		pretty = pretty?.toLowerCase() === 'true';

		const channels = this.instanceChannels.get(url)?.flatMap((i) => [i.name, i.userID]) ?? [];
		const channelPath = channel.match(this.userIdRegex) ? 'channelid' : 'channel';
		const instanceURL = this.config.justlogsInstances[url]?.alternate ?? url;
		const channelClean = channel.replace('id:', '');

		if (!banned && !channels.includes(channelClean)) return { Status: 3 };
		if (!channels.length) return { Status: 0 };

		const listCacheKey = `logs:list:${url}:${channel.replace('id:', 'id-')}`;
		let list = this.listData.get(listCacheKey);

		if (!list || force) {
			list = await this.request(`https://${instanceURL}/list?${channelPath}=${channelClean}`, {
				headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
				https: { rejectUnauthorized: false },
				timeout: 5000,
				http2: true,
			})
				.then((response) => {
					const data = JSON.parse(response.body);
					const availableLogsLength = data?.availableLogs ?? [];

					return availableLogsLength;
				})
				.catch((err) => {
					console.error(`[${instanceURL}] Failed loading ${channel} length: ${err.message}`);
					return [];
				});

			this.listData.set(listCacheKey, list);
		}

		const channelFull = pretty ? `https://tv.supa.sh/logs?c=${channel}` : `https://${url}/?channel=${channel}`;

		if (!user) {
			console.log(`[${url}] Channel: ${channel} | ${list.length} days`);

			return {
				Status: 2,
				Link: `https://${url}`,
				channelFull,
				list,
			};
		}

		const instanceCacheKey = `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`;
		const userPath = user.match(this.userIdRegex) ? 'userid' : 'user';
		let statusCode = this.statusCodes.get(instanceCacheKey);
		const userClean = user.replace('id:', '');

		if (!statusCode || force) {
			statusCode = await this.request(`https://${instanceURL}/list?${channelPath}=${channelClean}&${userPath}=${userClean}`, {
				headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
				https: { rejectUnauthorized: false },
				throwHttpErrors: false,
				timeout: 5000,
				http2: true,
			})
				.then((res) => res.statusCode)
				.catch(() => 500);

			this.statusCodes.set(instanceCacheKey, statusCode);
		}

		const fullLink = pretty ? `https://tv.supa.sh/logs?c=${channel}&u=${user}` : `https://${url}/?channel=${channel}&username=${user}`;

		console.log(`[${url}] Channel: ${channel} - User: ${user} | ${statusCode} - ${list.length} days`);

		if (statusCode === 403) {
			return {
				Status: 4,
				Link: `https://${url}`,
			};
		}

		return {
			list,
			channelFull,
			Status: ~~(statusCode / 100) === 2 ? 1 : 2,
			Link: `https://${url}`,
			Full: fullLink,
		};
	}

	async fetchMessages(instance, channel, searchParams) {
		return this.request(`https://${instance}/api/v2/recent-messages/${channel}`, {
			headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
			https: { rejectUnauthorized: false },
			throwHttpErrors: false,
			responseType: 'json',
			timeout: 5000,
			searchParams,
		});
	}

	async fetchRustlogs(instance, channel, date, limit, firstTs) {
		const { body } = await this.request(`${instance}/channel/${channel}/${date.year}/${date.month}/${date.day}?limit=${limit}&raw&reverse`, {
			headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
			https: { rejectUnauthorized: false },
			timeout: 5000,
			http2: true,
		});

		const logsMessages = (body?.split(/\r?\n/) ?? []).reverse().slice(1);

		//
		// This adds the `historical=1` tag to the beginning of each message.
		//
		// This is needed because Chatterino relies on this tag to
		// differentiate between historical and recent messages, resulting in issues.
		//

		for (let i = logsMessages.length - 1; i >= 0; i -= 1) {
			let message = logsMessages[i];

			// Get timestamp value
			const match = message.match(this.tmiSentRegex);
			if (match) {
				const timestamp = Number(match[1]);
				if (firstTs && timestamp >= Number(firstTs)) {
					// Remove message if already in RecentMessages
					logsMessages.splice(i, 1);
					continue;
				}

				// Add the tag "tmi-sent-ts=XXXX;"
				message = message.replace(`tmi-sent-ts=${timestamp};`, `tmi-sent-ts=${timestamp};rm-received-ts=${timestamp};`);
			}

			// If you request the tags capability all messages start with @
			logsMessages[i] = '@historical=1;' + message.substring(1);
		}

		return logsMessages;
	}

	async getRecentMessages(channel, searchParams) {
		const start = performance.now();

		const instances = Object.keys(this.config.recentmessagesInstances);
		let { limit, rm_only } = searchParams;
		limit = Number(limit) || 1000;
		let recentMessages = [];
		let messages = [];

		let statusMessage;
		let errorCode;
		let instance;
		let status;
		let error;

		for (const entry of instances) {
			const { body, statusCode } = await this.fetchMessages(entry, channel, searchParams);
			statusMessage = body?.status_message;
			instance = `https://${entry}`;
			status = statusCode || 500;

			if (statusCode === 200 && body.messages.length) {
				recentMessages = body.messages.filter((str) => !str.includes(':tmi.twitch.tv ROOMSTATE #'));
				messages = body.messages.filter((str) => !str.includes(':tmi.twitch.tv ROOMSTATE #'));
				errorCode = body.error_code;
				error = body.error;

				console.log(`[${entry}] Channel: ${channel} | ${status} - ${messages.length} messages`);
				break;
			} else {
				errorCode = body?.error_code || 'internal_server_error';
				error = body?.error || 'Internal Server Error';

				console.error(`[${entry}] Channel: ${channel} | ${status} - ${error}`);
			}
		}

		const firstTs = messages[0]?.match(this.tmiSentRegex)?.[1] || null;

		if (!rm_only || rm_only !== 'true') {
			const logs = await this.getInstance(channel);
			let instanceLink = 'Logs';

			try {
				let instances = logs.channelLogs.instances;

				const mainInstance = `https://${Object.keys(this.config.justlogsInstances)[0]}`;
				const index = instances.indexOf(mainInstance);
				if (index > 0) {
					instances = [instances[index], ...instances.slice(0, index), ...instances.slice(index + 1)];
				}

				const maxRetries = 3;
				let instanceIndex = 0;
				let success = false;
				let retries = 0;

				while (retries < maxRetries && instanceIndex < instances.length && !success) {
					instanceLink = instances[instanceIndex];
					try {
						if (logs.available.channel) {
							const list = logs.loggedData.list;

							let totalMessages = recentMessages.length;
							let logsMessages = recentMessages;
							let daysFetched = 0;
							const maxDays = 7;

							while (totalMessages < limit && daysFetched < maxDays && daysFetched < list.length) {
								try {
									const dayLogs = await this.fetchRustlogs(
										instanceLink,
										channel,
										list[daysFetched],
										limit - totalMessages,
										firstTs,
									);
									logsMessages = [...dayLogs, ...logsMessages];
									totalMessages += dayLogs.length;
								} catch (dayError) {
									if (daysFetched === 0) {
										throw dayError;
									}
								}
								daysFetched++;
							}

							console.log(`[${instanceLink.replace('https://', '')}] Channel: ${channel} | 200 - ${logsMessages.length} messages`);

							if (logsMessages?.length >= messages.length) {
								messages = logsMessages;
								instance = instanceLink;
								errorCode = null;
								success = true;
								status = 200;
								error = null;
							}
						}
					} catch (err) {
						console.error(`[${instanceLink.replace('https://', '')}] Channel: ${channel} | Failed loading messages: ${err.message}`);
						retries++;
					} finally {
						instanceIndex++;
					}
				}

				if (!success) {
					throw new Error(`Failed to fetch logs after ${retries + 1} retries`);
				}
			} catch (err) {
				console.error(`- [RecentMessages] Channel: ${channel} | ${err.message}`);
			}
		}

		const end = performance.now();
		const elapsed = {
			ms: Math.round((end - start) * 100) / 100,
			s: Math.round((end - start) / 10) / 100,
		};

		console.log(`- [RecentMessages] Channel: ${channel} | ${status} - [${messages.length}/${limit}] | ${instance} | ${elapsed.ms}ms`);

		const request = ((req) => ({
			...req,
			...Object.fromEntries(
				Object.entries(searchParams)
					.filter(([key, value]) => !(key in req))
					.map(([key, value]) => [key, value === 'true' ? true : value === 'false' ? false : value]),
			),
		}))({ channel, limit });

		return {
			status,
			status_message: statusMessage,
			error,
			error_code: errorCode,
			instance,
			elapsed,
			count: messages.length,
			request,
			messages,
		};
	}

	async getNameHistory(user) {
		user = user.replace(/^id:/, '');

		if (!user.startsWith('login:') && isNaN(user)) {
			return "The value must be an ID or use 'login:' to refer to usernames. Example: 754201843 or login:zonianmidian";
		}

		if (user.startsWith('login:')) {
			user = user.replace('login:', '');
			try {
				const userInfo = await this.getInfo(user);
				user = userInfo?.id;
				if (!user) throw new Error('User ID not found');
			} catch (err) {
				console.error(`- [NameHistory] Failed to get user ID: ${err.message}`);
				return [];
			}
		}

		let nameHistory = [];

		await Promise.allSettled(
			Object.keys(this.config.justlogsInstances).map(async (url) => {
				try {
					const instanceURL = this.config.justlogsInstances[url]?.alternate ?? url;
					const historyData = await this.request(`https://${instanceURL}/namehistory/${user}`, {
						headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
						https: { rejectUnauthorized: false },
						responseType: 'json',
						timeout: 10000,
						http2: true,
					});

					if (historyData.statusCode !== 200 || !Array.isArray(historyData.body)) return;

					console.log(`[${url}] Found ${historyData.body.length} registered usernames for ID ${user}`);

					for (const newEntry of historyData.body) {
						const existingEntry = nameHistory.find((entry) => entry.user_login === newEntry.user_login);

						if (existingEntry) {
							if (new Date(newEntry.last_timestamp) > new Date(existingEntry.last_timestamp)) {
								existingEntry.last_timestamp = newEntry.last_timestamp;
							}
							if (new Date(newEntry.first_timestamp) < new Date(existingEntry.first_timestamp)) {
								existingEntry.first_timestamp = newEntry.first_timestamp;
							}
						} else {
							nameHistory.push({ ...newEntry });
						}
					}
				} catch (err) {
					// console.error(`[${url}] Failed to fetch name history: ${err.message}`);
				}
			}),
		);

		nameHistory.sort((a, b) => new Date(a.last_timestamp) - new Date(b.last_timestamp));

		console.log(`- [NameHistory] Found ${nameHistory.length} unique usernames for ID ${user}`);

		return nameHistory;
	}

	async getInfo(user) {
		const dataCacheKey = `logs:info:${user.replace('id:', 'id-')}`;
		const cachedData = this.infoData.get(dataCacheKey);
		let apiError = false;
		let data = {};

		if (cachedData) {
			data = cachedData;
		} else {
			const { body, statusCode } = await this.request(
				`https://api.ivr.fi/v2/twitch/user?${this.userIdRegex.test(user) ? 'id' : 'login'}=${user.replace('id:', '')}`,
				{
					headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
					https: { rejectUnauthorized: false },
					throwHttpErrors: false,
					responseType: 'json',
					timeout: 5000,
				},
			);
			if (statusCode < 200 || statusCode > 299) {
				apiError = true;
			} else {
				data = body?.[0] || {};
			}
		}

		if (!apiError) this.infoData.set(dataCacheKey, data);

		const { displayName, login, logo: avatar, id, banned } = data;
		const name = displayName.toLowerCase() === login ? displayName : login;

		return { name, login, avatar, id, banned };
	}
}
