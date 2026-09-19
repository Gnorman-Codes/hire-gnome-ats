'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function dedupeOptionsByValue(options) {
	const seenValues = new Set();
	const deduped = [];

	for (const option of options) {
		if (!option || option.value == null) continue;
		const optionValue = String(option.value);
		if (seenValues.has(optionValue)) continue;
		seenValues.add(optionValue);
		deduped.push(option);
	}

	return deduped;
}

function normalizeLoadedOptions(result, fallbackPage = 1) {
	if (Array.isArray(result)) {
		return {
			items: result,
			pagination: {
				page: fallbackPage,
				hasMore: false
			}
		};
	}

	const items = Array.isArray(result?.items) ? result.items : [];
	const pagination = result?.pagination || {};

	return {
		items,
		pagination: {
			page: Number(pagination.page) > 0 ? Number(pagination.page) : fallbackPage,
			hasMore: Boolean(pagination.hasMore)
		}
	};
}

export default function TypeaheadSelect({
	options,
	value,
	onChange,
	onSelectOption,
	loadOptions,
	loadOptionByValue,
	loadDeps = [],
	placeholder,
	disabled = false,
	emptyLabel = 'No matches found.',
	loadingLabel = 'Searching...',
	label,
	selectedLabel = '',
	searchDebounceMs = 180,
	minSearchChars = 0
}) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [currentPage, setCurrentPage] = useState(1);
	const [pageHasMore, setPageHasMore] = useState(false);
	const [dynamicOptions, setDynamicOptions] = useState([]);
	const [dynamicLoading, setDynamicLoading] = useState(false);
	const [resolvedSelectedOption, setResolvedSelectedOption] = useState(null);
	const activeSearchRequestRef = useRef(0);
	const activeResolveRequestRef = useRef(0);
	const lastValueRef = useRef(null);
	const pendingUserValueRef = useRef(null);
	const queryIsUserEditedRef = useRef(false);
	const loadDepsKey = useMemo(() => JSON.stringify(loadDeps), [loadDeps]);
	const asyncMode = typeof loadOptions === 'function';

	const selectedFallbackOption = useMemo(() => {
		if (!value || !selectedLabel) return null;
		return {
			value: String(value),
			label: selectedLabel
		};
	}, [selectedLabel, value]);

	const sourceOptions = useMemo(() => {
		const baseOptions = asyncMode ? dynamicOptions : Array.isArray(options) ? options : [];
		return dedupeOptionsByValue([resolvedSelectedOption, selectedFallbackOption, ...baseOptions]);
	}, [asyncMode, dynamicOptions, options, resolvedSelectedOption, selectedFallbackOption]);

	const selectedOption = useMemo(() => {
		if (!value) return null;
		return sourceOptions.find((option) => String(option.value) === String(value)) || null;
	}, [sourceOptions, value]);

	const filteredOptions = useMemo(() => {
		if (asyncMode) return sourceOptions;
		const q = query.trim().toLowerCase();
		if (!q) return sourceOptions.slice(0, 100);
		return sourceOptions
			.filter((option) => option.label.toLowerCase().includes(q))
			.slice(0, 100);
	}, [asyncMode, query, sourceOptions]);

	useEffect(() => {
		const timeoutId = setTimeout(() => {
			setDebouncedQuery(query);
		}, searchDebounceMs);

		return () => {
			clearTimeout(timeoutId);
		};
	}, [query, searchDebounceMs]);

	useEffect(() => {
		if (!asyncMode) return;
		if (disabled || !open) return;
		const nextQuery = debouncedQuery.trim();
		if (minSearchChars > 0 && nextQuery.length < minSearchChars) {
			setCurrentPage(1);
			setPageHasMore(false);
			setDynamicOptions([]);
			setDynamicLoading(false);
			return;
		}

		const requestId = activeSearchRequestRef.current + 1;
		activeSearchRequestRef.current = requestId;
		setDynamicLoading(true);

		Promise.resolve(loadOptions(nextQuery, currentPage))
			.then((loadedResult) => {
				if (activeSearchRequestRef.current !== requestId) return;
				const normalized = normalizeLoadedOptions(loadedResult, currentPage);
				setDynamicOptions(dedupeOptionsByValue(normalized.items));
				setPageHasMore(Boolean(normalized.pagination.hasMore));
				setCurrentPage(normalized.pagination.page);
			})
			.catch(() => {
				if (activeSearchRequestRef.current !== requestId) return;
				setDynamicOptions([]);
				setPageHasMore(false);
			})
			.finally(() => {
				if (activeSearchRequestRef.current !== requestId) return;
				setDynamicLoading(false);
			});
	}, [asyncMode, currentPage, debouncedQuery, disabled, loadOptions, minSearchChars, open, loadDepsKey]);

	useEffect(() => {
		if (asyncMode) {
			setCurrentPage(1);
			setPageHasMore(false);
			setDynamicOptions([]);
		}
	}, [asyncMode, loadDepsKey]);

	useEffect(() => {
		if (!value) {
			activeResolveRequestRef.current += 1;
			setResolvedSelectedOption(null);
			return;
		}

		if (!loadOptionByValue) return;
		if (selectedOption) return;

		const requestId = activeResolveRequestRef.current + 1;
		activeResolveRequestRef.current = requestId;

		Promise.resolve(loadOptionByValue(value))
			.then((option) => {
				if (activeResolveRequestRef.current !== requestId) return;
				setResolvedSelectedOption(option || null);
			})
			.catch(() => {
				if (activeResolveRequestRef.current !== requestId) return;
				setResolvedSelectedOption(null);
			});
	}, [loadOptionByValue, selectedOption, value]);

	useEffect(() => {
		const normalizedValue = value == null || value === '' ? '' : String(value);
		const valueChanged = lastValueRef.current !== normalizedValue;
		if (valueChanged) {
			lastValueRef.current = normalizedValue;
			const preserveUserQuery = pendingUserValueRef.current === normalizedValue;
			pendingUserValueRef.current = null;
			if (preserveUserQuery) return;
			queryIsUserEditedRef.current = false;
		}

		if (!normalizedValue) {
			if (!queryIsUserEditedRef.current) setQuery('');
			return;
		}

		if (selectedOption?.label && !queryIsUserEditedRef.current) {
			setQuery(selectedOption.label);
		}
	}, [selectedOption?.label, value]);

	function onInputChange(nextValue) {
		queryIsUserEditedRef.current = true;
		setQuery(nextValue);
		setOpen(true);
		setCurrentPage(1);
		setPageHasMore(false);

		if (!selectedOption) return;
		if (nextValue !== selectedOption.label) {
			pendingUserValueRef.current = '';
			onChange('');
			setResolvedSelectedOption(null);
			onSelectOption?.(null);
		}
	}

	function onOptionSelect(option) {
		queryIsUserEditedRef.current = false;
		pendingUserValueRef.current = null;
		onChange(String(option.value));
		setQuery(option.label);
		setResolvedSelectedOption(option);
		onSelectOption?.(option);
		setOpen(false);
	}

	function onPrevPage() {
		setCurrentPage((page) => Math.max(1, page - 1));
	}

	function onNextPage() {
		if (!pageHasMore) return;
		setCurrentPage((page) => page + 1);
	}

	const canShowPagingControls =
		asyncMode &&
		!dynamicLoading &&
		(minSearchChars === 0 || query.trim().length >= minSearchChars) &&
		(currentPage > 1 || pageHasMore);

	return (
		<div className={disabled ? 'typeahead disabled' : 'typeahead'}>
			<div className="typeahead-input-wrap">
				<input
					value={query}
					onChange={(e) => onInputChange(e.target.value)}
					onFocus={() => {
						setOpen(true);
						setCurrentPage(1);
					}}
					onBlur={() => {
						setTimeout(() => {
							setOpen(false);
							setQuery(selectedOption?.label || '');
						}, 120);
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							setOpen(false);
						}
					}}
					placeholder={placeholder}
					disabled={disabled}
					aria-label={label || placeholder}
				/>
			</div>

			{open && !disabled ? (
				<div className="typeahead-menu">
					{dynamicLoading ? <p className="typeahead-empty">{loadingLabel}</p> : null}
					{!dynamicLoading && minSearchChars > 0 && query.trim().length < minSearchChars ? (
						<p className="typeahead-empty">{`Type at least ${minSearchChars} characters.`}</p>
					) : null}
					{!dynamicLoading &&
					(minSearchChars === 0 || query.trim().length >= minSearchChars) &&
					filteredOptions.length === 0 ? (
						<p className="typeahead-empty">{emptyLabel}</p>
					) : (
						!dynamicLoading &&
						filteredOptions.map((option) => (
							<button
								key={option.value}
								type="button"
								className={
									String(option.value) === String(value)
										? 'typeahead-option active'
										: 'typeahead-option'
								}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => onOptionSelect(option)}
							>
								{option.label}
							</button>
						))
					)}
					{canShowPagingControls ? (
						<div className="typeahead-pagination">
							<button
								type="button"
								className="typeahead-page-button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={onPrevPage}
								disabled={currentPage <= 1}
							>
								<ChevronLeft aria-hidden="true" />
								Previous
							</button>
							<span className="typeahead-page-label">{`Page ${currentPage}`}</span>
							<button
								type="button"
								className="typeahead-page-button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={onNextPage}
								disabled={!pageHasMore}
							>
								Next
								<ChevronRight aria-hidden="true" />
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
