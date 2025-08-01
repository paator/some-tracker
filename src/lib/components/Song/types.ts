export type VisibleRow = {
	rowIndex: number;
	isSelected: boolean;
	isGhost: boolean;
	patternIndex: number;
	displayIndex: number;
	isEmpty?: boolean;
};

export type CellPosition = {
	x: number;
	width: number;
	char: string;
	partIndex: number;
	charIndex: number;
};

export const PATTERN_EDITOR_CONSTANTS = {
	FONT_SIZE: 14,
	LINE_HEIGHT_MULTIPLIER: 1.5,
	DEFAULT_CANVAS_WIDTH: 800,
	DEFAULT_CANVAS_HEIGHT: 600,
	CANVAS_PADDING: 0,
	MIN_CANVAS_HEIGHT: 200,
	CANVAS_TOP_MARGIN: 65,
	ROWS_PER_PAGE: 16
};
