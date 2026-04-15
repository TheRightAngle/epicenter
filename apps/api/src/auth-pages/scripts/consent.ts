import { raw } from 'hono/html';

/**
 * Client-side script for the OAuth consent page.
 *
 * Sends the user's consent decision (approve/deny) to the Better Auth
 * consent endpoint with `oauth_query` (signed URL params from the
 * authorize redirect). On success, navigates to the redirect URL
 * returned by Better Auth to complete the OAuth flow.
 */
export const CONSENT_SCRIPT = raw(`<script>
(() => {
	const approveBtn = document.getElementById('approve');
	const denyBtn = document.getElementById('deny');
	const msg = document.getElementById('msg');
	const scope = new URLSearchParams(window.location.search).get('scope') || '';

	const getOAuthQuery = () => {
		const params = new URLSearchParams(window.location.search);
		return params.has('sig') ? params.toString() : undefined;
	};

	const show = (text, type) => {
		msg.textContent = text;
		msg.className = 'msg ' + type;
	};

	const setLoading = (on) => {
		approveBtn.disabled = on;
		denyBtn.disabled = on;
	};

	const sendConsent = async (accept) => {
		setLoading(true);
		msg.className = 'msg hidden';

		try {
			const res = await fetch('/auth/oauth2/consent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					accept,
					scope: scope || undefined,
					oauth_query: getOAuthQuery(),
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				show(data.message || data.error || 'Something went wrong.', 'err');
				setLoading(false);
				return;
			}

			// Better Auth returns { redirect: true, url: "..." } for fetch
			// requests instead of a 302 redirect (see handleRedirect).
			const data = await res.json().catch(() => ({}));
			if (data.url) {
				window.location.href = data.url;
			} else if (res.redirected) {
				window.location.href = res.url;
			} else {
				show(accept ? 'Access granted.' : 'Access denied.', 'ok');
			}
		} catch (err) {
			show('Network error. Check your connection and try again.', 'err');
			setLoading(false);
		}
	};

	approveBtn.addEventListener('click', () => sendConsent(true));
	denyBtn.addEventListener('click', () => sendConsent(false));
})();
</script>`);
