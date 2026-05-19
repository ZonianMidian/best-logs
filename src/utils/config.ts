import fs from 'node:fs/promises';

export interface Config {
	port: number;
	serveStatic: boolean;
	baseUrl: string;
	apiUrl: string;
	instances: LogInstanceConfig[];
	recentmessagesInstances: string[];
}

export interface LogInstanceConfig {
	host: string;
	apiHost: string;
	maintainer: string;
}

const HOST_REGEX = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/i;

function normalizeUrl(value: unknown, key: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`Invalid config.${key}: expected a string`);
	}
	if (value === '') return '';
	if (!/^https?:\/\//i.test(value)) {
		throw new TypeError(`Invalid config.${key}: expected a URL starting with http:// or https://`);
	}
	return value.replace(/\/+$/, '');
}

function assertStringArray(value: unknown, key: keyof Config): string[] {
	if (!Array.isArray(value)) {
		throw new TypeError(`Invalid config.${key}: expected an array of hostnames`);
	}

	const entries: string[] = [];
	for (const entry of value as readonly unknown[]) {
		if (typeof entry !== 'string' || !HOST_REGEX.test(entry)) {
			throw new TypeError(`Invalid config.${key}: expected an array of hostnames`);
		}
		entries.push(entry);
	}

	return [...new Set(entries)];
}

function assertInstances(value: unknown): LogInstanceConfig[] {
	if (Array.isArray(value)) {
		return assertStringArray(value, 'instances').map((host) => ({ host, apiHost: host, maintainer: '' }));
	}

	if (value === null || typeof value !== 'object') {
		throw new TypeError('Invalid config.instances: expected an object of hostnames');
	}

	const instances: LogInstanceConfig[] = [];
	for (const [host, metadata] of Object.entries(value)) {
		if (!HOST_REGEX.test(host)) {
			throw new TypeError('Invalid config.instances: expected valid hostname keys');
		}

		if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
			throw new TypeError(`Invalid config.instances.${host}: expected an object`);
		}

		const raw = metadata as { alternate?: unknown; maintainer?: unknown };
		const alternate = raw.alternate;
		if (alternate !== undefined && (typeof alternate !== 'string' || !HOST_REGEX.test(alternate))) {
			throw new TypeError(`Invalid config.instances.${host}.alternate: expected a hostname`);
		}

		const maintainer = raw.maintainer;
		if (maintainer !== undefined && typeof maintainer !== 'string') {
			throw new TypeError(`Invalid config.instances.${host}.maintainer: expected a string`);
		}

		instances.push({
			host,
			apiHost: alternate ?? host,
			maintainer: maintainer ?? '',
		});
	}

	return instances;
}

function normalizeConfig(value: unknown): Config {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid config: expected an object');
	}

	const raw = value as Record<string, unknown>;
	const port = raw.port;
	if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new TypeError('Invalid config.port: expected an integer from 1 to 65535');
	}

	const serveStatic = raw.serveStatic ?? true;
	if (typeof serveStatic !== 'boolean') {
		throw new TypeError('Invalid config.serveStatic: expected a boolean');
	}

	return {
		port,
		serveStatic,
		baseUrl: normalizeUrl(raw.baseUrl ?? '', 'baseUrl'),
		apiUrl: normalizeUrl(raw.apiUrl ?? '', 'apiUrl'),
		instances: assertInstances(raw.instances),
		recentmessagesInstances: assertStringArray(raw.recentmessagesInstances, 'recentmessagesInstances'),
	};
}

const loadConfig = async (): Promise<Config> => {
	for (const path of ['./config.local.json', './config.json']) {
		try {
			const data = await fs.readFile(path, 'utf8');
			console.log(`[Config] Loaded ${path}`);
			return normalizeConfig(JSON.parse(data));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}

	throw new Error('No config file found (expected config.local.json or config.json)');
};

export const config = await loadConfig();
