import { raw } from 'hono/html';

/**
 * Client-side script for the device authorization verification page.
 *
 * Posts the user code to `/auth/device/approve` or `/auth/device/deny`,
 * shows status messages, and hides the form on completion.
 */
export const DEVICE_SCRIPT = raw(`<script>
(() => {
	const form = document.getElementById('form');
	const code = document.getElementById('code');
	const approve = document.getElementById('approve');
	const deny = document.getElementById('deny');
	const msg = document.getElementById('msg');

	const show = (text, type) => {
		msg.textContent = text;
		msg.className = 'msg ' + type;
	};

	const setLoading = (on) => {
		approve.disabled = on;
		deny.disabled = on;
		code.disabled = on;
	};

	const send = async (endpoint, userCode) => {
		setLoading(true);
		msg.className = 'msg hidden';
		try {
			const res = await fetch('/auth/device/' + endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ userCode }),
			});
			const data = await res.json();
			if (!res.ok) {
				if (res.status === 401 || data.error === 'unauthorized') {
					show('Sign in first, then come back to this page.', 'warn');
				} else {
					show(data.error_description || data.message || 'Something went wrong.', 'err');
				}
				return;
			}
			if (endpoint === 'approve') {
				show('Device authorized. You can close this page.', 'ok');
				form.classList.add('hidden');
			} else {
				show('Device denied.', 'ok');
				form.classList.add('hidden');
			}
		} catch (e) {
			show('Network error. Check your connection and try again.', 'err');
		} finally {
			setLoading(false);
		}
	};

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const val = code.value.trim();
		if (val) send('approve', val);
	});

	deny.addEventListener('click', () => {
		const val = code.value.trim();
		if (val) send('deny', val);
	});
})();
</script>`);
