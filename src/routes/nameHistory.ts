import { Router } from 'express';
import type { Request, Response } from 'express';
import { nameHistoryService } from '../utils/nameHistoryService.js';
import { formatError, userChanRegex } from '../utils/helpers.js';
import { AppError } from '../utils/errors.js';

const nameHistoryInputRe = /^\d{1,20}$|^login:[a-z0-9]\w{0,24}$/i;

const router = Router();

router.get('/namehistory/:user', async (req: Request, res: Response) => {
	const raw = String(req.params.user);
	const user = raw.startsWith('id:') ? raw.slice('id:'.length) : raw;

	if (!nameHistoryInputRe.test(user)) {
		res
			.status(400)
			.contentType('text/plain')
			.send("The value must be an ID or use 'login:' to refer to usernames. Example: 754201843 or login:zonianmidian");
		return;
	}

	if (user.startsWith('login:') && !userChanRegex.test(user.slice('login:'.length))) {
		res.status(400).contentType('text/plain').send('Invalid username');
		return;
	}

	try {
		const result = await nameHistoryService.getNameHistory(user);
		res.json(result);
	} catch (error) {
		const status = error instanceof AppError ? error.status : 500;
		res.status(status);
		res.contentType('text/plain');
		res.send(error instanceof Error ? error.message : formatError(error));
	}
});

export default router;
