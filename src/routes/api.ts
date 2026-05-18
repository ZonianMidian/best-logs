import { Router } from 'express';
import type { Request, Response } from 'express';
import { logsService } from '../utils/logsService.js';
import { formatError, parseUsername } from '../utils/helpers.js';

function sendApiResponse(
	res: Response,
	status: number,
	isPlain: boolean,
	plainText: string | null | undefined,
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

const makeApiHandler =
	(withUser: boolean) =>
	async (req: Request, res: Response): Promise<void> => {
		const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';
		const isPlain = (req.query.plain as string | undefined)?.toLowerCase() === 'true';

		const channel = parseUsername(String(req.params.channel));
		if (!channel) {
			const msg = `Invalid channel or channel ID: ${String(req.params.channel)}`;
			sendApiResponse(res, 400, isPlain, msg, { error: msg });
			return;
		}

		let user: string | null = null;
		if (withUser) {
			user = parseUsername(String(req.params.user));
			if (!user) {
				const msg = `Invalid username or user ID: ${String(req.params.user)}`;
				sendApiResponse(res, 400, isPlain, msg, { error: msg });
				return;
			}
		}

		try {
			const instances = await logsService.getInstance(channel, user, false, pretty);
			const plainText = user
				? (instances.userLogs.fullLink[0] ?? instances.error)
				: (instances.channelLogs.fullLink[0] ?? instances.error);
			sendApiResponse(res, instances.status, isPlain, plainText, instances);
		} catch (error_) {
			const msg = formatError(error_);
			sendApiResponse(res, 500, isPlain, msg, { error: msg });
		}
	};

router.get('/api/:channel', makeApiHandler(false));
router.get('/api/:channel/:user', makeApiHandler(true));

export default router;
