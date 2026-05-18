import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { config } from './utils/config.js';
import { instanceLoader } from './utils/instanceLoader.js';
import healthRouter from './routes/health.js';
import apiRouter from './routes/api.js';
import redirectRouter from './routes/redirect.js';
import logsRouter from './routes/logs.js';
import recentMessagesRouter from './routes/recentMessages.js';
import nameHistoryRouter from './routes/nameHistory.js';
import instancesRouter from './routes/instances.js';

const app = express();

app.use((_req: Request, res: Response, next: NextFunction) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Max-Age', '86400');
	next();
});

app.options('*', (_req: Request, res: Response) => {
	res.sendStatus(204);
});

app.use(healthRouter);
app.use(apiRouter);
app.use(redirectRouter);
app.use(logsRouter);
app.use(recentMessagesRouter);
app.use(nameHistoryRouter);
app.use(instancesRouter);

app.use(function (_req: Request, _res: Response, next: NextFunction) {
	const err = Object.assign(new Error('Not Found'), { status: 404 });
	next(err);
});

app.use(function (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) {
	const status = err.status ?? 500;
	res.status(status).json({ error: err.message, code: status });
});

await instanceLoader.loadInstanceChannels();

app.listen(config.port, () => {
	console.log(`[API] Listening on ${String(config.port)}`);
	instanceLoader.startLoops();
});
