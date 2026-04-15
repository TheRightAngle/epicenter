use log::info;
use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::mem::size_of;
use std::path::PathBuf;

/// Progressive WAV file writer.
///
/// Hot path: `write_*` methods do NO per-call allocation (a reusable byte
/// buffer is kept on `self`) and NO periodic header seeks. Header fields
/// are updated only when [`finalize`] is called (usually at stop or drop).
///
/// This is safe because a WAV file with stale size fields is still readable
/// by nearly every tool — the data chunk is linear and the actual sample
/// bytes are correct. On unexpected termination, worst case is a WAV whose
/// declared size is the placeholder 0xFFFFFFFF; any modern player still
/// plays it, and `finalize()` in [`Drop`] handles normal exits.
pub struct WavWriter {
    writer: BufWriter<File>,
    sample_rate: u32,
    channels: u16,
    bytes_per_sample: u16,
    data_chunk_size_pos: u64,
    riff_chunk_size_pos: u64,
    samples_written: u64,
    scratch_bytes: Vec<u8>,
    file_path: PathBuf,
}

impl WavWriter {
    pub fn new(file_path: PathBuf, sample_rate: u32, channels: u16) -> io::Result<Self> {
        let file = File::create(&file_path)?;
        let mut writer = BufWriter::new(file);

        // Store samples as 32-bit IEEE float (AudioFormat = 3). Matches the
        // data shape we hand to the transcriber and lets the audio callback
        // skip a conversion when CPAL gives us f32 natively.
        let bits_per_sample: u16 = 32;
        let bytes_per_sample = bits_per_sample / 8;

        // RIFF header
        writer.write_all(b"RIFF")?;
        let riff_chunk_size_pos = writer.stream_position()?;
        writer.write_all(&[0xFF, 0xFF, 0xFF, 0xFF])?;
        writer.write_all(b"WAVE")?;

        // fmt chunk
        writer.write_all(b"fmt ")?;
        writer.write_all(&16u32.to_le_bytes())?;
        writer.write_all(&3u16.to_le_bytes())?;
        writer.write_all(&channels.to_le_bytes())?;
        writer.write_all(&sample_rate.to_le_bytes())?;
        let byte_rate = sample_rate * channels as u32 * bytes_per_sample as u32;
        writer.write_all(&byte_rate.to_le_bytes())?;
        let block_align = channels * bytes_per_sample;
        writer.write_all(&block_align.to_le_bytes())?;
        writer.write_all(&bits_per_sample.to_le_bytes())?;

        // data chunk (size filled in by finalize)
        writer.write_all(b"data")?;
        let data_chunk_size_pos = writer.stream_position()?;
        writer.write_all(&[0xFF, 0xFF, 0xFF, 0xFF])?;

        info!(
            "Created WAV file at {:?}: {}Hz, {} channels, {}-bit float",
            file_path, sample_rate, channels, bits_per_sample
        );

        Ok(Self {
            writer,
            sample_rate,
            channels,
            bytes_per_sample,
            data_chunk_size_pos,
            riff_chunk_size_pos,
            samples_written: 0,
            scratch_bytes: Vec::with_capacity(4096),
            file_path,
        })
    }

    /// Write f32 samples directly (no conversion, native WAV format).
    pub fn write_samples_f32(&mut self, samples: &[f32]) -> io::Result<()> {
        self.write_converted(samples, |sample| sample)
    }

    /// Write i16 samples, converting to f32 at [-1.0, 1.0].
    pub fn write_samples_i16(&mut self, samples: &[i16]) -> io::Result<()> {
        self.write_converted(samples, |s| s as f32 / i16::MAX as f32)
    }

    /// Write u16 samples, converting to f32 at [-1.0, 1.0].
    pub fn write_samples_u16(&mut self, samples: &[u16]) -> io::Result<()> {
        self.write_converted(samples, |s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
    }

    /// Serialize a sample slice into the reusable scratch buffer and flush
    /// to the BufWriter. No allocation if `scratch_bytes` is already large
    /// enough (the common steady-state case).
    fn write_converted<T: Copy>(
        &mut self,
        samples: &[T],
        convert: impl Fn(T) -> f32,
    ) -> io::Result<()> {
        let needed_bytes = samples.len() * size_of::<f32>();
        self.scratch_bytes.clear();
        self.scratch_bytes.reserve(needed_bytes);

        for &sample in samples {
            let f = convert(sample);
            self.scratch_bytes.extend_from_slice(&f.to_le_bytes());
        }

        self.writer.write_all(&self.scratch_bytes)?;
        self.samples_written += samples.len() as u64;
        Ok(())
    }

    /// Finalize the WAV file: patch headers and flush. Call before closing
    /// the file (or rely on [`Drop`], which calls this).
    pub fn finalize(&mut self) -> io::Result<()> {
        let data_size = self.samples_written * self.bytes_per_sample as u64;
        let file_size = 36 + data_size; // total file size minus the 8-byte "RIFF<size>" preamble

        // Keep current position so we can restore it; matters if the writer
        // is reused after finalize (we don't, but defensively correct).
        let current_pos = self.writer.stream_position()?;

        self.writer
            .seek(SeekFrom::Start(self.riff_chunk_size_pos))?;
        self.writer.write_all(&(file_size as u32).to_le_bytes())?;

        self.writer
            .seek(SeekFrom::Start(self.data_chunk_size_pos))?;
        self.writer.write_all(&(data_size as u32).to_le_bytes())?;

        self.writer.seek(SeekFrom::Start(current_pos))?;
        self.writer.flush()?;

        info!(
            "Finalized WAV file {:?}: {} samples, {:.2} seconds",
            self.file_path,
            self.samples_written,
            self.get_duration_seconds()
        );

        Ok(())
    }

    pub fn get_duration_seconds(&self) -> f32 {
        self.samples_written as f32 / (self.sample_rate as f32 * self.channels as f32)
    }

    pub fn get_file_path(&self) -> &PathBuf {
        &self.file_path
    }

    pub fn get_metadata(&self) -> (u32, u16, f32) {
        (self.sample_rate, self.channels, self.get_duration_seconds())
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

impl Drop for WavWriter {
    fn drop(&mut self) {
        if let Err(e) = self.finalize() {
            log::error!("Failed to finalize WAV file on drop: {}", e);
        }
    }
}
