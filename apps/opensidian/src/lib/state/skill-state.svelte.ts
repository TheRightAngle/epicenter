import { Ok, tryAsync } from 'wellcrafted/result';
import { fs, skillsWorkspace } from '$lib/client';

/** A global skill loaded from the @epicenter/skills workspace. */
type GlobalSkill = { name: string; instructions: string };

/** A vault skill loaded from /skills/*.md in the user's filesystem. */
type VaultSkill = { name: string; content: string };

/**
 * Reactive skill loader for Opensidian's two-layer prompt architecture.
 *
 * Opensidian assembles skills from two separate sources because they solve
 * different problems:
 *
 * 1. **Global skills** come from `skillsWorkspace`, the shared
 *    `@epicenter/skills` workspace persisted in its own IndexedDB database.
 *    These are ecosystem-wide conventions imported through Epicenter's skills
 *    tooling and shared across apps.
 * 2. **Vault skills** come from `/skills/*.md` inside the user's current vault.
 *    These are local markdown files that travel with the vault itself, making
 *    them ideal for project-specific instructions, notes, and overrides.
 *
 * When the system prompt is composed, the global layer provides the stable,
 * cross-app baseline—things like house style, workflow rules, and reusable
 * patterns. The vault layer adds local context that belongs to this specific
 * vault. Keeping both layers separate avoids conflating "shared Epicenter
 * conventions" with "instructions that should live next to the user's notes."
 *
 * Error handling is intentionally forgiving. A missing or empty global skills
 * workspace means there simply are no imported global skills yet, so loading
 * falls back to an empty list. A missing `/skills` directory is also normal for
 * a brand-new vault, so that case is treated as "no vault skills" rather than a
 * user-facing failure.
 *
 * @example
 * ```typescript
 * await skillState.loadAllSkills();
 *
 * const globalLayer = skillState.globalSkills;
 * const vaultLayer = skillState.vaultSkills;
 * ```
 */
function createSkillState() {
	let globalSkills = $state<GlobalSkill[]>([]);
	let vaultSkills = $state<VaultSkill[]>([]);
	let loading = $state(false);

	async function loadGlobalSkills() {
		const emptyGlobalSkills: GlobalSkill[] = [];

		const { data } = await tryAsync({
			try: async () => {
				const catalog = await skillsWorkspace.actions.listSkills();
				const loadedSkills = await Promise.all(
					catalog.map(async ({ id }) =>
						skillsWorkspace.actions.getSkill({ id }),
					),
				);

				return loadedSkills
					.filter((entry) => entry !== null)
					.map(({ skill, instructions }) => ({
						name: skill.name,
						instructions,
					}));
			},
			catch: () => Ok(emptyGlobalSkills),
		});

		return data;
	}

	async function loadVaultSkills() {
		const emptyVaultSkills: VaultSkill[] = [];

		const { data } = await tryAsync({
			try: async () => {
				const entries = await fs.readdir('/skills');
				const markdownEntries = entries.filter((entry) =>
					entry.endsWith('.md'),
				);

				return Promise.all(
					markdownEntries.map(async (entry) => ({
						name: entry.replace('.md', ''),
						content: await fs.readFile(`/skills/${entry}`),
					})),
				);
			},
			catch: () => Ok(emptyVaultSkills),
		});

		return data;
	}

	return {
		get globalSkills() {
			return globalSkills;
		},

		get vaultSkills() {
			return vaultSkills;
		},

		get loading() {
			return loading;
		},

		/**
		 * Refresh both skill layers in parallel.
		 *
		 * Global and vault skills are independent data sources, so loading them
		 * together keeps the UI snappy and avoids unnecessary serial waits.
		 */
		async loadAllSkills() {
			loading = true;

			try {
				const [nextGlobalSkills, nextVaultSkills] = await Promise.all([
					loadGlobalSkills(),
					loadVaultSkills(),
				]);

				globalSkills = nextGlobalSkills;
				vaultSkills = nextVaultSkills;
			} finally {
				loading = false;
			}
		},
	};
}

export const skillState = createSkillState();
