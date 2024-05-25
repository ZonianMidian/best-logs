const data = require('./data.json');
const got = require('got');

let loadLoop;
module.exports = new class LogUtils {
    lastUpdated = Date.now();

    instanceChannels = new Map();

    statusCodes = new Map();

    reloadInterval = 2 * 60 * 60 * 1000;

    userIdRegex = /^id:(\d{1,})$/i;

    userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i;


    formatUsername(username) {
        return decodeURIComponent(username.replace(/[@#,]/g, '').toLowerCase());
    }

    getNow() {
        return Math.round(Date.now() / 1000)
    }

    async request(url, options) {
        return Promise.race([
            got(url, options),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 5000))
        ])
    }

    async loadInstanceChannels(noLogs) {
        let count = new Set();
        await Promise.allSettled(data.justlogsInstances.map(async (url) => {
            try {
                const channelURL = data.alternateEndpoint[url] ?? url;
                const logsData = await this.request(`https://${channelURL}/channels`, {
                    headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                    https: {
                        rejectUnauthorized: false
                    },
                    responseType: 'json',
                    http2: true,
                });

                if (!logsData.body?.channels?.length) throw new Error(`${url}: No channels found`);
                const channels = [].concat(
                    logsData.body.channels.map((i) => i.name),
                    logsData.body.channels.map((i) => i.userID),
                );

                for (let id of logsData.body.channels.map((i) => i.userID)) count.add(id);
                this.instanceChannels.set(url, channels);

                if (!noLogs) console.log(`[${url}] Loaded ${channels.length} channels`);
            } catch (err) {
                console.error(`Failed loading channels for ${url}: ${err.message}`);
                this.instanceChannels.set(url, [])
            }
        }))
        this.statusCodes.clear();
        this.lastUpdated = Date.now();
        console.log(`Loaded ${count.size} channels from ${data.justlogsInstances.length} instances`);
    }

    async loopLoadInstanceChannels(noLogs) {
        clearInterval(loadLoop)

        await this.loadInstanceChannels(noLogs);

        loadLoop = setInterval(
            this.loadInstanceChannels,
            this.reloadInterval
        );
    }

    async getInstance(channel, user, force, pretty, error) {
        force = force?.toLowerCase() === 'true';
        const instances = data.justlogsInstances;

        let downSites = 0;
        let optOuts = [];
        let userLinks = [];
        let channelLinks = [];
        let userInstances = [];
        let channelInstances = [];

        const start = performance.now();

        if (force) await this.loopLoadInstanceChannels(true);
        if (!error) {
            const resolvedInstances = await Promise
                .allSettled(instances.map(async (inst) => this.getLogs(inst, user, channel, force, pretty)))
                .then(r => r.filter(res => res.status === 'fulfilled').map(data => data.value));

            for (const instance of resolvedInstances) {
                const { Status, Link, Full, channelFull } = instance;
                switch (Status) {
                    case 0:
                        // The instance is probably down
                        downSites++;
                        continue;
                    case 1:
                        // The instance is up and the user logs are available
                        channelLinks.push(channelFull);
                        channelInstances.push(Link);
                        userInstances.push(Link);
                        userLinks.push(Full);
                        continue;
                    case 2:
                        // The instance is up but the user logs are not available
                        channelLinks.push(channelFull);
                        channelInstances.push(Link);
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
        }

        if (!error && !channelInstances.length) error = 'No channel logs found';
        else if (!error && !userInstances.length && user) error = 'No user logs found';
        const end = performance.now();

        return {
            error: error,
            instancesInfo: {
                count: instances.length,
                down: downSites,
            },
            request: {
                user: user,
                channel: channel,
                forced: force,
            },
            available: {
                user: userInstances.length > 0 ? true : false,
                channel: channelInstances.length > 0 ? true : false,
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
            elapsed: {
                ms: Math.round((end - start) * 100) / 100,
                s: Math.round((end - start) / 10) / 100,
            },
        };
    };

    async getLogs(url, user, channel, force, pretty) {
        const channelPath = channel.match(this.userIdRegex) ? 'channelid' : 'channel';
        const instanceURL = data.alternateEndpoint[url] ?? url;
        const channels = this.instanceChannels.get(url) ?? [];
        const channelClean = channel.replace('id:', '');

        if (!channels.length) return { Status: 0 };
        if (!channels.includes(channelClean)) return { Status: 3 };

        if (!user) return {
            Status: 2,
            Link: `https://${url}`,
            channelFull: pretty?.toLowerCase() === 'false'
                ? `https://${url}/?channel=${channel}`
                : `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`,
        }

        const cacheKey = `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`;
        const userPath = user.match(this.userIdRegex) ? 'userid' : 'user';
        const userClean = user.replace('id:', '');

        let statusCode = this.statusCodes.get(cacheKey);
        if (!statusCode || force) {
            statusCode = await this.request(`https://${instanceURL}/${channelPath}/${channelClean}/${userPath}/${userClean}`, {
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                https: {
                    rejectUnauthorized: false
                },
                timeout: 5000,
                http2: true,
            }).then(res => res.statusCode).catch(err => err.response.statusCode);

            this.statusCodes.set(cacheKey, statusCode);
        }

        const fullLink = pretty?.toLowerCase() === 'true' ?
            `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}/${userPath}/${userClean}` :
            `https://${url}/?channel=${channel}&username=${user}`;

        const channelFull = pretty?.toLowerCase() === 'false' ?
            `https://${url}/?channel=${channel}` :
            `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;

        console.log(`[${url}] Channel: ${channel} - User: ${user} - ${statusCode}`)

        if (statusCode === 403) return {
            Status: 4,
            Link: `https://${url}`
        };

        return {
            Status: ~~(statusCode / 100) === 2 ? 1 : 2,
            Link: `https://${url}`,
            Full: fullLink,
            channelFull: channelFull
        };
    };

    async fetchMessages(instance, channel, searchParams) {
        return this.request(`https://${instance}/api/v2/recent-messages/${channel}`, {
            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            throwHttpErrors: false,
            responseType: 'json',
            searchParams,
        });
    };

    async getRecentMessages(channel, searchParams) {
        const instances = data.recentmessagesInstances;
        const start = performance.now();
        let finalInstance = null;
        let statusMessage = null;
        let messagesData = [];
        let errorCode = null;
        let status = null;
        let error = null;

        for (const instance of instances) {
            const { body, statusCode } = await this.fetchMessages(instance, channel, searchParams);

            if (statusCode === 200 && body.messages.length) {
                finalInstance = `https://${instance}`;
                messagesData = body.messages;
                status = '200';
                break;
            } else {
                statusMessage = body?.status_message || 'Internal Server Error';
                errorCode = body?.error_code || 'internal_server_error';
                error = body?.error || 'Internal Server Error';
                status = statusCode || '500';
            }
        }

        const end = performance.now();
        const elapsed = {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        };

        console.log(`[${channel}] Recent messages - ${status} - ${elapsed.s}s`)

        const response = finalInstance
            ? { messages: messagesData, error: null, error_code: null, instance: finalInstance, elapsed }
            : { messages: [], status, status_message: statusMessage, error, error_code: errorCode, elapsed };

        return response;
    };

    async getInfo(user) {
        const { body, statusCode } = await this.request(`https://api.ivr.fi/v2/twitch/user?login=${user}`, {
            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            throwHttpErrors: false,
            responseType: 'json',
            timeout: 5000,
        });
        if (statusCode < 200 || statusCode > 299) return null;

        const displayName = body[0].displayName.toLowerCase() === user ? body[0].displayName : user;
        return { name: displayName, avatar: body[0].logo, id: body[0].id };
    };
}
