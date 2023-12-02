const data = require('./data.json');
const express = require('express');
const utils = require('./utils');
const app = express();
const port = 2028;

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
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel))
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '' });

    const { pretty } = req.query;

    try {
        const instance = await utils.getInstance(channel, null, 'true', pretty);
        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        } else {
            return res.redirect(instance?.channelLogs?.fullLink[0]);
        }
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '' });
    }
});

app.get('/rdr/:channel/:user', async (req, res) => {
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    const user = utils.formatUsername(decodeURIComponent(req.params.user));

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel))
        return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: '' });
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user))
        return res.render('error', { error: `Invalid username or user ID: ${user}`, code: '' });

    const { pretty } = req.query;

    try {
        const instance = await utils.getInstance(channel, user, 'true', pretty);
        if (instance.error) {
            return res.render('error', { error: instance.error, code: '' });
        } else {
            return res.redirect(instance?.userLogs?.fullLink[0]);
        }
    } catch (err) {
        return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: '' });
    }
});

app.get('/api/:channel', async (req, res) => {
    const { force, full, pretty, plain } = req.query;
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    let error = null;

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel))
        error = `Invalid channel or channel ID: ${channel}`;

    try {
        const instances = await utils.getInstance(channel, null, force, pretty, full, error);
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

app.get('/api/:channel/:user', async (req, res) => {
    const { force, full, pretty, plain } = req.query;
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));
    const user = utils.formatUsername(decodeURIComponent(req.params.user));
    let error = null;

    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(channel))
        error = `Invalid channel or channel ID: ${channel}`;
    if (!new RegExp(/^[a-z0-9]\w{0,24}$|^id:(\d{1,})$/i).exec(user)) error = `Invalid username or user ID: ${user}`;

    try {
        const instances = await utils.getInstance(channel, user, force, pretty, full, error);
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

app.get('/rm/:channel', async (req, res) => {
    const channel = utils.formatUsername(decodeURIComponent(req.params.channel));

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

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    return res.render('error', { error: err.message, code: `${err.status} - ` });
});

app.listen(port, () => {
    console.log(`Logs website listening on ${port}`);
});
