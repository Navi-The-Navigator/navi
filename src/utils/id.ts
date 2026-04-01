export function createThreadId(): string {
	return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTodoId(): string {
	return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i += 1) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
