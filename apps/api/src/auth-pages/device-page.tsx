import { DEVICE_SCRIPT } from './scripts/device';

/**
 * Server-rendered device authorization verification page (RFC 8628).
 *
 * The user enters the code displayed by Epicenter CLI, clicks Approve,
 * and the CLI's polling loop picks up the token automatically. Session
 * cookies from `epicenter.so` work here via cross-subdomain cookies.
 */
export function DevicePage({ userCode }: { userCode?: string }) {
	const prefilled = userCode ? escapeHtml(userCode) : '';

	return (
		<>
			<h1>Authorize device</h1>
			<p class="subtitle">Enter the code shown by Epicenter CLI.</p>

			<form id="form">
				<div class="field">
					<label for="code">Device code</label>
					<input
						id="code"
						name="code"
						type="text"
						required
						autocomplete="off"
						placeholder="ABCD-1234"
						maxlength={20}
						value={prefilled}
						class="code-input"
					/>
				</div>
				<div class="actions">
					<button type="submit" class="btn btn-primary" id="approve">
						Approve
					</button>
					<button type="button" class="btn btn-outline" id="deny">
						Deny
					</button>
				</div>
			</form>

			<div id="msg" class="msg hidden" />

			{DEVICE_SCRIPT}
		</>
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
