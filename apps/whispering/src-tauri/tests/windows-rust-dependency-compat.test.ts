import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const recorderPath = resolve(import.meta.dir, "../src/recorder/recorder.rs");
const transcriptionPath = resolve(import.meta.dir, "../src/transcription/mod.rs");
const audioConverterPath = resolve(
	import.meta.dir,
	"../src/transcription/audio_converter.rs",
);

describe("Windows Rust dependency compatibility", () => {
	test("avoids removed cpal and rubato APIs", () => {
		const recorder = readFileSync(recorderPath, "utf8");
		const transcription = readFileSync(transcriptionPath, "utf8");
		const audioConverter = readFileSync(audioConverterPath, "utf8");

		expect(recorder).not.toContain("cpal::SampleRate(");
		expect(recorder).not.toContain(".min_sample_rate().0");
		expect(recorder).not.toContain(".max_sample_rate().0");

		expect(transcription).not.toContain("SincFixedIn");
		expect(transcription).toContain("Async::<f32>::new_sinc");
		expect(transcription).toContain("FixedAsync::Input");

		expect(audioConverter).not.toContain("FftFixedInOut");
		expect(audioConverter).toContain("Fft::<f32>::new");
		expect(audioConverter).toContain("FixedSync::Both");
	});
});
