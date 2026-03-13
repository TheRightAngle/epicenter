import type { Device } from './types';

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDetail(baseLabel: string, richerLabel: string): string | null {
	const normalizedBaseLabel = baseLabel.trim();
	const normalizedRicherLabel = richerLabel.trim();

	if (!normalizedRicherLabel || normalizedRicherLabel === normalizedBaseLabel) {
		return null;
	}

	const detailMatch = normalizedRicherLabel.match(
		new RegExp(`^${escapeRegExp(normalizedBaseLabel)}\\s*\\((.+)\\)$`),
	);

	if (detailMatch?.[1]) {
		return detailMatch[1].trim();
	}

	return normalizedRicherLabel;
}

export function disambiguateDeviceLabels(
	devices: Device[],
	richerDevices?: Device[],
): Device[] {
	const indicesByLabel = new Map<string, number[]>();

	for (const [index, device] of devices.entries()) {
		const existingIndices = indicesByLabel.get(device.label) ?? [];
		existingIndices.push(index);
		indicesByLabel.set(device.label, existingIndices);
	}

	if ([...indicesByLabel.values()].every((indices) => indices.length === 1)) {
		return devices;
	}

	return devices.map((device, index) => {
		const duplicateIndices = indicesByLabel.get(device.label) ?? [];
		if (duplicateIndices.length === 1) return device;

		const richerDetails = duplicateIndices.map((duplicateIndex) =>
			extractDetail(
				device.label,
				richerDevices?.[duplicateIndex]?.label ?? '',
			),
		);

		const hasUniqueRicherDetails =
			richerDetails.every(Boolean) &&
			new Set(richerDetails.map((detail) => detail?.toLowerCase())).size ===
				richerDetails.length;

		if (hasUniqueRicherDetails) {
			const detail = richerDetails[duplicateIndices.indexOf(index)];
			return {
				...device,
				label: `${device.label} (${detail})`,
			};
		}

		return {
			...device,
			label: `${device.label} (${duplicateIndices.indexOf(index) + 1})`,
		};
	});
}
