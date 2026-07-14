import type { DialogContentProps } from "@xgx/ui";
import { Button, DialogFooter, Stack, Text, toast } from "@xgx/ui";
import { CircleCheck, GitBranch } from "@xgx/ui/icons";
import { createSignal } from "solid-js";

export type CloseIssueChoice = "closed" | "related";

export interface CloseIssueDialogProps
	extends DialogContentProps<CloseIssueChoice> {
	closeTicket: (choice: CloseIssueChoice) => Promise<void>;
}

export function CloseIssueDialog(props: CloseIssueDialogProps) {
	const [pending, setPending] = createSignal<CloseIssueChoice>();

	const close = async (choice: CloseIssueChoice) => {
		setPending(choice);
		try {
			await props.closeTicket(choice);
			props.resolve(choice);
		} catch (error) {
			toast.error(
				"Ticket could not be closed",
				error instanceof Error ? error.message : "Try again in a moment.",
			);
		} finally {
			setPending(undefined);
		}
	};

	return (
		<Stack gap="4">
			<div class="grid gap-2 sm:grid-cols-2">
				<div class="rounded-lg border p-3">
					<Text as="p" size="sm" weight="medium">
						<CircleCheck class="mr-2 inline size-4" />
						Close as resolved
					</Text>
					<Text as="p" size="xs" class="mt-2 text-muted-foreground">
						Add your draft as the final comment, then close this ticket.
					</Text>
					<Button
						class="mt-3 w-full"
						disabled={Boolean(pending())}
						onClick={() => void close("closed")}
						size="sm"
						variant="outline"
					>
						{pending() === "closed" ? "Closing..." : "Close as resolved"}
					</Button>
				</div>

				<div class="rounded-lg border p-3">
					<Text as="p" size="sm" weight="medium">
						<GitBranch class="mr-2 inline size-4" />
						Close and create related
					</Text>
					<Text as="p" size="xs" class="mt-2 text-muted-foreground">
						Close this ticket and use your draft for a linked request.
					</Text>
					<Button
						class="mt-3 w-full"
						disabled={Boolean(pending())}
						onClick={() => void close("related")}
						size="sm"
					>
						{pending() === "related"
							? "Closing..."
							: "Close and create related"}
					</Button>
				</div>
			</div>

			<DialogFooter>
				<Button
					disabled={Boolean(pending())}
					onClick={() => props.reject()}
					size="sm"
					variant="ghost"
				>
					Cancel
				</Button>
			</DialogFooter>
		</Stack>
	);
}
