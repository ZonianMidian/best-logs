import { fileURLToPath } from 'url';
import { Utils } from './utils.js';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';
import got from 'got';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const utils = new Utils();
const app = express();

const config = utils.config;
app.use((req, res, next) => {
	res.locals.config = config;
	next();
});

app.use('/favicon.ico', express.static(`${__dirname}/static/favicon.ico`));
app.use('/static', express.static(`${__dirname}/static`));
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');
app.use(cors());

app.get('/', (req, res) => {
	const instances = Object.keys(config.justlogsInstances);

	res.render('index', { instances });
});

app.get('/api', async (req, res) => {
	res.render('api');
});

app.get('/faq', (req, res) => {
	const instances = Object.keys(config.justlogsInstances);

	res.render('faq', { instances });
});

app.get('/contact', async (req, res) => {
	const userInfo = await utils.getInfo('zonianmidian');

	res.render('contact', userInfo);
});

app.get('/status', (req, res) => {
	const channels = Object.fromEntries(utils.instanceChannels);
	const instances = config.justlogsInstances;

	for (let key in instances) {
		if (channels[key]) {
			instances[key].channels = channels[key];
		} else {
			instances[key] = { channels: channels[key] };
		}
	}

	res.render('status', { instances, timestamp: utils.lastUpdated, nextUpdate: utils.reloadInterval });
});

async function sendStats(req, name, data = {}) {
	const payload = {
		hostname: req.hostname,
		language: req.headers['accept-language'],
		referrer: req.headers['referer'] || '',
		url: req.originalUrl,
		website: config.umamiStats.id,
		name: name,
		data,
	};

	try {
		await got.post(`${config.umamiStats.url}/api/send`, {
			headers: {
				Authorization: `Bearer ${config.umamiStats.token}`,
			},
			json: {
				payload,
				type: 'event',
			},
		});
	} catch (error) {
		console.error('Error sending data to Umami:', error);
	}
}

app.get('/rdr/:channel', async (req, res) => {
	const channel = utils.formatUsername(req.params.channel);

	if (!utils.userChanRegex.test(channel)) {
		res.status(400);
		return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: 400 });
	}

	const { force, pretty } = req.query;

	try {
		const instance = await utils.getInstance(channel, null, force, pretty);

		if (instance.error) {
			res.status(instance.status);
			return res.render('error', { error: instance.error, code: instance.status });
		} else {
			await sendStats(req, 'rdr', {
				channel: channel ?? '',
			});

			res.status(302);
			return res.redirect(instance?.channelLogs?.fullLink[0]);
		}
	} catch (err) {
		res.status(500);
		return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: 500 });
	}
});

app.get('/rdr/:channel/:user', async (req, res) => {
	const channel = utils.formatUsername(req.params.channel);
	const user = utils.formatUsername(req.params.user);
	const { force, pretty } = req.query;

	if (!utils.userChanRegex.test(channel)) {
		res.status(400);
		return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: 400 });
	}

	if (!utils.userChanRegex.test(user)) {
		res.status(400);
		return res.render('error', { error: `Invalid username or user ID: ${user}`, code: 400 });
	}

	try {
		const instance = await utils.getInstance(channel, user, force, pretty);

		if (instance.error) {
			res.status(instance.status);
			return res.render('error', { error: instance.error, code: instance.status });
		} else {
			await sendStats(req, 'rdr', {
				channel: channel ?? '',
				user: user ?? '',
			});

			res.status(302);
			return res.redirect(instance?.userLogs?.fullLink[0]);
		}
	} catch (err) {
		res.status(500);
		return res.render('error', { error: `Internal error${err.message ? ` - ${err.message}` : ''}`, code: 500 });
	}
});

