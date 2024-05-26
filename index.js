import express from 'express';
import data from './data.json' with { type: 'json' };
import { LogUtils } from './utils.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = data.port || 3000;
const utils = new LogUtils();

app.use('/favicon.ico', express.static(`${__dirname}/static/favicon.ico`));
app.use('/static', express.static(`${__dirname}/static`));
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');

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

    const { pretty } = req.query;

    try {
        const instance = await utils.getInstance(channel, null, 'true', pretty);

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
    const { pretty } = req.query;

    if (!utils.userChanRegex.test(channel)) {
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '' });
    }

    if (!utils.userChanRegex.test(user)) {
        return res.render('error', { error: `Invalid username or user ID: ${user}`, code: '' });
    }

    try {
        const instance = await utils.getInstance(channel, user, 'true', pretty);

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

app.get('/rm/:channel', async (req, res) => {
    const channel = utils.formatUsername(req.params.channel);

    try {
        const recentMessages = await utils.getRecentMessages(channel, req.query);

        return res.send(recentMessages);
    } catch (err) {
        return res.send({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
    }
});

app.get('/recent-messages/:channel', function (req, res) {
    res.redirect(`/rm/${req.params.channel}`);
});

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
