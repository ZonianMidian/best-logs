const data = require('./data.json');
const ioredis = require('ioredis');
const got = require('got');
const utils = this;

exports.formatUsername = (username) => {
    return username.replace('@', '').replace(',', '').replace('#', '').toLowerCase();
};

exports.redis = new ioredis();

exports.getInstance = async (channel, user, force, pretty, full, error) => {
    force = force?.toLowerCase() === 'true';
    full = full?.toLowerCase() === 'true';
    const instances = data.justlogsInstances;

    let downSites = 0;
    let userLinks = [];
    let channelLinks = [];
    let userInstances = [];
    let channelInstances = [];

    if (Number(await utils.redis.get(`logs:updated`)) - Math.round(new Date().getTime() / 1000) > 86400) force = true;

    const start = performance.now();
    if (!error)
        for (const Website of instances) {
            const { Status, Link, Full, channelFull } = await utils.getLogs(Website, user, channel, force, pretty);
            switch (Status) {
                case 0:
                    downSites++;
                    continue;
                case 1:
                    channelLinks.push(channelFull);
                    channelInstances.push(Link);
                    userInstances.push(Link);
                    userLinks.push(Full);
                    if (full) {
                        continue;
                    }
                    break;
                case 2:
                    channelLinks.push(channelFull);
                    channelInstances.push(Link);
                    continue;
                case 3:
                    continue;
            }
            break;
        }

    if (force) await utils.redis.set(`logs:updated`, Math.round(new Date().getTime() / 1000));

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
            unix: Number(await utils.redis.get(`logs:updated`)),
            utc: new Date((await utils.redis.get(`logs:updated`)) * 1000).toUTCString(),
        },
        elapsed: {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100,
        },
    };
};

exports.getLogs = async (url, user, channel, force, pretty) => {
    let logsInfo = {
        Status: Number,
        Link: String ?? null,
        Full: String ?? null,
        channelFull: String ?? null,
    };

    let Channels;
    const cacheData = await utils.redis.get(`logs:instance:${url}`);

    if (cacheData && !force) {
        Channels = JSON.parse(cacheData);
    } else {
        try {
            var logsData = await got(`https://${url}/channels`, {
                responseType: 'json',
                http2: true,
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            });
            Channels = [].concat(
                logsData.body.channels.map((i) => i.name),
                logsData.body.channels.map((i) => i.userID),
            );
            await utils.redis.set(`logs:instance:${url}`, JSON.stringify(Channels));
        } catch (err) {
            logsInfo.Status = 0;
            return logsInfo;
        }
    }

    const channelPath = channel.match(/^id:(\d{1,})$/i) ? 'channelid' : 'channel';
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
        const cacheData = await utils.redis.get(
            `logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`,
        );
        let Code;

        const userPath = user.match(/^id:(\d{1,})$/i) ? 'userid' : 'user';
        const userClean = user.replace('id:', '');

        if (cacheData && !force) {
            Code = JSON.parse(cacheData);
        } else {
            const { statusCode } = await got(`https://${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`, {
                throwHttpErrors: false,
                http2: true,
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
            });
            await utils.redis.set(
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

exports.getRecentMessages = async (channel, options) => {
    const instances = data.recentmessagesInstances;

    let finalInstance = null;
    let searchParams = {};
    let messagesData = [];
    let errorCode = null;
    let error = null;

    const start = performance.now();

    for (const param of Object.keys(options)) {
        searchParams[param] = options[param];
    }

    for (const rm of instances) {
        const { body } = await got(`https://${rm}/api/v2/recent-messages/${channel}`, {
            searchParams,
            throwHttpErrors: false,
            responseType: 'json',
            headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
        });

        if (!body.error) {
            if (body.messages.length && body.messages.length > messagesData.length) {
                finalInstance = `https://${rm}`;
                messagesData = body.messages;
            }
            continue;
        } else {
            errorCode = body.error_code;
            error = body.error;
            break;
        }
    }

    const end = performance.now();
    const elapsed = {
        ms: Math.round((end - start) * 100) / 100,
        s: Math.round((end - start) / 10) / 100,
    };

    if (finalInstance) {
        return {
            messages: messagesData,
            error: null,
            error_code: null,
            instance: finalInstance,
            elapsed,
        };
    } else {
        return {
            messages: [],
            error: error,
            error_code: errorCode,
            elapsed,
        };
    }
};

exports.getInfo = async (user) => {
    const { body, statusCode } = await got(`https://api.ivr.fi/v2/twitch/user?login=${user}`, {
        throwHttpErrors: false,
        responseType: 'json',
        headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
    });
    if (statusCode < 200 || statusCode > 299) return null;

    const displayName = body[0].displayName.toLowerCase() === user ? body[0].displayName : user;
    return { name: displayName, avatar: body[0].logo, id: body[0].id };
};
