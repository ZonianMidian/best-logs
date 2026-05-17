import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { fetchStream } from '../utils/request.js';
import { logsService } from '../utils/logsService.js';
import { USER_AGENT, formatError, formatUsername, userChanRegex } from '../utils/helpers.js';

const ALLOWED_LOG_PARAMS = new Set(['limit', 'raw', 'reverse', 'json', 'jsonBasic']);
const DATE_SEGMENT_RE = /^\d{1,4}$/;
const NUMERIC_ID_RE = /^\d+$/;
const ALLOWED_CONTENT_TYPES = ['text/plain', 'application/json', 'application/octet-stream'];

function sendError(res: Response, status: number, message: string): void {
	res.status(status).contentType('text/plain').send(message);
}

async function proxyToInstance(res: Response, targetUrl: string): Promise<void> {
	const ac = new AbortController();
	const timer = setTimeout(() => { ac.abort(new DOMException('Gateway timeout', 'TimeoutError')); }, 120_000);

	try {
		const { body, statusCode, headers } = await fetchStream(targetUrl, {
			headers: { 'User-Agent': USER_AGENT },
			signal: ac.signal,
		});

		const contentType = headers['content-type'] ?? '';
		if (!ALLOWED_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
			sendError(res, 400, 'Invalid endpoint');
			return;
		}

		res.status(statusCode).contentType(contentType);
		if (body) {
			await pipeline(Readable.fromWeb(body), res);
		} else {
			res.end();
		}
	} finally {
		clearTimeout(timer);
	}
}

function resolveChannelInput(req: Request): string | null {
	if (typeof req.query.channelid === 'string' && req.query.channelid) {
		return `id:${req.query.channelid}`;
	}
	if (typeof req.query.channel === 'string' && req.query.channel) {
		return formatUsername(req.query.channel);
	}
	return null;
}

function resolveUserInput(req: Request): string | null {
	if (typeof req.query.userid === 'string' && req.query.userid) {
		return `id:${req.query.userid}`;
	}
	if (typeof req.query.user === 'string' && req.query.user) {
		return formatUsername(req.query.user);
	}
	return null;
}

const router = Router();

router.get('/list', async (req: Request, res: Response) => {
	const rawChannelId = req.query.channelid;
	if (typeof rawChannelId === 'string' && rawChannelId && !NUMERIC_ID_RE.test(rawChannelId)) {
		sendError(res, 400, 'Invalid channel ID: must be numeric');
		return;
	}
	const rawUserId = req.query.userid;
	if (typeof rawUserId === 'string' && rawUserId && !NUMERIC_ID_RE.test(rawUserId)) {
		sendError(res, 400, 'Invalid user ID: must be numeric');
		return;
	}

	const channel = resolveChannelInput(req);

	if (!channel) {
		sendError(res, 400, 'Missing channel or channelid parameter');
		return;
	}
	if (!userChanRegex.test(channel)) {
		sendError(res, 400, 'Invalid channel or channel ID');
		return;
	}

	const user = resolveUserInput(req);
	if (user !== null && !userChanRegex.test(user)) {
		sendError(res, 400, 'Invalid user or user ID');
		return;
	}

	try {
		const data = await logsService.getInstance(channel, user, false);
		if (data.error) {
			sendError(res, data.status, data.error);
			return;
		}

		const instanceLink = data.channelLogs.instances[0];
		const channelId = data.request.channel?.id;
		const userId = data.request.user?.id;

		if (!instanceLink || !channelId) {
			sendError(res, 404, 'No instance found');
			return;
		}

		if (!userId) {
			// Channel-only: getInstance already fetched and cached this list — return it directly.
			res.json({ availableLogs: data.loggedData.list });
			return;
		}

		const params = new URLSearchParams({ channelid: channelId, userid: userId });
		await proxyToInstance(res, `${instanceLink}/list?${params.toString()}`);
	} catch (error) {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		sendError(res, 500, formatError(error));
	}
});

const makeChannelLogsHandler =
	(isById: boolean) =>
	async (req: Request, res: Response): Promise<void> => {
		const rawUserId = req.query.userid;
		if (typeof rawUserId === 'string' && rawUserId && !NUMERIC_ID_RE.test(rawUserId)) {
			sendError(res, 400, 'Invalid user ID: must be numeric');
			return;
		}

		const endpoint = req.params.endpoint ?? '';
		const segments = endpoint.split('/').filter(Boolean);

		if (segments.length === 0) {
			sendError(res, 400, 'Missing channel');
			return;
		}

		const rawSegment = segments[0] ?? '';
		const channel = isById ? `id:${rawSegment}` : formatUsername(rawSegment);

		if (!userChanRegex.test(channel)) {
			sendError(res, 400, 'Invalid channel or channel ID');
			return;
		}

		// Support /channel/:channel/user/:user/... and /channel/:channel/userid/:id/... path formats
		let pathUser: string | null = null;
		let dateStart = 1;
		const userKeyword = segments[1];
		if (userKeyword === 'user' || userKeyword === 'userid') {
			const rawUser = segments[2];
			if (!rawUser) {
				sendError(res, 400, `Missing user after /${userKeyword}/`);
				return;
			}
			pathUser = userKeyword === 'userid' ? `id:${rawUser}` : formatUsername(rawUser);
			dateStart = 3;
		}

		const dateSegments = segments.slice(dateStart);
		for (const seg of dateSegments) {
			if (!DATE_SEGMENT_RE.test(seg)) {
				sendError(res, 400, 'Invalid path segment');
				return;
			}
		}

		// Path /user/:username takes precedence over ?user= query param
		const user = pathUser ?? resolveUserInput(req);
		if (user !== null && !userChanRegex.test(user)) {
			sendError(res, 400, 'Invalid user or user ID');
			return;
		}

		try {
			const data = await logsService.getInstance(channel, user, false);
			if (data.error) {
				sendError(res, data.status, data.error);
				return;
			}

			const instanceLink = data.userLogs.instances[0] ?? data.channelLogs.instances[0];
			const channelId = data.request.channel?.id;
			const userId = data.request.user?.id;

			if (!instanceLink || !channelId) {
				sendError(res, 404, 'No instance found');
				return;
			}

			const pathParts = userId
				? ['channelid', channelId, 'userid', userId, ...dateSegments]
				: ['channelid', channelId, ...dateSegments];
			const params = new URLSearchParams();
			for (const key of ALLOWED_LOG_PARAMS) {
				const val = req.query[key];
				if (typeof val === 'string') params.set(key, val);
			}
			const qs = params.size > 0 ? `?${params.toString()}` : '';

			await proxyToInstance(res, `${instanceLink}/${pathParts.join('/')}${qs}`);
		} catch (error) {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			sendError(res, 500, formatError(error));
		}
	};

router.get('/channel/:endpoint(*)', makeChannelLogsHandler(false));
router.get('/channelid/:endpoint(*)', makeChannelLogsHandler(true));

export default router;
