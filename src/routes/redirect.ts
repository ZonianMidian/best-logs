import { Router } from 'express';
import type { Request, Response } from 'express';
import { logsService } from '../utils/logsService.js';
import { formatError, formatUsername, userChanRegex } from '../utils/helpers.js';

const router = Router();

router.get('/rdr/:channel', async (req: Request, res: Response) => {
	const channel = formatUsername(String(req.params.channel));

	if (!userChanRegex.test(channel)) {
		res.status(400).send(`Invalid channel or channel ID: ${channel}`);
		return;
	}

	const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';

	try {
		const instance = await logsService.getInstance(channel, null, false, pretty);

		if (instance.error) {
			res.status(instance.status).send(instance.error);
		} else {
			res.redirect(instance.channelLogs.fullLink[0] ?? '/');
		}
	} catch (error) {
		res.status(500).send(formatError(error));
	}
});

router.get('/rdr/:channel/:user', async (req: Request, res: Response) => {
	const channel = formatUsername(String(req.params.channel));
	const user = formatUsername(String(req.params.user));
	const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';

	if (!userChanRegex.test(channel)) {
		res.status(400).send(`Invalid channel or channel ID: ${channel}`);
		return;
	}

	if (!userChanRegex.test(user)) {
		res.status(400).send(`Invalid username or user ID: ${user}`);
		return;
	}

	try {
		const instance = await logsService.getInstance(channel, user, false, pretty);

		if (instance.error) {
			res.status(instance.status).send(instance.error);
		} else {
			res.redirect(instance.userLogs.fullLink[0] ?? '/');
		}
	} catch (error) {
		res.status(500).send(formatError(error));
	}
});

export default router;
