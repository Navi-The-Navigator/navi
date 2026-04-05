import type { NaviTool } from '../naviTool';

const USER_TIMEZONE = 'Asia/Shanghai';

export function createDateTimeTool(): NaviTool {
	return {
		name: 'get_date_time',
		description: `Get current date and time in ${USER_TIMEZONE}.`,
		func: async (_rawInput: string) => {
			const now = new Date();
			const formatted = new Intl.DateTimeFormat('zh-CN', {
				timeZone: USER_TIMEZONE,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false
			}).format(now);

			return JSON.stringify(
				{
					timezone: USER_TIMEZONE,
					iso: now.toISOString(),
					local: formatted
				},
				null,
				2
			);
		}
	};
}
