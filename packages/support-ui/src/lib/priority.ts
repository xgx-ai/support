/**
 * Priority helpers.
 *
 * Tickets can carry a priority label (`p0`, `p1`, `p2`, or `p3`) that maps to a
 * human-readable level shown in the UI:
 *
 *   p0 → Critical
 *   p1 → High
 *   p2 → Medium
 *   p3 → Low   (default when no priority label is present)
 */

export type PriorityLevel = "critical" | "high" | "medium" | "low";
export type PriorityLabel = "p0" | "p1" | "p2" | "p3";

/** Label names that represent a priority. */
const PRIORITY_LABELS: Record<string, PriorityLevel> = {
	p0: "critical",
	p1: "high",
	p2: "medium",
	p3: "low",
};

/** Map from level back to the label name. */
const LEVEL_TO_LABEL: Record<PriorityLevel, PriorityLabel> = {
	critical: "p0",
	high: "p1",
	medium: "p2",
	low: "p3",
};

/** All recognised priority label names. */
export const PRIORITY_LABEL_NAMES = new Set(Object.keys(PRIORITY_LABELS));

/** Human-readable display text for each level. */
const DISPLAY_TEXT: Record<PriorityLevel, string> = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
};

/**
 * Badge colour classes for each priority level (Tailwind-friendly).
 * These pair well with the `Badge` component's `variant="outline"` style.
 */
const BADGE_COLORS: Record<PriorityLevel, string> = {
	critical: "#9b2c2c", // dark red
	high: "#e53e3e", // red
	medium: "#dd6b20", // orange
	low: "#718096", // gray
};

export interface Priority {
	level: PriorityLevel;
	/** The GitHub label name (e.g. "p0", "p1", "p2", "p3"). */
	label: PriorityLabel;
	displayText: string;
	color: string;
}

/**
 * Derive the priority from an issue's label list.
 * The *highest* priority label wins if multiple exist.
 * Returns `low` when no priority label is present.
 */
export function getPriority(labels: { name: string }[]): Priority {
	let level: PriorityLevel = "low";

	for (const label of labels) {
		const mapped = PRIORITY_LABELS[label.name.toLowerCase()];
		if (mapped === "critical") {
			level = "critical";
			break;
		}
		if (mapped === "high") {
			level = "high";
			continue;
		}
		if (mapped === "medium" && level === "low") {
			level = "medium";
		}
	}

	return {
		level,
		label: LEVEL_TO_LABEL[level],
		displayText: DISPLAY_TEXT[level],
		color: BADGE_COLORS[level],
	};
}

/**
 * Returns only labels that are **not** priority labels,
 * so they can be displayed in the generic "Labels" column/section.
 */
export function filterNonPriorityLabels<T extends { name: string }>(
	labels: T[],
): T[] {
	return labels.filter((l) => !PRIORITY_LABEL_NAMES.has(l.name.toLowerCase()));
}
