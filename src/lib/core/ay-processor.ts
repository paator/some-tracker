import { AY_CHIP, type Chip } from '../models/chips';
import type { Pattern, Ornament } from '../models/song';
import type { ChipProcessor } from './chip-processor';

type PositionUpdateMessage = {
	type: 'position_update';
	currentRow: number;
	currentPatternOrderIndex?: number;
};

type RequestPatternMessage = {
	type: 'request_pattern';
	patternOrderIndex: number;
};

type WorkletMessage = PositionUpdateMessage | RequestPatternMessage;

type WorkletCommand =
	| { type: 'init'; wasmBuffer: ArrayBuffer }
	| { type: 'play' }
	| { type: 'stop' }
	| { type: 'update_order'; order: number[] }
	| { type: 'init_pattern'; pattern: Pattern; patternOrderIndex: number }
	| { type: 'init_tuning_table'; tuningTable: number[] }
	| { type: 'init_speed'; speed: number }
	| { type: 'set_pattern_data'; pattern: Pattern }
	| { type: 'init_ornaments'; ornaments: Ornament[] };

export class AYProcessor implements ChipProcessor {
	chip: Chip;
	audioNode: AudioWorkletNode | null = null;
	private onPositionUpdate?: (currentRow: number, currentPatternOrderIndex?: number) => void;
	private onPatternRequest?: (patternOrderIndex: number) => void;

	constructor() {
		this.chip = AY_CHIP;
	}

	initialize(wasmBuffer: ArrayBuffer, audioNode: AudioWorkletNode): void {
		if (!wasmBuffer || wasmBuffer.byteLength === 0) {
			throw new Error('WASM buffer not available or empty');
		}

		this.audioNode = audioNode;
		this.audioNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
			this.handleWorkletMessage(event);
		};

		this.sendCommand({ type: 'init', wasmBuffer });
	}

	private sendCommand(command: WorkletCommand): void {
		if (!this.audioNode) {
			throw new Error('Audio node not available');
		}
		this.audioNode.port.postMessage(command);
	}

	setCallbacks(
		onPositionUpdate: (currentRow: number, currentPatternOrderIndex?: number) => void,
		onPatternRequest: (patternOrderIndex: number) => void
	): void {
		this.onPositionUpdate = onPositionUpdate;
		this.onPatternRequest = onPatternRequest;
	}

	play(): void {
		this.sendCommand({ type: 'play' });
	}

	stop(): void {
		this.sendCommand({ type: 'stop' });
	}

	updateOrder(order: number[]): void {
		this.sendCommand({ type: 'update_order', order: Array.from(order) });
	}

	sendInitPattern(pattern: Pattern, patternOrderIndex: number): void {
		this.sendCommand({ type: 'init_pattern', pattern, patternOrderIndex });
	}

	sendInitTuningTable(tuningTable: number[]): void {
		this.sendCommand({ type: 'init_tuning_table', tuningTable });
	}

	sendInitSpeed(speed: number): void {
		this.sendCommand({ type: 'init_speed', speed });
	}

	sendInitOrnaments(ornaments: Ornament[]): void {
		this.sendCommand({ type: 'init_ornaments', ornaments });
	}

	sendRequestedPattern(pattern: Pattern): void {
		this.sendCommand({ type: 'set_pattern_data', pattern });
	}

	private handleWorkletMessage(event: MessageEvent<WorkletMessage>): void {
		const message = event.data;

		switch (message.type) {
			case 'position_update':
				this.onPositionUpdate?.(message.currentRow, message.currentPatternOrderIndex);
				break;
			case 'request_pattern':
				this.onPatternRequest?.(message.patternOrderIndex);
				break;
			default:
				console.warn('Unhandled message:', message);
		}
	}

	isAudioNodeAvailable(): boolean {
		return this.audioNode !== null;
	}
}
