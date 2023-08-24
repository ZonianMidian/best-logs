const express = require("express");
const utils = require("./utils");
const got = require("got");
const app = express();
const port = 2028;

app.use("/static", express.static(`${__dirname}/static`));
app.set("views", `${__dirname}/views`);
app.set("view engine", "ejs");

async function getInstance(channel, user, force, pretty, full, error) {
    const instances = (require("./data.json")).instances;
    force = (force?.toLowerCase() === 'true')
    full = (full?.toLowerCase() === 'true')

    let downSites = 0;
    let userLinks = []
    let channelLinks = []
    let userInstances = []
    let channelInstances = []

    if (Number(await utils.redis.get(`logs:updated`)) - Math.round((new Date()).getTime() / 1000) > 86400) force = true

    const start = performance.now();
    if (!error) for (const Website of instances) {
        const { Status, Link, Full, channelFull } = await getLogs(Website, user, channel, force, pretty);
        switch (Status) {
            case 0:
                downSites++;
                continue;
            case 1:
                channelLinks.push(channelFull)
                channelInstances.push(Link)
                userInstances.push(Link)
                userLinks.push(Full)
                if (full) { continue; }
                break;
            case 2:
                channelLinks.push(channelFull)
                channelInstances.push(Link)
                continue;
            case 3:
                continue;
        }
        break;
    }

    if (force) await utils.redis.set(`logs:updated`, Math.round((new Date()).getTime() / 1000))

    if (!error && !channelInstances.length) error = "No channel logs found"
    else if (!error && !userInstances.length && user) error = "No user logs found"
    const end = performance.now();

    return {
        error: error,
        instancesInfo: {
            count: instances.length,
            down: downSites
        },
        request: {
            user: user,
            channel: channel,
            forced: force,
            full: full
        },
        available: {
            user: (userInstances.length > 0) ? true : false,
            channel: (channelInstances.length > 0) ? true : false
        },
        userLogs: {
            count: userInstances.length,
            instances: userInstances,
            fullLink: userLinks
        },
        channelLogs: {
            count: channelInstances.length,
            instances: channelInstances,
            fullLink: channelLinks
        },
        lastUpdated: {
            unix: Number(await utils.redis.get(`logs:updated`)),
            utc: new Date(await utils.redis.get(`logs:updated`) * 1000).toUTCString()
        },
        elapsed: {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start) / 10) / 100
        }
    }
}

async function getLogs(url, user, channel, force, pretty) {

    let logsInfo = {
        Status: Number,
        Link: String ?? null,
        Full: String ?? null,
        channelFull: String ?? null
    }

    let Channels
    const cacheData = await utils.redis.get(`logs:instance:${url}`)

    if (cacheData && !force) {
        Channels = JSON.parse(cacheData)
    } else {
        try {
            var logsData = await got(`https://${url}/channels`, {
                responseType: "json",
                http2: true,
                headers: { "User-Agent": "Best Logs by ZonianMidian" }
            });
            Channels = [].concat(logsData.body.channels.map((i) => i.name), logsData.body.channels.map((i) => i.userID))
            await utils.redis.set(`logs:instance:${url}`, JSON.stringify(Channels))
        } catch (err) {
            logsInfo.Status = 0;
            return logsInfo;
        }
    }

    const channelPath = channel.match(/^id:(\d{1,})$/i) ? 'channelid' : 'channel'
    const channelClean = channel.replace('id:', '')

    if (!user && Channels.includes(channelClean)) {

        logsInfo.Status = 2
        logsInfo.Link = `https://${url}`
        logsInfo.channelFull = (pretty?.toLowerCase() === 'false') ?
            `https://${url}/?channel=${channel}` : `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
        return logsInfo;

    } else if (Channels.includes(channelClean)) {
        const cacheData = await utils.redis.get(`logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`)
        let Code

        const userPath = user.match(/^id:(\d{1,})$/i) ? 'userid' : 'user'
        const userClean = user.replace('id:', '')

        if (cacheData && !force) {
            Code = JSON.parse(cacheData)
        } else {
            const { statusCode } = await got(`https://${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`,
                { throwHttpErrors: false, http2: true, headers: { "User-Agent": "Best Logs by ZonianMidian" } })
            await utils.redis.set(`logs:instance:${url}:${channel.replace('id:', 'id-')}:${user.replace('id:', 'id-')}`, statusCode, "EX", 86400)
            Code = statusCode
        }

        if (Code < 200 || Code > 299) {
            logsInfo.Status = 2
            logsInfo.Link = `https://${url}`
            logsInfo.channelFull = (pretty?.toLowerCase() === 'false') ? `https://${url}/?channel=${channel}` :
                `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
        }
        else {
            logsInfo.Status = 1;
            logsInfo.Link = `https://${url}`;
            logsInfo.Full = (pretty?.toLowerCase() === 'true') ?
                `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}/${userPath}/${userClean}`
                : `https://${url}/?channel=${channel}&username=${user}`;
            logsInfo.channelFull = (pretty?.toLowerCase() === 'false') ? `https://${url}/?channel=${channel}` :
                `https://logs.raccatta.cc/${url}/${channelPath}/${channelClean}`;
        }

        return logsInfo;
    }

    logsInfo.Status = 3;
    return logsInfo;
}

