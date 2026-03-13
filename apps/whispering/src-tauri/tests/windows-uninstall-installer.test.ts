import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const tauriDir = join(import.meta.dir, "..");
const configPath = join(tauriDir, "tauri.conf.json");
const hooksPath = join(tauriDir, "windows", "nsis", "installer-hooks.nsh");
const templatePath = join(tauriDir, "windows", "nsis", "installer.nsi");

function findLine(lines: string[], needle: string) {
	const index = lines.findIndex((line) => line.includes(needle));
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}

function findLineInRange(
	lines: string[],
	needle: string,
	startIndex: number,
	endIndex: number,
) {
	const index = lines.findIndex(
		(line, lineIndex) =>
			lineIndex >= startIndex &&
			lineIndex <= endIndex &&
			line.includes(needle),
	);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}

function findBlockEnd(lines: string[], ifIndex: number) {
	let depth = 0;

	for (let index = ifIndex; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (line.startsWith("${ElseIf}") || line.startsWith("${Else}")) {
			continue;
		}

		if (
			line.startsWith("${If}") ||
			line.startsWith("${IfThen}") ||
			line.startsWith("${IfNot}")
		) {
			depth += 1;
			continue;
		}

		if (line.startsWith("${EndIf}")) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	throw new Error(`Missing matching \${EndIf} for line ${ifIndex + 1}`);
}

describe("Windows uninstall installer wiring", () => {
	test("owns NSIS uninstall cleanup and maintenance-exit flow", () => {
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		const nsis = config.bundle.windows.nsis;

		expect(nsis.installerHooks).toBe("windows/nsis/installer-hooks.nsh");
		expect(nsis.template).toBe("windows/nsis/installer.nsi");

		expect(existsSync(hooksPath)).toBe(true);
		expect(existsSync(templatePath)).toBe(true);

		const hooks = readFileSync(hooksPath, "utf8");
		const hookLines = hooks.split("\n");
		expect(hooks).toContain("!macro NSIS_HOOK_POSTUNINSTALL");
		const updateGuardIndex = findLine(hookLines, "${If} $UpdateMode <> 1");
		const updateGuardEnd = findBlockEnd(hookLines, updateGuardIndex);
		const deferredCleanupIndex = findLine(
			hookLines,
			`ExecShell "open" "$SYSDIR\\cmd.exe" '/C ping 127.0.0.1 -n 2 >NUL & rmdir /S /Q "$INSTDIR"' SW_HIDE`,
		);
		expect(deferredCleanupIndex).toBeGreaterThan(updateGuardIndex);
		expect(deferredCleanupIndex).toBeLessThan(updateGuardEnd);
		expect(hooks).not.toContain("$LOCALAPPDATA\\Whispering");
		expect(hooks).toContain("$LOCALAPPDATA\\com.bradenwong.whispering");
		const deleteAppDataGuardIndex = findLine(
			hookLines,
			"${If} $DeleteAppDataCheckboxState = 1",
		);
		const deleteAppDataGuardEnd = findBlockEnd(hookLines, deleteAppDataGuardIndex);
		const appDataCleanupIndex = findLine(
			hookLines,
			'RmDir /r "$LOCALAPPDATA\\com.bradenwong.whispering"',
		);
		expect(deleteAppDataGuardIndex).toBeGreaterThan(updateGuardIndex);
		expect(deleteAppDataGuardEnd).toBeLessThan(updateGuardEnd);
		expect(deferredCleanupIndex).toBeLessThan(deleteAppDataGuardIndex);
		expect(deferredCleanupIndex).toBeLessThan(deleteAppDataGuardEnd);
		expect(appDataCleanupIndex).toBeGreaterThan(deleteAppDataGuardIndex);
		expect(appDataCleanupIndex).toBeLessThan(deleteAppDataGuardEnd);

		const template = readFileSync(templatePath, "utf8");
		const templateLines = template.split("\n");
		expect(template).toContain("Derived from Tauri 2.10.x NSIS template.");
		expect(template).toContain("Function PageLeaveReinstall");
		expect(template).toContain("Var MaintenanceUninstallMode");
		expect(template).toContain(
			"SendMessage $DeleteAppDataCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0",
		);
		const sameVersionBranchIndex = findLine(
			templateLines,
			"${If} $R0 = 0 ; Same version, proceed",
		);
		const sameVersionBranchEnd = findBlockEnd(templateLines, sameVersionBranchIndex);
		const sameVersionProceedIndex = findLineInRange(
			templateLines,
			"${If} $R1 = 1",
			sameVersionBranchIndex,
			sameVersionBranchEnd,
		);
		const sameVersionUninstallElseIndex = findLineInRange(
			templateLines,
			"${Else}                    ; User chose to uninstall",
			sameVersionProceedIndex,
			sameVersionBranchEnd,
		);
		const sameVersionMaintenanceModeIndex = findLineInRange(
			templateLines,
			"StrCpy $MaintenanceUninstallMode 1",
			sameVersionUninstallElseIndex,
			sameVersionBranchEnd,
		);
		const sameVersionReinstallGotoIndex = findLineInRange(
			templateLines,
			"Goto reinst_uninstall",
			sameVersionMaintenanceModeIndex,
			sameVersionBranchEnd,
		);
		expect(sameVersionProceedIndex).toBeGreaterThan(sameVersionBranchIndex);
		expect(sameVersionUninstallElseIndex).toBeGreaterThan(sameVersionProceedIndex);
		expect(sameVersionMaintenanceModeIndex).toBeGreaterThan(
			sameVersionUninstallElseIndex,
		);
		expect(sameVersionReinstallGotoIndex).toBeGreaterThan(
			sameVersionMaintenanceModeIndex,
		);
		expect(sameVersionReinstallGotoIndex).toBeLessThan(sameVersionBranchEnd);
		const maintenanceGuardIndex = findLine(
			templateLines,
			"${If} $MaintenanceUninstallMode = 1",
		);
		const maintenanceGuardEnd = findBlockEnd(templateLines, maintenanceGuardIndex);
		const quitIndex = findLine(templateLines, "Quit");
		const errorMessageIndex = findLine(
			templateLines,
			'MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"',
		);
		const reinstDoneIndex = findLine(templateLines, "reinst_done:");
		expect(maintenanceGuardIndex).toBeGreaterThan(errorMessageIndex);
		expect(quitIndex).toBeGreaterThan(maintenanceGuardIndex);
		expect(quitIndex).toBeLessThan(maintenanceGuardEnd);
		expect(maintenanceGuardEnd).toBeLessThan(reinstDoneIndex);
	});
});
