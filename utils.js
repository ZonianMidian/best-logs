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
    channelLinkRegex = /channel(?:id)?[\/=]([a-z0-9]\w{0,24}|id:\d{1,})/i;
    userLinkRegex = /user(?:id)?[\/=]([a-z0-9]\w{0,24}|id:\d{1,})/i;
    userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i;
    userIdRegex = /^id:(\d{1,})$/i;

    instanceChannels = new Map();
    uniqueChannels = new Set();
    statusCodes = new Map();
    lengthData = new Map();

    reloadInterval = 1 * 60 * 60 * 1000;
    lastUpdated = Date.now();
    config = loadedConfig;
    loadLoop = null;

    formatUsername(username) {
        return decodeURIComponent(username.replace(/[@#,]/g, '').toLowerCase());
    }

    getNow() {
        return Math.round(Date.now() / 1000);
    }

    async request(url, options) {
        return Promise.race([
            got(url, options),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), options.timeout)),
        ]);
    }

    async loadInstanceChannels(noLogs) {
        await Promise.allSettled(
            Object.keys(this.config.justlogsInstances).map(async (url) => {
                try {
                    const channelURL = this.config.justlogsInstances[url]?.alternate ?? url;
                    const logsData = await this.request(`https://${channelURL}/channels`, {
                        headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                        https: {
                            rejectUnauthorized: false,
                        },
                        responseType: 'json',
                        timeout: 10000,
                        http2: true,
                    });

                    if (!logsData.body?.channels?.length) throw new Error(`No channels found`);

                    const currentInstanceChannels = logsData.body.channels;

                    for (const channel of logsData.body.channels) {
                        this.uniqueChannels.add(channel);
                    }

                    this.instanceChannels.set(url, currentInstanceChannels);

                    if (!noLogs) {
                        console.log(`[${url}] Loaded ${currentInstanceChannels.length} channels`);
                    }
                } catch (err) {
                    console.error(`[${url}] Failed loading channels: ${err.message}`);
                    this.instanceChannels.set(url, []);
                }
            }),
        );

        this.lastUpdated = Date.now();
        this.statusCodes.clear();

        console.log(
            `- [Logs] Loaded ${this.uniqueChannels.size} unique channels from ${this.instanceChannels.size} instances`,
        );
    }

    async loopLoadInstanceChannels(noLogs) {
        clearInterval(this.loadLoop);

        await this.loadInstanceChannels(noLogs);

        this.loadLoop = setInterval(() => this.loadInstanceChannels(), this.reloadInterval);
    }

    async getInstance(channel, user, force, pretty, error) {
        force = force?.toLowerCase() === 'true';

        const instances = Object.keys(this.config.justlogsInstances);
        const start = performance.now();

        let status = 200;
        let downSites = 0;

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

        if (!error) {
            const results = await Promise.allSettled(
                instances.map((i) => this.getLogs(i, user, channel, force, pretty)),
            );
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

        console.log(`- [Logs] Channel: ${channel}${user ? ` - User: ${user}` : ''} | ${elapsed.ms}ms`);

        return {
            error,
            status,
            instancesInfo: {
                count: instances.length,
                down: downSites,
            },
            request: {
                user,
                channel,
                forced: force,
            },
            available: {
                user: userInstances.length > 0,
                channel: channelInstances.length > 0,
            },
            loggedData: {
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

    async getLogs(url, user, channel, force, pretty) {
        pretty = pretty?.toLowerCase() === 'true';

        const channels = this.instanceChannels.get(url)?.flatMap((i) => [i.name, i.userID]) ?? [];
        const channelPath = channel.match(this.userIdRegex) ? 'channelid' : 'channel';
        const instanceURL = this.config.justlogsInstances[url]?.alternate ?? url;
        const channelClean = channel.replace('id:', '');

        if (!channels.length) return { Status: 0 };
        if (!channels.includes(channelClean)) return { Status: 3 };

        const listCacheKey = `logs:length:${url}:${channel.replace('id:', 'id-')}`;
        let list = this.lengthData.get(listCacheKey);

        if (!list || force) {
            list = await got(`https://${instanceURL}/list?${channelPath}=${channelClean}`, {
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                https: {
                    rejectUnauthorized: false,
                },
                timeout: 5000,
                http2: true,
            })
                .then((response) => {
                    const data = JSON.parse(response.body);
                    const availableLogsLength = data?.availableLogs ?? [];

                    this.lengthData.set(listCacheKey, availableLogsLength);

                    return availableLogsLength;
                })
                .catch((err) => {
                    console.error(`[${instanceURL}] Failed loading ${channelClean} length: ${err.message}`);
                    return [];
                });

            this.lengthData.set(listCacheKey, list);
        }

        if (!user) {
            console.log(`[${url}] Channel: ${channel} | ${list.length} days`);

            return {
                Status: 2,
                Link: `https://${url}`,
                channelFull: pretty
                    ? `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`
                    : `https://${url}/?channel=${channel}`,
                list,
            };
        }

        const instanceCacheKey = `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`;
        const userPath = user.match(this.userIdRegex) ? 'userid' : 'user';
        const userClean = user.replace('id:', '');
        let statusCode = this.statusCodes.get(instanceCacheKey);

        if (!statusCode || force) {
            statusCode = await this.request(
                `https://${instanceURL}/${channelPath}/${channelClean}/${userPath}/${userClean}`,
                {
                    headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                    https: {
                        rejectUnauthorized: false,
                    },
                    timeout: 5000,
                    http2: true,
                },
            )
                .then((res) => res.statusCode)
                .catch((err) => err.response.statusCode);

            this.statusCodes.set(instanceCacheKey, statusCode);
        }

        const fullLink = pretty
            ? `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`
            : `https://${url}/?channel=${channel}&username=${user}`;

        const channelFull = pretty
            ? `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`
            : `https://${url}/?channel=${channel}`;

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
            throwHttpErrors: false,
            responseType: 'json',
            timeout: 5000,
            searchParams,
        });
    }

    async getRecentMessages(channel, searchParams) {
        const start = performance.now();

        const instances = Object.keys(this.config.recentmessagesInstances);
        let { limit, rm_only } = searchParams;
        limit = Number(limit) || 1000;
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
                errorCode = body.error_code;
                messages = body.messages;
                error = body.error;

                console.log(`[${entry}] Channel: ${channel} | ${status} - ${messages.length} messages`);
                break;
            } else {
                errorCode = body?.error_code || 'internal_server_error';
                error = body?.error || 'Internal Server Error';

                console.error(`[${entry}] Channel: ${channel} | ${status} - ${error}`);
            }
        }

        if (!rm_only || rm_only !== 'true') {
            const logs = await this.getInstance(channel);
            let instanceLink = 'Logs';

            try {
                if (logs.available.channel) {
                    instanceLink = logs.channelLogs.instances[0];

                    const { body } = await this.request(
                        `${instanceLink}/channel/${channel}?limit=${limit}&raw&reverse`,
                        {
                            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                            timeout: 5000,
                            http2: true,
                        },
                    );

                    const logsMessages = (body?.split(/\r?\n/) ?? []).reverse().slice(1);
                    console.log(
                        `[${instanceLink.replace('https://', '')}] Channel: ${channel} | 200 - ${logsMessages.length} messages`,
                    );

                    if (logsMessages?.length > messages.length) {
                        messages = logsMessages;
                        instance = instanceLink;
                        errorCode = null;
                        status = 200;
                        error = null;
                    }
                }
            } catch (err) {
                console.error(
                    `[${instanceLink.replace('https://', '')}] Channel: ${channel} | Failed loading messages: ${err.message}`,
                );
            }
        }

        const end = performance.now();
        const elapsed = {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        };

        console.log(
            `- [RecentMessages] Channel: ${channel} | ${status} - [${messages.length}/${limit}] | ${instance} | ${elapsed.ms}ms`,
        );

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
            request,
            messages,
        };
    }

    async getInfo(user) {
        const { body, statusCode } = await this.request(`https://api.ivr.fi/v2/twitch/user?login=${user}`, {
            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            throwHttpErrors: false,
            responseType: 'json',
            timeout: 5000,
        });

        if (statusCode < 200 || statusCode > 299) return null;

        const { displayName, logo: avatar, id } = body?.[0] || {};
        const name = displayName.toLowerCase() === user ? displayName : user;

        return { name, avatar, id };
    }
}
