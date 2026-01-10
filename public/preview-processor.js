/**
 * Preview Note Audio Worklet Processor
 *
 * This processor handles real-time note preview playback as the user inputs notes.
 * It's completely separate from the main pattern playback system to avoid interference.
 * Works with any chip type by using the same WASM modules.
 */

import {
	AYUMI_STRUCT_SIZE,
	AYUMI_STRUCT_LEFT_OFFSET,
	AYUMI_STRUCT_RIGHT_OFFSET,
	PAN_SETTINGS,
	DEFAULT_AYM_FREQUENCY
} from './ayumi-constants.js';

// PT3 Volume table for proper volume calculation
const PT3_VOL = [
	[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
	[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01],
	[0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x02, 0x02, 0x02, 0x02],
	[0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03],
	[0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04],
	[0x00, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x05, 0x05],
	[0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x02, 0x03, 0x03, 0x04, 0x04, 0x04, 0x05, 0x05, 0x06, 0x06],
	[0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x06, 0x07, 0x07],
	[0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x06, 0x07, 0x07, 0x08],
	[0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x07, 0x07, 0x08, 0x08, 0x09],
	[0x00, 0x01, 0x01, 0x02, 0x03, 0x03, 0x04, 0x05, 0x05, 0x06, 0x07, 0x07, 0x08, 0x09, 0x09, 0x0a],
	[0x00, 0x01, 0x01, 0x02, 0x03, 0x04, 0x04, 0x05, 0x06, 0x07, 0x07, 0x08, 0x09, 0x0a, 0x0a, 0x0b],
	[0x00, 0x01, 0x02, 0x02, 0x03, 0x04, 0x05, 0x06, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0a, 0x0b, 0x0c],
	[0x00, 0x01, 0x02, 0x03, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0a, 0x0b, 0x0c, 0x0d],
	[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e],
	[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]
];

class PreviewProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.initialized = false;
		this.wasmModule = null;
		this.ayumiPtr = null;
		this.currentNote = null; // { noteName, octave, instrument, channelIndex, baseNote }
		this.instruments = [];
		this.tuningTable = [];
		this.chipType = null;
		this.instrumentRow = 0;
		this.tickCounter = 0;
		this.samplesPerTick = 0;

		this.port.onmessage = (event) => {
			this.handleMessage(event.data);
		};
	}

	handleMessage(message) {
		const { type, payload } = message;

		switch (type) {
			case 'init':
				this.initialize(payload);
				break;
			case 'play_note':
				this.playNote(payload);
				break;
			case 'stop_note':
				this.stopNote();
				break;
			case 'update_instruments':
				this.updateInstruments(payload);
				break;
			case 'update_tuning_table':
				this.updateTuningTable(payload);
				break;
			default:
				console.warn('Unknown message type:', type);
		}
	}

	async initialize(payload) {
		const { wasmBuffer, chipType, sampleRate } = payload;

		this.chipType = chipType;

		// Initialize based on chip type
		if (chipType === 'ay') {
			try {
				// Initialize Ayumi WASM module
				const result = await WebAssembly.instantiate(wasmBuffer, {
					env: { emscripten_notify_memory_growth: () => {} }
				});

				this.wasmModule = result.instance.exports;
				this.ayumiPtr = this.wasmModule.malloc(AYUMI_STRUCT_SIZE);

				// Configure Ayumi
				this.wasmModule.ayumi_configure(
					this.ayumiPtr,
					0,
					DEFAULT_AYM_FREQUENCY,
					sampleRate
				);

				// Set pan settings
				PAN_SETTINGS.forEach(({ channel, left, right }) => {
					this.wasmModule.ayumi_set_pan(this.ayumiPtr, channel, left, right);
				});

				// Calculate samples per tick (for instrument advancement)
				// Default to 50Hz (PAL) = 20ms per tick
				this.samplesPerTick = Math.floor(sampleRate / 50);

				this.initialized = true;
				this.port.postMessage({ type: 'ready' });
			} catch (error) {
				console.error('Failed to initialize preview processor:', error);
			}
		} else {
			// Future: Add support for other chip types (FM, SID, etc.)
			console.error('Unsupported chip type for preview:', chipType);
		}
	}

	updateInstruments(instruments) {
		this.instruments = instruments || [];
	}

	updateTuningTable(tuningTable) {
		this.tuningTable = tuningTable || [];
	}

	playNote(payload) {
		if (!this.initialized || !this.wasmModule) {
			return;
		}

		const { noteName, octave, instrumentIndex, channelIndex, baseVolume } = payload;

		// Stop any currently playing note
		if (this.currentNote) {
			this.stopNote();
		}

		// Calculate MIDI-like note number (C-1 = 0, C-0 = 12, etc.)
		// noteName is from NoteName enum where OFF=0, C=1, C#=2, etc.
		// We need to convert to internal format: (noteName - 2) + (octave - 1) * 12
		const baseNote = noteName - 2 + (octave - 1) * 12;

		// Get instrument data
		const instrument = this.instruments[instrumentIndex] || null;

		// Store current note state
		this.currentNote = {
			noteName,
			octave,
			instrumentIndex,
			channelIndex: channelIndex || 0,
			baseNote,
			instrument,
			baseVolume: baseVolume !== undefined ? baseVolume : 15
		};

		// Reset instrument position and tick counter
		this.instrumentRow = 0;
		this.tickCounter = 0;

		// Initialize the note on the chip
		this.updateChipRegisters();
	}

	stopNote() {
		if (!this.currentNote || !this.wasmModule) {
			return;
		}

		// Mute all channels (simple approach)
		for (let i = 0; i < 3; i++) {
			this.wasmModule.ayumi_set_volume(this.ayumiPtr, i, 0);
		}

		this.currentNote = null;
		this.instrumentRow = 0;
		this.tickCounter = 0;
	}

	updateChipRegisters() {
		if (!this.wasmModule || !this.currentNote || this.chipType !== 'ay') {
			return;
		}

		const { channelIndex, baseNote, instrument, baseVolume } = this.currentNote;

		// Get current instrument row data
		let noteOffset = 0;
		let instrumentVolume = 15; // Default max instrument volume
		let toneEnabled = true;
		let noiseEnabled = false;
		let envelopeEnabled = false;
		let noiseValue = 0;

		if (instrument && instrument.rows && this.instrumentRow < instrument.rows.length) {
			const instRow = instrument.rows[this.instrumentRow];

			// Note offset
			noteOffset = instRow.note || 0;

			// Instrument volume (0-15)
			if (instRow.volume !== undefined && instRow.volume !== null && instRow.volume >= 0) {
				instrumentVolume = instRow.volume;
			}

			// Mixer settings
			toneEnabled = instRow.tone !== undefined ? instRow.tone : true;
			noiseEnabled = instRow.noise !== undefined ? instRow.noise : false;
			envelopeEnabled = instRow.envelope !== undefined ? instRow.envelope : false;

			// Noise value
			if (instRow.noiseAdd !== undefined) {
				noiseValue = instRow.noiseAdd & 31;
			}
		}

		// Calculate final volume using PT3 volume table
		// Clamp volumes to valid range
		const patternVol = Math.max(0, Math.min(15, baseVolume));
		let instVol = Math.max(0, Math.min(15, instrumentVolume));

		// Use PT3 volume table for proper volume calculation
		const volumeValue = PT3_VOL[patternVol][instVol];

		// Calculate final note
		const finalNote = baseNote + noteOffset;

		// Get frequency from tuning table
		let frequency = 440; // Default A4
		if (this.tuningTable && this.tuningTable[finalNote] !== undefined) {
			frequency = this.tuningTable[finalNote];
		} else {
			// Fallback: calculate frequency using equal temperament
			// A4 (note 57 in our system) = 440 Hz
			frequency = 440 * Math.pow(2, (finalNote - 57) / 12);
		}

		// Mute other channels
		for (let i = 0; i < 3; i++) {
			if (i !== channelIndex) {
				this.wasmModule.ayumi_set_volume(this.ayumiPtr, i, 0);
				this.wasmModule.ayumi_set_mixer(this.ayumiPtr, i, 1, 1, 0);
			}
		}

		// Set tone frequency
		this.wasmModule.ayumi_set_tone(this.ayumiPtr, channelIndex, frequency);

		// Set noise if enabled
		if (noiseEnabled) {
			this.wasmModule.ayumi_set_noise(this.ayumiPtr, noiseValue);
		}

		// Set volume
		this.wasmModule.ayumi_set_volume(this.ayumiPtr, channelIndex, volumeValue);

		// Set mixer (tone, noise, envelope)
		// ayumi_set_mixer params: channel, tone (0=on, 1=off), noise (0=on, 1=off), envelope (0=off, 1=on)
		this.wasmModule.ayumi_set_mixer(
			this.ayumiPtr,
			channelIndex,
			toneEnabled ? 0 : 1,
			noiseEnabled ? 0 : 1,
			envelopeEnabled ? 1 : 0
		);
	}

	advanceInstrument() {
		if (!this.currentNote || !this.currentNote.instrument) {
			return;
		}

		const instrument = this.currentNote.instrument;
		this.instrumentRow++;

		// Handle instrument looping
		if (this.instrumentRow >= instrument.rows.length) {
			if (instrument.loop !== undefined && instrument.loop >= 0) {
				this.instrumentRow = instrument.loop;
			} else {
				// No loop, stay at last row
				this.instrumentRow = instrument.rows.length - 1;
			}
		}

		// Update chip registers with new instrument row
		this.updateChipRegisters();
	}

	process(inputs, outputs, parameters) {
		if (!this.initialized || !this.wasmModule) {
			return true;
		}

		const output = outputs[0];
		const blockSize = output[0].length;

		// Advance instrument on tick boundaries
		if (this.currentNote) {
			this.tickCounter += blockSize;
			if (this.tickCounter >= this.samplesPerTick) {
				this.tickCounter -= this.samplesPerTick;
				this.advanceInstrument();
			}
		}

		// Render audio
		if (this.chipType === 'ay') {
			const leftChannel = output[0];
			const rightChannel = output[1];

			// Process each sample individually
			for (let i = 0; i < blockSize; i++) {
				// Process one sample
				this.wasmModule.ayumi_process(this.ayumiPtr);

				// Remove DC offset
				this.wasmModule.ayumi_remove_dc(this.ayumiPtr);

				// Read the sample from WASM memory
				const leftOffset = this.ayumiPtr + AYUMI_STRUCT_LEFT_OFFSET;
				const rightOffset = this.ayumiPtr + AYUMI_STRUCT_RIGHT_OFFSET;

				const leftValue = new Float64Array(this.wasmModule.memory.buffer, leftOffset, 1)[0];
				const rightValue = new Float64Array(
					this.wasmModule.memory.buffer,
					rightOffset,
					1
				)[0];

				leftChannel[i] = leftValue;
				rightChannel[i] = rightValue;
			}
		}

		return true;
	}
}

registerProcessor('preview-processor', PreviewProcessor);
