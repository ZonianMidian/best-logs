import { Router } from 'express';
import type { Request, Response } from 'express';
import { elapsedFrom, checkInstances } from '../utils/helpers.js';
import { instanceLoader } from '../utils/instanceLoader.js';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
	const start = performance.now();

	const { instanceCounts, uniqueChannels } = instanceLoader;

	if (uniqueChannels.size === 0) res.status(500);

	res.json({
		elapsed: elapsedFrom(start),
		instancesStats: checkInstances(instanceCounts),
		instances: Object.fromEntries(instanceCounts),
		channels: uniqueChannels.size,
	});
});

export default router;
