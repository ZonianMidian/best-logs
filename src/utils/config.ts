import fs from 'node:fs/promises';

export interface Config {
	port: number;
	instances: string[];
	recentmessagesInstances: string[];
}

const loadConfig = async (): Promise<Config> => {
	try {
		const data = await fs.readFile('./config.json', 'utf8');
		const config = JSON.parse(data) as Partial<Config>;

		const defaultData = await fs.readFile('./example_config.json', 'utf8');
		const defaultConfig = JSON.parse(defaultData) as Config;

		return { ...defaultConfig, ...config };
	} catch (error) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
			const defaultData = await fs.readFile('./example_config.json', 'utf8');
			return JSON.parse(defaultData) as Config;
		} else {
			throw error;
		}
	}
};

export const config = await loadConfig();
console.log(`[Config] Loaded config`);
