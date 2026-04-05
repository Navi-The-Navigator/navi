import * as assert from 'assert';
import { createDateTimeTool } from '../agent/tools/dateTimeTool';

suite('createDateTimeTool', () => {
	test('returns the current time payload in the configured timezone', async () => {
		const tool = createDateTimeTool();
		const result = await tool.func('');
		const payload = JSON.parse(result) as {
			timezone: string;
			iso: string;
			local: string;
		};

		assert.strictEqual(tool.name, 'get_date_time');
		assert.match(tool.description, /Asia\/Shanghai/);
		assert.strictEqual(payload.timezone, 'Asia/Shanghai');
		assert.ok(Number.isFinite(Date.parse(payload.iso)));
		assert.match(payload.local, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
	});
});