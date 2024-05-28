import data from './data.json' with { type: 'json' };
import { Utils } from './utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';

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
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '' });
    }

    const { force, pretty } = req.query;

    try {
        const instance = await utils.getInstance(channel, null, force, pretty);

        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        }

        return res.redirect(instance?.channelLogs?.fullLink[0]);
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '' });
    }
});

app.get('/rdr/:channel/:user', async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);
    const user = utils.formatUsername(req.params.user);
    const { force, pretty } = req.query;

    if (!utils.userChanRegex.test(channel)) {
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '' });
    }

    if (!utils.userChanRegex.test(user)) {
        return res.render('error', { error: `Invalid username or user ID: ${user}`, code: '' });
    }

    try {
        const instance = await utils.getInstance(channel, user, force, pretty);

        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        }

        return res.redirect(instance?.userLogs?.fullLink[0]);
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '' });
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

app.get('/instances', async (req, res) => {
    const instances = Object.fromEntries(utils.instanceChannels);
    res.send(instances);
});

app.get('/channels', async (req, res) => {
    const channels = Array.from(utils.uniqueChannels);
    res.send({ channels });
});

const getRecentMessages = async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);

    try {
        const recentMessages = await utils.getRecentMessages(channel, req.query);

        return res.send(recentMessages);
    } catch (err) {
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

app.use(function (err, req, res) {
    res.status(err.status || 500);

    return res.render('error', { error: err.message, code: `${err.status} - ` });
});

app.listen(port, () => {
    utils.loopLoadInstanceChannels();
    console.log(`Logs website listening on ${port}`);
});
