export interface RequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeout?: number;
	signal?: AbortSignal;
}

export interface HttpResponse {
	body: string;
	statusCode: number;
	headers: Record<string, string>;
}

export interface StreamResponse {
	body: ReadableStream<Uint8Array> | null;
	statusCode: number;
	headers: Record<string, string>;
}

export async function request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
	const { method = 'GET', headers, body, timeout = 10_000 } = options;

	const response = await fetch(url, {
		method,
		...(headers === undefined ? {} : { headers }),
		body: body ?? null,
		signal: AbortSignal.timeout(timeout),
	});

	return {
		body: await response.text(),
		statusCode: response.status,
		headers: Object.fromEntries(response.headers.entries()),
	};
}

export async function fetchStream(url: string, options: RequestOptions = {}): Promise<StreamResponse> {
	const { method = 'GET', headers, body, timeout = 10_000, signal } = options;

	const response = await fetch(url, {
		method,
		...(headers === undefined ? {} : { headers }),
		body: body ?? null,
		signal: signal ?? AbortSignal.timeout(timeout),
	});

	return {
		body: response.body,
		statusCode: response.status,
		headers: Object.fromEntries(response.headers.entries()),
	};
}
