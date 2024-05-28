import data from './data.json' with { type: 'json' };
import got from 'got';

export class LogUtils {
    userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i;
    userIdRegex = /^id:(\d{1,})$/i;

    instanceChannels = new Map();
    uniqueChannels = new Set();
    statusCodes = new Map();
    lengthData = new Map();

    reloadInterval = 2 * 60 * 60 * 1000;
    lastUpdated = Date.now();
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
            data.justlogsInstances.map(async (url) => {
                try {
                    const channelURL = data.alternateEndpoint[url] ?? url;
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
            `- [Logs] Loaded ${this.uniqueChannels.size} unique channels from ${data.justlogsInstances.length} instances`,
        );
    }

    async loopLoadInstanceChannels(noLogs) {
        clearInterval(this.loadLoop);

        await this.loadInstanceChannels(noLogs);

        this.loadLoop = setInterval(this.loadInstanceChannels, this.reloadInterval);
    }

    async getInstance(channel, user, force, pretty, error) {
        force = force?.toLowerCase() === 'true';

        const instances = data.justlogsInstances;
        const start = performance.now();
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
                const { Status, Link, Full, channelFull, length } = instance;

                switch (Status) {
                    case 0:
                        // The instance is probably down
                        downSites++;
                        continue;
                    case 1:
                        // The instance is up and the user logs are available
                        channelInstancesWithLength.push({ Link, Full: channelFull, length });
                        userInstancesWithLength.push({ Link, Full, length });
                        continue;
                    case 2:
                        // The instance is up but the user logs are not available
                        channelInstancesWithLength.push({ Link, Full: channelFull, length });
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
            channelInstancesWithLength.sort((a, b) => b.length - a.length);
            userInstancesWithLength.sort((a, b) => b.length - a.length);

            for (const instance of channelInstancesWithLength) {
                channelInstances.push(instance.Link);
                channelLinks.push(instance.Full);
            }

            for (const instance of userInstancesWithLength) {
                userInstances.push(instance.Link);
                userLinks.push(instance.Full);
            }

            if (optOuts.length && !channelInstances.length) error = 'User or channel has opted out';
            else if (!channelInstances.length) error = 'No channel logs found';
            else if (!userInstances.length && user) error = 'No user logs found';
        }

        const end = performance.now();
        const elapsed = {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        };

        console.log(`- [Logs] Channel: ${channel}${user ? ` - User: ${user}` : ''} | ${elapsed.s}s`);

        return {
            error,
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
            elapsed
        };
    }

    async getLogs(url, user, channel, force, pretty) {
        pretty = pretty?.toLowerCase() === 'true';

        const channels = this.instanceChannels.get(url)?.flatMap((i) => [i.name, i.userID]) ?? [];
        const channelPath = channel.match(this.userIdRegex) ? 'channelid' : 'channel';
        const instanceURL = data.alternateEndpoint[url] ?? url;
        const channelClean = channel.replace('id:', '');

        if (!channels.length) return { Status: 0 };
        if (!channels.includes(channelClean)) return { Status: 3 };

        const lengthCacheKey = `logs:length:${url}:${channel.replace('id:', 'id-')}`;

        let length = this.lengthData.get(lengthCacheKey);

        if (!length || force) {
            length = await got(`https://${instanceURL}/list?${channelPath}=${channelClean}`, {
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                https: {
                    rejectUnauthorized: false,
                },
                timeout: 5000,
                http2: true,
            })
                .then((response) => {
                    const data = JSON.parse(response.body);
                    const availableLogsLength = data?.availableLogs?.length ?? 0;

                    this.lengthData.set(lengthCacheKey, availableLogsLength);

                    return availableLogsLength;
                })
                .catch((err) => {
                    console.error(`[${instanceURL}] Failed loading ${channelClean} length: ${err.message}`);
                    return 0;
                });

            this.lengthData.set(lengthCacheKey, length);
        }

        if (!user) {
            console.log(`[${url}] Channel: ${channel} | ${length}`);

            return {
                Status: 2,
                Link: `https://${url}`,
                channelFull: pretty
                    ? `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`
                    : `https://${url}/?channel=${channel}`,
                length,
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

        console.log(`[${url}] Channel: ${channel} - User: ${user} | ${statusCode} - ${length}`);

        if (statusCode === 403) {
            return {
                Status: 4,
                Link: `https://${url}`,
            };
        }

        return {
            length,
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
        const instances = data.recentmessagesInstances;
        const start = performance.now();
        let messages = [];
        let instance = null;
        let statusMessage = null;
        let errorCode = null;
        let status = null;
        let error = null;

        for (const entry of instances) {
            const { body, statusCode } = await this.fetchMessages(entry, channel, searchParams);

            if (statusCode === 200 && body.messages.length) {
                instance = `https://${entry}`;
                messages = body.messages;
                status = '200';

                console.log(`[${entry}] Channel: ${channel} | ${status} - ${messages.length} messages`)
                break;
            } else {
                statusMessage = body?.status_message || 'Internal Server Error';
                errorCode = body?.error_code || 'internal_server_error';
                error = body?.error || 'Internal Server Error';
                status = statusCode || '500';

                console.error(`[${entry}] Channel: ${channel} | ${status} - ${statusMessage}`);
            }
        }

        const end = performance.now();
        const elapsed = {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        };

        console.log(`- [RecentMessages] Channel: ${channel} | ${status} - ${messages.length} - ${elapsed.s}s`);

        return {
            error_code: errorCode,
            status_message: statusMessage,
            messages,
            status,
            error,
            elapsed,
            instance,
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
