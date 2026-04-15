<script lang="ts">
	import * as Field from '@epicenter/ui/field';
	import { Input } from '@epicenter/ui/input';
	import { Link } from '@epicenter/ui/link';
	import { deviceConfig } from '$lib/state/device-config.svelte';
</script>

<Field.Field>
	<Field.Label for="anthropic-api-key">Anthropic API Key</Field.Label>
	<Input
		id="anthropic-api-key"
		type="password"
		placeholder="Your Anthropic API Key"
		autocomplete="off"
		bind:value={() => deviceConfig.get('apiKeys.anthropic'),
			(value) => deviceConfig.set('apiKeys.anthropic', value)}
	/>
	<Field.Description>
		You can find your Anthropic API key in your <Link
			href="https://console.anthropic.com/settings/keys"
			target="_blank"
			rel="noopener noreferrer"
		>
			Anthropic console
		</Link>
		.
	</Field.Description>
</Field.Field>
