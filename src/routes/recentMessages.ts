import { Router } from 'express';
import type { Request, Response } from 'express';
import { recentMessagesService } from '../utils/recentMessagesService.js';
import { formatError, formatUsername, userChanRegex } from '../utils/helpers.js';

const ALLOWED_RM_PARAMS = new Set([
	'limit',
	'after',
	'rm_only',
	'hide_moderation_messages',
	'hide_moderated_users',
	'clearchat_to_notice',
]);

const router = Router();

const getRecentMessages = async (req: Request, res: Response): Promise<void> => {
	const channel = formatUsername(String(req.params.channel));

	if (!userChanRegex.test(channel) || channel.startsWith('id:')) {
		res.status(400).json({ error: `Invalid channel: ${channel}` });
		return;
	}

	try {
		const searchParams = Object.fromEntries(
			Object.entries(req.query).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string' && ALLOWED_RM_PARAMS.has(entry[0]),
			),
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
