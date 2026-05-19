import { Router } from 'express';
import type { Request, Response } from 'express';
import { checkInstances } from '../utils/helpers.js';
import { instanceLoader } from '../utils/instanceLoader.js';

const router = Router();

router.get('/instances', (_req: Request, res: Response) => {
	const { instanceCounts, instanceChannels } = instanceLoader;
	res.json({
		instancesStats: checkInstances(instanceCounts),
		instances: Object.fromEntries(instanceChannels),
		instanceCounts: Object.fromEntries(instanceCounts),
		lastUpdate: instanceLoader.lastUpdated,
		nextUpdate: Math.max(0, instanceLoader.lastUpdated + instanceLoader.reloadInterval - Date.now()),
		uptime: Date.now() - process.uptime() * 1000,
	});
});

router.get('/channels', (_req: Request, res: Response) => {
	const { instanceCounts, uniqueChannels, uniqueChannelsArray } = instanceLoader;
	res.json({
		instancesStats: checkInstances(instanceCounts),
		total: uniqueChannels.size,
		channels: uniqueChannelsArray,
	});
});

export default router;
