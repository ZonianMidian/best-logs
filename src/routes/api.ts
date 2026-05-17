import { Router } from 'express';
import type { Request, Response } from 'express';
import { logsService } from '../utils/logsService.js';
import { formatError, formatUsername, userChanRegex } from '../utils/helpers.js';

function sendApiResponse(
	res: Response,
	status: number,
	isPlain: boolean,
	plainText: string | undefined,
	jsonData: unknown,
): void {
	res.status(status);
	if (isPlain) {
		res.contentType('text/plain');
		res.send(plainText ?? '');
	} else {
		res.json(jsonData);
	}
}

const router = Router();

router.get('/api/:channel', async (req: Request, res: Response) => {
	const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';
	const plain = req.query.plain as string | undefined;
	const channel = formatUsername(String(req.params.channel));
	const isPlain = plain?.toLowerCase() === 'true';

	if (!userChanRegex.test(channel)) {
		const msg = `Invalid channel or channel ID: ${channel}`;
		sendApiResponse(res, 400, isPlain, msg, { error: msg });
		return;
	}

	try {
		const instances = await logsService.getInstance(channel, null, false, pretty);
		sendApiResponse(res, instances.status, isPlain, instances.channelLogs.fullLink[0] ?? instances.error, instances);
	} catch (error_) {
		const msg = formatError(error_);
		sendApiResponse(res, 500, isPlain, msg, { error: msg });
	}
});

router.get('/api/:channel/:user', async (req: Request, res: Response) => {
	const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';
	const plain = req.query.plain as string | undefined;
	const channel = formatUsername(String(req.params.channel));
	const user = formatUsername(String(req.params.user));
	const isPlain = plain?.toLowerCase() === 'true';

	if (!userChanRegex.test(channel)) {
		const msg = `Invalid channel or channel ID: ${channel}`;
		sendApiResponse(res, 400, isPlain, msg, { error: msg });
		return;
	}
	if (!userChanRegex.test(user)) {
		const msg = `Invalid username or user ID: ${user}`;
		sendApiResponse(res, 400, isPlain, msg, { error: msg });
		return;
	}

	try {
		const instances = await logsService.getInstance(channel, user, false, pretty);
		sendApiResponse(res, instances.status, isPlain, instances.userLogs.fullLink[0] ?? instances.error, instances);
	} catch (error_) {
		const msg = formatError(error_);
		sendApiResponse(res, 500, isPlain, msg, { error: msg });
	}
});

export default router;
