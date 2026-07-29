'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	Archive,
	BarChart3,
	BookOpenText,
	Building2,
	BookUser,
	CalendarClock,
	Check,
	ChevronDown,
	ClipboardList,
	Handshake,
	LayoutDashboard,
	LogOut,
	Menu,
	Send,
	Settings2,
	X,
	UserRound,
	Users
} from 'lucide-react';
import { ACTING_USER_COOKIE_NAME } from '@/lib/security-constants';
import { roleLabel } from '@/app/constants/access-control-options';
import GlobalSearch from '@/app/components/global-search';
import QuickCreateMenu from '@/app/components/quick-create-menu';
import NotificationCenter from '@/app/components/notification-center';
import { ToastProvider } from '@/app/components/toast-provider';
import LoadingIndicator from '@/app/components/loading-indicator';
import useSystemBranding from '@/app/hooks/use-system-branding';

const modules = [
	{ label: 'Dashboard', href: '/', icon: LayoutDashboard },
	{ label: 'Candidates', href: '/candidates', icon: UserRound },
	{ label: 'Clients', href: '/clients', icon: Building2 },
	{ label: 'Contacts', href: '/contacts', icon: BookUser },
	{ label: 'Job Orders', href: '/job-orders', icon: ClipboardList },
	{ label: 'Submissions', href: '/submissions', icon: Send },
	{ label: 'Interviews', href: '/interviews', icon: CalendarClock },
	{ label: 'Placements', href: '/placements', icon: Handshake },
	{ label: 'Reports', href: '/reports', icon: BarChart3 },
	{ label: 'Archive', href: '/archive', icon: Archive }
];

const AUTH_ROUTES = new Set(['/login', '/setup', '/forgot-password', '/reset-password', '/account/password']);
const CAREER_QUICK_LINKS = [
	{ label: 'All Jobs', href: '/careers', quick: '' },
	{ label: 'Remote', href: '/careers?quick=remote', quick: 'remote' },
	{ label: 'Hybrid', href: '/careers?quick=hybrid', quick: 'hybrid' },
	{ label: 'On-Site', href: '/careers?quick=onsite', quick: 'onsite' },
	{ label: 'Tech', href: '/careers?quick=tech', quick: 'tech' },
	{ label: 'Healthcare', href: '/careers?quick=healthcare', quick: 'healthcare' },
	{ label: 'Temp', href: '/careers?quick=temp', quick: 'temp' },
	{ label: 'Contract', href: '/careers?quick=contract', quick: 'contract' },
	{ label: 'Permanent', href: '/careers?quick=permanent', quick: 'permanent' },
	{ label: 'New This Week', href: '/careers?quick=new_week', quick: 'new_week' }
];

function normalizeCareerQuickValue(value) {
	return String(value || '').trim().toLowerCase();
}

