import { formatSelectValueLabel } from '@/lib/select-value-label';

export const PLACEMENT_COMMISSION_ROLE_OPTIONS = Object.freeze([
	{ value: 'recruiter', label: 'Recruiter' },
	{ value: 'sales_rep', label: 'Sales Rep' }
]);

export function formatPlacementCommissionRoleLabel(value) {
	return PLACEMENT_COMMISSION_ROLE_OPTIONS.find((option) => option.value === value)?.label || formatSelectValueLabel(value);
}

export function normalizePlacementCommissionSplit(raw, index = 0) {
	return {
		recordId: String(raw?.recordId || '').trim(),
		userId: String(raw?.userId || '').trim(),
		role: String(raw?.role || 'recruiter').trim() || 'recruiter',
		splitPercent: raw?.splitPercent == null ? '' : String(raw.splitPercent),
		commissionPercent: raw?.commissionPercent == null ? '' : String(raw.commissionPercent),
		_key: String(raw?._key || raw?.recordId || `${raw?.role || 'split'}-${raw?.userId || 'new'}-${index}`)
	};
}

export function normalizePlacementCommissionSplits(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map((split, index) => normalizePlacementCommissionSplit(split, index));
}

export function buildDefaultPlacementCommissionSplits({ recruiterUser, salesUser } = {}) {
	const rows = [];
	if (recruiterUser?.id) {
		rows.push(
			normalizePlacementCommissionSplit({
				recordId: '',
				userId: String(recruiterUser.id),
				role: 'recruiter',
				splitPercent: '',
				commissionPercent: ''
			})
		);
	}
	if (salesUser?.id) {
		rows.push(
			normalizePlacementCommissionSplit({
				recordId: '',
				userId: String(salesUser.id),
				role: 'sales_rep',
				splitPercent: '',
				commissionPercent: ''
			})
		);
	}
	return rows;
}

export function getPlacementCommissionOwners({ candidate, jobOrder } = {}) {
	const recruiterUser = candidate?.ownerUser || (candidate?.ownerId ? { id: candidate.ownerId } : null);
	const salesUser =
		jobOrder?.contact?.ownerUser ||
		(jobOrder?.contact?.ownerId ? { id: jobOrder.contact.ownerId } : null) ||
		jobOrder?.client?.ownerUser ||
		(jobOrder?.client?.ownerId ? { id: jobOrder.client.ownerId } : null) ||
		null;
	return { recruiterUser, salesUser };
}

export function validatePlacementCommissionSplits(splits) {
	const normalized = normalizePlacementCommissionSplits(splits);
	const totals = normalized.reduce(
		(accumulator, split) => {
			const value = Number(split.splitPercent);
			if (!Number.isFinite(value)) return accumulator;
			if (split.role === 'recruiter') accumulator.recruiter += value;
			if (split.role === 'sales_rep') accumulator.sales_rep += value;
			return accumulator;
		},
		{ recruiter: 0, sales_rep: 0 }
	);

	const hasInvalidRow = normalized.some((split) => {
		const splitPercentRaw = String(split.splitPercent ?? '').trim();
		const commissionPercentRaw = String(split.commissionPercent ?? '').trim();
		const splitPercent = Number(split.splitPercent);
		const commissionPercent = Number(split.commissionPercent);
		return (
			!split.userId ||
			splitPercentRaw === '' ||
			!Number.isFinite(splitPercent) ||
			splitPercent <= 0 ||
			commissionPercentRaw === '' ||
			!Number.isFinite(commissionPercent) ||
			commissionPercent < 0
		);
	});

	return {
		valid:
			normalized.length > 0 &&
			!hasInvalidRow &&
			Math.abs(totals.recruiter - 100) <= 0.01 &&
			Math.abs(totals.sales_rep - 100) <= 0.01,
		totals,
		rows: normalized
	};
}

export function summarizePlacementCommissionSplits(splits) {
	const normalized = normalizePlacementCommissionSplits(splits);
	if (normalized.length === 0) return '-';
	return normalized
		.map((split) => {
			const userLabel = split.user?.firstName
				? `${split.user.firstName} ${split.user.lastName || ''}`.trim()
				: split.userName || `User ${split.userId}`;
			const splitPercent = Number(split.splitPercent);
			const commissionPercent = Number(split.commissionPercent);
			const parts = [userLabel, formatPlacementCommissionRoleLabel(split.role)];
			if (Number.isFinite(splitPercent)) parts.push(`${splitPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% split`);
			if (Number.isFinite(commissionPercent)) parts.push(`${commissionPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% GM`);
			return parts.join(' · ');
		})
		.join(' | ');
}
