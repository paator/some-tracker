import type { ChipProcessor, SettingsSubscriber } from '../../chips/base/processor';
import type { Chip } from '../../chips/types';
import type { Table } from '../../models/project';
import { ChipSettings } from './chip-settings';
import { channelMuteStore } from '../../stores/channel-mute.svelte';
import { PreviewNoteService } from './preview-note-service';

export class AudioService {
	private _audioContext: AudioContext | null = new AudioContext();
	private _isPlaying = false;
	public chipSettings: ChipSettings = new ChipSettings();
	private _masterGainNode: GainNode | null = null;

	//for example 1x FM chip processor, 2x AY chip processors for TSFM track
	//they will all be mixed together in single audio context
	chipProcessors: ChipProcessor[] = [];

	// Preview note services - one per chip for real-time note preview
	previewServices: PreviewNoteService[] = [];

	constructor() {
		// Web browsers like to disable audio contexts when they first exist to prevent auto-play video/audio ads.
		// We explicitly re-enable it whenever the user does something on the page.
		if (this._audioContext) {
			this._masterGainNode = this._audioContext.createGain();
			this._masterGainNode.connect(this._audioContext.destination);
			this._masterGainNode.gain.value = 1.0;

			document.addEventListener('keydown', () => this._audioContext?.resume(), {
				once: true
			});
			document.addEventListener('mousedown', () => this._audioContext?.resume(), {
				once: true
			});
			document.addEventListener('touchstart', () => this._audioContext?.resume(), {
				once: true
			});
			document.addEventListener('touchend', () => this._audioContext?.resume(), {
				once: true
			});
		}
	}

	async addChipProcessor(chip: Chip) {
		if (!this._audioContext || !this._masterGainNode) {
			throw new Error('Audio context not initialized');
		}

		const processor = this.createChipProcessor(chip);
		this.chipProcessors.push(processor);

		if (this.hasSettingsSubscription(processor)) {
			processor.subscribeToSettings(this.chipSettings);
		}

		const response = await fetch(import.meta.env.BASE_URL + chip.wasmUrl);
		const wasmBuffer = await response.arrayBuffer();

		await this._audioContext.audioWorklet.addModule(
			import.meta.env.BASE_URL + chip.processorName + '.js'
		);

		const audioNode = this.createAudioNode();

		processor.initialize(wasmBuffer, audioNode);

		// Initialize preview note service for this chip
		const previewService = new PreviewNoteService(this._audioContext, this._masterGainNode);
		await previewService.initialize(chip, wasmBuffer);
		this.previewServices.push(previewService);
	}

	play() {
		if (this._isPlaying) return;

		this._isPlaying = true;

		this.applyMuteStateToAllChips();

		this.chipProcessors.forEach((chipProcessor) => {
			chipProcessor.play();
		});
	}

	playFromRow(
		row: number,
		patternOrderIndex?: number,
		getSpeedForChip?: (chipIndex: number) => number | null
	) {
		if (this._isPlaying) return;

		this._isPlaying = true;

		this.applyMuteStateToAllChips();

		this.chipProcessors.forEach((chipProcessor, index) => {
			const speed = getSpeedForChip ? getSpeedForChip(index) : undefined;
			chipProcessor.playFromRow(row, patternOrderIndex, speed);
		});
	}

	stop() {
		if (!this._isPlaying) return;

		this._isPlaying = false;

		this.chipProcessors.forEach((chipProcessor) => {
			chipProcessor.stop();
		});
	}

	updateOrder(order: number[]) {
		this.chipProcessors.forEach((chipProcessor) => {
			chipProcessor.updateOrder(order);
		});
	}

	updateTables(tables: Table[]) {
		this.chipProcessors.forEach((chipProcessor) => {
			chipProcessor.sendInitTables(tables);
		});
	}

	updateInstruments(instruments: import('../../models/song').Instrument[]) {
		this.chipProcessors.forEach((chipProcessor) => {
			if ('sendInitInstruments' in chipProcessor) {
				(chipProcessor as any).sendInitInstruments(instruments);
			}
		});

		// Update preview services with new instruments
		this.previewServices.forEach((previewService) => {
			previewService.updateInstruments(instruments);
		});
	}

	updateSpeed(speed: number) {
		this.chipProcessors.forEach((chipProcessor) => {
			chipProcessor.sendInitSpeed(speed);
		});
	}

	clearChipProcessors() {
		if (this._isPlaying) {
			this.stop();
		}

		// Clean up preview services
		this.previewServices.forEach((service) => service.destroy());
		this.previewServices = [];

		this.chipProcessors = [];
	}

	async dispose() {
		if (this._isPlaying) {
			this.stop();
		}

		// Clean up preview services
		this.previewServices.forEach((service) => service.destroy());
		this.previewServices = [];

		if (this._audioContext) {
			await this._audioContext.close();
			this._audioContext = null;
		}

		this.chipProcessors = [];
	}

	get playing() {
		return this._isPlaying;
	}

	private createAudioNode() {
		if (!this._audioContext || !this._masterGainNode) {
			throw new Error('Audio context not initialized');
		}

		const audioNode = new AudioWorkletNode(
			this._audioContext,
			this.chipProcessors[0].chip.processorName,
			{
				outputChannelCount: [2]
			}
		);

		audioNode.connect(this._masterGainNode);

		return audioNode;
	}

	setVolume(volume: number) {
		if (this._masterGainNode) {
			this._masterGainNode.gain.value = Math.max(0, Math.min(1, volume / 100));
		}
	}

	private createChipProcessor(chip: Chip): ChipProcessor {
		const createProcessor = chip.processorMap;
		if (!createProcessor) {
			throw new Error(`Unsupported chip: ${chip}`);
		}

		return createProcessor();
	}

	private hasSettingsSubscription(
		processor: ChipProcessor
	): processor is ChipProcessor & SettingsSubscriber {
		return (
			'subscribeToSettings' in processor &&
			'unsubscribeFromSettings' in processor &&
			typeof (processor as unknown as SettingsSubscriber).subscribeToSettings ===
				'function' &&
			typeof (processor as unknown as SettingsSubscriber).unsubscribeFromSettings ===
				'function'
		);
	}

	private applyMuteStateToAllChips(): void {
		const allMuteStates = channelMuteStore.getAllMuteStates();

		this.chipProcessors.forEach((chipProcessor, chipIndex) => {
			const chipMutes = allMuteStates.get(chipIndex);
			if (chipMutes) {
				chipMutes.forEach((isMuted, channelIndex) => {
					chipProcessor.updateParameter(`channelMute_${channelIndex}`, isMuted);
				});
			}
		});
	}

	/**
	 * Get the preview note service for a specific chip
	 */
	getPreviewService(chipIndex: number): PreviewNoteService | null {
		return this.previewServices[chipIndex] || null;
	}
}
