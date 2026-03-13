# Whispering Windows Uninstall Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Whispering's Windows uninstall flow remove app data reliably and exit cleanly instead of dropping back into the install pages.

**Architecture:** Vendor the current Tauri NSIS installer template into the repo so Whispering owns the same-version maintenance uninstall branch, then keep the cleanup delta isolated in a small NSIS hooks file. Add a Bun test that fails until the config, template, and hook are all wired together with the expected uninstall behavior.

**Tech Stack:** Bun test, Tauri 2, NSIS template customization, NSIS installer hooks

---

### Task 1: Add a failing verification test for the Windows installer wiring

**Files:**
- Create: `apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`
- Test: `apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tauriConfigPath = resolve(import.meta.dir, "../tauri.conf.json");
const installerTemplatePath = resolve(import.meta.dir, "../windows/nsis/installer.nsi");
const installerHooksPath = resolve(import.meta.dir, "../windows/nsis/installer-hooks.nsh");

describe("Windows uninstall packaging", () => {
	test("wires a custom NSIS template and cleanup hooks", () => {
		const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));

		expect(tauriConfig.bundle.windows.nsis.template).toBe("windows/nsis/installer.nsi");
		expect(tauriConfig.bundle.windows.nsis.installerHooks).toBe(
			"windows/nsis/installer-hooks.nsh",
		);

		const installerTemplate = readFileSync(installerTemplatePath, "utf8");
		const installerHooks = readFileSync(installerHooksPath, "utf8");

		expect(installerTemplate).toContain("Var QuitAfterUninstall");
		expect(installerTemplate).toContain("StrCpy $QuitAfterUninstall 1");
		expect(installerTemplate).toContain("${If} $QuitAfterUninstall = 1");
		expect(installerTemplate).toContain("Quit");
		expect(installerTemplate).toContain("SendMessage $DeleteAppDataCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0");

		expect(installerHooks).toContain("$LOCALAPPDATA\\Whispering");
		expect(installerHooks).toContain("$APPDATA\\${BUNDLEID}");
		expect(installerHooks).toContain("$LOCALAPPDATA\\${BUNDLEID}");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`
Expected: FAIL because the custom NSIS template and hooks files do not exist yet and `tauri.conf.json` does not reference them.

**Step 3: Commit**

```bash
git add apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts
git commit -m "test: cover whispering windows uninstall packaging"
```

### Task 2: Vendor the NSIS template and wire Tauri config to it

**Files:**
- Create: `apps/whispering/src-tauri/windows/nsis/installer.nsi`
- Create: `apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh`
- Modify: `apps/whispering/src-tauri/tauri.conf.json`
- Test: `apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`

**Step 1: Copy the matching upstream Tauri installer template**

Use the `tauri-cli-v2.10.1` template as the baseline and save it to:

```text
apps/whispering/src-tauri/windows/nsis/installer.nsi
```

**Step 2: Make the minimal template changes**

Modify the vendored template to:

```nsi
Var QuitAfterUninstall
```

Set the checkbox checked by default in the uninstaller confirm page:

```nsi
SendMessage $DeleteAppDataCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
```

In `Function PageLeaveReinstall`, only the same-version uninstall path should quit after uninstall succeeds:

```nsi
${If} $R0 = 0
  ${If} $R1 = 1
    Goto reinst_done
  ${Else}
    StrCpy $QuitAfterUninstall 1
    Goto reinst_uninstall
  ${EndIf}
```

After `ExecWait` succeeds, exit instead of continuing into install pages when `$QuitAfterUninstall = 1`:

```nsi
${If} $QuitAfterUninstall = 1
  Quit
${EndIf}
```

**Step 3: Add the uninstall cleanup hook**

Create:

```text
apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh
```

Add a post-uninstall hook that only runs when:
- `$DeleteAppDataCheckboxState = 1`
- `$UpdateMode <> 1`

The hook should:
- retry removal of `$APPDATA\${BUNDLEID}`
- retry removal of `$LOCALAPPDATA\${BUNDLEID}`
- retry removal of `$LOCALAPPDATA\Whispering`
- tolerate missing paths

Prefer a delayed shell cleanup command so the install directory can be removed after `uninstall.exe` exits.

**Step 4: Wire the config**

Update `apps/whispering/src-tauri/tauri.conf.json`:

```json
"nsis": {
  "compression": "bzip2",
  "installMode": "currentUser",
  "installerHooks": "windows/nsis/installer-hooks.nsh",
  "template": "windows/nsis/installer.nsi"
}
```

**Step 5: Run the test to verify it passes**

Run: `bun test apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts apps/whispering/src-tauri/windows/nsis/installer.nsi apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh apps/whispering/src-tauri/tauri.conf.json
git commit -m "fix: own whispering windows uninstall flow"
```

### Task 3: Run workspace verification and inspect the packaged inputs

**Files:**
- Modify: `apps/whispering/src-tauri/windows/nsis/installer.nsi`
- Modify: `apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh`
- Test: `apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`

**Step 1: Run the focused verification**

Run: `bun test apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts`
Expected: PASS

**Step 2: Run app verification**

Run: `bun run --cwd apps/whispering typecheck`
Expected: PASS

Run: `bun run --cwd apps/whispering build`
Expected: PASS

**Step 3: Inspect the customized installer sources**

Run:

```bash
rg -n "QuitAfterUninstall|DeleteAppDataCheckbox|LOCALAPPDATA\\\\Whispering" apps/whispering/src-tauri/windows/nsis/installer.nsi apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh
```

Expected:
- template contains the quit-after-maintenance-uninstall path
- hook contains cleanup for `%LOCALAPPDATA%\Whispering`
- hook still preserves bundle-id cleanup

**Step 4: Commit**

```bash
git add apps/whispering/src-tauri/windows/nsis/installer.nsi apps/whispering/src-tauri/windows/nsis/installer-hooks.nsh apps/whispering/src-tauri/tauri.conf.json apps/whispering/src-tauri/tests/windows-uninstall-installer.test.ts
git commit -m "test: verify whispering windows uninstall packaging"
```

### Task 4: Build and retest on Windows

**Files:**
- No new files expected

**Step 1: Trigger the fork-safe unsigned Windows build**

Run the GitHub Actions Windows release workflow from the branch containing this fix.

Expected: successful unsigned Windows build with updated installer assets.

**Step 2: Perform runtime verification on Windows 11**

Manual checks:
- install the new `Whispering_7.11.0_x64-setup.exe`
- uninstall via Windows using the maintenance flow
- confirm the uninstaller exits instead of returning to install pages
- confirm `%LOCALAPPDATA%\Whispering` is gone
- confirm `%LOCALAPPDATA%\com.bradenwong.whispering` is gone

**Step 3: Commit**

```bash
git add .
git commit -m "chore: verify whispering windows uninstall behavior"
```
