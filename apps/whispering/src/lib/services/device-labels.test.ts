import { describe, expect, test } from 'bun:test';
import { asDeviceIdentifier, type Device } from './types';
import { disambiguateDeviceLabels } from './device-labels';

function device(id: string, label: string): Device {
	return {
		id: asDeviceIdentifier(id),
		label,
	};
}

describe('disambiguateDeviceLabels', () => {
	test('leaves unique labels unchanged', () => {
		const devices = [
			device('builtin', 'Built-in Microphone'),
			device('webcam', 'Webcam Microphone'),
		];

		expect(disambiguateDeviceLabels(devices)).toEqual(devices);
	});

	test('uses richer aligned labels when duplicate labels exist', () => {
		const devices = [
			device('device-1', 'Microphone'),
			device('device-2', 'Microphone'),
		];

		const richerLabels = [
			device('nav-1', 'Microphone (Laptop Array)'),
			device('nav-2', 'Microphone (Webcam Mic)'),
		];

		expect(disambiguateDeviceLabels(devices, richerLabels)).toEqual([
			device('device-1', 'Microphone (Laptop Array)'),
			device('device-2', 'Microphone (Webcam Mic)'),
		]);
	});

	test('falls back to numbered labels when no richer detail is available', () => {
		const devices = [
			device('device-1', 'Microphone'),
			device('device-2', 'Microphone'),
			device('device-3', 'Built-in Microphone'),
		];

		expect(disambiguateDeviceLabels(devices)).toEqual([
			device('device-1', 'Microphone (1)'),
			device('device-2', 'Microphone (2)'),
			device('device-3', 'Built-in Microphone'),
		]);
	});
});
