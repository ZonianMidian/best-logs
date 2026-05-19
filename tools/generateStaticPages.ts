import fs from 'node:fs/promises';
import path from 'node:path';

interface StaticConfig {
	instances: StaticInstance[];
	baseUrl: string;
	apiUrl: string;
}

interface StaticInstance {
	host: string;
	maintainer: string;
}

const outputDirectory = 'public';
const config = await readConfig();
const version = await readVersion();
const { baseUrl } = config;
const assetBaseUrl = `${baseUrl}/static`;

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

async function readVersion(): Promise<string> {
	const raw = await fs.readFile('package.json', 'utf8');
	const packageJson = JSON.parse(raw) as unknown;

	if (
		packageJson !== null &&
		typeof packageJson === 'object' &&
		'version' in packageJson &&
		typeof packageJson.version === 'string'
	) {
		return packageJson.version;
	}

	return 'unknown';
}

function normalizeUrl(value: unknown, key: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`Invalid config.${key}: expected a string`);
	}
	if (value === '') return '';
	if (!/^https?:\/\//i.test(value)) {
		throw new TypeError(`Invalid config.${key}: expected a URL starting with http:// or https://`);
	}
	return value.replace(/\/+$/, '');
}

async function readConfig(): Promise<StaticConfig> {
	let raw: string | undefined;
	for (const file of ['config.local.json', 'config.json']) {
		try {
			raw = await fs.readFile(file, 'utf8');
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	if (raw === undefined) {
		throw new Error('No config file found (expected config.local.json or config.json)');
	}

	const parsedConfig = JSON.parse(raw) as unknown;

	if (parsedConfig === null || typeof parsedConfig !== 'object' || !('instances' in parsedConfig)) {
		throw new TypeError('Invalid config: expected an object with an instances array');
	}

	const { instances: rawInstances } = parsedConfig;
	if (rawInstances === null || typeof rawInstances !== 'object') {
		throw new TypeError('Invalid config.instances: expected an object');
	}

	const rawConfig = parsedConfig as { baseUrl?: unknown; apiUrl?: unknown };

	const normalizedBaseUrl = normalizeUrl(rawConfig.baseUrl ?? '', 'baseUrl');
	const normalizedApiUrl = normalizeUrl(rawConfig.apiUrl ?? '', 'apiUrl');

	if (Array.isArray(rawInstances)) {
		return {
			instances: rawInstances.map((host) => {
				if (typeof host !== 'string') {
					throw new TypeError('Invalid config.instances: expected strings');
				}
				return { host, maintainer: '' };
			}),
			baseUrl: normalizedBaseUrl,
			apiUrl: normalizedApiUrl,
		};
	}

	const instances = Object.entries(rawInstances).map(([host, metadata]) => {
		if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
			throw new TypeError(`Invalid config.instances.${host}: expected an object`);
		}

		const maintainer = (metadata as { maintainer?: unknown }).maintainer;
		if (maintainer !== undefined && typeof maintainer !== 'string') {
			throw new TypeError(`Invalid config.instances.${host}.maintainer: expected a string`);
		}

		return { host, maintainer: maintainer ?? '' };
	});

	return { instances, baseUrl: normalizedBaseUrl, apiUrl: normalizedApiUrl };
}

function pageHead(title: string, description: string, image = `${assetBaseUrl}/DankG.png`): string {
	return `<head>
	<meta name="viewport" content="width=device-width, initial-scale=0.6" />
	<meta property="og:url" content="${baseUrl}/" />
	<meta name="keywords" content="twitch, chat, logs" />
	<meta property="og:type" content="website" />
	<meta name="application-name" content="Best Logs" />
	<title>${escapeHtml(title)}</title>
	<meta name="description" content="${escapeHtml(description)}" />
	<meta property="og:title" content="${escapeHtml(title)}" />
	<meta property="og:image" content="${escapeHtml(image)}" />
	<meta property="og:description" content="${escapeHtml(description)}" />
	<style>${mainCss}</style>
	<link rel="stylesheet" href="https://bootswatch.com/5/solar/bootstrap.min.css" />
	<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
</head>`;
}

function navbar(): string {
	return `<nav class="navbar navbar-expand-lg bg-dark navbar-dark">
		<div class="container-fluid">
			<a class="navbar-brand" href="/"> <img class="navbarImage" src="${assetBaseUrl}/DankG.png" title="BestLogs" alt="BestLogs" />Best Logs</a>
			<button
				class="navbar-toggler"
				type="button"
				data-bs-toggle="collapse"
				data-bs-target="#navbarToggler"
				aria-controls="navbarToggler"
				aria-expanded="false">
				<span class="navbar-toggler-icon"></span>
			</button>
			<div class="collapse navbar-collapse" id="navbarToggler">
				<ul class="navbar-nav me-auto mb-2 mb-lg-0">
					<li class="nav-item">
						<a class="nav-link" href="/api" data-umami-event="navbar-api">API</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" href="/contact" data-umami-event="navbar-contact">Contact</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" href="/faq" data-umami-event="navbar-faq">FAQ</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" href="/status" data-umami-event="navbar-status">Status</a>
					</li>
				</ul>
				<form id="SearchForm" onsubmit="submitSearch(event)" class="d-flex" role="search">
					<input id="channelInput" class="form-control me-2" type="search" placeholder="Channel" aria-label="Channel" autofocus required />
					<input id="userInput" class="form-control me-2" type="search" placeholder="User" aria-label="User" />
					<button type="submit" class="btn btn-light"><i class="fa-solid fa-magnifying-glass"></i></button>
				</form>
			</div>
		</div>
	</nav>
	<script defer>
		function submitSearch(event) {
			event.preventDefault();

			const channel = document.getElementById('channelInput').value.trim();
			const user = document.getElementById('userInput').value.trim();

			if (window.umami) {
				window.umami.track('search', {
					channel: channel,
					user: user,
				});
			}

			const rdrPath = user
					? '/rdr/' + encodeURIComponent(channel) + '/' + encodeURIComponent(user)
					: '/rdr/' + encodeURIComponent(channel);
				window.open(rdrPath + '?pretty=true');
		}
	</script>`;
}

function versionFooter(): string {
	return `<div id="version">
		<p>
			Version
			${escapeHtml(version)}
		</p>
	</div>`;
}

function htmlDocument(
	title: string,
	description: string,
	body: string,
	scripts = '',
	image = `${assetBaseUrl}/DankG.png`,
): string {
	return `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
${pageHead(title, description, image)}
${navbar()}
${body}
${scripts}
</html>
`;
}

function indexPage(): string {
	const instances = config.instances
		.map((instance) => {
			const escaped = escapeHtml(instance.host);
			return `<li>
						<a href="https://${escaped}" style="text-decoration: none" data-umami-event="instance-${escaped}"> ${escaped}</a>
					</li>`;
		})
		.join('\n\t\t\t\t');

	return htmlDocument(
		'Best Logs',
		'Logs finder for Twitch',
		`<body>
	<div class="text-center margin content">
		<img src="${assetBaseUrl}/DankG.gif" alt="DankG" />
		<blockquote class="blockquote margin">
			<h1>About</h1>
			<p class="col-md-4 offset-md-4">
				This website does not store information of any kind, it only intends to collect public information about user logs in Twitch chats,
				and display them to visitors in a nice and clean way.
			</p>
		</blockquote>
		<blockquote class="blockquote margin">
			<h1>Usage</h1>
			<p class="col-md-4 offset-md-4">
				Go to the
				<a href="/api" style="text-decoration: none" data-umami-event="link-api">API</a>
				section for more details on how to use this service.
			</p>
		</blockquote>
		<blockquote class="blockquote margin">
			<h1>Used Data & APIs</h1>
			<p class="col-md-4 offset-md-4">The data is currently obtained from the following providers:</p>
			<ul style="display: inline-block; text-align: initial">
				${instances}
			</ul>
		</blockquote>
	</div>
	${versionFooter()}
</body>`,
	);
}

function apiPage(): string {
	return htmlDocument(
		'Logs | API',
		'Best Logs API',
		`<body>
	<div class="text-center margin content">
		<h1>Mirror</h1>

		<p>
			You can use any log instance endpoint and I will get the best result for the channel-user combination.<br />
			<b>Docs:</b><br />
			<a data-umami-event="endpoint-mirror" href="https://logs.ivr.fi/docs">https://logs.ivr.fi/docs</a>
		</p>

		<h1>API</h1>

		<kbd>api/:channel/:user</kbd>
		<p>Details for a user's available logs.</p>
		<ul style="list-style: none">
			<li><b>:channel</b> - It can be a username (TenkSit) or an id (id:557479550)</li>
			<li><b>:user (Optional)</b> - It can be a username (vicesmile) or an id (id:187698721)</li>
		</ul>
		<b>Example:</b><br />

		<a data-umami-event="endpoint-api" href="/api/orslok/Spanixbot">${baseUrl}/api/orslok/Spanixbot</a><br />
		<a data-umami-event="endpoint-api" href="/api/forsen/id:117691339">${baseUrl}/api/forsen/id:117691339</a>

		<ul style="list-style: none">
			<li><b>plain (bool):</b> - Get the instance link in plain text</li>
			<li><b>pretty (bool):</b> - Get the links using an enhanced version of the logs</li>
		</ul>

		<h1>Redirect</h1>

		<kbd>rdr/:channel/:user</kbd>
		<p>Simple redirect to an available instance for the user's logs.</p>
		<ul style="list-style: none">
			<li><b>:channel</b> - It can be a username (NOTLUSHIN) or an id (id:410014058)</li>
			<li><b>:user (Optional)</b> - It can be a username (Drapsnatt) or an id (id:43547909)</li>
		</ul>
		<p>
			<b>Example:</b><br />
			<a data-umami-event="endpoint-redirect" href="/rdr/FapParaMoar/Rubius">${baseUrl}/rdr/FapParaMoar/Rubius</a><br />
			<a data-umami-event="endpoint-redirect" href="/rdr/ZonianMidian/id:570220755">${baseUrl}/rdr/ZonianMidian/id:570220755</a>
		</p>

		<ul style="list-style: none">
			<li><b>pretty (bool):</b> - Get the links using an enhanced version of the logs</li>
		</ul>

		<h1>Name History</h1>

		<kbd>namehistory/:user</kbd>
		<p>Obtains the history of usernames used by someone.</p>
		<ul style="list-style: none">
			<li><b>:user</b> - It can be an id (596675864) or a username (login:xqc)</li>
		</ul>
		<p>
			<b>Example:</b><br />
			<a data-umami-event="endpoint-namehistory" href="/namehistory/93281234">${baseUrl}/namehistory/93281234</a><br />
			<a data-umami-event="endpoint-namehistory" href="/namehistory/login:vei">${baseUrl}/namehistory/login:vei</a>
		</p>

		<h1>Instances</h1>

		<kbd>instances</kbd>
		<p>
			List of tracked logging instances.<br />
			<b>Example:</b><br />
			<a data-umami-event="endpoint-instances" href="/instances">${baseUrl}/instances</a>
		</p>

		<h1>Channels</h1>

		<kbd>channels</kbd>
		<p>
			List of unique channels across all instances.<br />
			<b>Example:</b><br />
			<a data-umami-event="endpoint-channels" href="/channels">${baseUrl}/channels</a>
		</p>

		<h1>Health</h1>

		<kbd>health</kbd>
		<p>
			Health check for the API with basic data.<br />
			<b>Example:</b><br />
			<a data-umami-event="endpoint-health" href="/health">${baseUrl}/health</a>
		</p>

		<h1>Recent Messages</h1>

		<kbd>rm/:channel</kbd>
		<p>Most complete history from a recent-messages instance.</p>
		<ul style="list-style: none">
			<li><b>:channel</b> - It can only be a username (AlkalineXTw)</li>
		</ul>
		<b>Example:</b><br />
		<a data-umami-event="endpoint-rm" href="/rm/RyanPotat">${baseUrl}/rm/RyanPotat</a>

		<ul style="list-style: none">
			<li><b>hide_moderation_messages (bool):</b> - Omits CLEARCHAT and CLEARMSG messages from the response</li>
			<li>
				<b>hide_moderated_messages (bool):</b> - Omits all messages from the response that have been deleted by a CLEARCHAT or CLEARMSG
				message
			</li>
			<li><b>clearchat_to_notice (bool):</b> - Converts CLEARCHAT messages into NOTICE messages with a user-presentable message</li>
			<li><b>limit (number):</b> - Limit the number of messages returned</li>
			<li>
				<b>before (number):</b> - Only return messages that were received before (<) this timestamp (in milliseconds since the unix epoch,
				this refers to the rm-received-rs timestamp)
			</li>
			<li>
				<b>after (number):</b> - Only return messages that were received after (>) this timestamp (in milliseconds since the unix epoch, this
				refers to the rm-received-rs timestamp)
			</li>
			<li><b>rm_only (bool):</b> - Only use instances of recent-messages to get the history (ignore justlog/rustlog and it's faster)</li>
		</ul>
	</div>
	${versionFooter()}
</body>`,
	);
}

function contactPage(): string {
	return htmlDocument(
		'Logs | Contact',
		'Contact with @ZonianMidian',
		`<body>
	<div class="text-center margin">
		<h1>Contact</h1>
	</div>
	<div class="text-center margin content">
		<blockquote class="blockquote margin">
			<h1 class="title contactTitle">ZonianMidian</h1>
			<div class="socials">
				<a href="https://x.com/ZonianMidian" class="fa-brands fa-x-twitter" data-umami-event="socials-twitter"></a>
				<a href="https://twitch.tv/ZonianMidian" class="fa-brands fa-twitch" data-umami-event="socials-twitch"></a>
				<a href="https://github.com/ZonianMidian" class="fa-brands fa-github" data-umami-event="socials-github"></a>
				<a href="https://discord.gg/rMjftZx8Ex" class="fa-brands fa-discord" data-umami-event="socials-discord"></a>
			</div>
			<p>Contact me for questions or suggestions :P</p>
		</blockquote>
	</div>
	${versionFooter()}
</body>`,
	);
}

function faqPage(): string {
	return htmlDocument(
		'Logs | FAQ',
		'Frequently Asked Questions',
		`<body>
	<div class="text-center margin content">
		<h1>FAQ</h1>
		<img src="${assetBaseUrl}/dankSpin.gif" alt="dankSpin" class="margin" />
		<blockquote class="blockquote margin">
			<h2>Open source?</h2>
			<p class="col-md-4 offset-md-4">
				Yes, the code is available on
				<a href="https://github.com/ZonianMidian/best-logs" style="text-decoration: none" data-umami-event="link-repository"> GitHub</a>
			</p>
		</blockquote>
		<blockquote class="blockquote margin">
			<h2>Received an error?</h2>
			<p class="col-md-4 offset-md-4">
				You either misspelled the user or statistics were not found for the specified channel. In any case, you can
				<a data-umami-event="link-contact" href="/contact" style="text-decoration: none">contact</a>
				me or report the error on
				<a href="https://github.com/ZonianMidian/best-logs/issues" style="text-decoration: none" data-umami-event="link-issues"> GitHub</a>
			</p>
		</blockquote>
		<blockquote class="blockquote margin">
			<h2>Why are there no logs for my channel?</h2>
			<p class="col-md-4 offset-md-4">
				You should contact the maintainer of an available instance and ask them to add your channel. Check the
				<a href="/status" style="text-decoration: none" data-umami-event="link-status"> Status</a>
				section for more information about the instances.
			</p>
		</blockquote>
	</div>
	${versionFooter()}
</body>`,
	);
}

function statusPage(): string {
	const placeholders = config.instances
		.map((instance) => {
			const escaped = escapeHtml(instance.host);
			const maintainer = escapeHtml(instance.maintainer || 'Unknown');
			return `<div class="card" data-instance="${escaped}">
					<h2><a href="https://${escaped}" data-umami-event="instance-${escaped}">${escaped}</a></h2>
					<h3>${maintainer}</h3>
					<span class="status down">&#x2193; DOWN</span>
					<span>&#x200E;</span>
				</div>`;
		})
		.join('\n\t\t\t');

	return htmlDocument(
		'Logs | Status',
		'Status of instances',
		`<body>
	<div class="text-center margin content">
		<h1>Status</h1>
		<div class="container" id="instances">
			${placeholders}
		</div>
		<p class="time" id="last-update">Last update: loading</p>
		<p class="time" id="next-update">Next update: loading</p>
		<p class="time" id="current-uptime">Uptime: loading</p>
	</div>
	${versionFooter()}
</body>`,
		`<script>
	function getTime(timestamp, future) {
		const now = Date.now();
		const difference = future ? timestamp - now : now - timestamp;

		if (difference < 0) {
			return '0 seconds';
		}

		const seconds = Math.floor(difference / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return days === 1 ? '1 day' : days + ' days';
		} else if (hours > 0) {
			return hours === 1 ? '1 hour' : hours + ' hours';
		} else if (minutes > 0) {
			return minutes === 1 ? '1 minute' : minutes + ' minutes';
		} else {
			return seconds === 1 ? '1 second' : seconds + ' seconds';
		}
	}

	async function loadStatus() {
		const response = await fetch('${config.apiUrl}/instances');
		const data = await response.json();
		const instanceCounts = data.instanceCounts || {};
		const lastElement = document.getElementById('last-update');
		const nextElement = document.getElementById('next-update');
		const uptimeElement = document.getElementById('current-uptime');

		for (const card of document.querySelectorAll('[data-instance]')) {
			const instance = card.getAttribute('data-instance');
			const count = Number(instanceCounts[instance] || 0);
			const status = card.querySelector('.status');
			const countElement = status.nextElementSibling;

			if (count > 0) {
				status.className = 'status up';
				status.innerHTML = '&#x2191; UP';
				countElement.innerText = new Intl.NumberFormat().format(count) + ' channels';
			} else {
				status.className = 'status down';
				status.innerHTML = '&#x2193; DOWN';
				countElement.innerHTML = '&#x200E;';
			}
		}

		function updateTimes() {
			const lastTime = getTime(data.lastUpdate);
			const nextTime = getTime(Date.now() + data.nextUpdate, true);
			const currentUptime = getTime(data.uptime);

			lastElement.innerText = 'Last update: ' + lastTime + ' ago';
			nextElement.innerText = 'Next update: In ' + nextTime;
			uptimeElement.innerText = 'Uptime: ' + currentUptime;

			if (nextTime === '0 seconds') {
				clearInterval(intervalId);
				setTimeout(() => {
					location.reload();
				}, 5000);
			}
		}

		const intervalId = setInterval(updateTimes, 500);
		updateTimes();
	}

	void loadStatus();
</script>`,
	);
}

const mainCss = `::-webkit-scrollbar {
	display: none;
}

* {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
	font-family: Helvetica;
}

html,
body {
	height: 100%;
	display: flex;
	flex-direction: column;
}

blockquote.h1 {
	font-size: 1em;
	margin: 0.83em 0;
	font-weight: bold;
}

img.logo {
	height: 40px;
	float: left;
}

a.fa-brands {
	color: #fff;
	font-size: 50px;
	text-decoration: none;
	padding: 10px;
	border-radius: 50%;
	transition: 0.3s;
}

.navbarImage {
	margin: 0 10px;
	height: 40px;
	vertical-align: middle;
}

form {
	padding: 0 20px;
}

#urlInput {
	padding: 10px;
	resize: none;
	outline: none;
	caret-color: transparent;
}

.margin {
	margin-top: 2%;
}

h1.title {
	text-align: center;
	font-size: 50px;
	color: purple;
}

img.emote_image {
	position: relative;
	right: -10%;
	height: 50px;
	max-width: 30%;
}

.form-control {
	outline: none !important;
	border: none !important;
	background-color: #a9bdbd !important;
}

.form-control:focus {
	border: none !important;
	box-shadow: none !important;
}

.btn {
	background-color: #a9bdbd !important;
	border: none !important;
}

.btn:hover {
	background-color: #909f9f !important;
	border: none !important;
}

.navbar-brand {
	color: #909f9f !important;
	font-weight: 700 !important;
}

.fa-magnifying-glass {
	color: var(--bs-body-bg) !important;
}

.contactTitle {
	font-weight: 700 !important;
}

a {
	text-decoration: none !important;
}

.container {
	display: flex;
	flex-wrap: wrap;
	gap: 20px;
	margin: 20px;
	justify-content: center;
}

.card {
	padding: 20px;
	width: calc(33.333% - 40px);
	box-sizing: border-box;
	text-align: center;
}

.card h2 {
	font-size: 1.5em;
	margin-bottom: 10px;
}

.card h3 {
	font-size: 1.2em;
	color: #666;
}

.status {
	font-size: 1.5em;
	font-weight: bold;
}

.status.up {
	color: green;
}

.status.down {
	color: red;
}

.time {
	margin: 0;
}

.col2 {
	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: center;
	width: 100%;
	gap: 20px;
}

.col2 blockquote {
	padding: 1rem;
	margin: 0;
	width: 400px;
	height: 400px;
}

.flag {
	margin-bottom: 1rem;
}

.content {
	flex: 1;
}

#version {
	text-align: center;
	opacity: 0.7;
	padding: 1em 0 0.5em 0;
}

#version p {
	margin: 0;
}

@media (max-width: 768px) {
	.card {
		width: calc(50% - 40px);
	}
}

@media (max-width: 480px) {
	.card {
		width: 100%;
	}
}
`;

await Promise.all([
	fs.mkdir(path.join(outputDirectory, 'api'), { recursive: true }),
	fs.mkdir(path.join(outputDirectory, 'contact'), { recursive: true }),
	fs.mkdir(path.join(outputDirectory, 'faq'), { recursive: true }),
	fs.mkdir(path.join(outputDirectory, 'status'), { recursive: true }),
]);
await Promise.all([
	fs.writeFile(path.join(outputDirectory, 'index.html'), indexPage()),
	fs.writeFile(path.join(outputDirectory, 'api', 'index.html'), apiPage()),
	fs.writeFile(path.join(outputDirectory, 'contact', 'index.html'), contactPage()),
	fs.writeFile(path.join(outputDirectory, 'faq', 'index.html'), faqPage()),
	fs.writeFile(path.join(outputDirectory, 'status', 'index.html'), statusPage()),
]);

console.log(`[Static] Generated pages in ${outputDirectory}`);