app.get('/api/:channel', async (req, res) => {
	const { force, pretty, plain } = req.query;
	const channel = utils.formatUsername(req.params.channel);
	let error = null;

	await sendStats(req, 'api', {
		channel: channel ?? '',
	});

	if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;

	const isPlain = plain?.toLowerCase() === 'true';

	try {
		const instances = await utils.getInstance(channel, null, force, pretty, error);

		if (isPlain) {
			res.status(instances?.status || 400);
			res.contentType('text/plain');
			return res.send(instances?.channelLogs?.fullLink[0] ?? instances?.error);
		} else {
			res.status(instances?.status || 400);
			return res.json(instances);
		}
	} catch (err) {
		if (isPlain) {
			res.status(500);
			res.contentType('text/plain');
			return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
		} else {
			res.status(500);
			return res.json({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
		}
	}
});

app.get('/api/:channel/:user', async (req, res) => {
	const { force, pretty, plain } = req.query;
	const channel = utils.formatUsername(req.params.channel);
	const user = utils.formatUsername(req.params.user);
	const isPlain = plain?.toLowerCase() === 'true';
	let error = null;

	await sendStats(req, 'api', {
		channel: channel ?? '',
		user: user ?? '',
	});

	if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;
	if (!utils.userChanRegex.test(user)) error = `Invalid username or user ID: ${user}`;

	try {
		const instances = await utils.getInstance(channel, user, force, pretty, error);

		if (isPlain) {
			res.status(instances?.status || 400);
			res.contentType('text/plain');
			res.send(instances?.userLogs?.fullLink[0] ?? instances?.error);
		} else {
			res.status(instances?.status || 400);
			return res.json(instances);
		}
	} catch (err) {
		if (isPlain) {
			res.status(500);
			res.contentType('text/plain');
			return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
		} else {
			res.status(500);
			return res.json({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
		}
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
	await sendStats(req, 'instances');

	res.json({
		instancesStats: checkInstances(instances),
		instances: instances,
	});
});

app.get('/channels', async (req, res) => {
	const instances = Object.fromEntries(utils.instanceChannels);
	const channels = Array.from(utils.uniqueChannels);
	await sendStats(req, 'channels');

	res.json({
		instancesStats: checkInstances(instances),
		channels: channels,
	});
});

const extractValue = (input, regex) => {
	input = utils.formatUsername(input);
	const match = input.match(regex);
	if (match) {
		const result = match[1];
		if (input.match(/id[\/=]\d{1,}/)) {
			return `id:${result}`;
		}
		return result;
	}
	return null;
};

const logsApi = async (req, res) => {
	const channel = extractValue(req.url, utils.channelLinkRegex);
	const user = extractValue(req.url, utils.userLinkRegex);
	const { force } = req.query;

	await sendStats(req, 'mirror', {
		channel: channel ?? '',
		user: user ?? '',
	});

	if (!channel) {
		res.status(404);
		res.contentType('text/plain');
		return res.send('Invalid channel or channel ID');
	}

	try {
		const data = await utils.getInstance(channel, user, force);
		if (data.error) {
			res.status(data.status || 404);
			res.contentType('text/plain');
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
				res.contentType('text/plain');
				return res.send('Invalid endpoint');
			} else {
				res.status(statusCode);
				res.contentType(headers['content-type']);
				return res.send(body);
			}
		}
	} catch (err) {
		res.status(500);
		res.contentType('text/plain');
		return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
	}
};

app.get('/list', logsApi);
app.get('/channel/:endpoint(*)', logsApi);
app.get('/channelid/:endpoint(*)', logsApi);

const getRecentMessages = async (req, res) => {
	const channel = utils.formatUsername(req.params.channel);
	await sendStats(req, 'recent-messages', {
		channel: channel ?? '',
	});

	try {
		const recentMessages = await utils.getRecentMessages(channel, req.query);

		res.status(recentMessages.status || 400);
		return res.json(recentMessages);
	} catch (err) {
		res.status(500);
		return res.json({ error: `Internal error${err.message ? ` - ${err.message}` : ''}` });
	}
};

app.get('/rm/:channel', getRecentMessages);
app.get('/recent-messages/:channel', getRecentMessages);
app.get('/api/v2/recent-messages/:channel', getRecentMessages);

app.use(function (req, res, next) {
	const err = new Error('Not Found');
	err.status = 404;
	next(err);
});

app.use(function (err, req, res, next) {
	const status = err.status || 500;
	res.status(status);
	res.render('error', { error: err.message, code: status });
});

app.listen(config.port, () => {
	utils.loopLoadInstanceChannels();
	console.log(`- [Website] Listening on ${config.port}`);
});
