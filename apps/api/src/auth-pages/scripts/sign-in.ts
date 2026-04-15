import { raw } from 'hono/html';

/**
 * Client-side script for the sign-in/sign-up page.
 *
 * Handles form submission via `fetch`, mode toggling between sign-in and
 * sign-up, and error display. Includes `oauth_query` (signed URL params)
 * in requests so Better Auth's after-hook can continue the OAuth flow.
 * On success, navigates to the returned redirect URL, a `callbackURL`
 * query param (e.g. redirected here from /device), or reloads as fallback.
 */
export const SIGN_IN_SCRIPT = raw(`<script>
(() => {
	const form = document.getElementById('auth-form');
	const emailInput = document.getElementById('email');
	const passwordInput = document.getElementById('password');
	const nameField = document.getElementById('name-field');
	const nameInput = document.getElementById('name');
	const submitBtn = document.getElementById('submit-btn');
	const submitText = document.getElementById('submit-text');
	const googleBtn = document.getElementById('google-btn');
	const toggleBtn = document.getElementById('toggle-btn');
	const togglePrompt = document.getElementById('toggle-prompt');
	const msg = document.getElementById('msg');

	let isSignUp = false;

	// Replicate what oauthProviderClient does: parse the signed OAuth
	// query params from the URL so Better Auth can continue the flow.
	const getOAuthQuery = () => {
		const params = new URLSearchParams(window.location.search);
		return params.has('sig') ? params.toString() : undefined;
	};

	const showError = (text) => {
		msg.textContent = text;
		msg.className = 'msg err';
	};

	const clearError = () => {
		msg.className = 'msg hidden';
	};

	const setLoading = (on) => {
		submitBtn.disabled = on;
		googleBtn.disabled = on;
		emailInput.disabled = on;
		passwordInput.disabled = on;
		if (nameInput) nameInput.disabled = on;
		submitText.textContent = on
			? (isSignUp ? 'Creating account\\u2026' : 'Signing in\\u2026')
			: (isSignUp ? 'Create account' : 'Sign in');
	};

	const toggleMode = () => {
		isSignUp = !isSignUp;
		clearError();

		document.getElementById('heading').textContent = isSignUp ? 'Create account' : 'Sign in';
		document.getElementById('description').textContent = isSignUp
			? 'Create an account to get started with Epicenter.'
			: 'Sign in to your Epicenter account.';
		submitText.textContent = isSignUp ? 'Create account' : 'Sign in';
		togglePrompt.textContent = isSignUp ? 'Already have an account? ' : "Don't have an account? ";
		toggleBtn.textContent = isSignUp ? 'Sign in' : 'Sign up';
		nameField.style.display = isSignUp ? 'block' : 'none';
		passwordInput.autocomplete = isSignUp ? 'new-password' : 'current-password';

		if (nameInput) nameInput.required = isSignUp;
	};

	toggleBtn.addEventListener('click', toggleMode);

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		clearError();
		setLoading(true);

		const endpoint = isSignUp ? '/auth/sign-up/email' : '/auth/sign-in/email';
		const body = { email: emailInput.value, password: passwordInput.value };
		if (isSignUp && nameInput) body.name = nameInput.value;
		const oauthQuery = getOAuthQuery();
		if (oauthQuery) body.oauth_query = oauthQuery;

		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				showError(data.message || data.error || 'Something went wrong. Try again.');
				setLoading(false);
				return;
			}

			// If Better Auth returned a redirect (OAuth flow continuation),
			// navigate there. For non-OAuth sign-ins, honor callbackURL if
			// present (e.g. redirected here from /device), otherwise reload.
			const data = await res.json().catch(() => ({}));
			if (data.url) {
				window.location.href = data.url;
			} else {
				const params = new URLSearchParams(window.location.search);
				const callbackURL = params.get('callbackURL');
				if (callbackURL && callbackURL.startsWith('/')) {
					window.location.href = callbackURL;
				} else {
					window.location.reload();
				}
			}
		} catch (err) {
			showError('Network error. Check your connection and try again.');
			setLoading(false);
		}
	});

	googleBtn.addEventListener('click', async () => {
		clearError();
		setLoading(true);

		try {
			const body = {
				provider: 'google',
				callbackURL: window.location.href,
			};
			const oauthQuery = getOAuthQuery();
			if (oauthQuery) body.oauth_query = oauthQuery;

			const res = await fetch('/auth/sign-in/social', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(body),
			});

			const data = await res.json().catch(() => ({}));
			if (data.url) {
				window.location.href = data.url;
			} else if (res.redirected) {
				window.location.href = res.url;
			} else {
				showError(data.message || data.error || 'Failed to start Google sign-in.');
				setLoading(false);
			}
		} catch (err) {
			showError('Network error. Check your connection and try again.');
			setLoading(false);
		}
	});
})();
</script>`);
