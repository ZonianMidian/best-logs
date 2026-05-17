import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkInstances } from '../utils/helpers.js';
import { instanceLoader } from '../utils/instanceLoader.js';

const router = Router();

router.get('/instances', (_req: Request, res: Response) => {
	const { instanceCounts } = instanceLoader;
	res.json({
		instancesStats: checkInstances(instanceCounts),
		instances: Object.fromEntries(instanceCounts),
	});
});

router.get('/channels', (_req: Request, res: Response) => {
	const { instanceCounts, uniqueChannels } = instanceLoader;
	res.json({
		instancesStats: checkInstances(instanceCounts),
		channels: [...uniqueChannels.values()],
	});
});

export default router;
