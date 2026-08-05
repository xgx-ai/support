import { describe, expect, test } from "bun:test";
import {
	filterNonPriorityLabels,
	getPriority,
	PRIORITY_LABEL_NAMES,
} from "./priority";

describe("priority helpers", () => {
	test("recognises P0 as the highest critical priority", () => {
		expect(
			getPriority([{ name: "p1" }, { name: "p2" }, { name: "P0" }]),
		).toMatchObject({
			label: "p0",
			level: "critical",
			displayText: "Critical",
		});
	});

	test("removes every managed priority label from generic labels", () => {
		expect(PRIORITY_LABEL_NAMES).toEqual(new Set(["p0", "p1", "p2", "p3"]));
		expect(
			filterNonPriorityLabels([
				{ name: "bug" },
				{ name: "p0" },
				{ name: "p2" },
			]),
		).toEqual([{ name: "bug" }]);
	});
});
