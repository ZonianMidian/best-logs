const data = require('./data.json');
const ioredis = require('ioredis');
const got = require('got');

module.exports = new class LogUtils {
    redis = new ioredis();

    userIdRegex = /^id:(\d{1,})$/i;

    userChanRegex = /^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i;

    formatUsername(username) {
        return decodeURIComponent(username.replace(/[@#,]/g, '').toLowerCase());
    }

    getNow() {
        return Math.round(Date.now() / 1000)
    }

    async getInstance(channel, user, force, pretty, full, error) {
        force = force?.toLowerCase() === 'true';
        full = full?.toLowerCase() === 'true';
        const instances = data.justlogsInstances;
    
        let downSites = 0;
        let userLinks = [];
        let channelLinks = [];
        let userInstances = [];
        let channelInstances = [];
    
        let time = await this.redis.get(`logs:updated`);
        if (Number(time) - this.getNow() > 86400) force = true;
    
        const start = performance.now();
        if (!error)
            await Promise.allSettled(instances.map(async (Website) => {
                const { Status, Link, Full, channelFull } = await this.getLogs(Website, user, channel, force, pretty);
                switch (Status) {
                    case 0:
                        downSites++;
                        return;
                    case 1:
                        channelLinks.push(channelFull);
                        channelInstances.push(Link);
                        userInstances.push(Link);
                        userLinks.push(Full);
                        if (full) {
                            return;
                        }
                        break;
                    case 2:
                        channelLinks.push(channelFull);
                        channelInstances.push(Link);
                        return;
                    case 3:
                        return;
                }
            })).then(res => res.filter(r => r.status === 'fulfilled')).map(r => r.value);
    
        
        if (force) {
            time = this.getNow();
            this.redis.set(`logs:updated`, time);
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
                full: full,
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
            lastUpdated: {
                unix: Number(time),
                utc: new Date(time * 1000).toUTCString(),
            },
            elapsed: {
                ms: Math.round((end - start) * 100) / 100,
                s: Math.round((end - start) / 10) / 100,
            },
        };
    };

    async getLogs(url, user, channel, force, pretty) {
        let logsInfo = {
            Status: Number,
            Link: String ?? null,
            Full: String ?? null,
            channelFull: String ?? null,
        };
    
        let Channels;
        const cacheData = await this.redis.get(`logs:instance:${url}`);
    
        if (cacheData && !force) {
            Channels = JSON.parse(cacheData);
        } else {
            try {
                const logsData = await got(`https://${url}/channels`, {
                    headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                    responseType: 'json',
                    timeout: 5000,
                    http2: true,
                });
                Channels = [].concat(
                    logsData.body.channels.map((i) => i.name),
                    logsData.body.channels.map((i) => i.userID),
                );
                await this.redis.set(`logs:instance:${url}`, JSON.stringify(Channels));
            } catch (err) {
                logsInfo.Status = 0;
                return logsInfo;
            }
        }
    
        const channelPath = channel.match(this.userIdRegex) ? 'channelid' : 'channel';
        const channelClean = channel.replace('id:', '');
    
        if (!user && Channels.includes(channelClean)) {
            logsInfo.Status = 2;
            logsInfo.Link = `https://${url}`;
            logsInfo.channelFull =
                pretty?.toLowerCase() === 'false'
                    ? `https://${url}/?channel=${channel}`
                    : `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
            return logsInfo;
        } else if (Channels.includes(channelClean)) {
            const cacheData = await this.redis.get(
                `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`,
            );
            let Code;
    
            const userPath = user.match(this.userIdRegex) ? 'userid' : 'user';
            const userClean = user.replace('id:', '');
    
            if (cacheData && !force) {
                Code = JSON.parse(cacheData);
            } else {
                const { statusCode } = await got(`https://${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`, {
                    headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                    throwHttpErrors: false,
                    timeout: 5000,
                    http2: true,
                });
                await this.redis.set(
                    `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`,
                    statusCode,
                    'EX',
                    86400,
                );
                Code = statusCode;
            }
    
            if (Code < 200 || Code > 299) {
                logsInfo.Status = 2;
                logsInfo.Link = `https://${url}`;
                logsInfo.channelFull =
                    pretty?.toLowerCase() === 'false'
                        ? `https://${url}/?channel=${channel}`
                        : `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
            } else {
                logsInfo.Status = 1;
                logsInfo.Link = `https://${url}`;
                logsInfo.Full =
                    pretty?.toLowerCase() === 'true'
                        ? `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`
                        : `https://${url}/?channel=${channel}&username=${user}`;
                logsInfo.channelFull =
                    pretty?.toLowerCase() === 'false'
                        ? `https://${url}/?channel=${channel}`
                        : `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
            }
    
            return logsInfo;
        }
    
        logsInfo.Status = 3;
        return logsInfo;
    };

    async fetchMessages(instance, channel, searchParams) {
        return got(`https://${instance}/api/v2/recent-messages/${channel}`, {
            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            throwHttpErrors: false,
            responseType: 'json',
            timeout: 5000,
            searchParams,
        });
    };
    
    async getRecentMessages(channel, searchParams) {  
        const 
        instances = data.recentmessagesInstances,

        start = performance.now(),

        results = await Promise.allSettled(instances.map(async (instance) => {
            const { body, statusCode } = await fetchMessages(instance, channel, searchParams);

            if (statusCode === 200 && body.messages.length) {
                return {
                    foundInstance: `https://${instance}`,
                    messagesData: body.messages
                }
            } 
            return {
                statusMessage: body?.status_message ?? 'Internal Server Error',
                errorCode: body?.error_code ?? 'internal_server_error',
                error: body?.error ?? 'Internal Server Error',
                status: statusCode ?? '500'
            }
        })).filter(res => res.status === 'fulfilled'),

        end = performance.now(),

        elapsed = {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        },

        instance = results.find(res => res.value?.foundInstance);
        if (instance) {
            const { foundInstance, messagesData } = instance.value;
            return { messages: messagesData, error: null, error_code: null, instance: foundInstance, elapsed }
        } else {
            const { statusMessage, errorCode, status, error } = results[0].value;
            return { messages: [], status, status_message: statusMessage, error, error_code: errorCode, elapsed };
        }
    };

    async getInfo(user) {
        const { body, statusCode } = await got(`https://api.ivr.fi/v2/twitch/user?login=${user}`, {
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