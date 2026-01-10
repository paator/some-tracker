/**
 * Preview Note Service
 *
 * Manages real-time note preview playback as users input notes.
 * Creates a separate audio worklet instance per chip to avoid interfering
 * with pattern playback.
 */

import type { Chip } from '../../chips/types';
import type { Instrument } from '../../models/song';
import { NoteName } from '../../models/song';

interface PreviewNote {
	noteName: NoteName;
	octave: number;
	instrumentIndex: number;
	channelIndex: number;
	key: string; // The keyboard key that triggered this note
}

export class PreviewNoteService {
	private audioContext: AudioContext;
	private audioNode: AudioWorkletNode | null = null;
	private masterGain: GainNode;
	private chip: Chip | null = null;
	private ready: boolean = false;
	private currentNote: PreviewNote | null = null;
	private heldKeys: Set<string> = new Set();
	private instruments: Instrument[] = [];
	private tuningTable: number[] = [];

	constructor(audioContext: AudioContext, masterGain: GainNode) {
		this.audioContext = audioContext;
		this.masterGain = masterGain;
	}

	async initialize(chip: Chip, wasmBuffer: ArrayBuffer): Promise<void> {
		this.chip = chip;

		try {
			// Load the preview processor worklet
			await this.audioContext.audioWorklet.addModule(
				import.meta.env.BASE_URL + 'preview-processor.js'
			);

			// Create the audio worklet node
			this.audioNode = new AudioWorkletNode(this.audioContext, 'preview-processor', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2]
			});

			// Connect to master gain
			this.audioNode.connect(this.masterGain);

			// Wait for ready message
			await new Promise<void>((resolve) => {
				this.audioNode!.port.onmessage = (event) => {
					if (event.data.type === 'ready') {
						this.ready = true;
						resolve();
					}
				};

				// Initialize the worklet with WASM buffer
				this.audioNode!.port.postMessage({
					type: 'init',
					payload: {
						wasmBuffer,
						chipType: chip.type,
						sampleRate: this.audioContext.sampleRate
					}
				});
			});
		} catch (error) {
			console.error('Failed to initialize preview note service:', error);
			throw error;
		}
	}

	/**
	 * Update the instruments available for preview
	 */
	updateInstruments(instruments: Instrument[]): void {
		this.instruments = instruments;
		if (this.audioNode && this.ready) {
			this.audioNode.port.postMessage({
				type: 'update_instruments',
				payload: instruments
			});
		}
	}

	/**
	 * Update the tuning table
	 */
	updateTuningTable(tuningTable: number[]): void {
		this.tuningTable = tuningTable;
		if (this.audioNode && this.ready) {
			this.audioNode.port.postMessage({
				type: 'update_tuning_table',
				payload: tuningTable
			});
		}
	}

	/**
	 * Play a preview note
	 */
	playNote(
		noteName: NoteName,
		octave: number,
		instrumentIndex: number,
		channelIndex: number,
		key: string,
		baseVolume: number = 15
	): void {
		if (!this.audioNode || !this.ready) {
			return;
		}

		// Resume audio context if needed (browser autoplay policy)
		if (this.audioContext.state === 'suspended') {
			this.audioContext.resume();
		}

		// Track the held key
		this.heldKeys.add(key);

		// If already playing the same note, don't restart
		if (
			this.currentNote &&
			this.currentNote.noteName === noteName &&
			this.currentNote.octave === octave &&
			this.currentNote.instrumentIndex === instrumentIndex &&
			this.currentNote.channelIndex === channelIndex
		) {
			return;
		}

		// Store current note
		this.currentNote = {
			noteName,
			octave,
			instrumentIndex,
			channelIndex,
			key
		};

		// Send play command to worklet
		this.audioNode.port.postMessage({
			type: 'play_note',
			payload: {
				noteName,
				octave,
				instrumentIndex,
				channelIndex,
				baseVolume
			}
		});
	}

	/**
	 * Stop the currently playing preview note
	 */
	stopNote(key?: string): void {
		if (!this.audioNode || !this.ready) {
			return;
		}

		// Remove key from held keys
		if (key) {
			this.heldKeys.delete(key);
		}

		// Only stop if no keys are held (or if called without a key)
		if (this.heldKeys.size === 0 || !key) {
			this.audioNode.port.postMessage({
				type: 'stop_note'
			});
			this.currentNote = null;
			this.heldKeys.clear();
		}
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		if (this.audioNode) {
			this.audioNode.disconnect();
			this.audioNode = null;
		}
		this.ready = false;
		this.currentNote = null;
		this.heldKeys.clear();
	}

	/**
	 * Check if a note is currently playing
	 */
	isPlaying(): boolean {
		return this.currentNote !== null;
	}

	/**
	 * Get the currently playing note
	 */
	getCurrentNote(): PreviewNote | null {
		return this.currentNote;
	}
}
