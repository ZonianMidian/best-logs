import { Router } from 'express';
import type { Request, Response } from 'express';
import { logsService } from '../utils/logsService.js';
import { formatError, parseUsername } from '../utils/helpers.js';

const router = Router();

const makeRedirectHandler =
	(withUser: boolean) =>
	async (req: Request, res: Response): Promise<void> => {
		const channel = parseUsername(String(req.params.channel));
		if (!channel) {
			res.status(400).send(`Invalid channel or channel ID: ${String(req.params.channel)}`);
			return;
		}

		let user: string | null = null;
		if (withUser) {
			user = parseUsername(String(req.params.user));
			if (!user) {
				res.status(400).send(`Invalid username or user ID: ${String(req.params.user)}`);
				return;
			}
		}

		const pretty = (req.query.pretty as string | undefined)?.toLowerCase() === 'true';

		try {
			const instance = await logsService.getInstance(channel, user, false, pretty);
			if (instance.error) {
				res.status(instance.status).send(instance.error);
			} else {
				const link = user ? (instance.userLogs.fullLink[0] ?? '/') : (instance.channelLogs.fullLink[0] ?? '/');
				res.redirect(link);
			}
		} catch (error) {
			res.status(500).send(formatError(error));
		}
	};

router.get('/rdr/:channel', makeRedirectHandler(false));
router.get('/rdr/:channel/:user', makeRedirectHandler(true));

export default router;
