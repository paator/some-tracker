<script lang="ts">
	import type { Pattern, Instrument } from '../../models/song';
	import type { Ornament } from '../../models/project';
	import type { ChipProcessor } from '../../core/chip-processor';
	import type { AudioService } from '../../services/audio-service';
	import { getColors } from '../../utils/colors';
	import { getFonts } from '../../utils/fonts';
	import {
		getRowDataStructured,
		type RowPart,
		type NoteParameterField
	} from '../../utils/pattern-format';
	import PatternOrder from './PatternOrder.svelte';
	import { getContext } from 'svelte';
	import { PATTERN_EDITOR_CONSTANTS } from './types';
	import { playbackStore } from '../../stores/playback.svelte';

	let {
		patterns = $bindable(),
		patternOrder = $bindable(),
		ayProcessor,
		tuningTable,
		speed,
		ornaments,
		instruments
	}: {
		patterns: Pattern[];
		patternOrder: number[];
		ayProcessor: ChipProcessor;
		tuningTable: number[];
		speed: number;
		ornaments: Ornament[];
		instruments: Instrument[];
	} = $props();

	const services: { audioService: AudioService } = getContext('container');

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;

	let COLORS = getColors();
	let FONTS = getFonts();

	let canvasWidth = $state(PATTERN_EDITOR_CONSTANTS.DEFAULT_CANVAS_WIDTH);
	let canvasHeight = $state(PATTERN_EDITOR_CONSTANTS.DEFAULT_CANVAS_HEIGHT);
	let lineHeight =
		PATTERN_EDITOR_CONSTANTS.FONT_SIZE * PATTERN_EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER;

	let selectedColumn = $state(0);
	let currentPatternOrderIndex = $state(0);
	let selectedRow = $state(0);

	let currentPattern = $derived(patterns[patternOrder[currentPatternOrderIndex]]);

	export function resetToBeginning() {
		selectedRow = 0;
		currentPatternOrderIndex = 0;
	}

	export function playFromCursor() {
		if (!ayProcessor || !ayProcessor.isAudioNodeAvailable()) {
			console.warn('Audio processor not available or not initialized');
			return;
		}

		try {
			if (!currentPattern) {
				console.warn('No pattern selected');
				return;
			}

			initPlayback();

			services.audioService.updateOrder(patternOrder);
			services.audioService.playFromRow(selectedRow);
		} catch (error) {
			console.error('Error during playback from cursor:', error);
			services.audioService.stop();
		}
	}

	export function togglePlayback() {
		if (!ayProcessor || !ayProcessor.isAudioNodeAvailable()) {
			console.warn('Audio processor not available or not initialized');
			return;
		}

		try {
			if (!services.audioService.playing) {
				if (!currentPattern) {
					console.warn('No pattern selected');
					return;
				}

				initPlayback();

				services.audioService.updateOrder(patternOrder);
				services.audioService.play();
			}
		} catch (error) {
			console.error('Error during playback toggle:', error);
			services.audioService.stop();
		}
	}

	function initPlayback() {
		ayProcessor.sendInitPattern(currentPattern, currentPatternOrderIndex);
		ayProcessor.sendInitTuningTable(tuningTable);
		ayProcessor.sendInitSpeed(speed);
		ayProcessor.sendInitInstruments(instruments);
	}

	function pausePlayback() {
		services.audioService.stop();
	}

	function getCellPositions(
		parts: RowPart[]
	): { x: number; width: number; partIndex: number; fieldIndex: number; charIndex: number }[] {
		const positions: {
			x: number;
			width: number;
			partIndex: number;
			fieldIndex: number;
			charIndex: number;
		}[] = [];
		let x = 10;

		for (let partIndex = 0; partIndex < parts.length; partIndex++) {
			const part = parts[partIndex];

			if (part.type === 'rowNum') {
				x += ctx.measureText(part.value as string).width;
				x += ctx.measureText(' ').width;
				continue;
			}

			if (part.type === 'note') {
				const value = part.value as string;
				const width = ctx.measureText(value).width;
				positions.push({ x, width, partIndex, fieldIndex: -1, charIndex: 0 });
				x += width;
				x += ctx.measureText(' ').width;
				continue;
			}

			if (part.type === 'noteParameters') {
				const fields = part.value as NoteParameterField[];
				for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
					const field = fields[fieldIndex];
					for (let charIndex = 0; charIndex < field.value.length; charIndex++) {
						const width = ctx.measureText(field.value[charIndex]).width;
						positions.push({ x, width, partIndex, fieldIndex, charIndex });
						x += width;
					}
				}
				x += ctx.measureText(' ').width;
				continue;
			}

			const value = part.value as string;
			for (let charIndex = 0; charIndex < value.length; charIndex++) {
				const width = ctx.measureText(value[charIndex]).width;
				positions.push({ x, width, partIndex, fieldIndex: -1, charIndex });
				x += width;
			}
			x += ctx.measureText(' ').width;
		}

		return positions;
	}

	function getTotalCellCount(parts: RowPart[]): number {
		let count = 0;
		for (const part of parts) {
			if (part.type === 'noteParameters') {
				const fields = part.value as NoteParameterField[];
				for (const field of fields) {
					count += field.value.length;
				}
			} else {
				count += (part.value as string).length;
			}
			count += 1; // for space between parts
		}
		return count;
	}

	function getVisibleRows() {
		const visibleCount = Math.floor(canvasHeight / lineHeight);
		const halfVisible = Math.floor(visibleCount / 2);
		const startRow = selectedRow - halfVisible;
		const endRow = selectedRow + halfVisible;

		const rows = [];
		let displayIndex = 0;

		for (let i = startRow; i <= endRow; i++) {
			let rowAdded = false;

			if (i >= 0 && i < currentPattern.length) {
				rows.push({
					rowIndex: i,
					isSelected: i === selectedRow,
					isGhost: false,
					patternIndex: patternOrder[currentPatternOrderIndex],
					displayIndex
				});
				rowAdded = true;
			} else if (i < 0) {
				const prevPatternOrderIndex = currentPatternOrderIndex - 1;
				if (prevPatternOrderIndex >= 0) {
					const prevPatternIndex = patternOrder[prevPatternOrderIndex];
					const prevPattern = patterns[prevPatternIndex];
					if (prevPattern) {
						const ghostRowIndex = prevPattern.length + i;
						if (ghostRowIndex >= 0 && ghostRowIndex < prevPattern.length) {
							rows.push({
								rowIndex: ghostRowIndex,
								isSelected: false,
								isGhost: true,
								patternIndex: prevPatternIndex,
								displayIndex
							});
							rowAdded = true;
						}
					}
				}
			} else {
				const nextPatternOrderIndex = currentPatternOrderIndex + 1;
				if (nextPatternOrderIndex < patternOrder.length) {
					const nextPatternIndex = patternOrder[nextPatternOrderIndex];
					const nextPattern = patterns[nextPatternIndex];
					if (nextPattern) {
						const ghostRowIndex = i - currentPattern.length;
						if (ghostRowIndex < nextPattern.length) {
							rows.push({
								rowIndex: ghostRowIndex,
								isSelected: false,
								isGhost: true,
								patternIndex: nextPatternIndex,
								displayIndex
							});
							rowAdded = true;
						}
					}
				}
			}

			if (!rowAdded) {
				rows.push({
					rowIndex: -1,
					isSelected: false,
					isGhost: false,
					patternIndex: -1,
					displayIndex,
					isEmpty: true
				});
			}

			displayIndex++;
		}
		return rows;
	}

	function setupCanvas() {
		if (!canvas) return;

		ctx = canvas.getContext('2d')!;

		try {
			updateSize();

			const dpr = window.devicePixelRatio || 1;
			canvas.width = canvasWidth * dpr;
			canvas.height = canvasHeight * dpr;
			canvas.style.width = canvasWidth + 'px';
			canvas.style.height = canvasHeight + 'px';

			ctx.scale(dpr, dpr);
			ctx.font = `${PATTERN_EDITOR_CONSTANTS.FONT_SIZE}px ${FONTS.mono}`;
			ctx.textBaseline = 'middle';
		} catch (error) {
			console.error('Error during canvas setup:', error);
		}
	}

	function drawRowStructured(parts: RowPart[], y: number, isSelected: boolean, rowIndex: number) {
		if (rowIndex % 4 === 0) {
			ctx.fillStyle = COLORS.patternAlternate;
			ctx.fillRect(0, y, canvasWidth, lineHeight);
		}

		if (isSelected) {
			ctx.fillStyle = COLORS.patternSelected;
			ctx.fillRect(0, y, canvasWidth, lineHeight);
		}

		const cellPositions = getCellPositions(parts);
		if (isSelected && selectedColumn < cellPositions.length) {
			const cellPos = cellPositions[selectedColumn];
			ctx.fillStyle = COLORS.patternCellSelected;
			ctx.fillRect(cellPos.x - 1, y, cellPos.width + 2, lineHeight);
		}

		let x = 10;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part.type === 'noteParameters') {
				const fields = part.value as NoteParameterField[];
				for (let f = 0; f < fields.length; f++) {
					const field = fields[f];
					let color;
					switch (field.type) {
						case 'instrument':
							color = COLORS.patternInstrument;
							break;
						case 'shape':
							color = COLORS.patternEnvelope;
							break;
						case 'ornament':
							color = COLORS.patternOrnament;
							break;
						case 'volume':
							color = COLORS.patternText;
							break;
					}
					for (let c = 0; c < field.value.length; c++) {
						const char = field.value[c];
						if (char === '.') {
							ctx.fillStyle = isSelected
								? COLORS.patternEmptySelected
								: rowIndex % 4 === 0
									? COLORS.patternAlternateEmpty
									: COLORS.patternEmpty;
						} else {
							ctx.fillStyle = color;
						}
						ctx.fillText(char, x, y + lineHeight / 2);
						x += ctx.measureText(char).width;
					}
				}
				x += ctx.measureText(' ').width;
			} else {
				let color = COLORS.patternText;
				switch (part.type) {
					case 'rowNum':
						color =
							rowIndex % 4 === 0
								? COLORS.patternRowNumAlternate
								: COLORS.patternRowNum;
						break;
					case 'envelope':
						color = COLORS.patternEnvelope;
						break;
					case 'envEffect':
						color = COLORS.patternEffect;
						break;
					case 'noise':
						color = COLORS.patternNoise;
						break;
					case 'note':
						const value = part.value as string;
						ctx.fillStyle =
							value === '---'
								? isSelected
									? COLORS.patternEmptySelected
									: rowIndex % 4 === 0
										? COLORS.patternAlternateEmpty
										: COLORS.patternEmpty
								: COLORS.patternNote;
						ctx.fillText(value, x, y + lineHeight / 2);
						x += ctx.measureText(value).width;
						x += ctx.measureText(' ').width;
						continue;
					case 'fx':
						color = COLORS.patternEffect;
						break;
				}
				const value = part.value as string;
				for (let c = 0; c < value.length; c++) {
					const char = value[c];
					if (char === '.' || char === '-') {
						ctx.fillStyle = isSelected
							? COLORS.patternEmptySelected
							: rowIndex % 4 === 0
								? COLORS.patternAlternateEmpty
								: COLORS.patternEmpty;
					} else {
						ctx.fillStyle = color;
					}
					ctx.fillText(char, x, y + lineHeight / 2);
					x += ctx.measureText(char).width;
				}
				x += ctx.measureText(' ').width;
			}
		}
	}

	function draw() {
		if (!ctx || !currentPattern) return;

		ctx.fillStyle = COLORS.patternBg;
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		const visibleRows = getVisibleRows();
		visibleRows.forEach((row) => {
			const y = row.displayIndex * lineHeight;

			if (row.isEmpty) {
				return;
			}

			if (row.isGhost) {
				ctx.globalAlpha = 0.3;
			} else {
				ctx.globalAlpha = 1.0;
			}

			const pattern = patterns[row.patternIndex];
			if (pattern) {
				const parts = getRowDataStructured(pattern, row.rowIndex);
				drawRowStructured(parts, y, row.isSelected, row.rowIndex);
			}
		});

		ctx.globalAlpha = 1.0;
	}

	function moveRow(delta: number) {
		const newRow = selectedRow + delta;
		if (newRow >= 0 && newRow < currentPattern.length) {
			selectedRow = newRow;
		} else if (delta < 0 && currentPatternOrderIndex > 0) {
			currentPatternOrderIndex--;
			selectedRow = patterns[patternOrder[currentPatternOrderIndex]].length - 1;
		} else if (delta > 0 && currentPatternOrderIndex < patternOrder.length - 1) {
			currentPatternOrderIndex++;
			selectedRow = 0;
		}

		if (currentPattern) {
			const parts = getRowDataStructured(currentPattern, selectedRow);
			const cellPositions = getCellPositions(parts);
			const maxCells = cellPositions.length;
			if (selectedColumn >= maxCells) {
				selectedColumn = Math.max(0, maxCells - 1);
			}
		}
	}

	function moveColumn(delta: number) {
		if (!currentPattern) return;

		const parts = getRowDataStructured(currentPattern, selectedRow);
		const cellPositions = getCellPositions(parts);
		const maxCells = cellPositions.length;
		let newColumn = selectedColumn + delta;

		if (newColumn < 0) newColumn = 0;
		if (newColumn >= maxCells) newColumn = maxCells - 1;

		selectedColumn = newColumn;
	}

	function handleKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case ' ':
				event.preventDefault();
				playbackStore.isPlaying = !playbackStore.isPlaying;
				if (playbackStore.isPlaying) {
					togglePlayback();
				} else {
					pausePlayback();
				}
				break;
			case 'ArrowUp':
				event.preventDefault();
				moveRow(-1);
				break;
			case 'ArrowDown':
				event.preventDefault();
				moveRow(1);
				break;
			case 'ArrowLeft':
				event.preventDefault();
				moveColumn(-1);
				break;
			case 'ArrowRight':
				event.preventDefault();
				moveColumn(1);
				break;
			case 'PageUp':
				event.preventDefault();
				moveRow(-16);
				break;
			case 'PageDown':
				event.preventDefault();
				moveRow(16);
				break;
			case 'Home':
				event.preventDefault();
				if (event.ctrlKey) {
					selectedRow = 0;
				} else {
					selectedColumn = 0;
				}
				break;
			case 'End':
				event.preventDefault();
				if (event.ctrlKey) {
					selectedRow = currentPattern.length - 1;
				} else {
					const parts = getRowDataStructured(currentPattern, selectedRow);
					const cellPositions = getCellPositions(parts);
					const maxCells = cellPositions.length;
					selectedColumn = Math.max(0, maxCells - 1);
				}
				break;
		}
	}

	function handleWheel(event: WheelEvent) {
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
			return;
		}

		event.preventDefault();
		moveRow(Math.sign(event.deltaY));
	}

	function handleMouseEnter(): void {
		if (canvas) {
			canvas.focus();
		}
	}

	function updateSize() {
		canvasHeight = Math.max(
			PATTERN_EDITOR_CONSTANTS.MIN_CANVAS_HEIGHT,
			window.innerHeight - PATTERN_EDITOR_CONSTANTS.CANVAS_TOP_MARGIN
		);
		if (ctx && currentPattern) {
			const parts = getRowDataStructured(currentPattern, 0);
			let width = 10; // starting x position
			for (const part of parts) {
				if (part.type === 'noteParameters') {
					const fields = part.value as NoteParameterField[];
					for (const field of fields) {
						width += ctx.measureText(field.value).width;
					}
				} else {
					width += ctx.measureText(part.value as string).width;
				}
				width += ctx.measureText(' ').width; // space between parts
			}
			canvasWidth = width + PATTERN_EDITOR_CONSTANTS.CANVAS_PADDING;
		} else {
			canvasWidth = PATTERN_EDITOR_CONSTANTS.DEFAULT_CANVAS_WIDTH;
		}
	}

	$effect(() => {
		if (canvas) {
			setupCanvas();
			draw();
		}
	});

	$effect(() => {
		const handleResize = () => {
			if (document.hidden) return;
			updateSize();
			setupCanvas();
			draw();
		};

		const handleVisibilityChange = () => {
			if (!document.hidden) {
				updateSize();
				setupCanvas();
				draw();
			}
		};

		window.addEventListener('resize', handleResize);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	$effect(() => {
		if (!ayProcessor) return;

		const handlePatternUpdate = (
			currentRow: number,
			currentPatternOrderIndexUpdate?: number
		) => {
			if (services.audioService.playing) {
				selectedRow = currentRow;
				if (currentPatternOrderIndexUpdate !== undefined) {
					currentPatternOrderIndex = currentPatternOrderIndexUpdate;
				}
			}
		};

		const handlePatternRequest = (requestedOrderIndex: number) => {
			if (requestedOrderIndex >= 0 && requestedOrderIndex < patternOrder.length) {
				const patternIndex = patternOrder[requestedOrderIndex];
				const requestedPattern = patterns[patternIndex];

				if (requestedPattern) {
					ayProcessor.sendRequestedPattern(requestedPattern);
				}
			}
		};

		ayProcessor.setCallbacks(handlePatternUpdate, handlePatternRequest);
	});
</script>

<div class="flex flex-col gap-2">
	<div class="flex" style="max-height: {canvasHeight}px">
		<PatternOrder
			bind:currentPatternOrderIndex
			bind:patterns
			bind:selectedRow
			bind:patternOrder
			{canvasHeight}
			{lineHeight} />

		<canvas
			bind:this={canvas}
			tabindex="0"
			onkeydown={handleKeyDown}
			onwheel={handleWheel}
			onmouseenter={handleMouseEnter}
			class="focus:border-opacity-50 border-pattern-empty focus:border-pattern-text block border transition-colors duration-150 focus:outline-none">
		</canvas>
	</div>
</div>
