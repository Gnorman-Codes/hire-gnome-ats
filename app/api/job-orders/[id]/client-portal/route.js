import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildClientPortalInternalSummary } from '@/lib/client-portal';
import { AccessControlError, addScopeToWhere, getActingUser, getEntityScope } from '@/lib/access-control';
import { logCreate, logUpdate } from '@/lib/audit-log';
import { sendEmailMessage } from '@/lib/email-delivery';
import { isValidEmailAddress } from '@/lib/email-validation';
import { getPublicAppBaseUrl } from '@/lib/site-url';
import { getSystemBranding, getSystemSettingRecord } from '@/lib/system-settings';
import { parseJsonBody, parseRouteId, ValidationError } from '@/lib/request-validation';
import { normalizeThemeKey } from '@/lib/theme-options.cjs';

import { withApiLogging } from '@/lib/api-logging';

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}
	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getClientPortalEmailPalette(themeKey) {
	switch (normalizeThemeKey(themeKey)) {
		case 'midnight':
			return {
				shellBg: '#0f1722',
				cardBg: '#152233',
				cardBorder: '#304760',
				headerGradient: 'linear-gradient(135deg,#0a1220 0%,#10243a 56%,#183a5a 100%)',
				headerInk: '#f3f7fc',
				headerMuted: '#c9d7e8',
				kickerInk: '#9fb0c7',
				bodyInk: '#f3f7fc',
				mutedInk: '#9fb0c7',
				linkInk: '#57a6ff',
				ctaBg: '#1d4ed8',
				ctaInk: '#ffffff',
				infoBg: '#1d2c40',
				infoBorder: '#304760',
				infoInk: '#d7e6f7'
			};
		case 'emerald':
			return {
				shellBg: '#eef8f2',
				cardBg: '#ffffff',
				cardBorder: '#cfe4d9',
				headerGradient: 'linear-gradient(135deg,#0f3f30 0%,#1b7455 56%,#28a56c 100%)',
				headerInk: '#f2fbf6',
				headerMuted: '#d6f0e3',
				kickerInk: '#cdefdc',
				bodyInk: '#184c39',
				mutedInk: '#4e6f61',
				linkInk: '#1b7d58',
				ctaBg: '#188753',
				ctaInk: '#ffffff',
				infoBg: '#f2fbf6',
				infoBorder: '#cfe4d9',
				infoInk: '#245744'
			};
		case 'slate':
			return {
				shellBg: '#f1f4f8',
				cardBg: '#ffffff',
				cardBorder: '#d4dde8',
				headerGradient: 'linear-gradient(135deg,#243244 0%,#3a4d66 56%,#536985 100%)',
				headerInk: '#f4f7fb',
				headerMuted: '#dbe4f1',
				kickerInk: '#ccd8e9',
				bodyInk: '#26384d',
				mutedInk: '#596b82',
				linkInk: '#42566f',
				ctaBg: '#475569',
				ctaInk: '#ffffff',
				infoBg: '#f7f9fc',
				infoBorder: '#d4dde8',
				infoInk: '#33465d'
			};
		case 'sunset':
			return {
				shellBg: '#fff4ea',
				cardBg: '#ffffff',
				cardBorder: '#f0d1bc',
				headerGradient: 'linear-gradient(135deg,#6f2d15 0%,#b14c1f 56%,#de7a1e 100%)',
				headerInk: '#fff7f0',
				headerMuted: '#ffe6d3',
				kickerInk: '#ffe2c9',
				bodyInk: '#6a3a21',
				mutedInk: '#8a5d44',
				linkInk: '#b14c1f',
				ctaBg: '#ea580c',
				ctaInk: '#ffffff',
				infoBg: '#fff7f1',
				infoBorder: '#f0d1bc',
				infoInk: '#7a4527'
			};
		case 'high_contrast':
			return {
				shellBg: '#f0f0f0',
				cardBg: '#ffffff',
				cardBorder: '#7a7a7a',
				headerGradient: 'linear-gradient(135deg,#111111 0%,#272727 56%,#3b3b3b 100%)',
				headerInk: '#ffffff',
				headerMuted: '#efefef',
				kickerInk: '#ffffff',
				bodyInk: '#111111',
				mutedInk: '#3b3b3b',
				linkInk: '#0047ff',
				ctaBg: '#111111',
				ctaInk: '#ffffff',
				infoBg: '#f7f7f7',
				infoBorder: '#7a7a7a',
				infoInk: '#111111'
			};
		case 'navy':
			return {
				shellBg: '#f4f5f7',
				cardBg: '#ffffff',
				cardBorder: '#d6dce4',
				headerGradient: 'linear-gradient(#15263b,#15263b)',
				headerInk: '#ffffff',
				headerMuted: '#dce5f0',
				kickerInk: '#bac9dc',
				bodyInk: '#18283b',
				mutedInk: '#536176',
				linkInk: '#30547a',
				ctaBg: '#30547a',
				ctaInk: '#ffffff',
				infoBg: '#f1f4f8',
				infoBorder: '#d6dce4',
				infoInk: '#304965'
			};
		case 'classic_blue':
		default:
			return {
				shellBg: '#eef3f8',
				cardBg: '#ffffff',
				cardBorder: '#c7d9ef',
				headerGradient: 'linear-gradient(135deg,#0b2f5f 0%,#15579d 56%,#1f79ff 100%)',
				headerInk: '#f4f9ff',
				headerMuted: '#dce9ff',
				kickerInk: '#c6dcfb',
				bodyInk: '#173153',
				mutedInk: '#5d769d',
				linkInk: '#0f6bff',
				ctaBg: '#0f6bff',
				ctaInk: '#ffffff',
				infoBg: '#eaf2ff',
				infoBorder: '#c7d9ef',
				infoInk: '#2d466d'
			};
	}
}

