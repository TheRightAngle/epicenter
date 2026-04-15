<script lang="ts">
	import { AuthForm } from '@epicenter/svelte/auth-form';
	import { auth } from '$lib/client';
</script>

<AuthForm
	{auth}
	syncNoun="tabs"
	onSocialSignIn={() => auth.signInWithSocialPopup()}
/>
