import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const tauriDir = join(import.meta.dir, "..");
const configPath = join(tauriDir, "tauri.conf.json");
const hooksPath = join(tauriDir, "windows", "nsis", "installer-hooks.nsh");
const templatePath = join(tauriDir, "windows", "nsis", "installer.nsi");

describe("Windows uninstall installer wiring", () => {
	test("owns NSIS uninstall cleanup and maintenance-exit flow", () => {
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		const nsis = config.bundle.windows.nsis;

		expect(nsis.installerHooks).toBe("windows/nsis/installer-hooks.nsh");
		expect(nsis.template).toBe("windows/nsis/installer.nsi");

		expect(existsSync(hooksPath)).toBe(true);
		expect(existsSync(templatePath)).toBe(true);

		const hooks = readFileSync(hooksPath, "utf8");
		expect(hooks).toContain("!macro NSIS_HOOK_POSTUNINSTALL");
		expect(hooks).toContain("DeleteAppDataCheckboxState");
		expect(hooks).toContain("$LOCALAPPDATA\\Whispering");
		expect(hooks).toContain("$LOCALAPPDATA\\com.bradenwong.whispering");

		const template = readFileSync(templatePath, "utf8");
		expect(template).toContain("Function PageLeaveReinstall");
		expect(template).toContain("Var MaintenanceUninstallMode");
		expect(template).toContain("${If} $MaintenanceUninstallMode = 1");
		expect(template).toContain("Quit");
	});
});
