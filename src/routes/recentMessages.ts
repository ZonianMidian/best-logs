import { Router } from 'express';
import type { Request, Response } from 'express';
import { recentMessagesService } from '../utils/recentMessagesService.js';
import { formatError, parseUsername } from '../utils/helpers.js';

const router = Router();

const getRecentMessages = async (req: Request, res: Response): Promise<void> => {
	const channel = parseUsername(String(req.params.channel));

	if (!channel || channel.startsWith('id:')) {
		res.status(400).json({ error: `Invalid channel: ${String(req.params.channel)}` });
		return;
	}

	try {
		const searchParams = Object.fromEntries(
			Object.entries(req.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
		);
		const recentMessages = await recentMessagesService.getRecentMessages(channel, searchParams);

		res.status(recentMessages.status);
		res.json(recentMessages);
	} catch (error) {
		res.status(500);
		res.json({ error: formatError(error) });
	}
};

router.get('/rm/:channel', getRecentMessages);
router.get('/recent-messages/:channel', getRecentMessages);
router.get('/api/v2/recent-messages/:channel', getRecentMessages);

export default router;
