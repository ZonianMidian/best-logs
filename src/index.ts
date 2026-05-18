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
import { AppError } from './utils/errors.js';

const app = express();

app.disable('x-powered-by');

const allowedMethods = 'GET, HEAD, OPTIONS';
const exposedHeaders = 'Content-Length, Content-Type, Location';

app.use((req: Request, res: Response, next: NextFunction) => {
	const requestHeaders = req.header('Access-Control-Request-Headers');

	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', allowedMethods);
	res.setHeader('Access-Control-Allow-Headers', requestHeaders ?? '*');
	res.setHeader('Access-Control-Expose-Headers', exposedHeaders);
	res.setHeader('Access-Control-Max-Age', '86400');

	if (req.header('Access-Control-Request-Private-Network') === 'true') {
		res.setHeader('Access-Control-Allow-Private-Network', 'true');
	}

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
	next(new AppError('Not Found', 404, 'not_found'));
});

app.use(function (err: Error, _req: Request, res: Response, _next: NextFunction) {
	const status = err instanceof AppError ? err.status : 500;
	res.status(status).json({ error: err.message, code: status });
});

await instanceLoader.reloadInstanceChannels();

const server = app.listen(config.port, () => {
	console.log(`[API] Listening on ${String(config.port)}`);
	instanceLoader.startLoops();
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 125_000;

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	console.log(`[API] Received ${signal}, shutting down`);
	instanceLoader.stopLoops();
	server.close((error) => {
		if (error) {
			console.error(`[API] Failed to close server: ${error.message}`);
			process.exitCode = 1;
		}
	});
	setTimeout(() => {
		console.error('[API] Shutdown timed out');
		process.exitCode = 1;
		throw new Error('Shutdown timed out');
	}, 30_000).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
