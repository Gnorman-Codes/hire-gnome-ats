'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import AdminGate from '@/app/components/admin-gate';

export default function AdminPage() {
	const [counts, setCounts] = useState({
		divisions: 0,
		users: 0,
		skills: 0,
		customFields: 0,
		apiErrors: 0
	});

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const [divisionRes, userRes, skillRes, customFieldRes, errorRes] = await Promise.all([
				fetch('/api/divisions'),
				fetch('/api/users'),
				fetch('/api/skills'),
				fetch('/api/admin/custom-fields?includeInactive=true'),
				fetch('/api/admin/error-logs?limit=1')
			]);

			if (!divisionRes.ok || !userRes.ok || !skillRes.ok || !customFieldRes.ok || !errorRes.ok) return;

			const [divisionData, userData, skillData, customFieldData] = await Promise.all([
				divisionRes.json(),
				userRes.json(),
				skillRes.json(),
				customFieldRes.json()
			]);
			const errorData = await errorRes.json().catch(() => ({}));
			if (cancelled) return;

			setCounts({
				divisions: Array.isArray(divisionData) ? divisionData.length : 0,
				users: Array.isArray(userData) ? userData.length : 0,
				skills: Array.isArray(skillData) ? skillData.length : 0,
				customFields: Array.isArray(customFieldData) ? customFieldData.length : 0,
				apiErrors: Number.isInteger(errorData?.total) ? errorData.total : 0
			});
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	function renderAdminCard({ href, label, value }) {
		return (
			<Link key={href} className="metric-card" href={href}>
				<p className="metric-label">{label}</p>
				<p className="metric-value">{value}</p>
				<span className="metric-link">
					<span>Detail</span>
					<span className="metric-link-icon" aria-hidden="true">
						<ArrowUpRight />
					</span>
				</span>
			</Link>
		);
	}

	return (
		<AdminGate>
			<section className="module-page">
				<header className="module-header">
					<div>
						<h2>Admin Area</h2>
						<p>System setup, migration, access, and admin operations.</p>
					</div>
				</header>

				<div className="admin-card-sections">
					<article className="panel panel-spacious">
						<div className="admin-card-section-head">
							<h3>Platform Controls</h3>
							<p>Settings, integrations, imports, and exports.</p>
						</div>
						<div className="metric-grid admin-metric-grid">
							{renderAdminCard({
								href: '/admin/settings',
								label: 'Configuration',
								value: 'Settings'
							})}
							{renderAdminCard({
								href: '/admin/closer-gnome',
								label: 'Integration',
								value: 'Closer Gnome'
							})}
							{renderAdminCard({
								href: '/admin/api-keys',
								label: 'Integration',
								value: 'API Keys'
							})}
							{renderAdminCard({
								href: '/admin/imports',
								label: 'Data Import',
								value: 'Migration Console'
							})}
							{renderAdminCard({
								href: '/admin/exports',
								label: 'Data Export',
								value: 'Export Center'
							})}
						</div>
					</article>

					<article className="panel panel-spacious">
						<div className="admin-card-section-head">
							<h3>Access & Taxonomy</h3>
							<p>Users, divisions, skills, and custom fields.</p>
						</div>
						<div className="metric-grid admin-metric-grid">
							{renderAdminCard({
								href: '/admin/users',
								label: 'Users',
								value: counts.users
							})}
							{renderAdminCard({
								href: '/admin/divisions',
								label: 'Divisions',
								value: counts.divisions
							})}
							{renderAdminCard({
								href: '/admin/skills',
								label: 'Skills',
								value: counts.skills
							})}
							{renderAdminCard({
								href: '/admin/custom-fields',
								label: 'Custom Fields',
								value: counts.customFields
							})}
						</div>
					</article>

					<article className="panel panel-spacious">
						<div className="admin-card-section-head">
							<h3>Monitoring</h3>
							<p>API, integration, and runtime errors.</p>
						</div>
						<div className="metric-grid admin-metric-grid">
							{renderAdminCard({
								href: '/admin/logs/errors',
								label: 'API Errors',
								value: counts.apiErrors
							})}
						</div>
					</article>
				</div>
			</section>
		</AdminGate>
	);
}
