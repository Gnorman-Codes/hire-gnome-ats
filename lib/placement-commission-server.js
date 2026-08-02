import 'server-only';
import { normalizePlacementCommissionSplits } from '@/lib/placement-commission';
import { createRecordId } from '@/lib/record-id';

export function toPlacementCommissionSplitCreateData(splits) {
	return normalizePlacementCommissionSplits(splits).map((split) => ({
		recordId: split.recordId || createRecordId('OfferCommissionSplit'),
		userId: Number(split.userId),
		role: split.role,
		splitPercent: Number(split.splitPercent),
		commissionPercent: Number(split.commissionPercent)
	}));
}
