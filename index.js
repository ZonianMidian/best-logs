const express = require("express");
const utils = require("./utils");
const got = require("got");
const app = express();
const port = 2028;

app.use("/static", express.static(`${__dirname}/static`));
app.set("views", `${__dirname}/views`);
app.set("view engine", "ejs");

async function getInstance(channel, user, force, pretty, full) {
    const instances = (require("./data.json")).instances;
    pretty = (pretty?.toLowerCase() === 'true')
    force = (force?.toLowerCase() === 'true')
    full = (full?.toLowerCase() === 'true')

    let error = null;
    let downSites = 0;
    let fullLinks = []
    let userInstances = []
    let channelInstances = []

    if(Number(await utils.redis.get(`logs:updated`)) - Math.round((new Date()).getTime() / 1000) > 86400) force = true

    const start = performance.now();
    for (const Website of instances) {
        const { Status, Link, Full } = await getLogs(Website, user, channel, force, pretty);
        switch (Status) {
            case 0:
                downSites++;
                continue;
            case 1:
                channelInstances.push(Link)
                userInstances.push(Link)
                fullLinks.push(Full)
                if (full) { continue; }
                break;
            case 2:
                channelInstances.push(Link)
                continue;
            case 3:
                continue;
        }
        break;
    }

    if(force) await utils.redis.set(`logs:updated`, Math.round((new Date()).getTime() / 1000))

    if(userInstances.length === 0 && channelInstances.length === 0) error = "No logs found"
    if(userInstances.length === 0 && channelInstances.length > 0) error = "No user logs found"
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
            fullLink: fullLinks
        },
        channelLogs: {
            count: channelInstances.length,
            instances: channelInstances
        },
        lastUpdated: {
            unix: Number(await utils.redis.get(`logs:updated`)),
            utc: new Date(await utils.redis.get(`logs:updated`) * 1000).toUTCString()
        },
        elapsed: {
            ms: Math.round((end - start) * 100) / 100,
            s: Math.round((end - start)/10) / 100
        }
    }
}

async function getLogs(url, user, channel, force, pretty) {

    let logsInfo = {
        Status: Number,
        Link: String ?? null,
        Full: String ?? null
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
                headers: {"User-Agent": "Best Logs by ZonianMidian"}
            });
            Channels = logsData.body.channels.map((i) => i.name)
            await utils.redis.set(`logs:instance:${url}`, JSON.stringify(Channels))
        } catch (err) {
            logsInfo.Status = 0;
            return logsInfo;
        }
    }

    if (Channels.includes(channel)) {
        const cacheData = await utils.redis.get(`logs:instance:${url}:${channel}:${user}`)
        let Code

        const userPath = user.match(/^id:(\d{1,})$/i) ? 'userid' : 'user'

        if (cacheData && !force) {
            Code = JSON.parse(cacheData)
        } else {
            const { statusCode } = await got(`https://${url}/channel/${channel}/${userPath}/${user.replace('id:', '')}`,
                { throwHttpErrors: false, http2: true, headers: { "User-Agent": "Best Logs by ZonianMidian" } })
            await utils.redis.set(`logs:instance:${url}:${channel}:${user}`, statusCode, "EX", 86400)
            Code = statusCode
        }

        if (Code < 200 || Code > 299) {
            logsInfo.Status = 2
            logsInfo.Link = `https://${url}`
        }
        else {
            logsInfo.Status = 1;
            logsInfo.Link = `https://${url}`;
            logsInfo.Full = (pretty) ? 
                `https://logs.raccatta.cc/${url}/channel/${channel}/${userPath}/${user.replace('id:', '')}` 
                : `https://${url}/?channel=${channel}&username=${user}`;
        }

        return logsInfo;
    }

    logsInfo.Status = 3;
    return logsInfo;
}

async function getInfo(user) {
    const { body, statusCode } = await got(
        `https://api.ivr.fi/v2/twitch/user/${user}`,
        {
            throwHttpErrors: false,
            responseType: "json",
        }
    );
    if (statusCode < 200 || statusCode > 299) return null;

    const displayName =
        body.displayName.toLowerCase() === user ? body.displayName : user;
    return { name: displayName, avatar: body.logo, id: body.id };
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

app.get("/rdr/:channel/:user", async (req, res) => {
    const { channel, user } = req.params;
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user)) return res.render("error", { error: "Invalid username", code: "" });
    if (!new RegExp(/^[a-z0-9]\w{0,24}$/i).exec(channel)) return res.render("error", { error: "Invalid channel", code: "" });

    const { force, pretty } = req.query;
    const instance = await getInstance(utils.formatUsername(channel), utils.formatUsername(user), force, pretty);
    if (instance.error) {
        return res.render("error", { error: instance.error, code: "" });
    } else {
        return res.redirect(instance?.userLogs?.fullLink[0]);
    }
    
});

app.get("/api/:channel/:user", async (req, res) => {
    const { channel, user } = req.params;
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user)) res.send({ error: "Invalid username" });
    if (!new RegExp(/^[a-z0-9]\w{0,24}$/i).exec(channel)) res.send({ error: "Invalid channel" });

    const { force, full, pretty, plain } = req.query;
    const instances = await getInstance(utils.formatUsername(channel), utils.formatUsername(user), force, pretty, full);
    if (plain?.toLowerCase() === 'true') {
        return res.send(instances?.userLogs?.fullLink[0]);
    } else {
        return res.send(instances);
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