function setCookieValue(name, value) {
	document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=2592000; SameSite=Lax`;
}

export default function AppShell({ children }) {
	const pathname = usePathname();
	const branding = useSystemBranding();
	const isPublicCareersRoute = pathname?.startsWith('/careers');
	const isPublicClientReviewRoute = pathname?.startsWith('/client-review/');
	const isAuthRoute = AUTH_ROUTES.has(pathname);
	const [activeCareerQuick, setActiveCareerQuick] = useState('');
	const [users, setUsers] = useState([]);
	const [activeUserId, setActiveUserId] = useState('');
	const [sessionState, setSessionState] = useState({
		loading: true,
		actingUser: null,
		authenticatedUser: null,
		canImpersonate: false
	});
	const [impersonationOpen, setImpersonationOpen] = useState(false);
	const [logoutPending, setLogoutPending] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const [demoWelcomeOpen, setDemoWelcomeOpen] = useState(false);
	const impersonationMenuRef = useRef(null);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		const nextThemeKey = String(branding?.themeKey || 'classic_blue').trim() || 'classic_blue';
		document.documentElement.setAttribute('data-theme', nextThemeKey);
	}, [branding?.themeKey]);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		const nextTitle = String(branding?.siteName || '').trim();
		if (!nextTitle) return;
		document.title = nextTitle;
	}, [branding?.siteName]);

	useEffect(() => {
		if (isPublicCareersRoute || isPublicClientReviewRoute || isAuthRoute) return;
		if (sessionState.loading) return;
		if (!branding?.demoMode) return;
		if (!sessionState.authenticatedUser?.id) return;
		if (typeof window === 'undefined') return;

		const storageKey = `hg:demo-welcome:${sessionState.authenticatedUser.id}`;
		if (window.localStorage.getItem(storageKey) !== 'seen') {
			setDemoWelcomeOpen(true);
		}
	}, [
		branding?.demoMode,
		isAuthRoute,
		isPublicClientReviewRoute,
		isPublicCareersRoute,
		sessionState.authenticatedUser?.id,
		sessionState.loading
	]);

	function dismissDemoWelcome() {
		if (typeof window !== 'undefined' && sessionState.authenticatedUser?.id) {
			window.localStorage.setItem(`hg:demo-welcome:${sessionState.authenticatedUser.id}`, 'seen');
		}
		setDemoWelcomeOpen(false);
	}

	const activeUser = useMemo(() => {
		if (users.length > 0) {
			const fromList = users.find((user) => String(user.id) === String(activeUserId));
			if (fromList) return fromList;
		}
		return sessionState.actingUser;
	}, [activeUserId, sessionState.actingUser, users]);
	const systemAdminUser = useMemo(() => {
		if (sessionState.authenticatedUser?.role === 'ADMINISTRATOR') {
			return sessionState.authenticatedUser;
		}
		return users.find((user) => user.role === 'ADMINISTRATOR') || null;
	}, [sessionState.authenticatedUser, users]);
	const selectableUsers = useMemo(() => {
		if (!systemAdminUser) return users;
		return users.filter((user) => user.id !== systemAdminUser.id);
	}, [users, systemAdminUser]);

	useEffect(() => {
		if (isPublicCareersRoute || isPublicClientReviewRoute || isAuthRoute) return undefined;
		let cancelled = false;

		async function loadSessionState() {
			setSessionState((current) => ({ ...current, loading: true }));
			const sessionRes = await fetch('/api/session/acting-user', { cache: 'no-store' });
			if (!sessionRes.ok) {
				if (!cancelled) {
					window.location.assign('/login');
				}
				return;
			}

			const sessionData = await sessionRes.json().catch(() => ({}));
			const actingUser = sessionData?.user || null;
			const authenticatedUser = sessionData?.authenticatedUser || null;
			const canImpersonate = Boolean(sessionData?.canImpersonate);

			if (!actingUser || !authenticatedUser) {
				if (!cancelled) {
					window.location.assign('/login');
				}
				return;
			}

			if (cancelled) return;
			setSessionState({
				loading: false,
				actingUser,
				authenticatedUser,
				canImpersonate
			});
			setActiveUserId(String(actingUser.id));

			if (!canImpersonate) {
				setUsers([actingUser]);
				return;
			}

			const usersRes = await fetch('/api/users?active=true&forSwitch=true');
			if (!usersRes.ok) {
				setUsers([actingUser]);
				return;
			}
			const usersData = await usersRes.json().catch(() => []);
			if (!cancelled && Array.isArray(usersData)) {
				setUsers(usersData);
			}
		}

		loadSessionState();
		return () => {
			cancelled = true;
		};
	}, [isAuthRoute, isPublicCareersRoute, isPublicClientReviewRoute]);

	useEffect(() => {
		if (!isPublicCareersRoute || typeof window === 'undefined') return undefined;

		const syncQuickFromUrl = () => {
			const nextQuick = normalizeCareerQuickValue(new URLSearchParams(window.location.search).get('quick'));
			setActiveCareerQuick(nextQuick);
		};

		syncQuickFromUrl();
		window.addEventListener('popstate', syncQuickFromUrl);
		return () => {
			window.removeEventListener('popstate', syncQuickFromUrl);
		};
	}, [isPublicCareersRoute, pathname]);

	useEffect(() => {
		setMobileNavOpen(false);
	}, [pathname]);

	useEffect(() => {
		if (typeof window === 'undefined') return undefined;
		const onResize = () => {
			if (window.innerWidth > 1080) {
				setMobileNavOpen(false);
			}
		};
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
		};
	}, []);

	useEffect(() => {
		if (isPublicCareersRoute || isPublicClientReviewRoute || isAuthRoute || typeof document === 'undefined') {
			return undefined;
		}
		if (!mobileNavOpen) return undefined;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isAuthRoute, isPublicCareersRoute, isPublicClientReviewRoute, mobileNavOpen]);

	useEffect(() => {
		if (isPublicCareersRoute || isPublicClientReviewRoute || isAuthRoute) return undefined;

		function onMouseDown(event) {
			if (!impersonationMenuRef.current) return;
			if (impersonationMenuRef.current.contains(event.target)) return;
			setImpersonationOpen(false);
		}

		function onKeyDown(event) {
			if (event.key === 'Escape') {
				setImpersonationOpen(false);
			}
		}

		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [isAuthRoute, isPublicCareersRoute, isPublicClientReviewRoute]);

	function onSwitchUser(nextUserId) {
		if (!sessionState.canImpersonate) return;
		if (!nextUserId) return;
		setActiveUserId(nextUserId);
		setCookieValue(ACTING_USER_COOKIE_NAME, nextUserId);
		setImpersonationOpen(false);
		window.location.reload();
	}

	async function onLogout() {
		if (logoutPending) return;
		setLogoutPending(true);
		await fetch('/api/session/logout', { method: 'POST' }).catch(() => null);
		window.location.assign('/login');
	}

	if (isAuthRoute) {
		return <ToastProvider>{children}</ToastProvider>;
	}

	if (isPublicCareersRoute) {
		return (
			<ToastProvider>
				<div className="career-public-shell">
					<header className={branding.hasCustomLogo ? 'career-public-topbar' : 'career-public-topbar no-brand'}>
						{branding.hasCustomLogo ? (
							<Link href="/careers" className="career-public-brand" aria-label={`${branding.siteName} Careers`}>
								<img src={branding.logoUrl} alt={branding.siteName} className="career-public-brand-logo" />
							</Link>
						) : null}
						<nav className="career-public-quick-links" aria-label="Career quick filters">
							{CAREER_QUICK_LINKS.map((item) => {
								const isActive =
									pathname === '/careers' &&
									(item.quick ? activeCareerQuick === item.quick : !activeCareerQuick);
								return (
									<Link
										key={item.href}
										href={item.href}
										className={isActive ? 'career-public-quick-link active' : 'career-public-quick-link'}
										onClick={() => setActiveCareerQuick(item.quick)}
									>
										{item.label}
									</Link>
								);
							})}
						</nav>
					</header>
					<main className="career-public-main">{children}</main>
				</div>
			</ToastProvider>
		);
	}

	if (isPublicClientReviewRoute) {
		return <ToastProvider>{children}</ToastProvider>;
	}

	if (sessionState.loading) {
		return (
			<ToastProvider>
				<section className="module-page">
					<LoadingIndicator className="page-loading-indicator" label="Loading your workspace" />
				</section>
			</ToastProvider>
		);
	}

	return (
		<ToastProvider>
			<div className="app-shell">
				{mobileNavOpen ? (
					<button
						type="button"
						className="mobile-nav-backdrop"
						aria-label="Close navigation"
						onClick={() => setMobileNavOpen(false)}
					/>
				) : null}
				<aside className={mobileNavOpen ? 'sidebar mobile-open' : 'sidebar'}>
					<button
						type="button"
						className="sidebar-close"
						aria-label="Close navigation"
						onClick={() => setMobileNavOpen(false)}
					>
						<X aria-hidden="true" />
					</button>
					<div className="brand-block">
						<Link href="/" className="brand-link" aria-label={`${branding.siteName} home`}>
							<img src={branding.logoUrl} alt={branding.siteName} className="brand-logo" />
						</Link>
					</div>
					<nav className="module-nav">
						{modules.map((module) => {
							const active = pathname === module.href || (module.href !== '/' && pathname.startsWith(module.href));
							return (
								<Link
									key={module.href}
									href={module.href}
									className={active ? 'module-link active' : 'module-link'}
									onClick={() => setMobileNavOpen(false)}
								>
									<span className="module-link-content">
										<span className="module-link-icon" aria-hidden="true">
											<module.icon />
										</span>
										<span>{module.label}</span>
									</span>
								</Link>
							);
						})}
					</nav>
					{activeUser?.role === 'ADMINISTRATOR' ? (
						<div className="admin-nav">
							<p className="admin-nav-label">Administration</p>
							<Link
								href="/admin"
								className={pathname === '/admin' || pathname.startsWith('/admin/') ? 'module-link active' : 'module-link'}
								onClick={() => setMobileNavOpen(false)}
							>
								<span className="module-link-content">
									<span className="module-link-icon" aria-hidden="true">
										<Settings2 />
									</span>
									<span>Admin Area</span>
								</span>
							</Link>
						</div>
					) : null}
				</aside>
				<div className="workspace-shell">
					<header className="topbar">
						<GlobalSearch />
						<div className="topbar-controls">
							<QuickCreateMenu />
							<NotificationCenter />
							<div className="topbar-user-menu" ref={impersonationMenuRef}>
								<button
									type="button"
									className="topbar-user-trigger"
									onClick={() => setImpersonationOpen((current) => !current)}
									aria-haspopup="menu"
									aria-expanded={impersonationOpen}
									aria-label="Open user menu"
									title="User Menu"
								>
									<Users aria-hidden="true" />
									<ChevronDown aria-hidden="true" />
								</button>
								{impersonationOpen ? (
									<div className="topbar-user-dropdown" role="menu" aria-label="User menu">
										<p className="topbar-user-dropdown-label">Signed In</p>
										<div className="topbar-user-signed-in">
											<strong>
												{sessionState.authenticatedUser?.firstName} {sessionState.authenticatedUser?.lastName}
											</strong>
											<span>
												{roleLabel(sessionState.authenticatedUser?.role)}
												{sessionState.authenticatedUser?.division?.name
													? ` | ${sessionState.authenticatedUser.division.name}`
													: ''}
											</span>
										</div>
										{sessionState.canImpersonate ? (
											<>
												<div className="topbar-user-divider" />
												<p className="topbar-user-dropdown-label">Acting User</p>
												{systemAdminUser ? (
													<button
														type="button"
														role="menuitem"
														className="topbar-user-item topbar-user-item-admin"
														onClick={() => onSwitchUser(String(systemAdminUser.id))}
													>
														<span>
															System Administrator
															<small>
																{systemAdminUser.firstName} {systemAdminUser.lastName}
															</small>
														</span>
														{String(activeUserId) === String(systemAdminUser.id) ? <Check aria-hidden="true" /> : null}
													</button>
												) : null}
												<div className="topbar-user-item-list">
													{selectableUsers.map((user) => (
														<button
															key={user.id}
															type="button"
															role="menuitem"
															className="topbar-user-item"
															onClick={() => onSwitchUser(String(user.id))}
														>
															<span>
																{user.firstName} {user.lastName}
																<small>
																	{roleLabel(user.role)}
																	{user.division?.name ? ` | ${user.division.name}` : ''}
																</small>
															</span>
															{String(activeUserId) === String(user.id) ? <Check aria-hidden="true" /> : null}
														</button>
													))}
												</div>
											</>
										) : null}
										<div className="topbar-user-divider" />
										<Link
											href="/account/settings"
											role="menuitem"
											className="topbar-user-item"
											onClick={() => setImpersonationOpen(false)}
										>
											<span>Account Settings</span>
											<Settings2 aria-hidden="true" />
										</Link>
										<Link
											href="/help"
											role="menuitem"
											className="topbar-user-item"
											onClick={() => setImpersonationOpen(false)}
										>
											<span>Help</span>
											<BookOpenText aria-hidden="true" />
										</Link>
										<div className="topbar-user-divider" />
										<button
											type="button"
											role="menuitem"
											className="topbar-user-item topbar-user-item-logout"
											onClick={onLogout}
											disabled={logoutPending}
										>
											<span>{logoutPending ? 'Signing Out...' : 'Sign Out'}</span>
											<LogOut aria-hidden="true" />
										</button>
									</div>
								) : null}
							</div>
							<button
								type="button"
								className="mobile-nav-toggle"
								onClick={() => setMobileNavOpen(true)}
								aria-label="Open navigation"
								title="Open Navigation"
							>
								<Menu aria-hidden="true" />
							</button>
						</div>
					</header>
					<main className="workspace-main">{children}</main>
				</div>
			</div>
			{demoWelcomeOpen ? (
				<div className="confirm-overlay" onClick={dismissDemoWelcome}>
					<div
						className="confirm-dialog demo-welcome-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="demo-welcome-title"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="report-detail-modal-head">
							<div>
								<h3 id="demo-welcome-title" className="confirm-title">Welcome To The Demo</h3>
								<p className="panel-subtext">
									This workspace is preloaded so you can move through real recruiting flows quickly.
								</p>
							</div>
							<button
								type="button"
								className="btn-secondary btn-link-icon report-detail-modal-close"
								onClick={dismissDemoWelcome}
								aria-label="Close demo instructions"
								title="Close"
							>
								<X aria-hidden="true" className="btn-refresh-icon-svg" />
							</button>
						</div>
						<div className="demo-welcome-body">
							<ul className="demo-welcome-list">
								<li>Open candidates, job orders, submissions, and interviews to explore the seeded workflow end to end.</li>
								<li>Use the dashboard and reports to review live seeded activity, pipeline counts, and owner performance.</li>
								<li>
									Forward an email to <strong>demo@hiregnome.com</strong> to trigger the Postmark inbound workflow.
									The forwarded message must include an email address that matches an existing candidate or contact record.
									When it matches, Hire Gnome creates an email note on that record, and candidate attachments land in Files.
								</li>
								<li>Demo data resets periodically, so treat everything here as disposable.</li>
							</ul>
							<div className="demo-welcome-actions">
								<Link href="/help" className="btn-secondary" onClick={dismissDemoWelcome}>
									Open Help
								</Link>
								<button type="button" className="btn-primary" onClick={dismissDemoWelcome}>
									Got It
								</button>
							</div>
						</div>
					</div>
				</div>
			) : null}
		</ToastProvider>
	);
}
