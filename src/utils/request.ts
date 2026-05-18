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

export interface JsonResponse<T> {
	body: T;
	statusCode: number;
	headers: Record<string, string>;
}

export interface StreamResponse {
	body: ReadableStream<Uint8Array> | null;
	statusCode: number;
	headers: Record<string, string>;
}

async function fetchWithTimeout(url: string, options: RequestOptions): Promise<Response> {
	const { method = 'GET', headers, body, timeout = 10_000, signal } = options;

	const timeoutSignal = AbortSignal.timeout(timeout);
	const fetchSignal = signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, signal]);

	return fetch(url, {
		method,
		...(headers === undefined ? {} : { headers }),
		body: body ?? null,
		signal: fetchSignal,
	});
}

function responseHeaders(response: Response): Record<string, string> {
	return Object.fromEntries(response.headers.entries());
}

export function parseJsonResponse<T>(response: HttpResponse): JsonResponse<T> {
	return {
		body: JSON.parse(response.body) as T,
		statusCode: response.statusCode,
		headers: response.headers,
	};
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
	const response = await fetchWithTimeout(url, options);

	return {
		body: await response.text(),
		statusCode: response.status,
		headers: responseHeaders(response),
	};
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<JsonResponse<T>> {
	const response = await requestText(url, options);
	return parseJsonResponse<T>(response);
}

export async function requestStream(url: string, options: RequestOptions = {}): Promise<StreamResponse> {
	const response = await fetchWithTimeout(url, options);

	return {
		body: response.body,
		statusCode: response.status,
		headers: responseHeaders(response),
	};
}
