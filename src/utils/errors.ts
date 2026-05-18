export class AppError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class LookupNotFoundError extends AppError {
	constructor(input: string) {
		super(`User not found: ${input}`, 404, 'lookup_not_found');
	}
}
