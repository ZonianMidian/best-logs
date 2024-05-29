import data from './data.json' with { type: 'json' };
import { Utils } from './utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';
import got from 'got';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = data.port || 3000;
const utils = new Utils();
const app = express();

app.use('/favicon.ico', express.static(`${__dirname}/static/favicon.ico`));
app.use('/static', express.static(`${__dirname}/static`));
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');
app.use(cors());

app.get('/', (req, res) => {
    const instances = data.justlogsInstances;
    res.render('index', { instances: instances });
});

app.get('/api', async (req, res) => {
    res.render('api');
});

app.get('/faq', (req, res) => {
    const instances = data.justlogsInstances;

    res.render('faq', { instances: instances });
});

app.get('/contact', async (req, res) => {
    const userInfo = await utils.getInfo('zonianmidian');

    res.render('contact', userInfo);
});

app.get('/rdr/:channel', async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);

    if (!utils.userChanRegex.test(channel)) {
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '400' });
    }

    const { force, pretty } = req.query;

    try {
        const instance = await utils.getInstance(channel, null, force, pretty);

        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        }

        return res.redirect(instance?.channelLogs?.fullLink[0]);
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '500' });
    }
});

app.get('/rdr/:channel/:user', async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);
    const user = utils.formatUsername(req.params.user);
    const { force, pretty } = req.query;

    if (!utils.userChanRegex.test(channel)) {
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '400' });
    }

    if (!utils.userChanRegex.test(user)) {
        return res.render('error', { error: `Invalid username or user ID: ${user}`, code: '400' });
    }

    try {
        const instance = await utils.getInstance(channel, user, force, pretty);

        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        }

        return res.redirect(instance?.userLogs?.fullLink[0]);
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '500' });
    }
});

app.get('/api/:channel', async (req, res) => {
    const { force, pretty, plain } = req.query;
    const channel = utils.formatUsername(req.params.channel);
    let error = null;

    if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;

    const isPlain = plain?.toLowerCase() === 'true';

    try {
        const instances = await utils.getInstance(channel, null, force, pretty, error);

        if (isPlain) {
            return res.send(instances?.channelLogs?.fullLink[0] ?? instances?.error);
        }

        return res.send(instances);
    } catch (err) {
        if (isPlain) {
            return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
        }

        return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
    }
});

app.get('/api/:channel/:user', async (req, res) => {
    const { force, pretty, plain } = req.query;
    const channel = utils.formatUsername(req.params.channel);
    const user = utils.formatUsername(req.params.user);
    const isPlain = plain?.toLowerCase() === 'true';
    let error = null;

    if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;
    if (!utils.userChanRegex.test(user)) error = `Invalid username or user ID: ${user}`;

    try {
        const instances = await utils.getInstance(channel, user, force, pretty, error);

        if (isPlain) {
            res.send(instances?.userLogs?.fullLink[0] ?? instances?.error);
        }

        return res.send(instances);
    } catch (err) {
        if (isPlain) {
            return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
        }

        return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
    }
});

const checkInstances = (obj) => {
    let count = 0;
    let down = 0;

    for (let key in obj) {
        count++;

        if (Array.isArray(obj[key]) && obj[key].length === 0) {
            down++;
        }
    }

    return {
        count,
        down,
    };
};

app.get('/instances', async (req, res) => {
    const instances = Object.fromEntries(utils.instanceChannels);
    res.send({
        instancesStats: checkInstances(instances),
        instances: instances,
    });
});

app.get('/channels', async (req, res) => {
    const instances = Object.fromEntries(utils.instanceChannels);
    const channels = Array.from(utils.uniqueChannels);
    res.send({
        instancesStats: checkInstances(instances),
        channels: channels,
    });
});

const extractValue = (input, regex) => {
    input = utils.formatUsername(input);
    const match = input.match(regex);
    if (match) {
        return match[1];
    }
    return null;
};

const logsApi = async (req, res) => {
    const channel = extractValue(req.url, utils.channelLinkRegex);
    const user = extractValue(req.url, utils.userLinkRegex);
    const { force } = req.query;

    if (!channel) {
        res.status(404);
        return res.send('Invalid channel or channel ID');
    }

    try {
        const data = await utils.getInstance(channel, user, force);
        if (data.error) {
            res.status(data.status || 404);
            return res.send(data.error);
        } else {
            const instanceLink = data?.userLogs?.instances[0] ?? data?.channelLogs?.instances[0];

            const { body, statusCode, headers } = await got(`${instanceLink}${req.url}`, {
                headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
                https: {
                    rejectUnauthorized: false,
                },
                http2: true,
            });

            if (/text\/html/.test(headers['content-type'])) {
                res.status(400);
                return res.send('Invalid endpoint');
            }

            res.status(statusCode);
            return res.send(body);
        }
    } catch (err) {
        res.status(500);
        return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
    }
};

app.get('/list', logsApi);
app.get('/channel/:endpoint(*)', logsApi);
app.get('/channelid/:endpoint(*)', logsApi);

const getRecentMessages = async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);

    try {
        const recentMessages = await utils.getRecentMessages(channel, req.query);

        return res.send(recentMessages);
    } catch (err) {
        res.status(500);
        return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
    }
};

app.get('/rm/:channel', getRecentMessages);
app.get('/recent-messages/:channel', getRecentMessages);
app.get('/api/v2/recent-messages/:channel', getRecentMessages);

app.use(function (req, res, next) {
    const err = new Error('Not found');
    err.status = 404;
    next(err);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', { error: err.message, code: `${err.status} - ` });
});

app.listen(port, () => {
    utils.loopLoadInstanceChannels();
    console.log(`Logs website listening on ${port}`);
});
