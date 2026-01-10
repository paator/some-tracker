/**
 * Pattern Instrument Context Service
 *
 * Helps determine which instrument should be used for preview playback
 * based on the current editing context.
 */

import type { Pattern } from '../../models/song';

export class PatternInstrumentContext {
	/**
	 * Get the instrument that should be used for preview at the current position.
	 *
	 * Logic:
	 * 1. If current row has instrument set in this channel, use it
	 * 2. Otherwise, look backwards in the channel for the most recent instrument
	 * 3. If no instrument found, default to instrument 0 (index 0 = instrument 01)
	 */
	static getInstrumentForPreview(
		pattern: Pattern,
		rowIndex: number,
		channelIndex: number
	): number {
		// Validate channelIndex
		if (channelIndex < 0 || channelIndex >= pattern.channels.length) {
			return 0; // Default to instrument 0 (01)
		}

		// Check current row
		const currentRow = pattern.channels[channelIndex]?.rows[rowIndex];
		if (currentRow && currentRow.instrument !== undefined && currentRow.instrument !== null && currentRow.instrument > 0) {
			return currentRow.instrument;
		}

		// Look backwards for the most recent instrument
		for (let i = rowIndex - 1; i >= 0; i--) {
			const row = pattern.channels[channelIndex]?.rows[i];
			if (row && row.instrument !== undefined && row.instrument !== null && row.instrument > 0) {
				return row.instrument;
			}
		}

		// Default to instrument 0 (01)
		return 0;
	}

	/**
	 * Get the volume that should be used for preview at the current position.
	 *
	 * Logic:
	 * 1. If current row has volume set in this channel, use it
	 * 2. Otherwise, look backwards in the channel for the most recent volume
	 * 3. If no volume found, default to 15 (max volume)
	 */
	static getVolumeForPreview(
		pattern: Pattern,
		rowIndex: number,
		channelIndex: number
	): number {
		// Validate channelIndex
		if (channelIndex < 0 || channelIndex >= pattern.channels.length) {
			return 15; // Default to max volume
		}

		// Check current row
		const currentRow = pattern.channels[channelIndex]?.rows[rowIndex];
		if (currentRow && currentRow.volume !== undefined && currentRow.volume !== null && currentRow.volume > 0) {
			return currentRow.volume;
		}

		// Look backwards for the most recent volume
		for (let i = rowIndex - 1; i >= 0; i--) {
			const row = pattern.channels[channelIndex]?.rows[i];
			if (row && row.volume !== undefined && row.volume !== null && row.volume > 0) {
				return row.volume;
			}
		}

		// Default to max volume (15)
		return 15;
	}

	/**
	 * Get the channel index from the selected column.
	 * This assumes the standard pattern layout where columns are grouped by channel.
	 */
	static getChannelIndexFromColumn(selectedColumn: number, pattern: Pattern): number {
		// Each channel typically has 6 columns in AY chip:
		// note(3) + instrument(2) + envelopeShape(1) + table(2) + volume(1) + effect(3) = 12 total
		// But we need to determine this from the pattern structure

		const numChannels = pattern.channels.length;
		if (numChannels === 0) {
			return 0;
		}

		// Simple approach: divide column by approximate columns per channel
		// This should be calculated based on the chip schema, but for now we'll use a heuristic
		const columnsPerChannel = Math.ceil(selectedColumn / numChannels) || 1;
		const channelIndex = Math.floor(selectedColumn / columnsPerChannel);

		return Math.min(channelIndex, numChannels - 1);
	}
}
