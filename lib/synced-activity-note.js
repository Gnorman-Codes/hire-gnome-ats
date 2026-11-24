const headingPattern = /^(Closer Gnome · (?:Call|Email|Meeting|Note)(?:\nOpportunity: [^\n]*)?)\n\n/;

export function isSyncedActivityNote(recordId, parent) {
	const pattern = parent === 'client' ? /^CLN-CG-[a-f0-9]{64}$/ : /^CTN-CG-[a-f0-9]{64}$/;
	return pattern.test(recordId ?? '');
}

export function activityNoteSummary(content) {
	return content.replace(headingPattern, '');
}

export function replaceActivityNoteSummary(content, summary) {
	return (content.match(headingPattern)?.[0] ?? '') + summary;
}