function buildClientPortalInviteEmail({ siteName, logoUrl, hasCustomLogo, themeKey, jobOrderTitle, clientName, contactName, portalUrl }) {
	const safeSiteName = String(siteName || 'Hire Gnome ATS').trim() || 'Hire Gnome ATS';
	const safeJobOrderTitle = String(jobOrderTitle || 'Job Order').trim() || 'Job Order';
	const safeClientName = String(clientName || '').trim();
	const safeContactName = String(contactName || 'there').trim() || 'there';
	const safePortalUrl = String(portalUrl || '').trim();
	const safeLogoUrl = String(logoUrl || '').trim();
	const palette = getClientPortalEmailPalette(themeKey);
	let logoMarkup = '';
	if (safeLogoUrl) {
		const useLogoTile = hasCustomLogo && normalizeThemeKey(themeKey) === 'navy';
		const logoMargin = useLogoTile ? '' : 'margin:0 0 18px;';
		const logoImage = `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(safeSiteName)}" style="display:block;max-height:40px;max-width:180px;${logoMargin}" />`;
		logoMarkup = useLogoTile
			? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td bgcolor="${palette.cardBg}" style="padding:8px 12px;background-color:${palette.cardBg};border-radius:8px;color:${palette.bodyInk};">${logoImage}</td></tr></table>`
			: logoImage;
	}
	const reviewLabel = safeClientName
		? `${safeJobOrderTitle} at ${safeClientName}`
		: safeJobOrderTitle;
	const subject = `${safeSiteName}: Review submitted candidates for ${safeJobOrderTitle}`;
	const text = [
		`Hi ${safeContactName},`,
		'',
		`${safeSiteName} shared a client review link for ${reviewLabel}.`,
		'',
		'Use this portal to review recruiter-submitted candidates, request interviews, leave comments, or pass on a submission.',
		'',
		safePortalUrl,
		'',
		'This link stays valid for the life of the job unless it is explicitly disabled.',
		'',
		`Sent from ${safeSiteName}.`
	].join('\n');
	const html = `
		<div style="margin:0;padding:24px 0;background:${palette.shellBg};font-family:'Segoe UI',Arial,sans-serif;color:${palette.bodyInk};">
			<div style="max-width:640px;margin:0 auto;padding:0 16px;">
				<div style="background:${palette.cardBg};border:1px solid ${palette.cardBorder};border-radius:18px;overflow:hidden;box-shadow:0 18px 38px rgba(16,36,72,0.12);">
					<div style="padding:28px 32px;background:${palette.headerGradient};color:${palette.headerInk};">
						${logoMarkup}
						<p style="margin:0 0 10px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${palette.kickerInk} !important;-webkit-text-fill-color:${palette.kickerInk};opacity:0.92;">
							<span style="color:${palette.kickerInk} !important;-webkit-text-fill-color:${palette.kickerInk};">Client Review Portal</span>
						</p>
						<p style="margin:0;font-size:28px;font-weight:800;line-height:1.15;color:${palette.headerInk} !important;-webkit-text-fill-color:${palette.headerInk};">
							<span style="color:${palette.headerInk} !important;-webkit-text-fill-color:${palette.headerInk};">Review submitted candidates for ${escapeHtml(safeJobOrderTitle)}</span>
						</p>
						${safeClientName ? `<p style="margin:12px 0 0;font-size:16px;line-height:1.5;color:${palette.headerMuted} !important;-webkit-text-fill-color:${palette.headerMuted};"><span style="color:${palette.headerMuted} !important;-webkit-text-fill-color:${palette.headerMuted};">For ${escapeHtml(safeClientName)}</span></p>` : ''}
					</div>
					<div style="padding:28px 32px;">
						<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(safeContactName)},</p>
						<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">
							${escapeHtml(safeSiteName)} shared a review link so you can evaluate recruiter-submitted candidates for this role.
						</p>
						<div style="margin:0 0 20px;padding:16px 18px;border:1px solid ${palette.infoBorder};border-radius:14px;background:${palette.infoBg};">
							<div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${palette.mutedInk};margin-bottom:8px;">What you can do</div>
							<ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.6;color:${palette.infoInk};">
								<li>Review the candidates submitted for this job</li>
								<li>Open the shared resume</li>
								<li>Request an interview, comment, or pass</li>
							</ul>
						</div>
						<div style="margin:24px 0 22px;">
							<a href="${escapeHtml(safePortalUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:${palette.ctaBg};color:${palette.ctaInk};text-decoration:none;font-size:15px;font-weight:700;">
								Open Client Review Portal
							</a>
						</div>
						<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${palette.mutedInk};">
							If the button above does not work, copy and paste this link into your browser:
						</p>
						<p style="margin:0 0 18px;font-size:14px;line-height:1.6;word-break:break-word;">
							<a href="${escapeHtml(safePortalUrl)}" style="color:${palette.linkInk};text-decoration:underline;">${escapeHtml(safePortalUrl)}</a>
						</p>
						<p style="margin:0;font-size:13px;line-height:1.6;color:${palette.mutedInk};">
							This link stays valid for the life of the job unless it is explicitly disabled.
						</p>
					</div>
				</div>
			</div>
		</div>
	`.trim();

	return { subject, text, html };
}

async function loadScopedJobOrder(req, id) {
	const actingUser = await getActingUser(req, { allowFallback: false });
	const jobOrder = await prisma.jobOrder.findFirst({
		where: addScopeToWhere({ id }, getEntityScope(actingUser)),
		select: {
			id: true,
			recordId: true,
			title: true,
			contactId: true,
			client: {
				select: {
					name: true
				}
			},
			contact: {
				select: {
					id: true,
					recordId: true,
					firstName: true,
					lastName: true,
					email: true,
					title: true
				}
			}
		}
	});
	if (!jobOrder) {
		throw new ValidationError('Job order not found.');
	}
	return { actingUser, jobOrder };
}

async function loadPortalAccess(jobOrder) {
	if (!jobOrder?.contactId) return null;
	return prisma.clientPortalAccess.findFirst({
		where: {
			jobOrderId: jobOrder.id,
			contactId: jobOrder.contactId
		},
		include: {
			contact: {
				select: {
					id: true,
					recordId: true,
					firstName: true,
					lastName: true,
					email: true,
					title: true
				}
			},
			_count: {
				select: {
					feedbackEntries: true
				}
			}
		}
	});
}

async function isClientPortalEnabled() {
	const setting = await getSystemSettingRecord();
	if (typeof setting?.clientPortalEnabled === 'boolean') {
		return setting.clientPortalEnabled;
	}
	return true;
}

async function getJob_orders_id_client_portalHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);
		const { jobOrder } = await loadScopedJobOrder(req, id);
		if (!(await isClientPortalEnabled())) {
			return NextResponse.json({ error: 'Client review portal is disabled.' }, { status: 403 });
		}
		const access = await loadPortalAccess(jobOrder);

		return NextResponse.json({
			jobOrder: {
				id: jobOrder.id,
				recordId: jobOrder.recordId,
				title: jobOrder.title
			},
			contactRequired: !jobOrder.contactId,
			contact: jobOrder.contact || null,
			access: buildClientPortalInternalSummary({ req, portalAccess: access })
		});
	} catch (error) {
		return handleError(error, 'Failed to load client portal settings.');
	}
}

async function postJob_orders_id_client_portalHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);
		const { actingUser, jobOrder } = await loadScopedJobOrder(req, id);
		if (!(await isClientPortalEnabled())) {
			return NextResponse.json({ error: 'Client review portal is disabled.' }, { status: 403 });
		}
		if (!jobOrder.contactId) {
			return NextResponse.json(
				{ error: 'Assign a client contact to this job order before creating a portal link.' },
				{ status: 400 }
			);
		}

		const existing = await loadPortalAccess(jobOrder);
		const access = existing
			? await prisma.clientPortalAccess.update({
					where: { id: existing.id },
					data: { isRevoked: false },
					include: {
						contact: {
							select: {
								id: true,
								recordId: true,
								firstName: true,
								lastName: true,
								email: true,
								title: true
							}
						},
						_count: {
							select: {
								feedbackEntries: true
							}
						}
					}
				})
			: await prisma.clientPortalAccess.create({
					data: {
						contactId: jobOrder.contactId,
						jobOrderId: jobOrder.id,
						createdByUserId: actingUser.id
					},
					include: {
						contact: {
							select: {
								id: true,
								recordId: true,
								firstName: true,
								lastName: true,
								email: true,
								title: true
							}
						},
						_count: {
							select: {
								feedbackEntries: true
							}
						}
					}
				});

		if (existing) {
			await logUpdate({
				actorUserId: actingUser.id,
				entityType: 'CLIENT_PORTAL_ACCESS',
				before: existing,
				after: access,
				summary: `Reactivated client portal for ${jobOrder.title}`
			});
		} else {
			await logCreate({
				actorUserId: actingUser.id,
				entityType: 'CLIENT_PORTAL_ACCESS',
				entity: access,
				summary: `Created client portal for ${jobOrder.title}`
			});
		}

		return NextResponse.json({
			access: buildClientPortalInternalSummary({ req, portalAccess: access })
		});
	} catch (error) {
		return handleError(error, 'Failed to create client portal link.');
	}
}

async function patchJob_orders_id_client_portalHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);
		const { actingUser, jobOrder } = await loadScopedJobOrder(req, id);
		if (!(await isClientPortalEnabled())) {
			return NextResponse.json({ error: 'Client review portal is disabled.' }, { status: 403 });
		}
		const existing = await loadPortalAccess(jobOrder);
		if (!existing) {
			return NextResponse.json({ error: 'Client portal link not found.' }, { status: 404 });
		}

		const body = await parseJsonBody(req);
		const action = String(body.action || '').trim().toLowerCase();
		if (!['revoke', 'restore', 'send'].includes(action)) {
			return NextResponse.json({ error: 'Unsupported client portal action.' }, { status: 400 });
		}

		if (action === 'send') {
			const contactEmail = String(existing.contact?.email || '').trim().toLowerCase();
			if (!isValidEmailAddress(contactEmail)) {
				return NextResponse.json(
					{ error: 'The assigned client contact must have a valid email address before you can send the portal link.' },
					{ status: 400 }
				);
			}

			if (existing.isRevoked) {
				return NextResponse.json({ error: 'Restore the client portal before sending the link.' }, { status: 400 });
			}

			const accessSummary = buildClientPortalInternalSummary({ req, portalAccess: existing });
			const branding = await getSystemBranding();
			const baseUrl = getPublicAppBaseUrl();
			const contactName = `${existing.contact?.firstName || ''} ${existing.contact?.lastName || ''}`.trim() || 'there';
			const email = buildClientPortalInviteEmail({
				siteName: branding.siteName,
				logoUrl: branding.logoUrl ? `${baseUrl}${branding.logoUrl}` : '',
				hasCustomLogo: branding.hasCustomLogo,
				themeKey: branding.themeKey,
				jobOrderTitle: jobOrder.title,
				clientName: jobOrder.client?.name || '',
				contactName,
				portalUrl: accessSummary.portalUrl
			});
			const delivery = await sendEmailMessage({
				to: contactEmail,
				subject: email.subject,
				text: email.text,
				html: email.html
			});
			if (!delivery.sent) {
				return NextResponse.json(
					{ error: delivery.reason || 'Failed to send client portal email.' },
					{ status: 400 }
				);
			}

			const updatedAccess = await prisma.clientPortalAccess.update({
				where: { id: existing.id },
				data: {
					lastEmailedAt: new Date()
				},
				include: {
					contact: {
						select: {
							id: true,
							recordId: true,
							firstName: true,
							lastName: true,
							email: true,
							title: true
						}
					},
					_count: {
						select: {
							feedbackEntries: true
						}
					}
				}
			});

			await logUpdate({
				actorUserId: actingUser.id,
				entityType: 'CLIENT_PORTAL_ACCESS',
				before: existing,
				after: updatedAccess,
				summary: `Emailed client portal link for ${jobOrder.title}`
			});

			return NextResponse.json({
				access: buildClientPortalInternalSummary({ req, portalAccess: updatedAccess }),
				sent: true,
				deliveredTo: delivery.deliveredTo || [],
				testMode: Boolean(delivery.testMode)
			});
		}

		const access = await prisma.clientPortalAccess.update({
			where: { id: existing.id },
			data: {
				isRevoked: action === 'revoke'
			},
			include: {
				contact: {
					select: {
						id: true,
						recordId: true,
						firstName: true,
						lastName: true,
						email: true,
						title: true
					}
				},
				_count: {
					select: {
						feedbackEntries: true
					}
				}
			}
		});

		await logUpdate({
			actorUserId: actingUser.id,
			entityType: 'CLIENT_PORTAL_ACCESS',
			before: existing,
			after: access,
			summary: `${action === 'revoke' ? 'Revoked' : 'Restored'} client portal for ${jobOrder.title}`
		});

		return NextResponse.json({
			access: buildClientPortalInternalSummary({ req, portalAccess: access })
		});
	} catch (error) {
		return handleError(error, 'Failed to update client portal link.');
	}
}

export const GET = withApiLogging('job_orders.id.client_portal.get', getJob_orders_id_client_portalHandler);
export const POST = withApiLogging('job_orders.id.client_portal.post', postJob_orders_id_client_portalHandler);
export const PATCH = withApiLogging('job_orders.id.client_portal.patch', patchJob_orders_id_client_portalHandler);
