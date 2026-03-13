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
		expect(installerTemplate).toContain(
			"SendMessage $DeleteAppDataCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0",
		);

		expect(installerHooks).toContain("$LOCALAPPDATA\\Whispering");
		expect(installerHooks).toContain("$APPDATA\\${BUNDLEID}");
		expect(installerHooks).toContain("$LOCALAPPDATA\\${BUNDLEID}");
		expect(installerHooks).toContain("Function un.WhisperingRunDeferredCleanup");
		expect(installerHooks).toContain("Call un.WhisperingRunDeferredCleanup");
	});
});