async function getInfo(user) {
    const { body, statusCode } = await got(
        `https://api.ivr.fi/v2/twitch/user?login=${user}`,
        {
            throwHttpErrors: false,
            responseType: "json",
            headers: { "User-Agent": "Best Logs by ZonianMidian" }
        }
    );
    if (statusCode < 200 || statusCode > 299) return null;

    const displayName =
        body[0].displayName.toLowerCase() === user ? body[0].displayName : user;
    return { name: displayName, avatar: body[0].logo, id: body[0].id };
}

app.get("/", (req, res) => {
    const instances = (require("./data.json")).instances;
    res.render("index", { instances: instances });
});

app.get("/api", async (req, res) => {
    res.render("api");
});

app.get("/faq", (req, res) => {
    const instances = (require("./data.json")).instances;
    res.render("faq", { instances: instances });
});

app.get("/contact", async (req, res) => {
    const userInfo = await getInfo("zonianmidian");
    res.render("contact", userInfo);
});

app.get("/rdr/:channel", async (req, res) => {
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel)) return res.render("error", { error: `Invalid channel or channel ID: ${channel}`, code: "" });

    const { pretty } = req.query;

    try {
        const instance = await getInstance(channel, null, 'true', pretty);
        if (instance.error) {
            return res.render("error", { error: instance.error, code: "" });
        } else {
            return res.redirect(instance?.channelLogs?.fullLink[0]);
        }
    } catch (err) {
        return res.render("error", { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: "" });
    }

});

app.get("/rdr/:channel/:user", async (req, res) => {
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    const user = utils.formatUsername(decodeURIComponent(req.params.user));

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel)) return res.render("error", { error: `Invalid channel or channel ID: ${channel}`, code: "" });
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user)) return res.render("error", { error: `Invalid username or user ID: ${user}`, code: "" });

    const { pretty } = req.query;

    try {
        const instance = await getInstance(channel, user, 'true', pretty);
        if (instance.error) {
            return res.render("error", { error: instance.error, code: "" });
        } else {
            return res.redirect(instance?.userLogs?.fullLink[0]);
        }
    } catch (err) {
        return res.render("error", { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: "" });
    }

});

app.get("/api/:channel", async (req, res) => {
    const { force, full, pretty, plain } = req.query;
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    let error = null;

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel)) error = `Invalid channel or channel ID: ${channel}`;

    try {
        const instances = await getInstance(channel, null, force, pretty, full, error);
        if (plain?.toLowerCase() === 'true') {
            return res.send(instances?.channelLogs?.fullLink[0] ?? instances?.error);
        } else {
            return res.send(instances);
        }
    } catch (err) {
        if (plain?.toLowerCase() === 'true') {
            return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
        } else {
            return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
        }
    }
});

app.get("/api/:channel/:user", async (req, res) => {
    const { force, full, pretty, plain } = req.query;
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    const user = utils.formatUsername(decodeURIComponent(req.params.user));
    let error = null;

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel)) error = `Invalid channel or channel ID: ${channel}`;
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user)) error = `Invalid username or user ID: ${user}`;

    try {
        const instances = await getInstance(channel, user, force, pretty, full, error);
        if (plain?.toLowerCase() === 'true') {
            return res.send(instances?.userLogs?.fullLink[0] ?? instances?.error);
        } else {
            return res.send(instances);
        }
    } catch (err) {
        if (plain?.toLowerCase() === 'true') {
            return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
        } else {
            return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
        }
    }
});

app.use(function (req, res, next) {
    const err = new Error("Not found");
    err.status = 404;
    next(err);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    return res.render("error", { error: err.message, code: `${err.status} - ` });
});

app.listen(port, () => {
    console.log(`Logs website listening on ${port}`);
});
