export function formatDateTimeAt(value, { timeZone } = {}) {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '-';
	const datePart = date.toLocaleDateString(undefined, {
		...(timeZone ? { timeZone } : {}),
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	});
	const timePart = date.toLocaleTimeString(undefined, {
		...(timeZone ? { timeZone } : {}),
		hour: 'numeric',
		minute: '2-digit'
	});
	return `${datePart} @ ${timePart}`;
}
