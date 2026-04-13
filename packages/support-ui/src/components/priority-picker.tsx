import { Badge, Flex, Text } from "@xgx/ui";
import { For } from "solid-js";
import type { PriorityLevel } from "../lib/priority";

export interface PriorityOption {
	label: string;
	level: PriorityLevel;
	value: string;
	color: string;
}

const PRIORITY_OPTIONS: PriorityOption[] = [
	{ label: "High", level: "high", value: "p1", color: "#e53e3e" },
	{ label: "Medium", level: "medium", value: "p2", color: "#dd6b20" },
	{ label: "Low", level: "low", value: "p3", color: "#718096" },
];

export interface PriorityPickerProps {
	/** Currently selected priority label (e.g. "p1", "p2", "p3"). `undefined` means none selected. */
	value: string | undefined;
	/** Called when the user picks a priority. */
	onChange: (value: string) => void;
	/** Optional label above the picker. */
	label?: string;
	/** If true, render compact inline badges (for detail page). */
	inline?: boolean;
	/** Disable interaction. */
	disabled?: boolean;
}

export function PriorityPicker(props: PriorityPickerProps) {
	return (
		<div>
			{props.label && (
				<Text
					as="label"
					size="sm"
					weight="medium"
					class="block mb-1.5 text-foreground"
				>
					{props.label}
				</Text>
			)}
			<Flex gap="1.5" class="flex-wrap">
				<For each={PRIORITY_OPTIONS}>
					{(option) => {
						const isSelected = () => props.value === option.value;
						return (
							<button
								type="button"
								disabled={props.disabled}
								onClick={() => props.onChange(option.value)}
								class="transition-all rounded-md"
								style={{
									cursor: props.disabled ? "not-allowed" : "pointer",
									opacity: props.disabled ? "0.5" : "1",
								}}
							>
								<Badge
									variant="outline"
									class="font-normal text-xs"
									style={{
										"border-color": option.color,
										color: isSelected() ? "white" : option.color,
										"background-color": isSelected()
											? option.color
											: "transparent",
									}}
								>
									{option.label}
								</Badge>
							</button>
						);
					}}
				</For>
			</Flex>
		</div>
	);
}
