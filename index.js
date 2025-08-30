import { fileURLToPath } from 'url';
import { Utils } from './utils.js';
import { dirname } from 'path';
import express from 'express';
import cors from 'cors';
import got from 'got';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const utils = new Utils();
const app = express();

const config = utils.config;
app.use((req, res, next) => {
	res.locals.config = config;
	next();
});

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

app.use('/favicon.ico', express.static(`${__dirname}/static/favicon.ico`));
app.use('/static', express.static(`${__dirname}/static`));
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');
app.use(cors());

app.get('/', (req, res) => {
	const instances = Object.keys(config.justlogsInstances);

	res.render('index', { instances, instance: config.instance || {}, version });
});

app.get('/api', async (req, res) => {
	res.render('api', { version });
});

app.get('/faq', (req, res) => {
	const instances = Object.keys(config.justlogsInstances);

	res.render('faq', { version });
});

app.get('/contact', async (req, res) => {
	const creator = await utils.getInfo('ZonianMidian');
	let maintainer = null;

	if (config.instance && Object.keys(config.instance).length > 0) {
		const maintainerInfo = config.instance?.maintainer ? await utils.getInfo(config.instance.maintainer) : {};
		maintainer = Object.assign({}, config.instance, maintainerInfo);
	}

	res.render('contact', { creator, maintainer, version });
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

	const uptime = Date.now() - process.uptime() * 1000;

	res.render('status', { instances, lastUpdate: utils.lastUpdated, nextUpdate: utils.reloadInterval, uptime, version });
});

async function sendStats(req, name, data = {}) {
	const payload = {
		hostname: req.hostname,
		language: req.headers['accept-language'],
		referrer: req.headers['referer'] || config.instance?.url || '',
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
	} catch (err) {
		console.error(`- [Umami] Error sending '${name}' data: ${err.message} - `, data);
	}
}

app.get('/health', async (req, res) => {
	const start = performance.now();
	sendStats(req, 'health');

	const rawInstances = Object.fromEntries(utils.instanceChannels);
	const channels = Array.from(utils.uniqueChannels.values());

	const instances = {};
	for (const [key, arr] of Object.entries(rawInstances)) {
		instances[key] = Array.isArray(arr) ? arr.length : 0;
	}

	if (channels.length === 0) {
		res.status(500);
	}

	const end = performance.now();
	res.json({
		elapsed: {
			ms: Math.round((end - start) * 100) / 100,
			s: Math.round((end - start) / 10) / 100,
		},
		instancesStats: checkInstances(rawInstances),
		instances: instances,
		channels: channels.length,
		instance: config.instance || {},
	});
});

app.get('/rdr/:channel', async (req, res) => {
	const channel = utils.formatUsername(req.params.channel);

	if (!utils.userChanRegex.test(channel)) {
		res.status(400);
		return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: 400 });
	}

	const { pretty } = req.query;

	try {
		const instance = await utils.getInstance(channel, null, 'false', pretty);

		if (instance.error) {
			res.status(instance.status);
			return res.render('error', { error: instance.error, code: instance.status });
		} else {
			sendStats(req, 'rdr', {
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
	const { pretty } = req.query;

	if (!utils.userChanRegex.test(channel)) {
		res.status(400);
		return res.render('error', { error: `Invalid channel or channel ID: ${channel}`, code: 400 });
	}

	if (!utils.userChanRegex.test(user)) {
		res.status(400);
		return res.render('error', { error: `Invalid username or user ID: ${user}`, code: 400 });
	}

	try {
		const instance = await utils.getInstance(channel, user, 'false', pretty);

		if (instance.error) {
			res.status(instance.status);
			return res.render('error', { error: instance.error, code: instance.status });
		} else {
			sendStats(req, 'rdr', {
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
	const { pretty, plain } = req.query;
	const channel = utils.formatUsername(req.params.channel);
	let error = null;

	sendStats(req, 'api', {
		channel: channel ?? '',
	});

	if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;

	const isPlain = plain?.toLowerCase() === 'true';

	try {
		const instances = await utils.getInstance(channel, null, 'false', pretty, error);

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
	const { pretty, plain } = req.query;
	const channel = utils.formatUsername(req.params.channel);
	const user = utils.formatUsername(req.params.user);
	const isPlain = plain?.toLowerCase() === 'true';
	let error = null;

	sendStats(req, 'api', {
		channel: channel ?? '',
		user: user ?? '',
	});

	if (!utils.userChanRegex.test(channel)) error = `Invalid channel or channel ID: ${channel}`;
	if (!utils.userChanRegex.test(user)) error = `Invalid username or user ID: ${user}`;

	try {
		const instances = await utils.getInstance(channel, user, 'false', pretty, error);

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
	sendStats(req, 'instances');

	res.json({
		instancesStats: checkInstances(instances),
		instances: instances,
	});
});

app.get('/channels', async (req, res) => {
	const instances = Object.fromEntries(utils.instanceChannels);
	const channels = Array.from(utils.uniqueChannels.values());
	sendStats(req, 'channels');

	res.json({
		instancesStats: checkInstances(instances),
		channels: channels,
	});
});

const extractValue = (input, regex) => {
	input = utils.formatUsername(input);
	const match = input.match(regex);
	if (match) {
		const result = match[2];
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

	sendStats(req, 'mirror', {
		channel: channel ?? '',
		user: user ?? '',
	});

	if (!channel) {
		res.status(404);
		res.contentType('text/plain');
		return res.send('Invalid channel or channel ID');
	}

	try {
		const data = await utils.getInstance(channel, user, 'false');
		if (data.error) {
			res.status(data.status || 404);
			res.contentType('text/plain');
			return res.send(data.error);
		} else {
			const instanceLink = data?.userLogs?.instances[0] ?? data?.channelLogs?.instances[0];
			let requestUrl = req.url.replace(utils.channelLinkRegex, (_, sep) => {
				return `channelid${sep}${data.request.channel.id}`;
			});

			if (user) {
				requestUrl = requestUrl.replace(utils.userLinkRegex, (_, sep) => {
					return `userid${sep}${data.request.user.id}`;
				});
			}

			const { body, statusCode, headers } = await utils.request(`${instanceLink}${requestUrl}`, {
				headers: { 'User-Agent': 'Best Logs by ZonianMidian' },
				throwHttpErrors: false,
				https: { rejectUnauthorized: false },
				timeout: 120000,
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

app.get('/namehistory/:user', async (req, res) => {
	const user = req.params.user;

	if (user.startsWith('login:')) {
		sendStats(req, 'namehistory', { login: user.replace('login:', '') });
	} else {
		sendStats(req, 'namehistory', { id: user.replace('id:', '') });
	}

	try {
		const result = await utils.getNameHistory(user);

		if (!Array.isArray(result)) {
			res.status(500);
			res.contentType('text/plain');
			return res.send(result);
		}

		res.json(result);
	} catch (err) {
		res.status(500);
		res.contentType('text/plain');
		return res.send(`Internal error${err.message ? ` - ${err.message}` : ''}`);
	}
});

const getRecentMessages = async (req, res) => {
	const channel = utils.formatUsername(req.params.channel);
	sendStats(req, 'recent-messages', {
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

app.listen(config.port, async () => {
	console.log(`- [Website] Listening on ${config.port}`);

	await utils.loopLoadInstanceChannels();
	utils.loopErrorInstanceChannels();
});
